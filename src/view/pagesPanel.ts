import { defineMixin } from './mixin';
import { App, Menu, Modal, Notice, setIcon } from 'obsidian';
import { PageData } from '../types';
import { PAGE_TEMPLATES, PAPER_COLORS, PageTemplate } from '../templates';
import { PAGE_FORMATS, PageFormat, applyFormat, formatOf, newPage, pageHeight, pageWidth } from '../pageFormat';
import { appendSvg } from '../svg';

/**
 * Pages panel (like Nebo / GoodNotes): overlays the note at the side chosen in the settings
 * (a sheet from the bottom on a phone). Thumbnails grouped into sections by page titles;
 * tap = go to page, drag = move, long press / right click = page menu, "Select" = several pages at once
 * (style, duplicate, move, delete). Page style (size, pattern, paper) is a small popover from here.
 * Changes apply immediately; structural changes can be undone from the toast (and deleting pages
 * first saves a version to the version history).
 */
/** Thumbnail width (CSS px) for 1 / 2 / 3 columns; the panel width follows. */
const THUMB_W: Record<number, number> = { 1: 176, 2: 116, 3: 92 };
const PANEL_W: Record<number, number> = { 1: 216, 2: 292, 3: 360 };
const LONG_PRESS_MS = 420;
const DRAG_START_PX = 7;

class MoveToModal extends Modal {
    constructor(app: App, private count: number, private max: number, private onPick: (pos: number) => void) { super(app); }
    onOpen() {
        this.titleEl.setText(this.count > 1 ? `Move ${this.count} pages` : 'Move page');
        const p = this.contentEl.createEl('p', { cls: 'setting-item-description', text: `New position (1–${this.max}):` });
        void p;
        const input = this.contentEl.createEl('input', { type: 'number', cls: 'hw-pp-moveto' });
        input.min = '1'; input.max = String(this.max);
        const row = this.contentEl.createDiv({ cls: 'hw-pdf-buttons' });
        const cancel = row.createEl('button', { text: 'Cancel' });
        const ok = row.createEl('button', { text: 'Move', cls: 'mod-cta' });
        const go = () => {
            const n = parseInt(input.value, 10);
            if (!Number.isFinite(n) || n < 1 || n > this.max) { input.focus(); return; }
            this.close();
            this.onPick(n - 1);
        };
        cancel.onclick = () => this.close();
        ok.onclick = go;
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        window.setTimeout(() => input.focus(), 30);
    }
    onClose() { this.contentEl.empty(); }
}

