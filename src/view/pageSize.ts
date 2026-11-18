import type { Menu } from 'obsidian';
import { defineMixin } from './mixin';
import { A4_W, PageFormat, applyFormat, endlessHeight, pageHeight, pageWidth } from '../pageFormat';
import { PageData } from '../types';

/** Space above the first row / below the last one, and between pages (both directions). */
const LAYOUT_PAD = 20;
export const LAYOUT_GAP = 15;
/** Height of the "+ Add new page" row under the last page (also set in styles.css). */
const ADD_ROW_H = 140;

export interface LayoutRow { start: number; end: number; x: number; y: number; w: number; h: number; }

/**
 * Where every page sits in the page column (page-column coordinates, before zoom).
 * One column: every row holds one page. Two-page view: consecutive pages of the same orientation share a row;
 * an endless page, or a page without a partner, is alone in its row. Every row is centred in the column.
 */
export interface PageLayout {
    twoUp: boolean;
    x: number[];
    y: number[];
    /** Row index of every page. */
    row: number[];
    rows: LayoutRow[];
    /** Column width (the widest row) and the bottom edge of the last row. */
    w: number;
    bottom: number;
}

const isLandscape = (p: PageData) => pageWidth(p) > pageHeight(p);

/** Page sizes in the view: pages may have different formats (A4 portrait / landscape, "endless"). */
export const pageSizeMixin = defineMixin({
    pageW(i: number): number { return pageWidth(this.noteData.pages[i]); },
    pageH(i: number): number { return pageHeight(this.noteData.pages[i]); },

    /**
     * Computes the page layout (one or two pages per row) without touching the DOM.
     * 1. A manual pair (page.pair) is always side by side, also with the two-page view off.
     * 2. Two-page view: consecutive pages of the same orientation; with an odd number of pages and the "first alone"
     *    option the first page sits alone (like an open book), otherwise the last one is left over.
     * Endless pages are never paired.
     */
    computeLayout(twoUp: boolean): PageLayout {
        const pages = this.noteData.pages;
        const n = pages.length;
        const firstAlone = twoUp && n % 2 === 1 && this.plugin?.settings.twoPageAlone === 'first';
        const rows: LayoutRow[] = [];
        for (let i = 0; i < n;) {
            const p = pages[i], q = pages[i + 1];
            const canPair = !!q && !p.endless && !q.endless;
            let pair = canPair && !!p.pair;
            // The next page starts a manual pair: it keeps its partner, this page stays alone.
            const nextIsManual = !!q?.pair && !!pages[i + 2] && !q.endless && !pages[i + 2].endless;
            if (!pair && twoUp && canPair && !nextIsManual && !(firstAlone && i === 0)) pair = isLandscape(p) === isLandscape(q);
            const end = pair ? i + 1 : i;
            let w = 0, h = 0;
            for (let k = i; k <= end; k++) { w += pageWidth(pages[k]); h = Math.max(h, pageHeight(pages[k])); }
            w += (end - i) * LAYOUT_GAP;
            rows.push({ start: i, end, x: 0, y: 0, w, h });
            i = end + 1;
        }
        let colW = A4_W;
        for (const r of rows) colW = Math.max(colW, r.w);
        const x: number[] = new Array<number>(n), y: number[] = new Array<number>(n), row: number[] = new Array<number>(n);
        let top = LAYOUT_PAD;
        rows.forEach((r, ri) => {
            r.x = (colW - r.w) / 2;
            r.y = top;
            let left = r.x;
            for (let k = r.start; k <= r.end; k++) {
                x[k] = left;
                y[k] = top;
                row[k] = ri;
                left += pageWidth(pages[k]) + LAYOUT_GAP;
            }
            top += r.h + LAYOUT_GAP;
        });
        const bottom = rows.length ? top - LAYOUT_GAP : LAYOUT_PAD;
        return { twoUp, x, y, row, rows, w: colW, bottom };
    },

    /** Current layout (recomputed when the page list or a page size changed). */
    layoutNow(): PageLayout {
        const L = this.pageLayout;
        if (L && L.twoUp === this.twoUp && L.x.length === this.noteData.pages.length) return L;
        this.pageLayout = this.computeLayout(this.twoUp);
        return this.pageLayout;
    },

    /** Recomputes the layout and moves the page elements, the "Add page" row and the column size to it. */
    applyLayout() {
        this.pageLayout = this.computeLayout(this.twoUp);
        const L = this.pageLayout;
        this.pageViews.forEach((v, i) => {
            v.outer.style.left = `${L.x[i]}px`;
            v.outer.style.top = `${L.y[i]}px`;
        });
        let h = L.bottom + LAYOUT_PAD;
        const add = this.addRowEl;
        if (add && add.parentElement === this.pagesWrapper) {
            add.style.top = `${L.bottom + LAYOUT_GAP}px`;
            h = L.bottom + LAYOUT_GAP + ADD_ROW_H + LAYOUT_PAD;
        }
        if (this.pagesWrapper) {
            this.pagesWrapper.style.width = `${L.w}px`;
            this.pagesWrapper.style.height = `${h}px`;
        }
    },

    /** Width of the page column = the widest row (narrower rows are centred in it). */
    wrapperW(): number { return this.layoutNow().w; },

    /** Top edges of pages in the page column. */
    pageTops(): number[] { return this.layoutNow().y; },

    pageTop(i: number): number { return this.layoutNow().y[i] ?? LAYOUT_PAD; },
    pageLeft(i: number): number { return this.layoutNow().x[i] ?? 0; },

    /** Left edge of a page relative to the page column. */
    pageOffsetX(i: number): number { return this.pageLeft(i); },

    /** Row under point y (page column coordinates); the gap between rows belongs half to each. */
    rowAtWrapperY(y: number): number {
        const rows = this.layoutNow().rows;
        let r = 0;
        while (r + 1 < rows.length && y >= rows[r + 1].y - LAYOUT_GAP / 2) r++;
        return r;
    },

    /** Page under point (x, y) (page column coordinates), or the nearest one, and the offset from its top edge. */
    pageAtWrapperPoint(x: number, y: number): { i: number; within: number } {
        const L = this.layoutNow();
        const row = L.rows[this.rowAtWrapperY(y)];
        if (!row) return { i: 0, within: y - LAYOUT_PAD };
        let i = row.start;
        for (let k = row.start + 1; k <= row.end; k++) if (x >= L.x[k] - LAYOUT_GAP / 2) i = k;
        return { i, within: y - L.y[i] };
    },

    /** Two pages side by side? 'auto': when a pair fits the view width at the current zoom (with a margin against flicker). */
    wantTwoUp(): boolean {
        const mode = this.plugin.settings.twoPageMode;
        if (mode === 'off') return false;
        if (mode === 'always') return true;
        const vw = this.scrollArea?.clientWidth ?? 0;
        if (vw === 0) return this.twoUp;   // hidden view: keep what it had
        const need = this.computeLayout(true).w * this.currentZoom + 40;
        return this.twoUp ? need <= vw * 1.08 : need <= vw;
    },

    /** Applies a layout change (`change` runs before the new layout is computed); the point in the middle of the view stays in place. */
    relayoutKeepingCenter(change: () => void) {
        const area = this.scrollArea;
        const vw = area?.clientWidth ?? 0, vh = area?.clientHeight ?? 0;
        if (!area || vw === 0 || vh === 0 || this.pageViews.length === 0) {
            change();
            this.applyLayout();
            return;
        }
        this.stopInertia();
        const z = this.currentZoom;
        const cx = (vw / 2 - this.pagePositionX) / z, cy = (vh / 2 - this.pagePositionY) / z;
        const { i } = this.pageAtWrapperPoint(cx, cy);
        const dx = cx - this.pageLeft(i), dy = cy - this.pageTop(i);
        change();
        this.applyLayout();
        this.pagePositionX = vw / 2 - (this.pageLeft(i) + dx) * z;
        this.pagePositionY = vh / 2 - (this.pageTop(i) + dy) * z;
        this.applyManualZoom();
        this.updateVirtualization();
    },

    /** Switches between one and two pages per row; the point in the middle of the view stays in place. */
    setTwoUp(on: boolean) {
        if (on === this.twoUp) return;
        this.relayoutKeepingCenter(() => { this.twoUp = on; });
    },

    /**
     * Brings the layout up to date: the 'auto' mode follows the zoom / view width, and settings such as "first page
     * alone" or manual pairs may have changed the rows. Returns true when the pages moved.
     */
    relayoutIfNeeded(): boolean {
        const want = this.wantTwoUp();
        const cur = this.pageLayout;
        const next = this.computeLayout(want);
        const same = !!cur && want === this.twoUp && cur.rows.length === next.rows.length
            && cur.rows.every((r, k) => r.start === next.rows[k].start && r.end === next.rows[k].end);
        if (same) return false;
        this.relayoutKeepingCenter(() => { this.twoUp = want; });
        return true;
    },

    // --- MANUAL PAIRS (two chosen pages side by side, the rest unchanged) ---
    /** First page of the manual pair containing page i, or -1. */
    pairStart(i: number): number {
        const pages = this.noteData.pages;
        if (pages[i]?.pair && this.canPair(i)) return i;
        if (i > 0 && pages[i - 1]?.pair && this.canPair(i - 1) && !pages[i - 2]?.pair) return i - 1;
        return -1;
    },

    /** Whether page i and the next one can be shown as a pair (both exist, neither is endless). */
    canPair(i: number): boolean {
        const p = this.noteData.pages[i], q = this.noteData.pages[i + 1];
        return !!p && !!q && !p.endless && !q.endless;
    },

    /** Page menus: "Unpair pages" for a page in a manual pair, otherwise "Show beside next / previous page". */
    addPairMenuItems(menu: Menu, i: number) {
        const start = this.pairStart(i);
        if (start >= 0) {
            menu.addItem(it => it.setTitle('Unpair pages').setIcon('rows-2').onClick(() => this.setManualPair(start, false)));
            return;
        }
        if (this.canPair(i)) menu.addItem(it => it.setTitle('Show beside next page').setIcon('columns-2').onClick(() => this.setManualPair(i, true)));
        if (i > 0 && this.canPair(i - 1)) menu.addItem(it => it.setTitle('Show beside previous page').setIcon('columns-2').onClick(() => this.setManualPair(i - 1, true)));
    },

    /** Shows page i beside page i+1 (on) or removes the pair starting at i (off). Pairs never chain. */
    setManualPair(i: number, on: boolean) {
        const pages = this.noteData.pages;
        if (!pages[i] || !this.canEdit()) return;
        if (on && !this.canPair(i)) return;
        this.relayoutKeepingCenter(() => {
            if (on) {
                pages[i].pair = true;
                if (pages[i - 1]?.pair) delete pages[i - 1].pair;
                if (pages[i + 1]?.pair) delete pages[i + 1].pair;
            } else {
                delete pages[i].pair;
            }
        });
        this.requestSave();
        this.updateCurrentPage();
    },

    /** Sets the page element size (CSS variables) and moves the pages to the new layout. */
    applyPageSize(i: number) {
        const view = this.pageViews[i];
        if (!view) return;
        view.container.style.setProperty('--hw-pw', `${this.pageW(i)}px`);
        view.container.style.setProperty('--hw-ph', `${this.pageH(i)}px`);
        view.container.toggleClass('hw-endless', !!this.noteData.pages[i]?.endless);
        if (!this.buildingPages) this.applyLayout();   // buildPageElements lays out all pages once at the end
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
        this.updateCurrentPage();
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
