import { defineMixin } from './mixin';

/**
 * "Wet ink" layer (see HandwritingView.inkCanvas): the pen stroke being written is drawn on one screen-sized canvas
 * above the pages instead of the page's top canvas. The page canvases are scaled with the zoom (up to millions of
 * pixels each); this layer always has the size of the view, sits outside the zoomed page column and uses the
 * browser's low-latency ("desynchronized") canvas mode – the cost of a pen frame no longer grows with the zoom.
 */
export const inkLayerMixin = defineMixin({
    setupInkLayer() {
        this.inkCanvas?.remove();
        this.inkCanvas = null;
        this.inkCtx = null;
        this.inkSaved = false;
        if (!this.scrollArea || !this.plugin.settings.lowLatencyInk) return;
        const c = document.createElement('canvas');
        c.className = 'hw-ink-layer';
        // right above the page column (below the rail, badges and panels)
        if (this.pagesWrapper && this.pagesWrapper.parentElement === this.scrollArea) this.pagesWrapper.after(c);
        else this.scrollArea.appendChild(c);
        const ctx = c.getContext('2d', { desynchronized: true }) as CanvasRenderingContext2D | null;
        if (!ctx) { c.remove(); return; }
        this.inkCanvas = c;
        this.inkCtx = ctx;
        this.sizeInkLayer();
    },

    /** Canvas size = view size × devicePixelRatio (called when the view is resized). */
    sizeInkLayer() {
        const c = this.inkCanvas;
        if (!c || !this.scrollArea) return;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(this.scrollArea.clientWidth * dpr));
        const h = Math.max(1, Math.round(this.scrollArea.clientHeight * dpr));
        if (c.width !== w || c.height !== h) {
            c.width = w; c.height = h;   // resets the context state
            this.inkSaved = false;
            if (this.inkRedrawActive) this.inkRedrawActive();
        }
    },

    /**
     * Prepares the layer for a stroke on page `pageIndex` (`rect` = the page's client rectangle): page coordinates ->
     * layer pixels, clipped to the page. Returns false when the layer is not available.
     */
    beginInk(pageIndex: number, rect: DOMRect): boolean {
        const c = this.inkCanvas, ctx = this.inkCtx;
        if (!c || !ctx || !this.scrollArea) return false;
        const area = this.scrollArea.getBoundingClientRect();
        if (area.width <= 0 || rect.width <= 0) return false;
        const px = c.width / area.width;             // layer pixels per CSS pixel
        const k = rect.width / this.pageW(pageIndex); // CSS pixels per page unit (= zoom)
        if (this.inkSaved) { ctx.restore(); this.inkSaved = false; }
        ctx.save();
        this.inkSaved = true;
        ctx.setTransform(px * k, 0, 0, px * k, px * (rect.left - area.left), px * (rect.top - area.top));
        ctx.beginPath();
        ctx.rect(0, 0, this.pageW(pageIndex), this.pageH(pageIndex));
        ctx.clip();
        this.inkBegin = { pageIndex, rect };
        // OLED care: the page shows inverted ink – the wet ink must look the same.
        c.toggleClass('hw-ink-inv', !!this.pageViews[pageIndex]?.container.hasClass('hw-oled-inv'));
        return true;
    },

    /** Clears the whole layer at once (a stroke being written keeps its transform and clip). */
    clearInkNow() {
        const c = this.inkCanvas, ctx = this.inkCtx;
        if (!c || !ctx) return;
        const active = this.inkSaved ? this.inkBegin : null;
        if (this.inkSaved) { ctx.restore(); this.inkSaved = false; }   // the clip of the current stroke would limit the clearing
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        if (active) this.beginInk(active.pageIndex, active.rect);
    },

    /**
     * The stroke has been committed to the page canvas. The layer is cleared two frames later – by then the page
     * canvas shows the stroke, so it never blinks. A stroke started in the meantime is drawn again after clearing.
     */
    endInk() {
        const ctx = this.inkCtx;
        if (!ctx) return;
        if (this.inkSaved) { ctx.restore(); this.inkSaved = false; }
        if (this.inkClearRaf) window.cancelAnimationFrame(this.inkClearRaf);
        this.inkClearRaf = window.requestAnimationFrame(() => {
            this.inkClearRaf = window.requestAnimationFrame(() => {
                this.inkClearRaf = 0;
                this.clearInkNow();
                if (this.inkRedrawActive) this.inkRedrawActive();
            });
        });
    },
});
export type InkLayerMethods = typeof inkLayerMixin;
