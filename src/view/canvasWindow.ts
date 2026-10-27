import { defineMixin } from './mixin';
import { MAX_CANVAS_SCALE, CANVAS_PIXEL_BUDGET } from '../constants';
import { Point, Stroke, ImageItem, Bounds, BBox, PageView } from '../types';

export const canvasWindowMixin = defineMixin({
    // --- RESOLUTION, WINDOWED CANVASES AND PAGE VIRTUALIZATION ---
    // Obsidian theme accent colour (selection, handles, frames).
    accentColor(): string {
        const v = getComputedStyle(document.body).getPropertyValue('--interactive-accent').trim();
        return v || '#2563eb';
    },

    getCrispScale() {
        const dpr = window.devicePixelRatio || 1;
        return Math.max(1, Math.min(dpr * this.currentZoom, MAX_CANVAS_SCALE));
    },

    pageHasHighlighter(index: number) {
        const page = this.noteData.pages[index];
        return !!page && page.strokes.some(s => s.isHighlighter && !s.isEraser);
    },

    // Visible part of the page (logical coordinates), or null when the page is off screen.
    computeVisible(index: number): BBox | null {
        const view = this.pageViews[index];
        if (!view || !this.scrollArea) return null;
        const z = this.currentZoom;
        const left = this.pagePositionX + this.pageOffsetX(index) * z;
        const top = this.pagePositionY + view.outer.offsetTop * z;
        const x0 = Math.max(0, -left / z), x1 = Math.min(this.pageW(index), (this.scrollArea.clientWidth - left) / z);
        const y0 = Math.max(0, -top / z), y1 = Math.min(this.pageH(index), (this.scrollArea.clientHeight - top) / z);
        if (x1 <= x0 || y1 <= y0) return null;
        return { x0, y0, x1, y1 };
    },

    // Canvas window size: fixed for a given zoom and view size (view × 1.35), so the window can be
    // moved over the page without reallocating the canvas or redrawing everything.
    idealWindowSize(index: number): { w: number; h: number } {
        const z = this.currentZoom;
        const vw = this.scrollArea.clientWidth / z, vh = this.scrollArea.clientHeight / z;
        return { w: Math.min(this.pageW(index), Math.max(60, vw * 1.35)), h: Math.min(this.pageH(index), Math.max(60, vh * 1.35)) };
    },

    fixedWindow(index: number, vis: BBox, size: { w: number; h: number }): Bounds {
        let x = (vis.x0 + vis.x1) / 2 - size.w / 2;
        let y = (vis.y0 + vis.y1) / 2 - size.h / 2;
        x = Math.max(0, Math.min(this.pageW(index) - size.w, x));
        y = Math.max(0, Math.min(this.pageH(index) - size.h, y));
        return { x, y, w: size.w, h: size.h };
    },

    computeWindow(index: number): Bounds {
        const vis = this.computeVisible(index);
        if (vis) return this.fixedWindow(index, vis, this.idealWindowSize(index));
        // Page loaded "in advance" (off screen): a strip at the edge it is coming in from is enough.
        const view = this.pageViews[index];
        const z = this.currentZoom;
        const top = this.pagePositionY + view.outer.offsetTop * z;
        const strip = Math.min(this.pageH(index), Math.max(60, (this.scrollArea.clientHeight * 0.4) / z));
        const w = Math.min(this.pageW(index), Math.max(60, (this.scrollArea.clientWidth * 0.4) / z));
        const below = top > this.scrollArea.clientHeight / 2;
        return { x: 0, y: below ? 0 : this.pageH(index) - strip, w, h: strip };
    },

    // Sets the window and canvas sizes (clears their content – redrawPage is always called afterwards).
    sizeCanvases(index: number) {
        const view = this.pageViews[index];
        const ctxs = this.pageContexts[index];
        if (!view || !ctxs) return;
        const hasVis = !!this.computeVisible(index);
        const win = this.computeWindow(index);
        let scale = this.getCrispScale();
        view.crisp = scale;
        const budget = CANVAS_PIXEL_BUDGET[this.plugin.settings.canvasQuality] ?? CANVAS_PIXEL_BUDGET.balanced;
        while (win.w * scale * win.h * scale > budget && scale > 0.5) scale *= 0.92;
        const pw = Math.max(1, Math.ceil(win.w * scale));
        const ph = Math.max(1, Math.ceil(win.h * scale));
        // Window aligned to the canvas pixel grid: shifts are whole pixels (bitmap copy without blur).
        view.fixed = hasVis ? { w: win.w, h: win.h } : null;
        win.w = pw / scale;
        win.h = ph / scale;
        win.x = Math.round(win.x * scale) / scale;
        win.y = Math.round(win.y * scale) / scale;
        const needHigh = this.pageHasHighlighter(index);
        const place = (c: HTMLCanvasElement, cw: number, ch: number) => {
            if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
            c.style.left = `${win.x}px`;
            c.style.top = `${win.y}px`;
            c.style.width = `${win.w}px`;
            c.style.height = `${win.h}px`;
        };
        place(ctxs.bottomCtx.canvas, pw, ph);
        place(ctxs.topCtx.canvas, pw, ph);
        place(ctxs.highCtx.canvas, needHigh ? pw : 1, needHigh ? ph : 1);
        view.win = win;
        view.highAllocated = needHigh;
        view.scale = scale;
        this.layoutVersion++;
    },

    // Moves the canvas window with the view: the existing bitmap is copied and only the uncovered strips are drawn.
    shiftWindow(index: number, vis: BBox): boolean {
        const view = this.pageViews[index];
        const ctxs = this.pageContexts[index];
        if (!view || !ctxs || !view.fixed) return false;
        const ow = view.win, s = view.scale;
        let nx = (vis.x0 + vis.x1) / 2 - ow.w / 2;
        let ny = (vis.y0 + vis.y1) / 2 - ow.h / 2;
        nx = Math.max(0, Math.min(Math.max(0, this.pageW(index) - ow.w), nx));
        ny = Math.max(0, Math.min(Math.max(0, this.pageH(index) - ow.h), ny));
        const dxPx = Math.round((nx - ow.x) * s), dyPx = Math.round((ny - ow.y) * s);
        if (dxPx === 0 && dyPx === 0) return true;
        const cw = ctxs.bottomCtx.canvas.width, ch = ctxs.bottomCtx.canvas.height;
        if (Math.abs(dxPx) >= cw || Math.abs(dyPx) >= ch) return false;   // no overlap: full redraw

        const nw: Bounds = { x: ow.x + dxPx / s, y: ow.y + dyPx / s, w: ow.w, h: ow.h };
        const layers = [ctxs.bottomCtx];
        if (view.highAllocated) layers.push(ctxs.highCtx);
        for (const ctx of layers) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'copy';
            ctx.drawImage(ctx.canvas, -dxPx, -dyPx);
            ctx.globalCompositeOperation = 'source-over';
        }
        for (const c of [ctxs.bottomCtx.canvas, ctxs.topCtx.canvas, ctxs.highCtx.canvas]) {
            c.style.left = `${nw.x}px`;
            c.style.top = `${nw.y}px`;
        }
        // Overlay layer (selection, cursor) – cleared and drawn again.
        ctxs.topCtx.setTransform(1, 0, 0, 1, 0, 0);
        ctxs.topCtx.clearRect(0, 0, ctxs.topCtx.canvas.width, ctxs.topCtx.canvas.height);
        view.win = nw;
        this.layoutVersion++;

        // Uncovered areas: new window minus the part shared with the old one.
        const ix0 = Math.max(ow.x, nw.x), ix1 = Math.min(ow.x + ow.w, nw.x + nw.w);
        const iy0 = Math.max(ow.y, nw.y), iy1 = Math.min(ow.y + ow.h, nw.y + nw.h);
        const regions: Bounds[] = [];
        if (iy0 > nw.y) regions.push({ x: nw.x, y: nw.y, w: nw.w, h: iy0 - nw.y });
        if (nw.y + nw.h > iy1) regions.push({ x: nw.x, y: iy1, w: nw.w, h: nw.y + nw.h - iy1 });
        if (ix0 > nw.x) regions.push({ x: nw.x, y: iy0, w: ix0 - nw.x, h: iy1 - iy0 });
        if (nw.x + nw.w > ix1) regions.push({ x: ix1, y: iy0, w: nw.x + nw.w - ix1, h: iy1 - iy0 });
        for (const r of regions) if (r.w > 0 && r.h > 0) this.repaintRegion(index, r);
        // Restore the "page coordinates -> canvas pixels" transform (later drawing relies on it).
        const tl = [ctxs.bottomCtx, ctxs.topCtx];
        if (view.highAllocated) tl.push(ctxs.highCtx);
        for (const ctx of tl) {
            const sx = ctx.canvas.width / nw.w, sy = ctx.canvas.height / nw.h;
            ctx.setTransform(sx, 0, 0, sy, -nw.x * sx, -nw.y * sy);
        }
        this.drawSelectionOverlay();
        return true;
    },

    /**
     * Draws a stroke inside the clip region. A long stroke without a ready path (e.g. just cut by the eraser) is
     * drawn only in the pieces lying in the region – the cost depends on the region size, not the stroke length.
     * The stroke looks exactly the same in the region (curves depend only on neighbouring points), and the ends
     * of the pieces lie outside the clip region.
     */
    drawStrokeInRegion(ctx: CanvasRenderingContext2D, st: Stroke, x0: number, y0: number, x1: number, y1: number) {
        const pts = st.points;
        if (st.shape || pts.length < 48 || this.pathFresh(st) || (st.alpha !== undefined && st.alpha < 1)) {
            this.drawSmoothStroke(ctx, st);
            return;
        }
        const m = st.width * 2.5 + 6;
        const inside = (p: Point) => p.x >= x0 - m && p.x <= x1 + m && p.y >= y0 - m && p.y <= y1 + m;
        const n = pts.length;
        let i = 0;
        while (i < n) {
            while (i < n && !inside(pts[i])) i++;
            if (i >= n) break;
            let j = i;
            while (j + 1 < n && inside(pts[j + 1])) j++;
            // Two extra points on each side – the curve inside the region does not depend on the ends of the piece.
            const a = Math.max(0, i - 2), b = Math.min(n - 1, j + 2);
            if (a === 0 && b === n - 1) { this.drawSmoothStroke(ctx, st); return; }
            const sub: Stroke = { ...st, points: pts.slice(a, b + 1) };
            this.pressureCache.set(sub, this.strokeHasPressure(st));   // the piece is drawn the same way as the whole stroke
            this.drawSmoothStroke(ctx, sub);
            i = j + 1;
        }
    },

    // Redraws just a rectangle (logical coordinates): clears it and draws the strokes touching it.
    repaintRegion(index: number, reg: Bounds) {
        const view = this.pageViews[index];
        const ctxs = this.pageContexts[index];
        const page = this.noteData.pages[index];
        if (!view || !ctxs || !page || !view.active) return;
        const win = view.win;
        const sx = ctxs.bottomCtx.canvas.width / win.w, sy = ctxs.bottomCtx.canvas.height / win.h;
        let x0 = Math.max(win.x, reg.x), y0 = Math.max(win.y, reg.y);
        let x1 = Math.min(win.x + win.w, reg.x + reg.w), y1 = Math.min(win.y + win.h, reg.y + reg.h);
        if (x1 <= x0 || y1 <= y0) return;
        // Align to canvas pixels (no seams at the clip edge)
        x0 = win.x + Math.floor((x0 - win.x) * sx) / sx;
        y0 = win.y + Math.floor((y0 - win.y) * sy) / sy;
        x1 = win.x + Math.ceil((x1 - win.x) * sx) / sx;
        y1 = win.y + Math.ceil((y1 - win.y) * sy) / sy;
        const rw = x1 - x0, rh = y1 - y0;

        const drag = this.dragSet;
        const candidates = page.strokes.filter(st => {
            if (st.isEraser || (drag && drag.has(st))) return false;
            const bb = this.getStrokeBBox(st);
            const pad = st.width;   // margin for varying width (pressure)
            return !(bb.x1 + pad < x0 || bb.x0 - pad > x1 || bb.y1 + pad < y0 || bb.y0 - pad > y1);
        });
        const layers: { ctx: CanvasRenderingContext2D; high: boolean }[] = [{ ctx: ctxs.bottomCtx, high: false }];
        if (view.highAllocated) layers.push({ ctx: ctxs.highCtx, high: true });
        for (const { ctx, high } of layers) {
            ctx.setTransform(sx, 0, 0, sy, -win.x * sx, -win.y * sy);
            ctx.save();
            ctx.beginPath();
            ctx.rect(x0, y0, rw, rh);
            ctx.clip();
            ctx.clearRect(x0, y0, rw, rh);
            for (const st of candidates) {
                if (!!st.isHighlighter !== high) continue;
                this.drawStrokeInRegion(ctx, st, x0, y0, x1, y1);
            }
            ctx.restore();
        }
    },

    // Whether the canvas window has to be moved / changed (after scrolling, zooming or a resolution change).
    ensureWindow(index: number, opts: { scale?: boolean; force?: boolean }) {
        const view = this.pageViews[index];
        if (!view || !view.active) return;
        let redo = !!opts.force;
        if (!redo && opts.scale && Math.abs(view.crisp - this.getCrispScale()) > 0.01) redo = true;
        if (!redo) {
            const vis = this.computeVisible(index);
            if (vis) {
                const ideal = this.idealWindowSize(index);
                const f = view.fixed;
                if (!f || Math.abs(f.w - ideal.w) > 0.5 || Math.abs(f.h - ideal.h) > 0.5) {
                    // Window of a different size (zoom / view change, page loaded in advance): during a zoom gesture
                    // redraw only when the view leaves the window; after it ends (opts.scale) – always.
                    const w = view.win;
                    const inside = vis.x0 >= w.x && vis.y0 >= w.y && vis.x1 <= w.x + w.w && vis.y1 <= w.y + w.h;
                    if (!inside || opts.scale || w.w * w.h > 3 * ideal.w * ideal.h) redo = true;
                } else {
                    const w = view.win;
                    const mx = (vis.x1 - vis.x0) * 0.08, my = (vis.y1 - vis.y0) * 0.08;
                    const needX = (vis.x0 < w.x + mx && w.x > 0.5) || (vis.x1 > w.x + w.w - mx && w.x + w.w < this.pageW(index) - 0.5);
                    const needY = (vis.y0 < w.y + my && w.y > 0.5) || (vis.y1 > w.y + w.h - my && w.y + w.h < this.pageH(index) - 0.5);
                    if (needX || needY) {
                        if (this.shiftWindow(index, vis)) return;
                        redo = true;
                    }
                }
            }
        }
        if (redo) {
            this.sizeCanvases(index);
            this.redrawPage(index, false);
        }
    },

    activatePage(index: number) {
        const view = this.pageViews[index];
        if (!view) return;
        view.active = true;
        this.sizeCanvases(index);
        this.redrawPage(index, false);
        void this.loadBg(index);
    },

    deactivatePage(index: number) {
        const view = this.pageViews[index];
        const ctxs = this.pageContexts[index];
        if (!view || !ctxs) return;
        view.active = false;
        // Free memory: canvases and images outside the view.
        for (const c of [ctxs.bottomCtx.canvas, ctxs.topCtx.canvas, ctxs.highCtx.canvas]) {
            c.width = 1; c.height = 1;
            c.style.width = '1px'; c.style.height = '1px';
        }
        view.highAllocated = false;
        if (view.bgEl) view.bgEl.removeAttribute('src');
        view.imgEls.forEach(el => { el.removeAttribute('src'); delete el.dataset.src; });
    },

    async loadBg(index: number) {
        const view = this.pageViews[index];
        const page = this.noteData.pages[index];
        if (!view || !page || !view.bgEl) return;
        const url = await this.getPageBgUrl(page);
        if (url && view.active && view.bgEl && this.pageViews[index] === view) view.bgEl.src = url;
    },

    scheduleVirtualization() {
        if (this.virtRaf !== null) return;
        this.virtRaf = window.requestAnimationFrame(() => {
            this.virtRaf = null;
            this.updateVirtualization();
        });
    },

    // Only pages near the view are "live", and their canvases cover only the visible part of the page.
    updateVirtualization() {
        if (!this.scrollArea || !this.pagesWrapper) return;
        const viewH = this.scrollArea.clientHeight;
        const z = this.currentZoom;
        const margin = viewH * (z > 2 ? 0.5 : 0.75);
        this.pageViews.forEach((view, i) => {
            const top = this.pagePositionY + view.outer.offsetTop * z;
            const bottom = top + view.outer.offsetHeight * z;
            const near = bottom > -margin && top < viewH + margin;
            if (near && !view.active) this.activatePage(i);
            else if (!near && view.active) this.deactivatePage(i);
            else if (near && view.active) this.ensureWindow(i, {});
        });
    },

    // Redraw of one page (dragging a selection, eraser, undo/redo).
    redrawPage(index: number, contentChanged = true) {
        if (contentChanged) this.markThumbDirty(index);
        const view = this.pageViews[index];
        const contexts = this.pageContexts[index];
        if (!view || !contexts || !view.active) return;
        if (!view.highAllocated && this.pageHasHighlighter(index)) this.sizeCanvases(index);
        const win = view.win;
        const layers = [contexts.bottomCtx, contexts.topCtx];
        if (view.highAllocated) layers.push(contexts.highCtx);
        layers.forEach(ctx => {
            const sx = ctx.canvas.width / win.w, sy = ctx.canvas.height / win.h;
            ctx.setTransform(sx, 0, 0, sy, -win.x * sx, -win.y * sy);
            ctx.clearRect(win.x - 1, win.y - 1, win.w + 2, win.h + 2);
        });
        const page = this.noteData.pages[index];
        const dragging = !!this.dragSet && this.selection?.page === index;
        if (page) this.drawPageStrokes(view.highAllocated ? contexts.highCtx : null, contexts.bottomCtx, page.strokes, win, dragging ? this.dragSet : null);
        if (dragging) this.drawDragStrokes(index);
        this.drawSelectionOverlay();
        this.syncPageImages(index);
    },

    /** Redraw of the top layer only (selection frame) – when the strokes did not change. */
    redrawOverlay(index: number) {
        const view = this.pageViews[index];
        const ctx = this.pageContexts[index]?.topCtx;
        if (!view || !ctx || !view.active) return;
        const win = view.win;
        const sx = ctx.canvas.width / win.w, sy = ctx.canvas.height / win.h;
        ctx.setTransform(sx, 0, 0, sy, -win.x * sx, -win.y * sy);
        ctx.clearRect(win.x - 1, win.y - 1, win.w + 2, win.h + 2);
        if (this.dragSet && this.selection?.page === index) this.drawDragStrokes(index);
        this.drawSelectionOverlay();
    },

    // --- FAST SELECTION DRAGGING ---
    // When a drag starts, the page is redrawn once without the selected strokes, and those go to a separate
    // layer. Each move then only transforms that layer, not the whole page (large pages don't slow down).
    beginDragLayer(index: number) {
        const sel = this.selection;
        if (!sel || sel.page !== index) return;
        this.dragSet = new Set(sel.strokes);
        this.dragXform = new DOMMatrix();
        this.dragSprite = this.buildDragSprite(index);
        this.redrawPage(index, false);
    },

    /**
     * The selected strokes are drawn once into a separate image. While moving / scaling / rotating, each frame
     * is just a transform of that image – no matter how many strokes are selected.
     */
    buildDragSprite(index: number): { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null {
        const sel = this.selection;
        const view = this.pageViews[index];
        if (!sel || !view || sel.strokes.length === 0) return null;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const st of sel.strokes) {
            const b = this.getStrokeBBox(st);
            const pad = st.width;   // margin for pressure
            x0 = Math.min(x0, b.x0 - pad); y0 = Math.min(y0, b.y0 - pad); x1 = Math.max(x1, b.x1 + pad); y1 = Math.max(y1, b.y1 + pad);
        }
        if (!isFinite(x0)) return null;
        const w = x1 - x0, h = y1 - y0;
        // Resolution as on the page, but at most ~10 Mpx (large selections at high zoom).
        let s = Math.max(0.5, view.scale);
        s = Math.min(s, Math.sqrt(10e6 / Math.max(1, w * h)), 8000 / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.className = 'hw-drag-sprite';
        canvas.width = Math.max(1, Math.ceil(w * s));
        canvas.height = Math.max(1, Math.ceil(h * s));
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
        ctx.globalAlpha = 0.4;   // like the highlighter layer
        for (const st of sel.strokes) if (st.isHighlighter) this.drawSmoothStroke(ctx, st);
        ctx.globalAlpha = 1;
        for (const st of sel.strokes) if (!st.isHighlighter) this.drawSmoothStroke(ctx, st);
        return { canvas, x: x0, y: y0, w, h };
    },

    endDragLayer(index: number) {
        if (!this.dragSet) return;
        this.dragSet = null;
        if (this.dragSprite) { this.dragSprite.canvas.remove(); this.dragSprite.canvas.width = 0; this.dragSprite = null; }
        this.dragXform = null;
        this.redrawPage(index);
    },

    /** Transform of the selection since the drag started (for the image preview). */
    dragTransform(m: DOMMatrix) {
        if (this.dragXform) this.dragXform = m.multiply(this.dragXform);
    },

    drawDragStrokes(index: number) {
        const ctx = this.pageContexts[index]?.topCtx;
        const sel = this.selection;
        if (!ctx || !sel) return;
        const sp = this.dragSprite, m = this.dragXform;
        if (sp && m) {
            // The selection image is a separate element above the page: only a CSS transform moves it
            // (compositor), so a drag frame draws no pixels at all.
            const M = m.multiply(new DOMMatrix().translate(sp.x, sp.y));
            sp.canvas.style.transform = `matrix(${M.a}, ${M.b}, ${M.c}, ${M.d}, ${M.e}, ${M.f})`;
            if (!sp.canvas.isConnected) {
                const view = this.pageViews[index];
                const bottom = this.pageContexts[index]?.bottomCtx.canvas;
                if (view && bottom) bottom.after(sp.canvas);
            }
            return;
        }
        // While scaling / rotating the stroke shape changes every frame – instead of rebuilding it,
        // the preview draws a constant-width line (full quality returns on release).
        const draw = (st: Stroke) => {
            if (st.shape || st.points.length < 2 || this.pathFresh(st)) this.drawSmoothStroke(ctx, st);
            else this.drawFastStroke(ctx, st);
        };
        for (const st of sel.strokes) {
            if (!st.isHighlighter) continue;
            ctx.globalAlpha = 0.4;   // like the highlighter layer
            draw(st);
        }
        ctx.globalAlpha = 1;
        for (const st of sel.strokes) if (!st.isHighlighter) draw(st);
    },

    /** Drag frame: only the top layer (selection frame) and image positions. */
    redrawDragFrame(index: number) {
        const view = this.pageViews[index];
        const ctx = this.pageContexts[index]?.topCtx;
        if (!view || !ctx || !view.active || !this.dragSet) { this.redrawPage(index); return; }
        const win = view.win;
        const sx = ctx.canvas.width / win.w, sy = ctx.canvas.height / win.h;
        ctx.setTransform(sx, 0, 0, sy, -win.x * sx, -win.y * sy);
        ctx.clearRect(win.x - 1, win.y - 1, win.w + 2, win.h + 2);
        this.drawDragStrokes(index);
        this.drawSelectionOverlay();
        this.syncPageImages(index);
    },

    resizeAndRedrawAll(force = false) {
        this.pageViews.forEach((view, i) => {
            if (!view.active) return;
            this.ensureWindow(i, { scale: true, force });
        });
    },

    drawPageStrokes(highCtx: CanvasRenderingContext2D | null, bottomCtx: CanvasRenderingContext2D, strokes: Stroke[], win?: Bounds, skip?: Set<Stroke> | null) {
        for (const stroke of strokes) {
            if (stroke.isEraser || (skip && skip.has(stroke))) continue;
            if (win) {
                // Skip strokes completely outside the canvas window.
                const bb = this.getStrokeBBox(stroke);
                if (bb.x1 < win.x || bb.x0 > win.x + win.w || bb.y1 < win.y || bb.y0 > win.y + win.h) continue;
            }
            if (stroke.isHighlighter) {
                if (highCtx) this.drawSmoothStroke(highCtx, stroke);
            } else {
                this.drawSmoothStroke(bottomCtx, stroke);
            }
        }
    },

    // --- IMAGES ON THE PAGE ---
    syncPageImages(index: number) {
        const view = this.pageViews[index];
        const page = this.noteData.pages[index];
        if (!view || !page) return;
        const images = page.images ?? [];
        const ids = new Set(images.map(i => i.id));
        view.imgEls.forEach((el, id) => {
            if (!ids.has(id)) { el.remove(); view.imgEls.delete(id); }
        });
        let prev: HTMLElement | null = null;
        for (const img of images) {
            let el = view.imgEls.get(img.id);
            if (!el) {
                el = view.imgLayer.createEl("img", { cls: "hw-page-image" });
                el.draggable = false;
                el.decoding = 'async';
                view.imgEls.set(img.id, el);
            }
            // DOM order = image order (bring to front / send to back).
            const want: ChildNode | null = prev ? prev.nextSibling : view.imgLayer.firstChild;
            if (want !== el) view.imgLayer.insertBefore(el, want);
            prev = el;
            el.style.left = `${img.x}px`;
            el.style.top = `${img.y}px`;
            el.style.width = `${img.w}px`;
            el.style.height = `${img.h}px`;
            el.style.transform = img.rot ? `rotate(${img.rot}rad)` : '';
            if (view.active) {
                if (!el.dataset.src) {
                    el.dataset.src = '1';
                    void this.loadImageSrc(el, img, view);
                }
            } else if (el.dataset.src) {
                el.removeAttribute('src');
                delete el.dataset.src;
            }
        }
    },

    async loadImageSrc(el: HTMLImageElement, img: ImageItem, view: PageView) {
        const url = await this.getImageUrl(img);
        if (url && view.active && el.isConnected) el.src = url;
        else if (!url) delete el.dataset.src;
    },

    // Centre of the visible part of the page (logical page coordinates).
    getVisibleCenter(pageIndex: number): { x: number; y: number } {
        const vis = this.computeVisible(pageIndex);
        if (!vis) return { x: this.pageW(pageIndex) / 2, y: this.pageH(pageIndex) / 2 };
        return { x: (vis.x0 + vis.x1) / 2, y: (vis.y0 + vis.y1) / 2 };
    },
});
export type CanvasWindowMethods = typeof canvasWindowMixin;