export const pagesPanelMixin = defineMixin({
    togglePagesPanel(tab: 'pages' | 'contents' = 'pages') {
        if (this.pagesPanelEl && this.ppTab === tab) this.closePagesPanel();
        else this.openPagesPanel(tab);
    },

    openPagesPanel(tab: 'pages' | 'contents' = 'pages') {
        if (this.pagesPanelEl) { if (this.ppTab !== tab) this.setPanelTab(tab); return; }
        if (!this.scrollArea) return;
        this.ppTab = tab;
        const st = this.plugin.settings;
        const sheet = this.contentEl.clientWidth > 0 && this.contentEl.clientWidth < 600;
        const side = st.pagesPanelSide;
        const cols = sheet ? 3 : st.pagesPanelColumns;
        const panel = this.scrollArea.createDiv({ cls: `hw-pp ${sheet ? 'hw-pp-sheet' : `hw-pp-${side}`}` });
        panel.style.setProperty('--hw-pp-cols', String(cols));
        if (!sheet) panel.style.width = `${PANEL_W[cols]}px`;
        this.ppCols = cols;
        this.pagesPanelEl = panel;
        this.scrollArea.addClass(`hw-pp-open-${sheet ? 'sheet' : side}`);
        // The panel is its own world: no drawing, no page gestures underneath.
        for (const t of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'contextmenu'] as const) {
            panel.addEventListener(t, (e) => e.stopPropagation());
        }
        if (sheet) panel.createDiv({ cls: 'hw-pp-grip' });

        const head = panel.createDiv({ cls: 'hw-pp-head' });
        this.ppHead = head;
        // Two views: page thumbnails / contents (titled pages).
        const tabs = panel.createDiv({ cls: 'hw-pp-seg hw-pp-tabs' });
        this.ppTabBtns = (['pages', 'contents'] as const).map(t => {
            const b = tabs.createEl('button', { text: t === 'pages' ? 'Pages' : 'Contents' });
            b.onclick = () => this.setPanelTab(t);
            return b;
        });
        const search = panel.createDiv({ cls: 'hw-pp-search' });
        const ic = search.createSpan({ cls: 'hw-pp-search-icon' });
        setIcon(ic, 'search');
        const input = search.createEl('input', { type: 'search', placeholder: 'Go to page or title…' });
        input.setAttribute('aria-label', 'Go to page number or search page titles');
        input.addEventListener('input', () => {
            const v = input.value.trim();
            if (/^\d+$/.test(v)) { this.ppFilter = ''; this.buildPanelList(); this.ppReveal(parseInt(v, 10) - 1, true); }
            else { this.ppFilter = v.toLowerCase(); this.buildPanelList(); }
        });
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                const v = input.value.trim();
                if (/^\d+$/.test(v)) { this.goToPageFromPanel(parseInt(v, 10) - 1); input.value = ''; this.ppFilter = ''; this.buildPanelList(); }
            } else if (e.key === 'Escape') { input.value = ''; this.ppFilter = ''; this.buildPanelList(); }
        });

        const list = panel.createDiv({ cls: 'hw-pp-list' });
        this.ppList = list;
        // Touch: after a long press the finger drags the page – the list must not scroll then.
        list.addEventListener('touchmove', (e) => { if (this.ppDrag?.lifted) e.preventDefault(); }, { passive: false });

        this.ppToast = panel.createDiv({ cls: 'hw-pp-toast' });
        const foot = panel.createDiv({ cls: 'hw-pp-foot' });
        this.ppFoot = foot;

        this.ppObserver = new IntersectionObserver((entries) => {
            for (const en of entries) {
                const i = Number((en.target as HTMLElement).dataset.i);
                if (en.isIntersecting) { this.ppVisible.add(i); if (!this.ppPainted.has(i)) this.ppDirty.add(i); }
                else this.ppVisible.delete(i);
            }
            this.schedulePanelThumbs(20);
        }, { root: list, rootMargin: '200px 0px' });

        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || activeDocument.querySelector('.modal-container')) return;
            if (this.ppStylePop) this.closePageStylePop();
            else if (this.ppSelecting) this.setPanelSelecting(false);
            else this.closePagesPanel();
        };
        this.contentEl.ownerDocument.addEventListener('keydown', onKey);
        this.ppCleanup = () => this.contentEl.ownerDocument.removeEventListener('keydown', onKey);

        this.renderPanelChrome();
        this.buildPanelList();
        this.ppReveal(this.currentPageIdx >= 0 ? this.currentPageIdx : this.pageIndexAtViewCenter(), false);
    },

    setPanelColumns(c: 1 | 2 | 3) {
        const st = this.plugin.settings;
        if (st.pagesPanelColumns === c && this.ppCols === c) return;
        st.pagesPanelColumns = c;
        void this.plugin.saveSettings();
        const tab = this.ppTab;
        this.closePagesPanel();
        this.openPagesPanel(tab);
    },

    setPanelTab(tab: 'pages' | 'contents') {
        this.ppTab = tab;
        if (tab === 'contents' && this.ppSelecting) { this.ppSelecting = false; this.ppSelected.clear(); this.pagesPanelEl?.removeClass('hw-pp-selecting'); }
        this.ppFilter = '';
        const inp = this.pagesPanelEl?.querySelector('.hw-pp-search input') as HTMLInputElement | null;
        if (inp) { inp.value = ''; inp.placeholder = tab === 'pages' ? 'Go to page or title…' : 'Search titles…'; }
        this.renderPanelChrome();
        this.buildPanelList();
        if (tab === 'pages') this.ppReveal(Math.max(0, this.currentPageIdx), false);
    },

    /** Contents view: titled pages as a list (tap = go, right click / long press = rename). */
    buildContentsList(list: HTMLElement) {
        const titled = this.titledPages();
        const cur = Math.max(0, this.currentPageIdx);
        let section = -1;
        for (const t of titled) if (t.index <= cur) section = t.index;
        const f = this.ppFilter;
        const rows = titled.filter(t => !f || t.title.toLowerCase().includes(f));
        if (titled.length === 0) list.createDiv({ cls: 'hw-pp-empty', text: 'No titled pages yet. Give a page a title (right-click it, or the button below) – titled pages start sections here and become bookmarks in exported PDFs.' });
        else if (rows.length === 0) list.createDiv({ cls: 'hw-pp-empty', text: 'No page title matches.' });
        const n = this.noteData.pages.length;
        rows.forEach(t => {
            const k = titled.indexOf(t);
            const end = k + 1 < titled.length ? titled[k + 1].index - 1 : n - 1;
            const row = list.createEl('button', { cls: 'hw-pp-toc' });
            if (t.index === section) row.addClass('is-current');
            row.createSpan({ cls: 'hw-pp-toc-title', text: t.title });
            row.createSpan({ cls: 'hw-pp-toc-page', text: end > t.index ? `${t.index + 1}–${end + 1}` : String(t.index + 1) });
            row.onclick = () => this.goToPageFromPanel(t.index);
            row.oncontextmenu = (e) => {
                e.preventDefault();
                const m = new Menu();
                m.addItem(it => it.setTitle('Rename…').setIcon('pencil').onClick(() => this.editPageTitle(t.index)));
                m.addItem(it => it.setTitle('Remove title').setIcon('x').onClick(() => this.setPageTitle(t.index, '')));
                m.showAtMouseEvent(e);
            };
        });
    },

    closePagesPanel() {
        this.closePageStylePop();
        this.ppCleanup?.();
        this.ppCleanup = null;
        this.ppObserver?.disconnect();
        this.ppObserver = null;
        if (this.ppTimer !== null) { window.clearTimeout(this.ppTimer); this.ppTimer = null; }
        if (this.ppToastTimer !== null) { window.clearTimeout(this.ppToastTimer); this.ppToastTimer = null; }
        this.pagesPanelEl?.remove();
        this.pagesPanelEl = null;
        this.ppList = null;
        this.ppCells = [];
        this.ppCanvases = [];
        this.ppSelected.clear();
        this.ppSelecting = false;
        this.ppVisible.clear();
        this.ppPainted.clear();
        this.ppDirty.clear();
        this.ppFilter = '';
        this.scrollArea?.removeClass('hw-pp-open-left', 'hw-pp-open-right', 'hw-pp-open-sheet');
    },

    /** Header and footer – they change with the selection mode. */
    renderPanelChrome() {
        const head = this.ppHead, foot = this.ppFoot;
        if (!head || !foot) return;
        head.empty();
        foot.empty();
        const n = this.noteData.pages.length;
        this.ppTabBtns.forEach((b, i) => b.toggleClass('active', (i === 0 ? 'pages' : 'contents') === this.ppTab));
        (this.pagesPanelEl?.querySelector('.hw-pp-tabs') as HTMLElement | null)?.toggleClass('hw-hidden', this.ppSelecting);
        if (this.ppTab === 'contents') {
            foot.removeClass('hw-pp-actions');
            head.createSpan({ cls: 'hw-pp-title', text: 'Contents' });
            head.createSpan({ cls: 'hw-pp-count', text: String(this.titledPages().length) });
            head.createDiv({ cls: 'hw-pp-spacer' });
            const close = head.createEl('button', { cls: 'hw-pp-icon' });
            close.setAttribute('aria-label', 'Close pages panel');
            setIcon(close, 'x');
            close.onclick = () => this.closePagesPanel();
            const cur = Math.max(0, this.currentPageIdx);
            const has = !!this.noteData.pages[cur]?.title;
            const t = foot.createEl('button', { cls: 'hw-pp-add mod-cta', text: has ? `Rename page ${cur + 1}…` : `Title page ${cur + 1}…` });
            t.disabled = !this.canEdit();
            t.onclick = () => this.editPageTitle(cur);
            return;
        }
        if (this.ppSelecting) {
            head.createSpan({ cls: 'hw-pp-title', text: `${this.ppSelected.size} selected` });
            head.createDiv({ cls: 'hw-pp-spacer' });
            const all = head.createEl('button', { cls: 'hw-pp-textbtn', text: this.ppSelected.size === n ? 'Select none' : 'Select all' });
            all.onclick = () => {
                if (this.ppSelected.size === n) this.ppSelected.clear();
                else for (let i = 0; i < n; i++) this.ppSelected.add(i);
                this.refreshPanelSelection();
            };
            const done = head.createEl('button', { cls: 'hw-pp-btn', text: 'Done' });
            done.onclick = () => this.setPanelSelecting(false);
            const sel = () => [...this.ppSelected].sort((a, b) => a - b);
            const none = this.ppSelected.size === 0;
            const act = (icon: string, text: string, run: () => void, danger = false) => {
                const b = foot.createEl('button', { cls: `hw-pp-act${danger ? ' hw-pp-danger' : ''}` });
                const s = b.createSpan(); setIcon(s, icon);
                b.createSpan({ text });
                b.disabled = none;
                b.onclick = run;
            };
            foot.addClass('hw-pp-actions');
            act('paintbrush', 'Style', () => this.openPageStylePop(sel()));
            act('copy', 'Duplicate', () => this.duplicatePages(sel()));
            act('move-vertical', 'Move to…', () => this.promptMovePages(sel()));
            act('trash-2', 'Delete', () => this.deletePages(sel()), true);
        } else {
            foot.removeClass('hw-pp-actions');
            head.createSpan({ cls: 'hw-pp-title', text: 'Pages' });
            head.createSpan({ cls: 'hw-pp-count', text: String(n) });
            head.createDiv({ cls: 'hw-pp-spacer' });
            // Number of thumbnail columns (also in the settings).
            if (!this.pagesPanelEl?.hasClass('hw-pp-sheet')) {
                const colsBtn = head.createEl('button', { cls: 'hw-pp-icon hw-pp-cols' });
                colsBtn.setAttribute('aria-label', 'Thumbnail columns');
                setIcon(colsBtn, 'columns-3');
                colsBtn.createSpan({ cls: 'hw-pp-cols-n', text: String(this.ppCols) });
                colsBtn.onclick = (e) => {
                    const m = new Menu();
                    for (const c of [1, 2, 3] as const) {
                        m.addItem(it => it.setTitle(c === 1 ? 'One column' : c === 2 ? 'Two columns' : 'Three columns').setChecked(this.ppCols === c).onClick(() => this.setPanelColumns(c)));
                    }
                    m.showAtMouseEvent(e);
                };
            }
            const close = head.createEl('button', { cls: 'hw-pp-icon' });
            close.setAttribute('aria-label', 'Close pages panel');
            setIcon(close, 'x');
            close.onclick = () => this.closePagesPanel();
            const add = foot.createEl('button', { cls: 'hw-pp-add mod-cta' });
            const s = add.createSpan(); setIcon(s, 'plus');
            add.createSpan({ text: 'Add page' });
            add.setAttribute('aria-label', 'Add a page at the end');
            add.onclick = () => this.insertPagesAt(this.noteData.pages.length);
            const select = foot.createEl('button', { cls: 'hw-pp-btn hw-pp-foot-btn', text: 'Select' });
            select.onclick = () => this.setPanelSelecting(true);
        }
    },

    setPanelSelecting(on: boolean) {
        this.ppSelecting = on;
        this.ppSelected.clear();
        this.pagesPanelEl?.toggleClass('hw-pp-selecting', on);
        if (!on) this.closePageStylePop();
        this.renderPanelChrome();
        this.refreshPanelSelection();
    },

    refreshPanelSelection() {
        this.ppCells.forEach((c, i) => c?.toggleClass('is-selected', this.ppSelected.has(i)));
        if (this.ppSelecting) this.renderPanelChrome();
    },

    /** Rebuilds the list (after page changes); keeps the scroll position. */
    refreshPagesPanel() {
        if (!this.pagesPanelEl) return;
        const n = this.noteData.pages.length;
        for (const i of [...this.ppSelected]) if (i >= n) this.ppSelected.delete(i);
        this.renderPanelChrome();
        this.buildPanelList();
        if (this.ppStylePop) this.ppStyleRefresh?.();
    },

    /** Thumbnails grouped into sections (a section starts at every titled page). */
    buildPanelList() {
        const list = this.ppList;
        if (!list) return;
        const keep = list.scrollTop;
        this.ppObserver?.disconnect();
        list.empty();
        this.ppCells = [];
        this.ppCanvases = [];
        this.ppPainted.clear();
        this.ppVisible.clear();
        this.ppDirty.clear();
        if (this.ppTab === 'contents') { this.buildContentsList(list); list.scrollTop = keep; return; }
        const pages = this.noteData.pages;
        const hasTitles = pages.some(p => p.title);
        const groups: { start: number; end: number; title: string }[] = [];
        pages.forEach((p, i) => {
            if (i === 0 || p.title) groups.push({ start: i, end: i, title: p.title ?? '' });
            else groups[groups.length - 1].end = i;
        });
        const f = this.ppFilter;
        let shown = 0;
        for (const g of groups) {
            if (f && !g.title.toLowerCase().includes(f)) continue;
            shown++;
            const collapsed = this.ppCollapsed.has(g.start) && !f;
            if (hasTitles) {
                const h = list.createEl('button', { cls: 'hw-pp-sec' });
                const chev = h.createSpan({ cls: 'hw-pp-sec-chev' });
                setIcon(chev, collapsed ? 'chevron-right' : 'chevron-down');
                h.createSpan({ cls: 'hw-pp-sec-title', text: g.title || 'Untitled' });
                h.createSpan({ cls: 'hw-pp-sec-range', text: g.start === g.end ? `p. ${g.start + 1}` : `p. ${g.start + 1}–${g.end + 1}` });
                h.onclick = () => {
                    if (this.ppCollapsed.has(g.start)) this.ppCollapsed.delete(g.start); else this.ppCollapsed.add(g.start);
                    this.buildPanelList();
                };
            }
            if (collapsed) continue;
            const grid = list.createDiv({ cls: 'hw-pp-grid' });
            for (let i = g.start; i <= g.end; i++) this.buildPanelCell(grid, i);
        }
        if (f && shown === 0) list.createDiv({ cls: 'hw-pp-empty', text: 'No page title matches.' });
        list.scrollTop = keep;
        this.markPanelCurrent(this.currentPageIdx);
    },

    buildPanelCell(grid: HTMLElement, i: number) {
        const page = this.noteData.pages[i];
        const cell = grid.createDiv({ cls: 'hw-pp-cell' });
        cell.dataset.i = String(i);
        cell.setAttribute('role', 'button');
        cell.setAttribute('tabindex', '0');
        cell.setAttribute('aria-label', `Page ${i + 1}${page.title ? ` – ${page.title}` : ''}`);
        const frame = cell.createDiv({ cls: 'hw-pp-thumb' });
        const ratio = page.endless ? 1.414 : pageHeight(page) / pageWidth(page);
        const c = frame.createEl('canvas');
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const tw = THUMB_W[this.ppCols] ?? 116;
        c.width = Math.round(tw * dpr);
        c.height = Math.round(tw * ratio * dpr);
        c.style.width = `${tw}px`;
        c.style.height = `${Math.round(tw * ratio)}px`;
        frame.createSpan({ cls: 'hw-pp-check' });
        if (page.endless) frame.createSpan({ cls: 'hw-pp-badge', text: 'Endless' });
        const label = cell.createDiv({ cls: 'hw-pp-num', text: String(i + 1) });
        if (page.title) label.addClass('has-title');
        this.ppCells[i] = cell;
        this.ppCanvases[i] = c;
        if (this.ppSelected.has(i)) cell.addClass('is-selected');
        // OLED care: a light page is shown dark here too
        const real = this.effectiveStyle(i).paper;
        if (this.displayPaper(real) !== real) cell.addClass('hw-oled-inv');
        this.ppObserver?.observe(cell);
        this.wirePanelCell(cell, i);
    },

    /** Tap, long press, right click and dragging of one thumbnail. */
    wirePanelCell(cell: HTMLElement, i: number) {
        let press: { id: number; x: number; y: number; type: string; timer: number } | null = null;
        const clearPress = () => { if (press) window.clearTimeout(press.timer); press = null; };
        cell.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            clearPress();
            const p = { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType, timer: 0 };
            press = p;
            if (e.pointerType !== 'mouse') {
                p.timer = window.setTimeout(() => {
                    if (press !== p) return;
                    // Long press: the page lifts – moving drags it, letting go opens the page menu.
                    this.ppDrag = { from: i, lifted: true, started: false, x: p.x, y: p.y, id: p.id, ghost: null, target: -1 };
                    cell.addClass('is-lifted');
                    try { cell.setPointerCapture(p.id); } catch { /* the pointer may be gone */ }
                }, LONG_PRESS_MS);
            }
        });
        cell.addEventListener('pointermove', (e: PointerEvent) => {
            const d = this.ppDrag;
            if (d && d.id === e.pointerId) { this.panelDragMove(cell, e); return; }
            if (!press || press.id !== e.pointerId) return;
            const moved = Math.hypot(e.clientX - press.x, e.clientY - press.y);
            if (press.type === 'mouse' && moved > DRAG_START_PX && (e.buttons & 1)) {
                this.ppDrag = { from: i, lifted: true, started: false, x: press.x, y: press.y, id: e.pointerId, ghost: null, target: -1 };
                clearPress();
                try { cell.setPointerCapture(e.pointerId); } catch { /* ignore */ }
                this.panelDragMove(cell, e);
            } else if (press.type !== 'mouse' && moved > 10) {
                clearPress();   // it's a scroll of the list
            }
        });
        const up = (e: PointerEvent) => {
            const d = this.ppDrag;
            if (d && d.id === e.pointerId) {
                cell.removeClass('is-lifted');
                if (d.started) this.panelDragDrop();
                else if (e.type === 'pointerup') { this.endPanelDrag(); this.openPanelPageMenu(i, e); }
                else this.endPanelDrag();
                clearPress();
                return;
            }
            if (!press || press.id !== e.pointerId) return;
            clearPress();
            if (e.type !== 'pointerup') return;
            this.panelTap(i);
        };
        cell.addEventListener('pointerup', up);
        cell.addEventListener('pointercancel', up);
        cell.addEventListener('contextmenu', (e: MouseEvent) => { e.preventDefault(); if (e.button === 2 || (e as PointerEvent).pointerType === 'mouse') this.openPanelPageMenu(i, e); });
        cell.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.panelTap(i); }
            else if (e.key === 'Delete' && this.canEdit()) { e.preventDefault(); this.deletePages(this.ppSelecting && this.ppSelected.has(i) ? [...this.ppSelected] : [i]); }
        });
    },

    panelTap(i: number) {
        if (this.ppSelecting) {
            if (this.ppSelected.has(i)) this.ppSelected.delete(i); else this.ppSelected.add(i);
            this.refreshPanelSelection();
            return;
        }
        this.goToPageFromPanel(i);
    },

    goToPageFromPanel(i: number) {
        const n = this.noteData.pages.length;
        if (n === 0) return;
        const k = Math.max(0, Math.min(n - 1, i));
        this.scrollToPage(k);
        this.markPanelCurrent(k);
        if (this.pagesPanelEl?.hasClass('hw-pp-sheet')) this.closePagesPanel();
    },

    // --- dragging pages ---
    panelDragMove(cell: HTMLElement, e: PointerEvent) {
        const d = this.ppDrag;
        const list = this.ppList;
        if (!d || !list || !this.canEdit()) return;
        e.preventDefault();
        if (!d.started) {
            if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
            d.started = true;
            const moving = this.ppSelecting && this.ppSelected.has(d.from) ? this.ppSelected.size : 1;
            const ghost = activeDocument.body.createDiv({ cls: 'hw-pp-ghost' });
            const src = this.ppCanvases[d.from];
            if (src) {
                const g = ghost.createEl('canvas');
                g.width = src.width; g.height = src.height;
                g.getContext('2d')?.drawImage(src, 0, 0);
            }
            if (moving > 1) ghost.createSpan({ cls: 'hw-pp-ghost-count', text: String(moving) });
            d.ghost = ghost;
            cell.addClass('is-dragging');
            this.ppIndicator = list.createDiv({ cls: 'hw-pp-drop' });
        }
        if (d.ghost) { d.ghost.style.left = `${e.clientX - 40}px`; d.ghost.style.top = `${e.clientY - 50}px`; }
        // Drop target: before or after the thumbnail under the pointer.
        const under = activeDocument.elementsFromPoint(e.clientX, e.clientY).find(el => (el as HTMLElement).hasClass?.('hw-pp-cell')) as HTMLElement | undefined;
        const ind = this.ppIndicator;
        if (under && ind) {
            const r = under.getBoundingClientRect();
            const lr = list.getBoundingClientRect();
            const after = e.clientX > r.left + r.width / 2;
            const idx = Number(under.dataset.i);
            d.target = after ? idx + 1 : idx;
            const x = (after ? r.right + 4 : r.left - 6) - lr.left;
            ind.style.left = `${x}px`;
            ind.style.top = `${r.top - lr.top + list.scrollTop}px`;
            ind.style.height = `${r.height - 18}px`;
            ind.addClass('is-on');
        }
        // Scroll the list while the page is held near its top / bottom edge.
        const lr = list.getBoundingClientRect();
        const edge = 48;
        const speed = e.clientY < lr.top + edge ? -(lr.top + edge - e.clientY) / 3 : e.clientY > lr.bottom - edge ? (e.clientY - (lr.bottom - edge)) / 3 : 0;
        this.ppAutoScroll = speed;
        if (speed !== 0 && !this.ppScrollRaf) {
            const step = () => {
                if (!this.ppList || this.ppAutoScroll === 0 || !this.ppDrag) { this.ppScrollRaf = 0; return; }
                this.ppList.scrollTop += this.ppAutoScroll;
                this.ppScrollRaf = window.requestAnimationFrame(step);
            };
            this.ppScrollRaf = window.requestAnimationFrame(step);
        }
    },

    panelDragDrop() {
        const d = this.ppDrag;
        const target = d?.target ?? -1;
        const from = d?.from ?? -1;
        this.endPanelDrag();
        if (from < 0 || target < 0) return;
        const moving = this.ppSelecting && this.ppSelected.has(from) ? [...this.ppSelected].sort((a, b) => a - b) : [from];
        this.movePagesTo(moving, target);
    },

    endPanelDrag() {
        const d = this.ppDrag;
        d?.ghost?.remove();
        this.ppDrag = null;
        this.ppAutoScroll = 0;
        this.ppIndicator?.remove();
        this.ppIndicator = null;
        this.ppCells.forEach(c => c?.removeClass('is-dragging', 'is-lifted'));
    },

    /** Page menu (long press / right click on a thumbnail). */
    openPanelPageMenu(i: number, e: MouseEvent | PointerEvent) {
        const n = this.noteData.pages.length;
        const many = this.ppSelecting && this.ppSelected.has(i) && this.ppSelected.size > 1;
        const set = many ? [...this.ppSelected].sort((a, b) => a - b) : [i];
        const menu = new Menu();
        if (!many) menu.addItem(it => it.setTitle(`Go to page ${i + 1}`).setIcon('arrow-right').onClick(() => this.goToPageFromPanel(i)));
        if (this.canEdit()) {
            if (!many) {
                menu.addItem(it => it.setTitle('Add page before').setIcon('arrow-up-from-line').onClick(() => this.insertPagesAt(i)));
                menu.addItem(it => it.setTitle('Add page after').setIcon('arrow-down-from-line').onClick(() => this.insertPagesAt(i + 1)));
            }
            menu.addItem(it => it.setTitle(many ? `Duplicate ${set.length} pages` : 'Duplicate').setIcon('copy').onClick(() => this.duplicatePages(set)));
            if (!many) menu.addItem(it => it.setTitle(this.noteData.pages[i]?.title ? 'Rename section…' : 'Set title…').setIcon('heading').onClick(() => this.editPageTitle(i)));
            menu.addItem(it => it.setTitle('Page style…').setIcon('paintbrush').onClick(() => this.openPageStylePop(set)));
            menu.addItem(it => it.setTitle('Move to…').setIcon('move-vertical').onClick(() => this.promptMovePages(set)));
            menu.addSeparator();
            menu.addItem(it => it.setTitle(many ? `Delete ${set.length} pages` : n > 1 ? 'Delete page' : 'Clear page').setIcon('trash-2').onClick(() => this.deletePages(set)));
        }
        menu.showAtMouseEvent(e);
    },

    // --- page operations (all with an "Undo" toast) ---
    /** Replaces the page list; deleting pages first saves a version. The previous list can be restored from the toast. */
    applyPagesArray(next: PageData[], focus: number, toast: string | null) {
        const prev = this.noteData.pages;
        const prevFocus = Math.max(0, this.currentPageIdx);
        if (prev.some(p => !next.includes(p))) void this.snapshotNow('delete');
        if (next.length === 0) next.push(newPage(this.noteData));
        this.noteData.pages = next;
        this.activePageIndex = Math.max(0, Math.min(focus, next.length - 1));
        this.ppSelected.clear();
        this.requestSave();
        this.buildPageElements();
        this.scrollToPage(this.activePageIndex);
        if (toast) this.showPanelToast(toast, () => this.applyPagesArray(prev, prevFocus, null));
    },

    showPanelToast(text: string, undo: () => void) {
        const t = this.ppToast;
        if (!t || !this.pagesPanelEl) { new Notice(text); return; }
        t.empty();
        t.createSpan({ text });
        const b = t.createEl('button', { text: 'Undo' });
        b.onclick = () => { t.removeClass('is-on'); undo(); };
        t.addClass('is-on');
        if (this.ppToastTimer !== null) window.clearTimeout(this.ppToastTimer);
        this.ppToastTimer = window.setTimeout(() => { this.ppToastTimer = null; t.removeClass('is-on'); }, 7000);
    },

    insertPagesAt(pos: number) {
        if (!this.canEdit() || this.endlessBlocksPages()) return;
        const pages = [...this.noteData.pages];
        const at = Math.max(0, Math.min(pos, pages.length));
        pages.splice(at, 0, newPage(this.noteData));
        this.applyPagesArray(pages, at, null);
        this.ppReveal(at, false);
    },

    duplicatePages(indices: number[]) {
        if (!this.canEdit() || indices.length === 0 || this.endlessBlocksPages()) return;
        const pages = [...this.noteData.pages];
        const sorted = [...indices].sort((a, b) => a - b);
        const copies = sorted.map(i => JSON.parse(JSON.stringify(pages[i])) as PageData);
        copies.forEach(c => { delete c.title; for (const im of c.images ?? []) im.id = `${im.id}-${Math.random().toString(36).slice(2, 7)}`; });
        const at = sorted[sorted.length - 1] + 1;
        pages.splice(at, 0, ...copies);
        this.applyPagesArray(pages, at, copies.length > 1 ? `Duplicated ${copies.length} pages` : 'Page duplicated');
        this.ppReveal(at, false);
    },

    deletePages(indices: number[]) {
        if (!this.canEdit() || indices.length === 0) return;
        const del = new Set(indices);
        const pages = this.noteData.pages.filter((_, i) => !del.has(i));
        const first = Math.min(...indices);
        this.applyPagesArray(pages, Math.min(first, Math.max(0, pages.length - 1)), indices.length > 1 ? `Deleted ${indices.length} pages` : `Deleted page ${first + 1}`);
    },

    /** Moves the pages (sorted indices) so the first of them lands before the page that is now at `target`. */
    movePagesTo(indices: number[], target: number) {
        if (!this.canEdit() || indices.length === 0) return;
        const pages = this.noteData.pages;
        const set = new Set(indices);
        const moving = indices.map(i => pages[i]);
        const rest = pages.filter((_, i) => !set.has(i));
        const before = indices.filter(i => i < target).length;
        const at = Math.max(0, Math.min(rest.length, target - before));
        if (indices.length === 1 && (at === indices[0])) return;   // dropped on its own place
        rest.splice(at, 0, ...moving);
        this.applyPagesArray(rest, at, indices.length > 1 ? `Moved ${indices.length} pages` : `Moved page to ${at + 1}`);
        if (this.ppSelecting) { indices.forEach((_, k) => this.ppSelected.add(at + k)); this.refreshPanelSelection(); }
        this.ppReveal(at, false);
    },

    promptMovePages(indices: number[]) {
        if (!this.canEdit() || indices.length === 0) return;
        const n = this.noteData.pages.length;
        new MoveToModal(this.app, indices.length, n - indices.length + 1, (pos) => {
            // pos = the wanted position of the first moved page among the resulting pages
            const set = new Set(indices);
            const restCount = n - indices.length;
            const p = Math.max(0, Math.min(restCount, pos));
            // translate "position among the rest" into a target index in the current list
            let seen = 0, target = n;
            for (let i = 0; i < n; i++) { if (set.has(i)) continue; if (seen === p) { target = i; break; } seen++; }
            this.movePagesTo(indices, target);
        }).open();
    },

    // --- page style popover ---
    /**
     * Page style (size, pattern, paper) as a popover at the side of the view (next to the pages panel when it is open).
     * `pages` = the pages it starts with (selected pages, the clicked page or the current page).
     * Unless several pages were selected, a switch at the top chooses: this page / all pages / another page.
     */
    openPageStylePop(pagesIn: number[]) {
        this.closePageStylePop();
        if (!this.scrollArea || pagesIn.length === 0) return;
        const n0 = this.noteData.pages.length;
        const base = [...new Set(pagesIn)].filter(i => i >= 0 && i < n0).sort((a, b) => a - b);
        if (base.length === 0) return;
        const panel = this.pagesPanelEl;
        const sheet = !!panel?.hasClass('hw-pp-sheet') || (this.contentEl.clientWidth > 0 && this.contentEl.clientWidth < 600);
        const side = this.plugin.settings.pagesPanelSide;
        const where = sheet ? (panel ? 'hw-pp-style-sheet' : 'hw-pp-style-bottom') : panel ? `hw-pp-style-${side}` : `hw-pp-style-edge-${side}`;
        const pop = this.scrollArea.createDiv({ cls: `hw-pp-style ${where}` });
        if (panel && !sheet) pop.style.setProperty('--hw-pp-w', `${panel.offsetWidth}px`);
        this.ppStylePop = pop;
        for (const t of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'contextmenu'] as const) pop.addEventListener(t, (e) => e.stopPropagation());

        let scope: 'pages' | 'all' | 'other' = 'pages';
        let other = base[0];
        const targets = () => scope === 'all' ? this.noteData.pages.map((_, i) => i) : scope === 'other' ? [other] : base;

        const head = pop.createDiv({ cls: 'hw-pp-style-head' });
        head.createSpan({ cls: 'hw-pp-style-title', text: 'Page style' });
        const close = head.createEl('button', { cls: 'hw-pp-icon' });
        close.setAttribute('aria-label', 'Close');
        setIcon(close, 'x');
        close.onclick = () => this.closePageStylePop();

        // Which pages: selected / this page, all pages, another page (with a page picker).
        const scopeSeg = pop.createDiv({ cls: 'hw-pp-seg hw-pp-scope' });
        const scopeBtns = ([['pages', base.length > 1 ? `Selected (${base.length})` : `Page ${base[0] + 1}`], ['all', 'All pages'], ['other', 'Other page']] as const).map(([k, t]) => {
            const b = scopeSeg.createEl('button', { text: t });
            b.onclick = () => { scope = k; refresh(); };
            return [k, b] as const;
        });
        const picker = pop.createDiv({ cls: 'hw-pp-pick' });
        const prev = picker.createEl('button', { cls: 'hw-pp-icon', text: '‹' });
        prev.setAttribute('aria-label', 'Previous page');
        const pickLabel = picker.createDiv({ cls: 'hw-pp-pick-label' });
        pickLabel.createSpan({ text: 'Page' });
        const pickInput = pickLabel.createEl('input', { type: 'number' });
        pickInput.setAttribute('aria-label', 'Page number');
        const pickTotal = pickLabel.createSpan();
        const next = picker.createEl('button', { cls: 'hw-pp-icon', text: '›' });
        next.setAttribute('aria-label', 'Next page');
        const goOther = (i: number) => { other = Math.max(0, Math.min(this.noteData.pages.length - 1, i)); this.scrollToPage(other); refresh(); };
        prev.onclick = () => goOther(other - 1);
        next.onclick = () => goOther(other + 1);
        pickInput.onchange = () => { const v = parseInt(pickInput.value, 10); if (Number.isFinite(v)) goOther(v - 1); };
        pickInput.addEventListener('keydown', (e) => e.stopPropagation());
        const allNote = pop.createDiv({ cls: 'hw-pp-style-note', text: 'Every page of this note and new pages.' });

        const label = (t: string) => pop.createDiv({ cls: 'hw-pp-style-label', text: t });
        label('Size');
        const seg = pop.createDiv({ cls: 'hw-pp-seg' });
        const short: Record<PageFormat, string> = { a4: 'Portrait', a4l: 'Landscape', endless: 'Endless' };
        const fmtBtns = PAGE_FORMATS.map(f => {
            const b = seg.createEl('button');
            appendSvg(b, this.formatPreviewSvg(f.id));
            b.createSpan({ text: short[f.id] });
            b.setAttribute('title', `${f.label} – ${f.hint}`);
            b.onclick = () => {
                if (scope === 'all') this.setPageFormat('all', 0, f.id);
                else this.setFormatOfPages(targets(), f.id);
                refresh();
            };
            return [f.id, b] as const;
        });
        const fmtNote = pop.createDiv({ cls: 'hw-pp-style-note' });

        label('Pattern');
        const tpls = pop.createDiv({ cls: 'hw-pp-tpls' });
        const tplBtns = PAGE_TEMPLATES.map(t => {
            const b = tpls.createEl('button', { cls: 'hw-pp-tpl' });
            appendSvg(b, this.templatePreviewSvg(t.id));
            b.createSpan({ text: t.label });
            b.setAttribute('title', t.label);
            b.onclick = () => { if (scope === 'all') this.setPageStyle('all', 0, { tpl: t.id }); else this.setStyleOfPages(targets(), { tpl: t.id }); refresh(); };
            return [t.id, b] as const;
        });

        label('Paper');
        const papers = pop.createDiv({ cls: 'hw-pp-papers' });
        const setPaper = (c: string) => { if (scope === 'all') this.setPageStyle('all', 0, { paper: c }); else this.setStyleOfPages(targets(), { paper: c }); refresh(); };
        const paperBtns = PAPER_COLORS.map(c => {
            const b = papers.createEl('button', { cls: 'hw-swatch' });
            b.style.setProperty('--sw', c);
            b.setAttribute('aria-label', c);
            b.onclick = () => setPaper(c);
            return [c, b] as const;
        });
        const addBtn = papers.createEl('button', { cls: 'hw-swatch-add' });
        addBtn.setAttribute('aria-label', 'Custom color');
        const colorInput = papers.createEl('input', { type: 'color', cls: 'hw-color-input' });
        addBtn.onclick = () => { colorInput.value = this.effectiveStyle(targets()[0] ?? 0).paper; colorInput.click(); };
        colorInput.oninput = () => setPaper(colorInput.value.toLowerCase());

        const foot = pop.createDiv({ cls: 'hw-pp-style-foot' });
        const reset = foot.createEl('button', { cls: 'hw-pp-textbtn', text: 'Use note default' });
        reset.onclick = () => {
            for (const i of targets()) { const p = this.noteData.pages[i]; if (p) { delete p.tpl; delete p.paper; } }
            this.requestSave();
            this.applyAllPageStyles();
            refresh();
        };

        const refresh = () => {
            const n = this.noteData.pages.length;
            if (n === 0) { this.closePageStylePop(); return; }
            other = Math.min(other, n - 1);
            scopeBtns.forEach(([k, b]) => b.toggleClass('active', scope === k));
            scopeSeg.toggleClass('hw-hidden', n === 1);
            picker.toggleClass('hw-hidden', scope !== 'other');
            allNote.toggleClass('hw-hidden', scope !== 'all');
            if (pickInput.value !== String(other + 1)) pickInput.value = String(other + 1);
            pickInput.max = String(n);
            pickTotal.setText(`/ ${n}`);
            prev.disabled = other <= 0;
            next.disabled = other >= n - 1;
            const idx = targets();
            const pages = idx.map(i => this.noteData.pages[i]).filter(Boolean);
            const effs = idx.map(i => this.effectiveStyle(i));
            const same = <T,>(xs: T[]) => xs.length > 0 && xs.every(x => x === xs[0]) ? xs[0] : null;
            const tpl = scope === 'all' ? (this.noteData.defaults?.tpl ?? this.plugin.settings.defaultTemplate) : same(effs.map(e => e.tpl));
            const paper = scope === 'all' ? (this.noteData.defaults?.paper ?? this.plugin.settings.defaultPaper) : same(effs.map(e => e.paper));
            const fmt = same(pages.map(p => formatOf(p)));
            const locked = pages.length > 0 && pages.every(p => p.bgPath || p.bgImage);
            // Endless: only in a note with a single page (a long page and more pages don't go together).
            const endlessOk = n === 1;
            fmtBtns.forEach(([id, b]) => { b.toggleClass('active', fmt === id); b.disabled = locked || (id === 'endless' && !endlessOk && fmt !== 'endless'); });
            const notes: string[] = [];
            if (!endlessOk) notes.push('Endless is only available in a note with a single page.');
            if (pages.some(p => p.bgPath || p.bgImage)) notes.push('Pages with an imported PDF keep their size.');
            fmtNote.setText(notes.join(' '));
            fmtNote.toggleClass('hw-hidden', notes.length === 0);
            tplBtns.forEach(([id, b]) => b.toggleClass('active', tpl === id));
            paperBtns.forEach(([c, b]) => b.toggleClass('active', paper === c));
            reset.toggleClass('hw-hidden', scope === 'all' || !pages.some(p => p.tpl || p.paper));
            foot.toggleClass('hw-hidden', reset.hasClass('hw-hidden'));
        };
        this.ppStyleRefresh = refresh;
        refresh();

        const outside = (e: PointerEvent) => {
            const t = e.target as Node;
            if (pop.contains(t) || this.pagesPanelEl?.contains(t) || activeDocument.querySelector('.menu')?.contains(t)) return;
            this.closePageStylePop();
        };
        window.setTimeout(() => this.contentEl.ownerDocument.addEventListener('pointerdown', outside, true), 0);
        this.ppStyleCleanup = () => this.contentEl.ownerDocument.removeEventListener('pointerdown', outside, true);
    },

    /** Note with a single endless page: more pages are not possible (tells the user). */
    endlessBlocksPages(): boolean {
        const pages = this.noteData.pages;
        if (!pages.some(p => p.endless)) return false;
        new Notice('This note is one endless page. Switch it to Portrait or Landscape (Page style) to add more pages.', 7000);
        return true;
    },

    closePageStylePop() {
        this.ppStyleCleanup?.();
        this.ppStyleCleanup = null;
        this.ppStylePop?.remove();
        this.ppStylePop = null;
        this.ppStyleRefresh = null;
    },

    setStyleOfPages(indices: number[], patch: { tpl?: PageTemplate; paper?: string }) {
        if (!this.canEdit()) return;
        for (const i of indices) {
            const p = this.noteData.pages[i];
            if (!p) continue;
            if (patch.tpl) p.tpl = patch.tpl;
            if (patch.paper) p.paper = patch.paper;
        }
        this.requestSave();
        this.applyAllPageStyles();
        this.ppStyleRefresh?.();
    },

    setFormatOfPages(indices: number[], f: PageFormat) {
        if (!this.canEdit()) return;
        let changed = false;
        for (const i of indices) {
            const p = this.noteData.pages[i];
            if (!p || p.bgPath || p.bgImage || formatOf(p) === f) continue;
            applyFormat(p, f);
            changed = true;
        }
        if (!changed) return;
        this.requestSave();
        const keep = this.posCurrent();
        this.buildPageElements();
        if (keep) this.posApply(keep);
        this.ppStyleRefresh?.();
    },

    // --- thumbnails in the panel ---
    markPanelCurrent(i: number) {
        if (!this.pagesPanelEl) return;
        if (this.ppTab === 'contents') { this.buildPanelList(); this.renderPanelChrome(); return; }
        this.ppCells.forEach((c, k) => c?.toggleClass('is-current', k === i));
    },

    /** Scrolls the panel so page i is visible (optionally highlighting it for a moment). */
    ppReveal(i: number, flash: boolean) {
        const cell = this.ppCells[i];
        const list = this.ppList;
        if (!cell || !list) return;
        const cr = cell.getBoundingClientRect(), lr = list.getBoundingClientRect();
        if (cr.top < lr.top || cr.bottom > lr.bottom) list.scrollTop += cr.top - lr.top - (lr.height - cr.height) / 2;
        if (flash) { cell.addClass('is-flash'); window.setTimeout(() => cell.removeClass('is-flash'), 900); }
    },

    markPanelThumbDirty(i: number) {
        if (!this.pagesPanelEl || !this.ppCanvases[i]) return;
        this.ppDirty.add(i);
        this.schedulePanelThumbs(500);
    },

    schedulePanelThumbs(delay: number) {
        if (this.ppTimer !== null) return;
        this.ppTimer = window.setTimeout(() => { this.ppTimer = null; this.processPanelThumbs(); }, delay);
    },

    /** Draws visible thumbnails, 3 at a time; while the user is writing only never-drawn ones. */
    processPanelThumbs() {
        if (!this.pagesPanelEl) return;
        const busy = performance.now() - this.lastActivityAt < 1200;
        const todo = [...this.ppDirty].filter(i => this.ppVisible.has(i) && (!busy || !this.ppPainted.has(i)));
        let done = 0;
        for (const i of todo) {
            this.ppDirty.delete(i);
            const c = this.ppCanvases[i];
            if (!c) continue;
            this.ppPainted.add(i);
            void this.renderThumbInner(i, c).catch(e => console.error('Handwriting: page thumbnail failed', e));
            if (++done >= 3) break;
        }
        // Never-drawn thumbnails continue right away; redraws of changed ones wait while the user writes.
        const fresh = [...this.ppDirty].some(i => this.ppVisible.has(i) && !this.ppPainted.has(i));
        if (fresh || todo.length > done) this.schedulePanelThumbs(30);
        else if (busy && this.ppDirty.size) this.schedulePanelThumbs(600);
    },
});
export type PagesPanelMethods = typeof pagesPanelMixin;
