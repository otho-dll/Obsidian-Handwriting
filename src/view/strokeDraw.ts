import { defineMixin } from './mixin';
import { Point, Stroke } from '../types';
import type { PathCacheEntry } from '../../main';

/**
 * Whether the stroke turns sharply at point i (turn > ~110°). There the stroke must pass exactly through
 * the point – the usual smoothing (curves through segment midpoints) cuts corners and shortens reversals.
 */
export function sharpTurn(pts: Point[], i: number): boolean {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    if (lu < 1e-6 || lv < 1e-6) return false;
    return (ux * vx + uy * vy) / (lu * lv) < -0.35;
}


/**
 * Variable-width stroke as ONE outline: right edge forwards, left edge backwards, round ends,
 * and circles only where the outline could fold over (tight turns of a thick stroke). Previously the stroke was
 * a union of hundreds of small "capsules" – same look, but many times more edges to fill.
 * All parts have the same winding (positive area), so the nonzero fill leaves no holes.
 */
function outlinePath(X0: number[], Y0: number[], W0: number[]): Path2D {
    // without repeated points
    const X: number[] = [X0[0]], Y: number[] = [Y0[0]], W: number[] = [W0[0]];
    for (let j = 1; j < X0.length; j++) {
        if (Math.hypot(X0[j] - X[X.length - 1], Y0[j] - Y[Y.length - 1]) < 1e-4) { W[W.length - 1] = Math.max(W[W.length - 1], W0[j]); continue; }
        X.push(X0[j]); Y.push(Y0[j]); W.push(W0[j]);
    }
    const path = new Path2D();
    const m = X.length - 1;
    const circle = (j: number) => { const r = W[j] / 2; path.moveTo(X[j] + r, Y[j]); path.arc(X[j], Y[j], r, 0, Math.PI * 2); };
    if (m === 0) { circle(0); return path; }
    // segment directions and normals
    const ux: number[] = [], uy: number[] = [], d: number[] = [];
    for (let j = 0; j < m; j++) {
        const dx = X[j + 1] - X[j], dy = Y[j + 1] - Y[j], l = Math.hypot(dx, dy);
        ux.push(dx / l); uy.push(dy / l); d.push(l);
    }
    const NX: number[] = new Array(m + 1), NY: number[] = new Array(m + 1);
    for (let j = 0; j <= m; j++) {
        let ax: number, ay: number;
        if (j === 0) { ax = ux[0]; ay = uy[0]; }
        else if (j === m) { ax = ux[m - 1]; ay = uy[m - 1]; }
        else {
            ax = ux[j - 1] + ux[j]; ay = uy[j - 1] + uy[j];
            const l = Math.hypot(ax, ay);
            if (l < 1e-3) { ax = ux[j - 1]; ay = uy[j - 1]; } else { ax /= l; ay /= l; }
        }
        NX[j] = -ay; NY[j] = ax;
    }
    // outline: right side (P - n·r) forwards, left side (P + n·r) backwards – positive area like the circles
    path.moveTo(X[0] - NX[0] * W[0] / 2, Y[0] - NY[0] * W[0] / 2);
    for (let j = 1; j <= m; j++) path.lineTo(X[j] - NX[j] * W[j] / 2, Y[j] - NY[j] * W[j] / 2);
    for (let j = m; j >= 0; j--) path.lineTo(X[j] + NX[j] * W[j] / 2, Y[j] + NY[j] * W[j] / 2);
    path.closePath();
    // ends and tight turns
    circle(0);
    circle(m);
    for (let j = 1; j < m; j++) {
        const cos = ux[j - 1] * ux[j] + uy[j - 1] * uy[j];
        if (cos > 0.9999) continue;
        const tanHalf = cos <= -0.999 ? Infinity : Math.sqrt((1 - cos) / (1 + cos));
        if ((W[j] / 2) * tanHalf > 0.45 * Math.min(d[j - 1], d[j])) circle(j);
    }
    return path;
}

