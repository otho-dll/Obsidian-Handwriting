import { App, Modal, Notice, setIcon } from 'obsidian';

/** One row of the page layout: `orig` = index of an existing page, `null` = new blank page. */
export type PageLayout = (number | null)[];

/**
 * Page management dialog: order (dragging, arrows, number), adding blank pages and deleting.
 * Changes are applied only after "Apply". `paint` draws the thumbnail of an existing page.
 */
export class PageOrderModal extends Modal {
    private items: { orig: number | null }[];
    private listEl!: HTMLElement;
    private current: number;

    constructor(
        app: App,
        count: number,
        currentIndex: number,
        private paint: (originalIndex: number, canvas: HTMLCanvasElement) => Promise<void>,
        private onApply: (layout: PageLayout, newCurrent: number) => void,
        private renderStyle: (container: HTMLElement) => void,
        private startTab: 'pages' | 'style' = 'pages',
    ) {
        super(app);
        this.items = Array.from({ length: count }, (_, i) => ({ orig: i }));
        this.current = currentIndex;
    }

    private pagesPane!: HTMLElement;
    private stylePane!: HTMLElement;
    private pageBtns!: HTMLElement;
    private styleBtns!: HTMLElement;
    private tabBtns: Record<string, HTMLElement> = {};
    private styleBuilt = false;

    private isDirty() {
        return this.items.length !== this.count0() || this.items.some((it, i) => it.orig !== i);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('hw-order-modal');
        this.modalEl.addClass('mod-pages');
        this.titleEl.setText('Pages');

        const tabs = contentEl.createDiv({ cls: 'hw-order-tabs' });
        for (const [k, label] of [['pages', 'Pages'], ['style', 'Page style']] as const) {
            const b = tabs.createEl('button', { text: label });
            b.onclick = () => this.showTab(k);
            this.tabBtns[k] = b;
        }

        // --- "Pages" tab ---
        this.pagesPane = contentEl.createDiv({ cls: 'hw-order-pane' });
        const hint = this.pagesPane.createEl('p', { cls: 'setting-item-description' });
        hint.appendText('Drag ⠿ or use the arrows to reorder. ');
        const plus = hint.createSpan({ cls: 'hw-order-hint-icon' });
        setIcon(plus, 'file-plus');
        hint.appendText(' Above / Below adds a blank page before / after that page, ');
        const bin = hint.createSpan({ cls: 'hw-order-hint-icon' });
        setIcon(bin, 'trash-2');
        hint.appendText(' removes it. Nothing changes until you press Apply.');
        this.listEl = this.pagesPane.createDiv({ cls: 'hw-order-list' });

        // --- "Page style" tab (changes apply immediately) ---
        this.stylePane = contentEl.createDiv({ cls: 'hw-order-pane hw-order-style' });

        this.pageBtns = contentEl.createDiv({ cls: 'hw-pdf-buttons' });
        const bCancel = this.pageBtns.createEl('button', { text: 'Cancel' });
        const bApply = this.pageBtns.createEl('button', { text: 'Apply', cls: 'mod-cta' });
        bCancel.onclick = () => this.close();
        bApply.onclick = () => {
            const layout: PageLayout = this.items.map(it => it.orig);
            if (this.isDirty()) {
                let cur = layout.indexOf(this.current);
                if (cur < 0) cur = Math.max(0, Math.min(this.deletedNear, layout.length - 1));
                this.onApply(layout, cur);
            }
            this.close();
        };
        this.styleBtns = contentEl.createDiv({ cls: 'hw-pdf-buttons' });
        const bClose = this.styleBtns.createEl('button', { text: 'Done', cls: 'mod-cta' });
        bClose.onclick = () => this.close();

        this.render();
        this.showTab(this.startTab);
    }

    private showTab(tab: 'pages' | 'style') {
        if (tab === 'style' && this.isDirty()) {
            new Notice('Apply or cancel your page changes first.');
            return;
        }
        for (const k of Object.keys(this.tabBtns)) this.tabBtns[k].toggleClass('is-active', k === tab);
        this.pagesPane.style.display = tab === 'pages' ? '' : 'none';
        this.pageBtns.style.display = tab === 'pages' ? '' : 'none';
        this.stylePane.style.display = tab === 'style' ? '' : 'none';
        this.styleBtns.style.display = tab === 'style' ? '' : 'none';
        if (tab === 'style' && !this.styleBuilt) {
            this.styleBuilt = true;
            this.renderStyle(this.stylePane);
        }
    }

    private originalCount = -1;
    private deletedNear = 0;
    private count0(): number {
        if (this.originalCount < 0) this.originalCount = this.items.length;
        return this.originalCount;
    }

    private move(from: number, to: number) {
        to = Math.max(0, Math.min(this.items.length - 1, to));
        if (from === to) return;
        const [v] = this.items.splice(from, 1);
        this.items.splice(to, 0, v);
        this.render();
    }

    /** Thumbnails are created once per page and only moved between rows (no redraw after each change). */
    private thumbs = new Map<number, HTMLCanvasElement>();
    private thumbObserver: IntersectionObserver | null = null;

