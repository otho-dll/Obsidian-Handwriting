import { defineMixin } from './mixin';

/**
 * Current page: which page is in the middle of the view. It is marked by an accent frame (the other pages are
 * slightly dimmed), highlighted in the pages panel, and shown by a small "12 / 40" indicator beside the page
 * (outside it, so it never covers the writing). Tapping the indicator opens the pages panel.
 * When there is no room beside the page (zoomed in), the indicator sits at the edge of the view and appears
 * only for a moment after scrolling.
 */
const INDICATOR_GAP = 10;      // px between the page edge and the indicator
const INDICATOR_SHOW_MS = 1200;

export const currentPageMixin = defineMixin({
    /** Rebuilds what depends on the page list (after pages were added / removed / renamed). */
    buildPageIndicator() {
        this.currentPageIdx = -1;   // pages were rebuilt: mark the current page again
        if (this.pageNumEl) { this.pageNumEl.remove(); this.pageNumEl = null; }
        if (this.scrollArea) {
            const el = this.scrollArea.createEl('button', { cls: 'hw-page-num' });
            el.setAttribute('aria-label', 'Pages');
            el.addEventListener('pointerdown', (e) => e.stopPropagation());   // not a scroll / drawing gesture
            el.onclick = (e) => { e.stopPropagation(); this.togglePagesPanel('pages'); };
            this.pageNumEl = el;
            this.pageNumW = 0;
        }
        this.updateCurrentPage();
        this.refreshPagesPanel();
    },

    /** Index of the page under point y (page column coordinates) and the offset from its top edge. */
    pageAtWrapperY(y: number): { i: number; within: number } {
        const tops = this.pageTops();
        let i = 0;
        while (i + 1 < tops.length && y >= tops[i + 1] - 7.5) i++;
        return { i, within: y - (tops[i] ?? 0) };
    },

    /** Current page from the view position: frame, pages panel and the indicator. Called after every view change. */
    updateCurrentPage() {
        const n = this.noteData.pages.length;
        const viewH = this.scrollArea?.clientHeight ?? 0;
        const cy = (viewH / 2 - this.pagePositionY) / this.currentZoom;
        const idx = n ? Math.max(0, Math.min(n - 1, this.pageAtWrapperY(cy).i)) : 0;
        if (idx !== this.currentPageIdx) {
            this.currentPageIdx = idx;
            this.markPanelCurrent(idx);
        }
        this.placeCurrentFrame(idx);
        this.placePageIndicator(idx);
    },

    /** "12 / 40" beside the current page: to the right of it, at the top of its visible part. */
    placePageIndicator(i: number) {
        const el = this.pageNumEl;
        const area = this.scrollArea;
        const view = this.pageViews[i];
        const n = this.noteData.pages.length;
        if (!el || !area) return;
        if (n < 2 || !view) { el.style.display = 'none'; return; }
        el.style.display = '';
        const text = `${i + 1} / ${n}`;
        if (el.textContent !== text) { el.setText(text); this.pageNumW = 0; }
        if (!this.pageNumW) this.pageNumW = el.offsetWidth || 56;
        const w = this.pageNumW, h = 26;
        const z = this.currentZoom;
        const vw = area.clientWidth, vh = area.clientHeight;
        const left = this.pagePositionX + (view.outer.offsetLeft + view.container.offsetLeft) * z;
        const top = this.pagePositionY + (view.outer.offsetTop + view.container.offsetTop) * z;
        const right = left + this.pageW(i) * z, bottom = top + this.pageH(i) * z;
        // beside the page when there is room, otherwise at the edge of the view (over the page – only for a moment)
        let x = right + INDICATOR_GAP;
        const beside = x + w <= vw - 8;
        if (!beside) x = vw - w - 8;
        const y = Math.max(8, Math.min(Math.min(vh - h - 8, bottom - h), Math.max(top, 8)));
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        el.toggleClass('is-over', !beside);
        // stronger for a moment after the view moved
        el.addClass('is-recent');
        if (this.pageNumTimer !== null) window.clearTimeout(this.pageNumTimer);
        this.pageNumTimer = window.setTimeout(() => { this.pageNumTimer = null; this.pageNumEl?.removeClass('is-recent'); }, INDICATOR_SHOW_MS);
    },

    /**
     * Current page: an accent frame drawn in screen pixels over the page edge (not inside the zoomed pages),
     * so it is equally visible at every zoom level. Only when the note has more than one page.
     */
    placeCurrentFrame(i: number) {
        const area = this.scrollArea;
        if (!area) return;
        let fr = this.curFrame;
        const view = this.pageViews[i];
        const multi = this.noteData.pages.length >= 2 && !!view;
        // Other pages are dimmed (a veil inside each page), so the current one stands out.
        const want = multi ? view.outer : null;
        if (this.curPageEl !== want) {
            this.curPageEl?.removeClass('hw-page-current');
            want?.addClass('hw-page-current');
            this.curPageEl = want;
        }
        this.pagesWrapper?.toggleClass('hw-dim-others', multi);
        if (!multi) { if (fr) fr.style.display = 'none'; return; }
        if (!fr || fr.parentElement !== area) { fr?.remove(); fr = area.createDiv({ cls: 'hw-current-frame' }); this.curFrame = fr; }
        const z = this.currentZoom;
        const x = this.pagePositionX + (view.outer.offsetLeft + view.container.offsetLeft) * z;
        const y = this.pagePositionY + (view.outer.offsetTop + view.container.offsetTop) * z;
        fr.style.display = '';
        fr.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        fr.style.width = `${Math.round(this.pageW(i) * z)}px`;
        fr.style.height = `${Math.round(this.pageH(i) * z)}px`;
    },

    /** Page content changed: thumbnails in the pages panel are redrawn later; an endless page may need more room. */
    markThumbDirty(i: number) {
        if (this.noteData.pages[i]?.endless) {
            if (this.roomTimer !== null) window.clearTimeout(this.roomTimer);
            this.roomTimer = window.setTimeout(() => { this.roomTimer = null; this.ensurePageRoom(i); }, 250);
        }
        this.markPanelThumbDirty(i);
    },
});
export type CurrentPageMethods = typeof currentPageMixin;
