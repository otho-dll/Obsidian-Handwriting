import type { Polyline } from '../circuit/font';
import type { Patch, SolidGeom } from './shapes';
import type { Projector } from './projection';
import type { HiddenMode, V3 } from './types';

/** Lines of a solid in screen coordinates (model units, y down). */
export interface SolidLines { visible: Polyline[]; hidden: Polyline[]; axes: Polyline[] }

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------------------------------------------------------------- outlines of curved surfaces
/**
 * Outline (contour) of a curved surface: where n · (view direction) = 0. Marching squares on a (u, v) grid, the
 * crossing found on the grid edges, and the points mapped back onto the exact surface – smooth outlines of
 * cylinders, cones, spheres and tori, without the steps an outline of a triangle mesh has.
 */
export function contours(p: Patch, proj: Projector): V3[][] {
    const { nu, nv } = p;
    const g: number[][] = [];
    for (let i = 0; i <= nu; i++) {
        g.push([]);
        for (let j = 0; j <= nv; j++) {
            const u = i / nu, v = j / nv;
            const val = dot(p.n(u, v), proj.viewDir(p.f(u, v)));
            // exactly 0 (e.g. the side of a cylinder seen from above): no outline there
            g[i].push(Math.abs(val) < 1e-9 ? 1e-9 : val);
        }
    }
    // crossing on a grid edge: key = the edge, value = (u, v)
    const pt = new Map<string, [number, number]>();
    // on a closed surface the last grid line is the first one: the same key, so outlines run across the seam
    const wi = (i: number) => p.wrapU && i === nu ? 0 : i, wj = (j: number) => p.wrapV && j === nv ? 0 : j;
    const hKey = (i: number, j: number) => `h${wi(i)},${wj(j)}`;   // (i,j)–(i+1,j)
    const vKey = (i: number, j: number) => `v${wi(i)},${wj(j)}`;   // (i,j)–(i,j+1)
    const cross = (a: number, b: number) => a / (a - b);
    const hPt = (i: number, j: number) => { const k = hKey(i, j); if (!pt.has(k)) pt.set(k, [(i + cross(g[i][j], g[i + 1][j])) / nu, j / nv]); return k; };
    const vPt = (i: number, j: number) => { const k = vKey(i, j); if (!pt.has(k)) pt.set(k, [i / nu, (j + cross(g[i][j], g[i][j + 1])) / nv]); return k; };
    const links = new Map<string, string[]>();
    const link = (a: string, b: string) => {
        if (a === b) return;
        (links.get(a) ?? links.set(a, []).get(a)!).push(b);
        (links.get(b) ?? links.set(b, []).get(b)!).push(a);
    };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const a = g[i][j], b = g[i + 1][j], c = g[i + 1][j + 1], d = g[i][j + 1];
        const e: string[] = [];
        // cell edges in order bottom, right, top, left
        if ((a > 0) !== (b > 0)) e.push(hPt(i, j));
        if ((b > 0) !== (c > 0)) e.push(vPt(i + 1, j));
        if ((d > 0) !== (c > 0)) e.push(hPt(i, j + 1));
        if ((a > 0) !== (d > 0)) e.push(vPt(i, j));
        if (e.length === 2) link(e[0], e[1]);
        else if (e.length === 4) {
            // saddle: pair by the value in the middle
            const mid = (a + b + c + d) / 4;
            if ((mid > 0) === (a > 0)) { link(e[0], e[1]); link(e[2], e[3]); } else { link(e[0], e[3]); link(e[1], e[2]); }
        }
    }
    // chain the segments into polylines
    const seen = new Set<string>();
    const out: V3[][] = [];
    const walk = (start: string) => {
        const chain = [start];
        seen.add(start);
        let cur = start;
        for (;;) {
            const nx = (links.get(cur) ?? []).find(k => !seen.has(k));
            if (!nx) break;
            seen.add(nx); chain.push(nx); cur = nx;
        }
        return chain;
    };
    // open chains first (start at an end), then closed loops
    for (const [k, l] of links) if (l.length === 1 && !seen.has(k)) out.push(walk(k).map(key => p.f(...pt.get(key)!)));
    for (const k of links.keys()) {
        if (seen.has(k)) continue;
        const chain = walk(k);
        if ((links.get(chain[chain.length - 1]) ?? []).includes(k)) chain.push(k);   // close the loop
        out.push(chain.map(key => p.f(...pt.get(key)!)));
    }
    return out.filter(l => l.length >= 2);
}