    private thumbFor(orig: number | null): HTMLCanvasElement {
        if (orig !== null) {
            const cached = this.thumbs.get(orig);
            if (cached) return cached;
        }
        const canvas = document.createElement('canvas');
        canvas.className = 'hw-order-thumb';
        canvas.width = 80;
        canvas.height = 113;
        const ctx = canvas.getContext('2d');
        if (ctx) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 80, 113); }
        if (orig !== null) {
            this.thumbs.set(orig, canvas);
            // We draw only when the thumbnail scrolls into the list view (saves a lot of work for long notes).
            if (!this.thumbObserver) {
                this.thumbObserver = new IntersectionObserver((entries) => {
                    for (const e of entries) {
                        if (!e.isIntersecting) continue;
                        const c = e.target as HTMLCanvasElement;
                        this.thumbObserver?.unobserve(c);
                        const idx = Number(c.dataset.orig);
                        if (c.dataset.painted !== '1') { c.dataset.painted = '1'; void this.paint(idx, c); }
                    }
                }, { root: this.listEl, rootMargin: '200px' });
            }
            canvas.dataset.orig = String(orig);
            this.thumbObserver.observe(canvas);
        }
        return canvas;
    }

    private render() {
        this.count0();
        const scroll = this.listEl.scrollTop;
        this.listEl.empty();
        const n = this.items.length;
        this.items.forEach((it, pos) => {
            const row = this.listEl.createDiv({ cls: 'hw-order-row' });
            if (it.orig !== null && it.orig === this.current) row.addClass('hw-order-current');
            if (it.orig === null) row.addClass('hw-order-new');
            const handle = row.createDiv({ cls: 'hw-order-handle', text: '⠿' });
            handle.setAttribute('aria-label', 'Drag to move');
            this.attachDrag(handle, row, pos);
            row.appendChild(this.thumbFor(it.orig));

            const info = row.createDiv({ cls: 'hw-order-info' });
            info.createEl('div', { text: `Page ${pos + 1}`, cls: 'hw-order-title' });
            if (it.orig === null) info.createEl('div', { text: 'new blank page', cls: 'hw-order-was' });
            else if (it.orig !== pos) info.createEl('div', { text: `was ${it.orig + 1}`, cls: 'hw-order-was' });

            const ctl = row.createDiv({ cls: 'hw-order-ctl' });
            const up = ctl.createEl('button', { text: '↑' });
            const down = ctl.createEl('button', { text: '↓' });
            up.setAttribute('aria-label', 'Move up');
            down.setAttribute('aria-label', 'Move down');
            up.disabled = pos === 0;
            down.disabled = pos === n - 1;
            up.onclick = () => this.move(pos, pos - 1);
            down.onclick = () => this.move(pos, pos + 1);
            const mkAdd = (label: string, offset: number, tip: string) => {
                const b = ctl.createEl('button', { cls: 'hw-order-add' });
                setIcon(b.createSpan({ cls: 'hw-order-btn-icon' }), 'file-plus');
                b.createSpan({ text: label });
                b.setAttribute('aria-label', tip);
                b.setAttribute('title', tip);
                b.onclick = () => { this.items.splice(pos + offset, 0, { orig: null }); this.render(); };
            };
            mkAdd('Above', 0, 'Add a blank page before this one');
            mkAdd('Below', 1, 'Add a blank page after this one');
            const del = ctl.createEl('button', { cls: 'hw-order-del' });
            setIcon(del, 'trash-2');
            del.setAttribute('aria-label', 'Remove this page');
            del.setAttribute('title', 'Remove this page');
            del.disabled = n <= 1;
            del.onclick = () => {
                if (this.items.length <= 1) return;
                if (it.orig !== null && it.orig === this.current) this.deletedNear = pos;
                this.items.splice(pos, 1);
                this.render();
            };
        });
        this.listEl.scrollTop = scroll;
    }

    /** Dragging a row by its handle (mouse, finger, pen): the other rows make room live. */
    private attachDrag(handle: HTMLElement, row: HTMLElement, startPos: number) {
        handle.addEventListener('pointerdown', (e: PointerEvent) => {
            e.preventDefault();
            const list = this.listEl;
            const rows = Array.from(list.children) as HTMLElement[];
            if (rows.length < 2) return;
            const step = rows[1].offsetTop - rows[0].offsetTop;
            const startY = e.clientY, startScroll = list.scrollTop;
            let target = startPos;
            handle.setPointerCapture(e.pointerId);
            row.addClass('is-dragging');
            const layout = (dy: number) => {
                row.style.transform = `translateY(${dy}px)`;
                rows.forEach((r, i) => {
                    if (i === startPos) return;
                    let shift = 0;
                    if (startPos < i && i <= target) shift = -step;
                    else if (target <= i && i < startPos) shift = step;
                    r.style.transform = shift ? `translateY(${shift}px)` : '';
                });
            };
            const onMove = (ev: PointerEvent) => {
                const lr = list.getBoundingClientRect();
                if (ev.clientY < lr.top + 36) list.scrollTop -= 14;
                else if (ev.clientY > lr.bottom - 36) list.scrollTop += 14;
                const dy = ev.clientY - startY + (list.scrollTop - startScroll);
                target = Math.max(0, Math.min(rows.length - 1, startPos + Math.round(dy / step)));
                layout(dy);
            };
            const end = (ev: PointerEvent) => {
                handle.removeEventListener('pointermove', onMove);
                handle.removeEventListener('pointerup', end);
                handle.removeEventListener('pointercancel', end);
                try { handle.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
                if (ev.type === 'pointercancel') target = startPos;
                this.move(startPos, target);   // re-renders the list
                if (target === startPos) this.render();
            };
            handle.addEventListener('pointermove', onMove);
            handle.addEventListener('pointerup', end);
            handle.addEventListener('pointercancel', end);
        });
    }

    onClose() {
        this.thumbObserver?.disconnect();
        this.thumbObserver = null;
        this.thumbs.clear();
        this.contentEl.empty();
    }
}