export const strokeDrawMixin = defineMixin({
    constrainShape(stroke: Stroke, pos: Point): Point {
        const s = stroke.points[0];
        const dx = pos.x - s.x;
        const dy = pos.y - s.y;
        if (stroke.shape === 'line') {
            const step = Math.PI / 4;
            const ang = Math.round(Math.atan2(dy, dx) / step) * step;
            const len = Math.hypot(dx, dy);
            return { x: s.x + Math.cos(ang) * len, y: s.y + Math.sin(ang) * len, pressure: pos.pressure };
        }
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        return { x: s.x + (dx < 0 ? -m : m), y: s.y + (dy < 0 ? -m : m), pressure: pos.pressure };
    },

    drawShape(ctx: CanvasRenderingContext2D, stroke: Stroke) {
        const p0 = stroke.points[0];
        const p1 = stroke.points[stroke.points.length - 1];
        if (!p0 || !p1 || !stroke.shape) return;

        const w = Math.max(0.5, stroke.width);
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        ctx.lineWidth = w;
        ctx.lineJoin = 'round';

        // Dashed and dotted lines have flat ends and explicit dash lengths –
        // with the thinnest line, round dots of ~0 length were not drawn at all.
        if (stroke.dash === 'dashed') {
            ctx.lineCap = 'butt';
            ctx.setLineDash([w * 4 + 6, w * 2.5 + 5]);
        } else if (stroke.dash === 'dotted') {
            ctx.lineCap = 'butt';
            ctx.setLineDash([w * 1.2 + 0.8, w * 2 + 3]);
        } else {
            ctx.lineCap = 'round';
            ctx.setLineDash([]);
        }

        const rotated = !!stroke.rot && stroke.shape !== 'line';
        const cx = (p0.x + p1.x) / 2, cy = (p0.y + p1.y) / 2;
        if (rotated) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(stroke.rot!);
        }
        // Coordinates relative to the centre when the shape is rotated
        const ox = rotated ? cx : 0, oy = rotated ? cy : 0;
        const ax = p0.x - ox, ay = p0.y - oy, bx = p1.x - ox, by = p1.y - oy;

        ctx.beginPath();
        if (stroke.shape === 'line') {
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
        } else if (stroke.shape === 'rect') {
            ctx.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
        } else {
            const rx = Math.abs(bx - ax) / 2;
            const ry = Math.abs(by - ay) / 2;
            ctx.ellipse((ax + bx) / 2, (ay + by) / 2, rx, ry, 0, 0, Math.PI * 2);
        }
        if (stroke.fill && stroke.shape !== 'line') ctx.fill();
        ctx.stroke();
        if (rotated) ctx.restore();

        if (stroke.shape === 'line' && stroke.arrow) {
            ctx.setLineDash([]);
            ctx.lineCap = 'round';
            const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
            const head = Math.max(12, w * 5);
            ctx.beginPath();
            ctx.moveTo(p1.x - head * Math.cos(ang - Math.PI / 6), p1.y - head * Math.sin(ang - Math.PI / 6));
            ctx.lineTo(p1.x, p1.y);
            ctx.lineTo(p1.x - head * Math.cos(ang + Math.PI / 6), p1.y - head * Math.sin(ang + Math.PI / 6));
            ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.lineCap = 'round';
    },

    // Width multiplier for pressure 0..1 (pressure 0.5 = base width).
    pressureFactor(p: number): number {
        const st = this.plugin.settings;
        if (!st.pressureEnabled) return 1;
        return Math.max(0.2, 1 + st.pressureSensitivity * (p - 0.5) * 2);
    },

    strokeHasPressure(stroke: Stroke): boolean {
        if (stroke.isHighlighter || stroke.shape) return false;
        let v = this.pressureCache.get(stroke);
        if (v === undefined) {
            v = stroke.points.some(p => p.pressure !== 0.5);
            this.pressureCache.set(stroke, v);
        }
        return v;
    },

    /**
     * Cached stroke path. The stroke is recognized by its point count, a few points
     * and width (moving it with the lasso changes the coordinates, so the path is rebuilt).
     */
    cachedPath(stroke: Stroke, build: (e: PathCacheEntry) => void): PathCacheEntry {
        const pts = stroke.points, n = pts.length;
        const a = pts[0], b = pts[n - 1], m = pts[n >> 1];
        const st = this.plugin.settings;
        const k = st.pressureEnabled ? st.pressureSensitivity : -1;
        // The path is stored relative to the first point, so a moved stroke (lasso) reuses the same path.
        const x1 = b.x - a.x, y1 = b.y - a.y, xm = m.x - a.x, ym = m.y - a.y;
        const hit = this.pathCache.get(stroke);
        const eq = (u: number, v: number) => Math.abs(u - v) < 1e-6;
        if (hit && hit.n === n && eq(hit.x1, x1) && eq(hit.y1, y1) && eq(hit.xm, xm) && eq(hit.ym, ym) && hit.w === stroke.width && hit.k === k) {
            hit.x0 = a.x; hit.y0 = a.y;
            return hit;
        }
        const e: PathCacheEntry = { n, x0: a.x, y0: a.y, x1, y1, xm, ym, w: stroke.width, k };
        build(e);
        this.pathCache.set(stroke, e);
        return e;
    },

    /**
     * Variable-width stroke as one filled shape built along the smoothed centre line with a smoothly
     * changing width (see outlinePath). Everything is filled with a single fill() call – no width steps
     * and no seams between segments. The finished shape is cached (Path2D).
     */
    drawPressureStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
        const entry = this.cachedPath(stroke, (e) => {
            const pts = stroke.points;
            const n = pts.length;
            const wOf = (p: Point) => stroke.width * this.pressureFactor(p.pressure);
            // Samples along the same quadratic curves as a normal stroke (segment midpoints as knots).
            const X: number[] = [], Y: number[] = [], W: number[] = [];
            const ox = pts[0].x, oy = pts[0].y;
            const push = (x: number, y: number, w: number) => { X.push(x - ox); Y.push(y - oy); W.push(Math.max(0.15, w)); };
            let sx = pts[0].x, sy = pts[0].y, sw = wOf(pts[0]);
            push(sx, sy, sw);
            const quad = (cx: number, cy: number, cw: number, ex: number, ey: number, ew: number) => {
                const len = Math.hypot(cx - sx, cy - sy) + Math.hypot(ex - cx, ey - cy);
                const k = Math.max(1, Math.ceil(len / 2.4));
                for (let j = 1; j <= k; j++) {
                    const t = j / k, u = 1 - t;
                    push(u * u * sx + 2 * u * t * cx + t * t * ex, u * u * sy + 2 * u * t * cy + t * t * ey, u * u * sw + 2 * u * t * cw + t * t * ew);
                }
                sx = ex; sy = ey; sw = ew;
            };
            for (let i = 1; i < n - 1; i++) {
                const p1 = pts[i], p2 = pts[i + 1];
                if (sharpTurn(pts, i)) {
                    // Sharp turn (e.g. the leg of a P written down and back up): the stroke reaches exactly to the point.
                    quad((sx + p1.x) / 2, (sy + p1.y) / 2, (sw + wOf(p1)) / 2, p1.x, p1.y, wOf(p1));
                    continue;
                }
                quad(p1.x, p1.y, wOf(p1), (p1.x + p2.x) / 2, (p1.y + p2.y) / 2, (wOf(p1) + wOf(p2)) / 2);
            }
            const last = pts[n - 1];
            quad((sx + last.x) / 2, (sy + last.y) / 2, (sw + wOf(last)) / 2, last.x, last.y, wOf(last));
            e.fill = outlinePath(X, Y, W);
        });
        if (entry.fill) { ctx.translate(entry.x0, entry.y0); ctx.fill(entry.fill); ctx.translate(-entry.x0, -entry.y0); }
    },

    /** Whether the cached stroke path is up to date (without building it). */
    pathFresh(stroke: Stroke): boolean {
        const pts = stroke.points, n = pts.length;
        const hit = this.pathCache.get(stroke);
        if (!hit || hit.n !== n || hit.w !== stroke.width) return false;
        const a = pts[0], b = pts[n - 1], m = pts[n >> 1];
        const eq = (u: number, v: number) => Math.abs(u - v) < 1e-6;
        return eq(hit.x1, b.x - a.x) && eq(hit.y1, b.y - a.y) && eq(hit.xm, m.x - a.x) && eq(hit.ym, m.y - a.y);
    },

    /** Fast stroke preview: constant-width polyline (used while scaling / rotating). */
    drawFastStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
        const pts = stroke.points;
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        ctx.lineCap = stroke.isHighlighter ? 'butt' : 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
    },

    // --- STROKE PROCESSING AFTER THE PEN IS LIFTED ---

    /**
     * Removes pen jitter: light position smoothing where points are dense (slow writing – where
     * the noise is visible) plus pressure smoothing. Fast, sparse parts (sharp corners of letters) stay as they are.
     */
    smoothInkPoints(pts: Point[], zoom = 1): Point[] {
        const n = pts.length;
        if (n < 4) return pts;
        // Threshold for "dense" points in SCREEN pixels (2.5 px), not page units: zoomed in, the hand draws
        // more precisely, so less smoothing is needed. Sharp reversals are not smoothed at all.
        const near = 2.5 / Math.max(1, zoom);
        const sharp = new Uint8Array(n);
        for (let i = 1; i < n - 1; i++) if (sharpTurn(pts, i)) sharp[i] = sharp[i - 1] = sharp[i + 1] = 1;
        let cur = pts.map(p => ({ ...p }));
        for (let pass = 0; pass < 2; pass++) {
            const next = cur.map(p => ({ ...p }));
            for (let i = 1; i < n - 1; i++) {
                if (sharp[i]) continue;
                const a = cur[i - 1], b = cur[i], c = cur[i + 1];
                const da = Math.hypot(b.x - a.x, b.y - a.y), dc = Math.hypot(c.x - b.x, c.y - b.y);
                if (da > near || dc > near) continue;
                next[i].x = (a.x + 2 * b.x + c.x) / 4;
                next[i].y = (a.y + 2 * b.y + c.y) / 4;
            }
            cur = next;
        }
        // Pressure: moving average of 5 points (no jumps in width).
        const pr = cur.map(p => p.pressure);
        for (let i = 0; i < n; i++) {
            let s = 0, c = 0;
            for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) { s += pr[k]; c++; }
            cur[i].pressure = s / c;
        }
        return cur;
    },

    /**
     * Highlighter: smoothing and trimming of "hooks" at the ends (pen twitch when touching down and lifting).
     * The stroke is NOT straightened – it keeps the path you drew.
     */
    cleanHighlighter(pts0: Point[], width: number): Point[] {
        let pts = pts0.map(p => ({ ...p, pressure: 0.5 }));
        if (pts.length < 3) return pts;
        // Reversals (highlighting several lines in a zig-zag) stay sharp – the end there should be flat, like a real highlighter.
        // The turn is measured over a longer span (±3 points) so pen jitter does not look like a corner; > ~60° = corner.
        const keep = new Uint8Array(pts.length);
        const n0 = pts.length;
        for (let i = 1; i < n0 - 1; i++) {
            const a = pts[Math.max(0, i - 3)], b = pts[i], c = pts[Math.min(n0 - 1, i + 3)];
            const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
            const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
            if (lu < 1e-6 || lv < 1e-6) continue;
            if ((ux * vx + uy * vy) / (lu * lv) < 0.5) for (let k = Math.max(0, i - 1); k <= Math.min(n0 - 1, i + 1); k++) keep[k] = 1;
        }
        // Smoothing (3 passes of a [1,2,1] filter).
        for (let pass = 0; pass < 3; pass++) {
            const nx = pts.map(p => ({ ...p }));
            for (let i = 1; i < pts.length - 1; i++) {
                if (keep[i]) continue;
                nx[i].x = (pts[i - 1].x + 2 * pts[i].x + pts[i + 1].x) / 4;
                nx[i].y = (pts[i - 1].y + 2 * pts[i].y + pts[i + 1].y) / 4;
            }
            pts = nx;
        }
        const total = pts.reduce((s, p, i) => i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0, 0);
        // Hooks: drop short segments at the end whose direction differs from the main direction of the stroke.
        const trim = (list: Point[]) => {
            const L = Math.min(Math.max(width * 0.8, 6), total * 0.2);
            const pointAt = (dist: number) => {
                let acc = 0;
                for (let i = list.length - 1; i > 0; i--) {
                    acc += Math.hypot(list[i].x - list[i - 1].x, list[i].y - list[i - 1].y);
                    if (acc >= dist) return i - 1;
                }
                return 0;
            };
            const a = pointAt(Math.min(total * 0.45, L * 4)), b = pointAt(L);
            const mx = list[b].x - list[a].x, my = list[b].y - list[a].y;
            const ml = Math.hypot(mx, my);
            if (ml < 1e-6) return list;
            let dropped = 0;
            while (list.length > 2) {
                const p = list[list.length - 1], q = list[list.length - 2];
                const sx = p.x - q.x, sy = p.y - q.y, sl = Math.hypot(sx, sy);
                const cos = sl > 1e-6 ? (sx * mx + sy * my) / (sl * ml) : 1;
                if (cos > Math.cos(Math.PI / 5) || dropped + sl > L) break;
                dropped += sl;
                list = list.slice(0, -1);
            }
            return list;
        };
        pts = trim(pts);
        pts = trim(pts.slice().reverse()).reverse();
        // No straightening to a perfect line – the stroke stays the way you drew it (just without jitter).
        return this.simplifyPoints(pts, 0.6);
    },

    drawSmoothStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
        if (stroke.points.length === 0 || stroke.isEraser) return;
        // Semi-transparent pen: the whole stroke is one shape, so it does not get darker where it overlaps itself.
        if (stroke.alpha !== undefined && stroke.alpha < 1 && !stroke.isHighlighter) {
            const prev = ctx.globalAlpha;
            ctx.globalAlpha = prev * stroke.alpha;
            this.drawSmoothStrokeInner(ctx, stroke);
            ctx.globalAlpha = prev;
            return;
        }
        this.drawSmoothStrokeInner(ctx, stroke);
    },

    drawSmoothStrokeInner(ctx: CanvasRenderingContext2D, stroke: Stroke) {
        if (stroke.shape) { this.drawShape(ctx, stroke); return; }

        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = stroke.color;
        ctx.fillStyle = stroke.color;
        ctx.lineWidth = stroke.width;
        // Highlighter: polyline with flat ends and sharp corners (a reversal when highlighting several lines has
        // a square end, like a real highlighter – no rounding).
        const polyline = !!stroke.poly || stroke.isHighlighter;
        ctx.lineCap = stroke.isHighlighter ? 'butt' : 'round';
        ctx.lineJoin = polyline ? 'miter' : 'round';
        ctx.miterLimit = stroke.isHighlighter ? 2.2 : 4;
        ctx.setLineDash([]);
        if (stroke.dash === 'dashed') {
            ctx.lineCap = 'butt';
            ctx.setLineDash([stroke.width * 4 + 6, stroke.width * 2.5 + 5]);
        } else if (stroke.dash === 'dotted') {
            ctx.lineCap = 'butt';
            ctx.setLineDash([stroke.width * 1.2 + 0.8, stroke.width * 2 + 3]);
        }

        // A single tap draws a dot (a square for the highlighter).
        if (stroke.points.length === 1) {
            const p = stroke.points[0];
            ctx.beginPath();
            if (stroke.isHighlighter) ctx.rect(p.x - stroke.width / 4, p.y - stroke.width / 2, stroke.width / 2, stroke.width);
            else ctx.arc(p.x, p.y, stroke.width / 2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }

        if (this.strokeHasPressure(stroke)) { this.drawPressureStroke(ctx, stroke); return; }

        const entry = this.cachedPath(stroke, (e) => {
            const pts = stroke.points;
            const path = new Path2D();
            const ox = pts[0].x, oy = pts[0].y;
            path.moveTo(0, 0);
            if (polyline) {
                // Highlighter and shape fragments: polyline with sharp corners (no smoothing, which would round the turns).
                for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x - ox, pts[i].y - oy);
            } else {
                for (let i = 1; i < pts.length - 1; i++) {
                    const p1 = pts[i], p2 = pts[i + 1];
                    // Sharp turn: the line reaches the point itself (smoothing through segment midpoints would cut
                    // reversals – e.g. the leg of a P came out half as long).
                    if (sharpTurn(pts, i)) { path.lineTo(p1.x - ox, p1.y - oy); continue; }
                    path.quadraticCurveTo(p1.x - ox, p1.y - oy, (p1.x + p2.x) / 2 - ox, (p1.y + p2.y) / 2 - oy);
                }
                const last = pts[pts.length - 1];
                path.lineTo(last.x - ox, last.y - oy);
            }
            e.path = path;
        });
        if (entry.path) { ctx.translate(entry.x0, entry.y0); ctx.stroke(entry.path); ctx.translate(-entry.x0, -entry.y0); }
        ctx.setLineDash([]);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
    },
});
export type StrokeDrawMethods = typeof strokeDrawMixin;