// ---------------------------------------------------------------- depth buffer
/**
 * Software depth buffer: for every pixel the nearest triangle. A query takes that triangle's plane at the exact
 * point (not at the pixel centre), so an edge lying on a face never hides itself, even on faces seen at a grazing angle.
 */
class DepthBuffer {
    private idx: Int32Array;
    private zb: Float32Array;
    private planes: Float64Array;   // per triangle: key = A x + B y + C (screen space), then its smallest and largest key
    private x0: number; private y0: number; private s: number;
    constructor(private proj: Projector, tris: [V3, V3, V3][], readonly res: number) {
        const pts = tris.map(t => t.map(p => proj.project(p)));
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const t of pts) for (const q of t) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
        const span = Math.max(1e-6, x1 - x0, y1 - y0);
        this.s = (res - 2) / span;
        this.x0 = x0 - 1 / this.s; this.y0 = y0 - 1 / this.s;
        this.idx = new Int32Array(res * res).fill(-1);
        this.zb = new Float32Array(res * res).fill(Infinity);
        this.planes = new Float64Array(tris.length * 5);
        pts.forEach((t, k) => this.raster(t, k));
    }
    private raster(t: { x: number; y: number; key: number }[], k: number) {
        const s = this.s, P = t.map(q => ({ x: (q.x - this.x0) * s, y: (q.y - this.y0) * s, z: q.key }));
        const [a, b, c] = P;
        const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
        if (Math.abs(area) < 1e-9) { this.planes[5 * k] = NaN; return; }
        // plane of the key over the pixel grid
        const A = ((b.z - a.z) * (c.y - a.y) - (c.z - a.z) * (b.y - a.y)) / area;
        const B = ((c.z - a.z) * (b.x - a.x) - (b.z - a.z) * (c.x - a.x)) / area;
        const C = a.z - A * a.x - B * a.y;
        this.planes.set([A, B, C, Math.min(a.z, b.z, c.z), Math.max(a.z, b.z, c.z)], 5 * k);
        const R = this.res;
        const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))), maxX = Math.min(R - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
        const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), maxY = Math.min(R - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
        const sg = area > 0 ? 1 : -1;
        for (let y = minY; y <= maxY; y++) {
            const py = y + 0.5;
            for (let x = minX; x <= maxX; x++) {
                const px = x + 0.5;
                const w0 = ((b.x - a.x) * (py - a.y) - (b.y - a.y) * (px - a.x)) * sg;
                const w1 = ((c.x - b.x) * (py - b.y) - (c.y - b.y) * (px - b.x)) * sg;
                const w2 = ((a.x - c.x) * (py - c.y) - (a.y - c.y) * (px - c.x)) * sg;
                if (w0 < 0 || w1 < 0 || w2 < 0) continue;
                const z = A * px + B * py + C, i = y * R + x;
                if (z < this.zb[i]) { this.zb[i] = z; this.idx[i] = k; }
            }
        }
    }
    /** Depth of the nearest surface at screen point (x, y), or Infinity. */
    depthAt(x: number, y: number): number {
        const px = (x - this.x0) * this.s, py = (y - this.y0) * this.s;
        const ix = Math.floor(px), iy = Math.floor(py);
        if (ix < 0 || iy < 0 || ix >= this.res || iy >= this.res) return Infinity;
        const k = this.idx[iy * this.res + ix];
        if (k < 0) return Infinity;
        const P = this.planes, o = 5 * k;
        if (Number.isNaN(P[o])) return Infinity;
        // The plane at the point, moved away by its slope over 1.5 pixels and kept within the triangle's own depths.
        // The point may lie just outside the triangle that won the pixel (next to an outline the triangles are thinner
        // than a pixel and seen almost edge-on, so their planes are steep): the error then always favours "visible".
        const slope = Math.hypot(P[o], P[o + 1]) * 1.5;
        const key = Math.max(P[o + 3], Math.min(P[o + 4], P[o] * px + P[o + 1] * py + P[o + 2] + slope));
        return this.proj.keyDepth(key);
    }
    /** Screen length of one pixel. */
    get pixel() { return 1 / this.s; }
}

