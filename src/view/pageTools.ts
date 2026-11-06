import { defineMixin } from './mixin';
import { Menu } from 'obsidian';
import { PageTemplate, PAGE_TEMPLATES, inkForPaper, templateCssVars, TEMPLATE_CSS_VARS } from '../templates';
import { newPage, PageFormat } from '../pageFormat';

export const pageToolsMixin = defineMixin({
    // --- PAGE OPERATIONS (button at the bottom of the note + "More" menu and right-click menu) ---
    addPageAt(position: number) {
        if (this.endlessBlocksPages()) return;
        const pos = Math.max(0, Math.min(position, this.noteData.pages.length));
        this.noteData.pages.splice(pos, 0, newPage(this.noteData));
        this.activePageIndex = pos;
        this.requestSave();
        this.buildPageElements();
        this.scrollToPage(pos);
    },

    deleteActivePage() {
        const index = this.activePageIndex;
        void this.snapshotNow('delete');   // the state before deleting goes to the version history
        if (this.noteData.pages.length <= 1) {
            this.noteData.pages[0] = newPage(this.noteData);
        } else {
            this.noteData.pages.splice(index, 1);
            this.activePageIndex = Math.max(0, Math.min(index, this.noteData.pages.length - 1));
        }
        this.requestSave();
        this.buildPageElements();
    },

    /** Right-click menu items for managing the active page (no submenus). */
    addPageQuickItems(menu: Menu) {
        const n = this.noteData.pages.length;
        const i0 = this.activePageIndex;
        menu.addItem(it => it.setTitle('Pages panel').setIcon('hw-pages').onClick(() => { this.openPagesPanel(); this.ppReveal(i0, true); }));
        menu.addItem(it => it.setTitle('Add page before').setIcon('arrow-up-from-line').onClick(() => this.addPageAt(this.activePageIndex)));
        menu.addItem(it => it.setTitle('Add page after').setIcon('arrow-down-from-line').onClick(() => this.addPageAt(this.activePageIndex + 1)));
        menu.addItem(it => it.setTitle('Move page up').setIcon('arrow-up').setDisabled(i0 === 0).onClick(() => this.movePage(-1)));
        menu.addItem(it => it.setTitle('Move page down').setIcon('arrow-down').setDisabled(i0 >= n - 1).onClick(() => this.movePage(1)));
        menu.addItem(it => it.setTitle(n > 1 ? 'Delete this page' : 'Clear this page').setIcon('trash-2').onClick(() => this.deleteActivePage()));
    },

    /** "Add new page" button at the bottom of the last page. */
    createAddPageButton() {
        // An endless page grows by itself – no more pages in such a note.
        if (this.noteData.pages.some(p => p.endless)) return;
        const row = this.pagesWrapper.createDiv({ cls: 'hw-add-page-row' });
        const btn = row.createEl('button', { cls: 'hw-add-page-btn', text: '+ Add new page' });
        row.addEventListener('pointerdown', (e) => e.stopPropagation());
        btn.onclick = () => this.addPageAt(this.noteData.pages.length);
    },

    // Moves the active page by `delta` places (-1 = up, +1 = down).
    movePage(delta: number) {
        const from = this.activePageIndex;
        const to = from + delta;
        const n = this.noteData.pages.length;
        if (to < 0 || to >= n) return;
        const order = Array.from({ length: n }, (_, i) => i);
        order.splice(from, 1);
        order.splice(to, 0, from);
        this.applyPageLayout(order, to);
    },

    // New page layout: number = former page index, null = new blank page. Omitted pages are deleted.
    applyPageLayout(layout: (number | null)[], focus: number) {
        const pages = this.noteData.pages;
        const next = layout.map(i => (i === null ? newPage(this.noteData) : pages[i])).filter(Boolean);
        this.applyPagesArray(next, focus, null);
    },

    // --- PAGE PATTERN AND COLOUR ---
    effectiveStyle(i: number): { tpl: PageTemplate; paper: string } {
        const st = this.plugin.settings;
        const d = this.noteData.defaults;
        const p = this.noteData.pages[i];
        return { tpl: p?.tpl ?? d?.tpl ?? st.defaultTemplate, paper: p?.paper ?? d?.paper ?? st.defaultPaper };
    },

    applyPageStyle(i: number) {
        const view = this.pageViews[i];
        if (!view) return;
        const { tpl, paper: real } = this.effectiveStyle(i);
        // OLED care: light paper shown in a dark version (screen only; CSS inverts the ink – .hw-oled-dark).
        const paper = this.displayPaper(real);
        const ink = inkForPaper(paper);
        const el = view.container;
        el.toggleClass('hw-oled-inv', paper !== real);
        PAGE_TEMPLATES.forEach(t => el.removeClass(`hw-tpl-${t.id}`));
        el.addClass(`hw-tpl-${tpl}`);
        // Page pattern as CSS variables (geometry depends on the page size – see templates.ts).
        for (const k of TEMPLATE_CSS_VARS) el.style.removeProperty(k);
        const vars = templateCssVars(tpl, this.pageW(i), this.pageH(i), ink);
        for (const k of Object.keys(vars)) el.style.setProperty(k, vars[k]);
        el.style.setProperty('--hw-paper', paper);
        el.style.setProperty('--hw-line', ink.line);
        el.style.setProperty('--hw-dot', ink.dot);
        el.style.setProperty('--hw-accent', ink.accent);
    },

    applyAllPageStyles() {
        this.pageViews.forEach((_, i) => this.applyPageStyle(i));
        this.noteData.pages.forEach((_, i) => this.markThumbDirty(i));
    },

    // scope 'all' changes the whole note's setting (and clears per-page settings), 'page' only one page.
    setPageStyle(scope: 'page' | 'all', idx: number, patch: { tpl?: PageTemplate; paper?: string }) {
        if (scope === 'all') {
            this.noteData.defaults = { ...(this.noteData.defaults ?? {}), ...patch };
            for (const p of this.noteData.pages) {
                if (patch.tpl) delete p.tpl;
                if (patch.paper) delete p.paper;
            }
        } else {
            const p = this.noteData.pages[idx];
            if (!p) return;
            if (patch.tpl) p.tpl = patch.tpl;
            if (patch.paper) p.paper = patch.paper;
        }
        this.requestSave();
        this.applyAllPageStyles();
    },

    pageIndexAtViewCenter(): number {
        const centerY = (this.scrollArea.clientHeight / 2 - this.pagePositionY) / this.currentZoom;
        let idx = 0;
        for (let i = 0; i < this.pageViews.length; i++) {
            if (centerY >= this.pageViews[i].outer.offsetTop - 8) idx = i;
        }
        return idx;
    },

    templatePreviewSvg(id: PageTemplate): string {
        const frame = '<rect x="1" y="1" width="38" height="50" rx="3" fill="var(--background-primary)" stroke="currentColor" stroke-opacity="0.45"/>';
        let body = '';
        const line = (y: number) => `<path d="M3 ${y}h34" stroke="currentColor" stroke-opacity="0.35"/>`;
        if (id === 'dots') {
            for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) body += `<circle cx="${6 + c * 7}" cy="${7 + r * 7.5}" r="0.9" fill="currentColor" fill-opacity="0.55"/>`;
        } else if (id === 'lines') {
            for (let y = 11; y < 50; y += 6) body += line(y);
        } else if (id === 'grid') {
            for (let y = 7; y < 50; y += 6) body += line(y);
            for (let x = 7; x < 38; x += 6) body += `<path d="M${x} 3v46" stroke="currentColor" stroke-opacity="0.35"/>`;
        } else if (id === 'cornell') {
            for (let y = 11; y < 36; y += 6) body += line(y);
            body += '<path d="M14 3v33M3 36h34" stroke="#dc2626" stroke-opacity="0.55"/>';
        } else if (id === 'isometric') {
            for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) body += `<circle cx="${(r % 2 ? 9.5 : 6) + c * 7}" cy="${6 + r * 6.5}" r="0.9" fill="currentColor" fill-opacity="0.55"/>`;
        } else if (id === 'margin') {
            for (let y = 11; y < 50; y += 6) body += line(y);
            body += '<path d="M9 3v46" stroke="#dc2626" stroke-opacity="0.55"/>';
        } else if (id === 'checklist') {
            for (let y = 11; y < 50; y += 6) body += line(y) + `<rect x="4.5" y="${y - 4.5}" width="3.5" height="3.5" rx="0.6" stroke="currentColor" stroke-opacity="0.6" stroke-width="0.8"/>`;
        } else if (id === 'mm') {
            for (let v = 4; v <= 36; v += 2) {
                const o = (v - 4) % 8 === 0 ? 0.5 : 0.18;
                body += `<path d="M${v} 4v44" stroke="currentColor" stroke-opacity="${o}" stroke-width="0.6"/>`;
            }
            for (let v = 4; v <= 48; v += 2) {
                const o = (v - 4) % 8 === 0 ? 0.5 : 0.18;
                body += `<path d="M4 ${v}h32" stroke="currentColor" stroke-opacity="${o}" stroke-width="0.6"/>`;
            }
        } else if (id === 'music') {
            for (let s = 0; s < 4; s++) for (let l = 0; l < 5; l++) body += `<path d="M4 ${7 + s * 11.5 + l * 1.6}h32" stroke="currentColor" stroke-opacity="0.5" stroke-width="0.6"/>`;
        }
        return `<svg viewBox="0 0 40 52" width="40" height="52" fill="none">${frame}${body}</svg>`;
    },

    /** Small page format icon (portrait, landscape, long). */
    formatPreviewSvg(f: PageFormat): string {
        const r = f === 'a4l' ? { x: 3, y: 12, w: 46, h: 32 } : f === 'endless' ? { x: 14, y: 2, w: 24, h: 50 } : { x: 11, y: 4, w: 30, h: 42 };
        let extra = '';
        if (f === 'endless') extra = `<path d="M${r.x + 4} ${r.y + r.h - 9}h${r.w - 8}M26 ${r.y + r.h - 6}v4m-2.5 -2.5 2.5 2.5 2.5-2.5" stroke="currentColor" stroke-opacity="0.6"/>`;
        return `<svg viewBox="0 0 52 56" width="40" height="44" fill="none"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="3" fill="var(--background-primary)" stroke="currentColor" stroke-opacity="0.45"/>${extra}</svg>`;
    },

    // Scrolls the view so the given page is at the top.
    scrollToPage(i: number) {
        const view = this.pageViews[i];
        if (!view || !this.scrollArea) return;
        this.stopInertia();
        this.activePageIndex = i;
        this.pagePositionY = -(view.outer.offsetTop - 10) * this.currentZoom;
        this.pinnedPageIdx = i;   // the page jumped to is the current one (also when a shorter page sits below it)
        this.applyManualZoom();
        this.scheduleRedrawAfterZoom();
    },

    /** Page style of one page: the pages panel opens with the style popover. */
    openPageStylePanel(_anchor?: { left: number; top: number; bottom: number }) {
        this.openPageStylePop([Math.max(0, Math.min(this.activePageIndex, this.noteData.pages.length - 1))]);
    },
});
export type PageToolsMethods = typeof pageToolsMixin;
