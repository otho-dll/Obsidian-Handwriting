import { defineMixin } from './mixin';
import { Point, Stroke, ImageItem, Bounds } from '../types';
import { rotatePointAbout } from '../utils';

/** Lasso: selecting, moving between pages, selection frame. */
export const selectionMixin = defineMixin({
    // --- LASSO: selecting, moving, scaling, rotating, deleting ---
    /** After inserting an item switches to the lasso (to move it) and remembers the previous tool. */
    activateLassoForInsert() {
        if (this.currentTool !== 'lasso') this.toolBeforeInsert = this.currentTool;
        if (this.activateLasso) this.activateLasso();
    },

    updateSelectionUI() {
        // The selection is gone (tap on an empty page, delete…): go back to the tool used before inserting.
        if (!this.selection && this.toolBeforeInsert) {
            const t = this.toolBeforeInsert;
            this.toolBeforeInsert = null;
            if (this.currentTool === 'lasso' && this.setTool) this.setTool(t);
        }
        if (this.deleteSelBtn) {
            this.deleteSelBtn.disabled = !this.selection;
            this.deleteSelBtn.style.display = this.selection ? '' : 'none';
        }
        if (this.selMenuBtn) this.selMenuBtn.style.display = this.selection ? '' : 'none';
        // With strokes selected the toolbar shows their colour and thickness (changes apply to the selection).
        if (this.currentTool === 'lasso' && this.refreshToolbarUI) this.refreshToolbarUI();
    },

    // Which page the selection centre is on (selection coordinates are relative to page `from`).
    dropTargetPage(from: number): number {
        const b = this.getSelectionBounds();
        const fromView = this.pageViews[from];
        if (!b || !fromView) return from;
        const cy = fromView.outer.offsetTop + b.y + b.h / 2;
        for (let i = 0; i < this.pageViews.length; i++) {
            const top = this.pageViews[i].outer.offsetTop;
            if (cy >= top - 7 && cy < top + this.pageH(i) + 8) return i;
        }
        return from;
    },

    clearGhost() {
        if (this.ghostPage === null) return;
        const g = this.ghostPage;
        this.ghostPage = null;
        const view = this.pageViews[g];
        if (view) view.container.removeClass('hw-drop-target');
        this.redrawPage(g);
    },

    // While dragging the selection over another page: highlight it and show the outline where the selection will land.
    showDropGhost(from: number) {
        const target = this.dropTargetPage(from);
        if (target === from) { this.clearGhost(); return; }
        if (this.ghostPage !== null && this.ghostPage !== target) this.clearGhost();
        const view = this.pageViews[target];
        const ctx = this.pageContexts[target]?.topCtx;
        const b = this.getSelectionBounds();
        if (!view || !ctx || !view.active || !b) return;
        this.ghostPage = target;
        view.container.addClass('hw-drop-target');
        const win = view.win;
        const sx = ctx.canvas.width / win.w, sy = ctx.canvas.height / win.h;
        ctx.setTransform(sx, 0, 0, sy, -win.x * sx, -win.y * sy);
        ctx.clearRect(win.x - 1, win.y - 1, win.w + 2, win.h + 2);
        const dy = this.pageViews[from].outer.offsetTop - view.outer.offsetTop;
        const z = Math.max(0.5, this.currentZoom);
        ctx.globalCompositeOperation = 'source-over';
        const accent = this.accentColor();
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.16;
        ctx.fillRect(b.x, b.y + dy, b.w, b.h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5 / z;
        ctx.setLineDash([6 / z, 4 / z]);
        ctx.strokeRect(b.x, b.y + dy, b.w, b.h);
        ctx.setLineDash([]);
    },

    // After dropping the selection on another page moves the items into its data.
    transferSelectionIfNeeded(from: number) {
        const sel = this.selection;
        if (!sel) return;
        const target = this.dropTargetPage(from);
        if (target === from) return;
        const src = this.noteData.pages[from];
        const dst = this.noteData.pages[target];
        if (!src || !dst) return;
        const dy = this.pageViews[from].outer.offsetTop - this.pageViews[target].outer.offsetTop;
        const strokes = [...sel.strokes], images = [...sel.images];
        this.translateItems(strokes, images, 0, dy);
        src.strokes = src.strokes.filter(st => !strokes.includes(st));
        if (src.images) src.images = src.images.filter(im => !images.includes(im));
        dst.strokes.push(...strokes);
        (dst.images ?? (dst.images = [])).push(...images);
        this.pushHistoryAction({ type: 'transfer', page: from, to: target, strokes, images, dy });
        this.selection = { page: target, strokes, images };
        this.activePageIndex = target;
        this.redrawPage(from);
        this.redrawPage(target);
    },

    clearSelection() {
        if (!this.selection) return;
        const page = this.selection.page;
        this.selection = null;
        this.updateSelectionUI();
        this.redrawOverlay(page);
    },

    deleteSelection() {
        const sel = this.selection;
        if (!sel) return;
        const page = this.noteData.pages[sel.page];
        if (!page) return;
        const images = page.images ?? (page.images = []);
        const items = sel.strokes
            .map(stroke => ({ stroke, index: page.strokes.indexOf(stroke) }))
            .filter(i => i.index >= 0)
            .sort((a, b) => a.index - b.index);
        const imgItems = sel.images
            .map(image => ({ image, index: images.indexOf(image) }))
            .filter(i => i.index >= 0)
            .sort((a, b) => a.index - b.index);
        for (let i = items.length - 1; i >= 0; i--) page.strokes.splice(items[i].index, 1);
        for (let i = imgItems.length - 1; i >= 0; i--) images.splice(imgItems[i].index, 1);
        this.selection = null;
        this.updateSelectionUI();
        if (items.length > 0 || imgItems.length > 0) {
            this.pushHistoryAction({ type: 'delete', page: sel.page, items, imgItems });
            this.requestSave();
        }
        this.redrawPage(sel.page);
    },

    // Rotating the selection by a multiple of 90° around its centre (from the context menu).
    rotateSelectionBy(angle: number) {
        const sel = this.selection;
        const b = this.getSelectionBounds();
        if (!sel || !b) return;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        this.rotateItems(sel.strokes, sel.images, cx, cy, angle);
        this.pushHistoryAction({ type: 'rotate', page: sel.page, strokes: [...sel.strokes], images: [...sel.images], cx, cy, angle });
        this.requestSave();
        this.redrawPage(sel.page);
    },

    imageCorners(i: ImageItem): Point[] {
        const cx = i.x + i.w / 2, cy = i.y + i.h / 2;
        const pts = [this.mkPoint(i.x, i.y), this.mkPoint(i.x + i.w, i.y), this.mkPoint(i.x + i.w, i.y + i.h), this.mkPoint(i.x, i.y + i.h)];
        if (!i.rot) return pts;
        return pts.map(p => { const q = rotatePointAbout(p, cx, cy, i.rot!); return this.mkPoint(q.x, q.y); });
    },

    strokeSamplePoints(s: Stroke): Point[] {
        if (!s.shape) return s.points;
        const p0 = s.points[0];
        const p1 = s.points[s.points.length - 1];
        if (!p0 || !p1) return [];
        const center = this.mkPoint((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
        if (s.shape === 'line') return [p0, center, p1];
        const outline = this.shapeOutline(s);
        if (s.shape === 'rect') {
            const mids = outline.map((p, i) => {
                const q = outline[(i + 1) % outline.length];
                return this.mkPoint((p.x + q.x) / 2, (p.y + q.y) / 2);
            });
            return [...outline, ...mids, center];
        }
        return [...outline.filter((_, i) => i % 4 === 0), center];
    },

    imageSamplePoints(i: ImageItem): Point[] {
        const c = this.imageCorners(i);
        const mids = c.map((p, k) => {
            const q = c[(k + 1) % 4];
            return this.mkPoint((p.x + q.x) / 2, (p.y + q.y) / 2);
        });
        return [...c, ...mids, this.mkPoint(i.x + i.w / 2, i.y + i.h / 2)];
    },

    selectInPolygon(page: number, path: Point[]) {
        const data = this.noteData.pages[page];
        if (!data) return;
        // To judge "is the stroke in the loop", up to 24 evenly spaced stroke points are enough.
        const fraction = (pts: Point[]) => {
            const n = pts.length;
            if (n === 0) return 0;
            const step = Math.max(1, Math.floor(n / 24));
            let inside = 0, total = 0;
            for (let i = 0; i < n; i += step) { total++; if (this.pointInPolygon(pts[i].x, pts[i].y, path)) inside++; }
            return inside / total;
        };
        let px0 = Infinity, py0 = Infinity, px1 = -Infinity, py1 = -Infinity;
        for (const p of path) { px0 = Math.min(px0, p.x); px1 = Math.max(px1, p.x); py0 = Math.min(py0, p.y); py1 = Math.max(py1, p.y); }
        const strokes0 = data.strokes.filter(s => {
            if (s.isEraser || s.lock) return false;
            const bb = this.getStrokeBBox(s);
            if (bb.x1 < px0 || bb.x0 > px1 || bb.y1 < py0 || bb.y0 > py1) return false;   // outside the loop's bounding box
            return fraction(this.strokeSamplePoints(s)) >= 0.5;
        });
        const images0 = (data.images ?? []).filter(i => !i.lock && fraction(this.imageSamplePoints(i)) >= 0.5);
        const { strokes, images } = this.expandGroups(page, strokes0, images0);
        this.selection = strokes.length + images.length > 0 ? { page, strokes, images } : null;
        this.updateSelectionUI();
    },

    getSelectionBounds(): Bounds | null {
        const sel = this.selection;
        if (!sel || sel.strokes.length + sel.images.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        // Stroke bounding boxes are cached (fast even for a large selection).
        for (const s of sel.strokes) {
            const b = this.getStrokeBBox(s);
            minX = Math.min(minX, b.x0); maxX = Math.max(maxX, b.x1);
            minY = Math.min(minY, b.y0); maxY = Math.max(maxY, b.y1);
        }
        for (const i of sel.images) {
            for (const p of this.imageCorners(i)) {
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            }
        }
        const m = 6;
        return { x: minX - m, y: minY - m, w: maxX - minX + m * 2, h: maxY - minY + m * 2 };
    },

    // Positions of the selection handles (logical coordinates).
    getHandles(b: Bounds) {
        const z = Math.max(0.5, this.currentZoom);
        const stem = 26 / z;
        const above = b.y - stem >= 8 / z;
        return {
            resize: { x: b.x + b.w, y: b.y + b.h },
            rotate: { x: b.x + b.w / 2, y: above ? b.y - stem : b.y + b.h + stem },
            rotateFrom: { x: b.x + b.w / 2, y: above ? b.y : b.y + b.h },
            hitRadius: 16 / z
        };
    },

    drawSelectionOverlay() {
        const sel = this.selection;
        if (!sel) return;
        const view = this.pageViews[sel.page];
        const ctxs = this.pageContexts[sel.page];
        const b = this.getSelectionBounds();
        if (!view || !view.active || !ctxs || !b) return;
        const ctx = ctxs.topCtx;
        const z = Math.max(0.5, this.currentZoom);
        const h = this.getHandles(b);
        ctx.globalCompositeOperation = 'source-over';
        const accent = this.accentColor();
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.09;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.5 / z;
        ctx.setLineDash([6 / z, 4 / z]);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.setLineDash([]);

        // Rotation handle (circle on a stem)
        ctx.beginPath();
        ctx.moveTo(h.rotateFrom.x, h.rotateFrom.y);
        ctx.lineTo(h.rotate.x, h.rotate.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(h.rotate.x, h.rotate.y, 7 / z, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2 / z;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(h.rotate.x, h.rotate.y, 3 / z, -Math.PI * 0.8, Math.PI * 0.55);
        ctx.lineWidth = 1.5 / z;
        ctx.stroke();

        // Resize handle (bottom-right corner)
        const hs = 6 / z;
        ctx.fillStyle = '#ffffff';
        ctx.lineWidth = 2 / z;
        ctx.fillRect(h.resize.x - hs, h.resize.y - hs, hs * 2, hs * 2);
        ctx.strokeRect(h.resize.x - hs, h.resize.y - hs, hs * 2, hs * 2);
    },

    pageIndexAt(clientX: number, clientY: number): number {
        for (let i = 0; i < this.pageViews.length; i++) {
            const r = this.pageViews[i].container.getBoundingClientRect();
            if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return i;
        }
        return -1;
    },
});
export type SelectionMethods = typeof selectionMixin;