// ---------------------------------------------------------------- visibility of lines
type Sample = { x: number; y: number; vis: boolean };

/** Splits 3D lines into visible and hidden screen polylines. */
function classify(lines: V3[][], proj: Projector, zbuf: DepthBuffer, step: number, eps: number, minRun: number) {
    const visible: Polyline[] = [], hidden: Polyline[] = [];
    for (const line of lines) {
        // fine samples along the line (by screen length)
        const smp: Sample[] = [];
        // Visible when nothing is in front of it at its pixel OR at one of the four next to it: a line really hidden
        // behind a face is hidden at all of them, and a line along an outline is not lost to a pixel of the steep
        // surface beside it (the error is at most a pixel where a hidden line passes behind an outline).
        const px = zbuf.pixel;
        const seen = (x: number, y: number, d: number) => zbuf.depthAt(x, y) >= d - eps;
        const add = (p: V3) => {
            const q = proj.project(p);
            const vis = seen(q.x, q.y, q.depth) || seen(q.x + px, q.y, q.depth) || seen(q.x - px, q.y, q.depth) || seen(q.x, q.y + px, q.depth) || seen(q.x, q.y - px, q.depth);
            smp.push({ x: q.x, y: q.y, vis });
        };
        add(line[0]);
        for (let i = 1; i < line.length; i++) {
            const a = proj.project(line[i - 1]), b = proj.project(line[i]);
            const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
            for (let k = 1; k <= n; k++) add(lerp3(line[i - 1], line[i], k / n));
        }
        if (smp.length < 2) continue;
        // runs of the same visibility; runs shorter than minRun join their neighbours (no flicker at corners)
        type Run = { vis: boolean; a: number; b: number; len: number };
        const runs: Run[] = [];
        for (let i = 0; i < smp.length; i++) {
            const last = runs[runs.length - 1];
            const d = i > 0 ? Math.hypot(smp[i].x - smp[i - 1].x, smp[i].y - smp[i - 1].y) : 0;
            if (last && last.vis === smp[i].vis) { last.b = i; last.len += d; } else runs.push({ vis: smp[i].vis, a: i, b: i, len: d });
        }
        for (let pass = 0; pass < 3 && runs.length > 1; pass++) {
            for (let r = 0; r < runs.length; r++) {
                if (runs.length < 2 || runs[r].len >= minRun) continue;
                const nb = r > 0 ? runs[r - 1] : runs[r + 1];
                nb.a = Math.min(nb.a, runs[r].a); nb.b = Math.max(nb.b, runs[r].b); nb.len += runs[r].len;
                runs.splice(r, 1);
                // merge neighbours that now have the same visibility
                for (let q = 1; q < runs.length; q++) if (runs[q].vis === runs[q - 1].vis) { runs[q - 1].b = runs[q].b; runs[q - 1].len += runs[q].len; runs.splice(q, 1); q--; }
                r--;
            }
        }
        for (const r of runs) {
            // a run ends where the next one begins (no gap between visible and hidden parts)
            const pl: Polyline = [];
            for (let i = r.a; i <= Math.min(smp.length - 1, r.b + 1); i++) pl.push([smp[i].x, smp[i].y]);
            if (pl.length < 2) continue;
            (r.vis ? visible : hidden).push(simplify(pl, step * 0.05));
        }
    }
    return { visible, hidden };
}

