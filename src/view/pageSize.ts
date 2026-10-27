import { defineMixin } from './mixin';
import { A4_W, PageFormat, applyFormat, endlessHeight, pageHeight, pageWidth } from '../pageFormat';

/** Page sizes in the view: pages may have different formats (A4 portrait / landscape, "endless"). */
export const pageSizeMixin = defineMixin({
    pageW(i: number): number { return pageWidth(this.noteData.pages[i]); },
    pageH(i: number): number { return pageHeight(this.noteData.pages[i]); },

    /** Width of the page column = the widest page (narrower ones are centred in it). */
    wrapperW(): number {
        let w = A4_W;
        for (const p of this.noteData.pages) w = Math.max(w, pageWidth(p));
        return w;
    },

    /** Top edges of pages in the page column (from page heights; gap between pages = 15). */
    pageTops(): number[] {
        const tops: number[] = [];
        let y = this.pageViews[0]?.outer.offsetTop ?? 20;
        for (let i = 0; i < this.noteData.pages.length; i++) { tops.push(y); y += this.pageH(i) + 15; }
        return tops;
    },

    /** Left edge of a page relative to the page column. */
    pageOffsetX(i: number): number { return (this.wrapperW() - this.pageW(i)) / 2; },

    /** Sets the page element size (CSS variables) and the page column width. */
    applyPageSize(i: number) {
        const view = this.pageViews[i];
        if (!view) return;
        view.container.style.setProperty('--hw-pw', `${this.pageW(i)}px`);
        view.container.style.setProperty('--hw-ph', `${this.pageH(i)}px`);
        view.container.toggleClass('hw-endless', !!this.noteData.pages[i]?.endless);
        if (this.pagesWrapper) this.pagesWrapper.style.width = `${this.wrapperW()}px`;
    },

    /**
     * "Endless" page: when the content gets near the bottom edge, the page grows (by half an A4).
     * Called after every page content change. Returns true when the height changed.
     */
    ensurePageRoom(i: number): boolean {
        const p = this.noteData.pages[i];
        if (!p?.endless) return false;
        const need = endlessHeight(p);
        if (need <= pageHeight(p)) return false;
        p.h = need;
        this.applyPageSize(i);
        this.applyPageStyle(i);
        this.updateMinimapPageSize(i);
        this.applyManualZoom();
        if (this.pageViews[i]?.active) { this.sizeCanvases(i); this.redrawPage(i); }
        this.requestSave();
        return true;
    },

    /** Changes the format of a page (scope 'page') or of all pages and new pages of the note (scope 'all'). */
    setPageFormat(scope: 'page' | 'all', idx: number, f: PageFormat) {
        if (scope === 'all') {
            this.noteData.defaults = { ...(this.noteData.defaults ?? {}), format: f };
            if (f === 'a4') delete this.noteData.defaults.format;
            for (const p of this.noteData.pages) if (!p.bgPath && !p.bgImage) applyFormat(p, f);
        } else {
            const p = this.noteData.pages[idx];
            if (!p) return;
            applyFormat(p, f);
        }
        this.requestSave();
        const keep = this.posCurrent();
        this.buildPageElements();
        if (keep) this.posApply(keep);
    },
});
export type PageSizeMethods = typeof pageSizeMixin;
