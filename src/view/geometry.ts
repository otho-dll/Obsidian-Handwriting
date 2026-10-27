import { defineMixin } from './mixin';
import { rotatePointAbout } from '../utils';
import { Point, Stroke, BBox } from '../types';

export const geometryMixin = defineMixin({
    // --- GEOMETRY ---
    distPointSeg(p: Point, a: Point, b: Point) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const l2 = dx * dx + dy * dy;
        let t = l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    },

    segSegDist(p: Point, q: Point, a: Point, b: Point) {
        const o = (x: Point, y: Point, z: Point) => (y.x - x.x) * (z.y - x.y) - (y.y - x.y) * (z.x - x.x);
        const d1 = o(p, q, a), d2 = o(p, q, b), d3 = o(a, b, p), d4 = o(a, b, q);
        if ((d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0)) return 0;
        return Math.min(
            this.distPointSeg(a, p, q), this.distPointSeg(b, p, q),
            this.distPointSeg(p, a, b), this.distPointSeg(q, a, b)
        );
    },

    pointInPolygon(x: number, y: number, poly: Point[]) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    },

    // Ramer-Douglas-Peucker (iterative) – fewer points = smaller file and faster redraws.
    simplifyPoints(pts: Point[], eps: number): Point[] {
        const n = pts.length;
        if (n < 3) return pts;
        const keep = new Uint8Array(n);
        keep[0] = 1;
        keep[n - 1] = 1;
        // When pressure changes, the points carrying the thickness change are kept too.
        const hasP = pts.some(p => p.pressure !== 0.5);
        const stack: [number, number][] = [[0, n - 1]];
        while (stack.length > 0) {
            const [s, e] = stack.pop()!;
            let maxD = 0, idx = -1;
            for (let i = s + 1; i < e; i++) {
                let d = this.distPointSeg(pts[i], pts[s], pts[e]);
                if (hasP) {
                    const t = (i - s) / (e - s);
                    const ip = pts[s].pressure + (pts[e].pressure - pts[s].pressure) * t;
                    d = Math.max(d, 3 * Math.abs(pts[i].pressure - ip));
                }
                if (d > maxD) { maxD = d; idx = i; }
            }
            if (idx !== -1 && maxD > eps) {
                keep[idx] = 1;
                stack.push([s, idx], [idx, e]);
            }
        }
        const out: Point[] = [];
        for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
        return out;
    },

    mkPoint(x: number, y: number): Point { return { x, y, pressure: 0.5 }; },

    // Shape outline (including rotation) – for the eraser, selection and bounding boxes.
    shapeOutline(s: Stroke): Point[] {
        const p0 = s.points[0];
        const p1 = s.points[s.points.length - 1];
        if (!p0 || !p1) return [];
        if (s.shape === 'line') return [p0, p1];
        const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
        let out: Point[] = [];
        if (s.shape === 'rect') {
            out = [this.mkPoint(p0.x, p0.y), this.mkPoint(p1.x, p0.y), this.mkPoint(p1.x, p1.y), this.mkPoint(p0.x, p1.y)];
        } else {
            const rx = Math.abs(p1.x - p0.x) / 2, ry = Math.abs(p1.y - p0.y) / 2;
            for (let i = 0; i < 48; i++) {
                const a = (i / 48) * Math.PI * 2;
                out.push(this.mkPoint(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
            }
        }
        if (s.rot) out = out.map(p => { const q = rotatePointAbout(p, cx, cy, s.rot!); return this.mkPoint(q.x, q.y); });
        return out;
    },

    getStrokeBBox(s: Stroke): BBox {
        const cached = this.bboxCache.get(s);
        if (cached) return cached;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const pts = s.shape ? this.shapeOutline(s) : s.points;
        for (const p of pts) {
            if (p.x < x0) x0 = p.x;
            if (p.x > x1) x1 = p.x;
            if (p.y < y0) y0 = p.y;
            if (p.y > y1) y1 = p.y;
        }
        if (!isFinite(x0)) { x0 = y0 = x1 = y1 = 0; }
        let pad = s.width / 2 + 1;
        if (s.arrow) pad = Math.max(pad, Math.max(12, s.width * 5));
        const bb = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
        this.bboxCache.set(s, bb);
        return bb;
    },

    // --- VECTOR ERASER ---
    // The eraser cuts strokes (splits them into pieces) instead of painting transparent holes,
    // so moving with the lasso leaves no traces of it.

    // Shapes are removed whole when the eraser touches their outline (or inside, if filled).
    shapeHit(s: Stroke, a: Point, b: Point, r: number) {
        const R = r + s.width / 2;
        const poly = this.shapeOutline(s);
        if (poly.length < 2) return false;
        const closed = s.shape !== 'line';
        const count = closed ? poly.length : poly.length - 1;
        for (let i = 0; i < count; i++) {
            if (this.segSegDist(poly[i], poly[(i + 1) % poly.length], a, b) <= R) return true;
        }
        if (closed && s.fill && this.pointInPolygon(b.x, b.y, poly)) return true;
        return false;
    },

    eraseFromList(strokes: Stroke[], a: Point, b: Point, r: number, wholeHighlighterArg?: boolean, dirty?: BBox): { list: Stroke[]; changed: boolean } {
        const wholeHighlighter = wholeHighlighterArg ?? (this.plugin.settings.highlighterErase === 'whole');
        let changed = false;
        const out: Stroke[] = [];
        const minAx = Math.min(a.x, b.x) - r, maxAx = Math.max(a.x, b.x) + r;
        const minAy = Math.min(a.y, b.y) - r, maxAy = Math.max(a.y, b.y) + r;

        const mark = (st: Stroke) => {
            if (!dirty) return;
            const bb = this.getStrokeBBox(st);
            dirty.x0 = Math.min(dirty.x0, bb.x0); dirty.y0 = Math.min(dirty.y0, bb.y0);
            dirty.x1 = Math.max(dirty.x1, bb.x1); dirty.y1 = Math.max(dirty.y1, bb.y1);
        };
        for (const s0 of strokes) {
            let s = s0;
            if (s.isEraser || s.lock) { out.push(s); continue; }   // the eraser doesn't touch locked items

            // Quick rejection by bounding box (from the cache).
            const bb = this.getStrokeBBox(s);
            if (bb.x0 > maxAx || bb.x1 < minAx || bb.y0 > maxAy || bb.y1 < minAy) { out.push(s); continue; }

            if (s.shape) {
                const canCut = this.plugin.settings.shapeErase === 'partial' && !(s.fill && s.shape !== 'line') && !s.arrow;
                if (!canCut) {
                    if (this.shapeHit(s, a, b, r)) { changed = true; mark(s0); continue; }
                    out.push(s);
                    continue;
                }
                if (!this.shapeHit(s, a, b, r)) { out.push(s); continue; }
                // A shape is turned into a dense polyline and then erased like a normal stroke.
                const outline = this.shapeOutline(s);
                const closed = s.shape !== 'line';
                const path = closed ? [...outline, outline[0]] : outline;
                const step = Math.max(3, Math.min(r, 8));
                const dense: Point[] = [path[0]];
                for (let i = 1; i < path.length; i++) {
                    const p = path[i - 1], q = path[i];
                    const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / step));
                    for (let k = 1; k <= n; k++) dense.push(this.mkPoint(p.x + (q.x - p.x) * k / n, p.y + (q.y - p.y) * k / n));
                }
                s = { points: dense, color: s.color, width: s.width, isHighlighter: false, dash: s.dash, poly: true };
            }

            const R = r + s.width / 2;
            const pts = s.points;
            const n = pts.length;

            const bad: boolean[] = pts.map(p => this.distPointSeg(p, a, b) <= R);
            const cut: boolean[] = [];
            let hit = bad.some(v => v);
            for (let i = 0; i < n - 1; i++) {
                const c = !bad[i] && !bad[i + 1] && this.segSegDist(pts[i], pts[i + 1], a, b) <= R;
                cut.push(c);
                if (c) hit = true;
            }
            if (!hit) { out.push(s0); continue; }

            changed = true;
            // The highlighter disappears whole when the eraser touches it (plugin setting).
            if (s.isHighlighter && wholeHighlighter) { mark(s0); continue; }
            if (dirty) {
                // Area to redraw: only around the removed segments (not the whole stroke).
                let lo = n, hi = -1;
                for (let i = 0; i < n; i++) if (bad[i]) { lo = Math.min(lo, i - 2); hi = Math.max(hi, i + 2); }
                for (let i = 0; i < n - 1; i++) if (cut[i]) { lo = Math.min(lo, i - 1); hi = Math.max(hi, i + 2); }
                lo = Math.max(0, lo); hi = Math.min(n - 1, hi);
                const pad = s.width * 1.6 + 2;
                for (let i = lo; i <= hi; i++) {
                    const p = pts[i];
                    dirty.x0 = Math.min(dirty.x0, p.x - pad); dirty.y0 = Math.min(dirty.y0, p.y - pad);
                    dirty.x1 = Math.max(dirty.x1, p.x + pad); dirty.y1 = Math.max(dirty.y1, p.y + pad);
                }
            }
            let run: Point[] = [];
            const flush = () => {
                if (run.length >= 2) out.push({ ...s, points: run });
                run = [];
            };
            for (let i = 0; i < n; i++) {
                if (bad[i]) { flush(); continue; }
                run.push(pts[i]);
                if (i < n - 1 && (cut[i] || bad[i + 1])) flush();
            }
            flush();
        }
        return { list: changed ? out : strokes, changed };
    },

    eraseAt(pageIndex: number, a: Point, b: Point, r: number, dirty?: BBox): boolean {
        const page = this.noteData.pages[pageIndex];
        if (!page) return false;
        const res = this.eraseFromList(page.strokes, a, b, r, this.plugin.settings.highlighterErase === 'whole', dirty);
        if (res.changed) page.strokes = res.list;
        return res.changed;
    },

    // Old notes contain eraser strokes (transparent holes). We turn them into cut strokes.
    migrateErasers() {
        for (const page of this.noteData.pages) {
            if (!page.strokes.some(s => s.isEraser)) continue;
            let result: Stroke[] = [];
            for (const s of page.strokes) {
                if (!s.isEraser) { result.push(s); continue; }
                const r = s.width / 2;
                for (let i = 0; i < s.points.length; i++) {
                    const a = i === 0 ? s.points[0] : s.points[i - 1];
                    result = this.eraseFromList(result, a, s.points[i], r, false).list;
                }
            }
            page.strokes = result;
        }
    },
});
export type GeometryMethods = typeof geometryMixin;