/** Distance from point p to the polyline l. */
function distToLine(p: [number, number], l: Polyline): number {
    let best = Infinity;
    for (let i = 1; i < l.length; i++) {
        const [ax, ay] = l[i - 1], [bx, by] = l[i];
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        const t = L2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2));
        best = Math.min(best, Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy));
    }
    return best;
}

/**
 * Drops lines that lie on a line already kept (in a front view the back edges coincide with the front ones; a hidden
 * edge under a visible one is not drawn, as in technical drawing). `keep` grows with the lines that stay.
 */
function dropCovered(lines: Polyline[], keep: Polyline[], tol: number): Polyline[] {
    const out: Polyline[] = [];
    for (const l of lines) {
        const box = { x0: Math.min(...l.map(p => p[0])) - tol, x1: Math.max(...l.map(p => p[0])) + tol, y0: Math.min(...l.map(p => p[1])) - tol, y1: Math.max(...l.map(p => p[1])) + tol };
        const near = keep.filter(k => k.some(([x, y]) => x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) || k.length === 2);
        // sample the line (its points and the middles of long segments)
        const pts: [number, number][] = [];
        for (let i = 0; i < l.length; i++) {
            pts.push(l[i]);
            if (i > 0) pts.push([(l[i][0] + l[i - 1][0]) / 2, (l[i][1] + l[i - 1][1]) / 2]);
        }
        if (near.length > 0 && pts.every(p => near.some(k => distToLine(p, k) < tol))) continue;
        out.push(l);
        keep.push(l);
    }
    return out;
}

/** Drops points that lie on the straight line between their neighbours (long straight edges keep 2 points). */
function simplify(pl: Polyline, tol: number): Polyline {
    if (pl.length <= 2) return pl;
    const out: Polyline = [pl[0]];
    for (let i = 1; i < pl.length - 1; i++) {
        const a = out[out.length - 1], b = pl[i], c = pl[i + 1];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        const dist = L < 1e-9 ? Math.hypot(b[0] - a[0], b[1] - a[1]) : Math.abs((c[0] - a[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (c[1] - a[1])) / L;
        if (dist > tol) out.push(b);
    }
    out.push(pl[pl.length - 1]);
    return out;
}

/** Size of the solid (diagonal of its bounding box). */
export function geomSize(g: SolidGeom): number {
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const t of g.tris) for (const p of t) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); z0 = Math.min(z0, p[2]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); z1 = Math.max(z1, p[2]); }
    return Math.hypot(x1 - x0, y1 - y0, z1 - z0);
}

/**
 * The line drawing of a solid in one view: sharp edges and outlines split into visible and hidden parts, and
 * the centre lines. `res`: depth buffer resolution (the preview and the note use ~1024, small icons less).
 */
export function drawSolid(g: SolidGeom, proj: Projector, opts: { hidden: HiddenMode; axes: boolean; res?: number }): SolidLines {
    const size = geomSize(g);
    const res = opts.res ?? 1024;
    const zbuf = new DepthBuffer(proj, g.tris, res);
    const lines = [...g.sharp];
    for (const p of g.smooth) lines.push(...contours(p, proj));
    const step = Math.max(zbuf.pixel * 1.5, size / 400);
    const cls = classify(lines, proj, zbuf, step, size * 0.01, size * 0.02);
    const tol = size * 0.002, kept: Polyline[] = [];
    const visible = dropCovered(cls.visible, kept, tol);
    const hidden = dropCovered(cls.hidden, kept, tol);
    const toScreen = (l: V3[]): Polyline => l.map(p => { const q = proj.project(p); return [q.x, q.y] as [number, number]; });
    return {
        visible,
        hidden: opts.hidden === 'hide' ? [] : hidden,
        axes: opts.axes ? g.axes.map(toScreen) : [],
    };
}
