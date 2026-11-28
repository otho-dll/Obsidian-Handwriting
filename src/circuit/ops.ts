/** Operations on the circuit model (pure – no DOM, no Obsidian). Ported from the prototype. */
import { canonNormal, degrees, edgeById, edgeGeom, labelLines, nodeById, projOnto, type EdgeGeom, type Vec } from './geometry';
import { DIRECTIONAL, GRID, PREFIX, SHEET_H, SHEET_W, TYPES, type Circuit, type CircuitEdge, type CircuitElement, type ElType } from './types';

const G = GRID;

export function emptyCircuit(): Circuit { return { nodes: [], edges: [], nid: 1 }; }
export function cloneCircuit(c: Circuit): Circuit { return JSON.parse(JSON.stringify(c)) as Circuit; }

const uid = (c: Circuit, p: string) => p + (c.nid++);
export function addNode(c: Circuit, x: number, y: number): string { const id = uid(c, 'n'); c.nodes.push({ id, x, y }); return id; }
export function addEdge(c: Circuit, a: string, b: string, els: CircuitElement[] = []): CircuitEdge {
    const e = { id: uid(c, 'e'), a, b, els }; c.edges.push(e); return e;
}
export function mkEl(c: Circuit, type: ElType, label = ''): CircuitElement { return { id: uid(c, 'x'), type, label, flip: false, side: 1 }; }

/** The editor starts with one square mesh: 4 nodes, 4 branches. */
export function startSquare(): Circuit {
    const c = emptyCircuit();
    const a = addNode(c, 220, 140), b = addNode(c, 680, 140), d = addNode(c, 680, 520), e = addNode(c, 220, 520);
    addEdge(c, a, b); addEdge(c, b, d); addEdge(c, e, d); addEdge(c, a, e);
    return c;
}

export function findEl(c: Circuit, id: string | undefined): { edge: CircuitEdge; idx: number; el: CircuitElement } | null {
    if (!id) return null;
    for (const e of c.edges) { const i = e.els.findIndex(x => x.id === id); if (i >= 0) return { edge: e, idx: i, el: e.els[i] }; }
    return null;
}
/** Removes nodes without branches. */
export function cleanup(c: Circuit) { const d = degrees(c); c.nodes = c.nodes.filter(n => (d.get(n.id) ?? 0) > 0); }

// ---- auto numbering ----
const numRe = (p: string) => new RegExp('^' + p + '_?\\{?(\\d+)\\}?$');
export function autoLabel(c: Circuit, type: ElType): string {
    const p = PREFIX[type]; if (!p) return '';
    let max = 0; const re = numRe(p);
    for (const e of c.edges) for (const el of e.els) {
        if (PREFIX[el.type] !== p) continue;
        const m = (el.label || '').match(re); if (m) max = Math.max(max, +m[1]);
    }
    return p + (max + 1);
}
export function isAutoLabel(el: CircuitElement): boolean {
    const p = PREFIX[el.type];
    return !el.label || (!!p && numRe(p).test(el.label));
}

// ---- arrows ----
export type ArrowDir = 'up' | 'down' | 'left' | 'right' | null;
/** Screen direction of a source's arrow (null on a diagonal branch). */
export function arrowDir(c: Circuit, edge: CircuitEdge, el: CircuitElement): ArrowDir {
    const g = edgeGeom(c, edge), sg = el.flip ? -1 : 1, vx = g.d.x * sg, vy = g.d.y * sg;
    if (Math.abs(vx) < 0.01) return vy > 0 ? 'down' : 'up';
    if (Math.abs(vy) < 0.01) return vx > 0 ? 'right' : 'left';
    return null;
}

/** Inserts an element at index k of a branch (auto-number, default arrow up / right). Returns it. */
export function insertElement(c: Circuit, eid: string, k: number, type: ElType, autoNum: boolean): CircuitElement | null {
    const e = edgeById(c, eid); if (!e) return null;
    const el = mkEl(c, type, autoNum ? autoLabel(c, type) : '');
    e.els.splice(Math.max(0, Math.min(k, e.els.length)), 0, el);
    if (DIRECTIONAL.includes(type)) { const d0 = arrowDir(c, e, el); if (d0 === 'down' || d0 === 'left') el.flip = true; }
    return el;
}
/** Index for inserting at point p on a branch: number of elements whose centre lies before p's projection. */
export function insertIndexAt(c: Circuit, e: CircuitEdge, p: Vec): number {
    const g = edgeGeom(c, e), q = projOnto(p, g);
    return g.items.filter(it => it.s < q.s).length;
}
/** Changes an element's type; an auto-numbered label is renumbered for the new type. */
export function changeType(c: Circuit, el: CircuitElement, type: ElType, autoNum: boolean) {
    const relabel = autoNum && isAutoLabel(el);
    el.type = type;
    if (relabel) { el.label = ''; el.label = autoLabel(c, type); }
}

/** Splits a branch at (x, y); elements go to the half they lie on. Returns the new node id. */
export function splitEdge(c: Circuit, eid: string, x: number, y: number): string {
    const e = edgeById(c, eid)!, g = edgeGeom(c, e);
    const s = (x - g.A.x) * g.d.x + (y - g.A.y) * g.d.y;
    const m = addNode(c, x, y);
    const left: CircuitElement[] = [], right: CircuitElement[] = [];
    g.items.forEach(it => (it.s < s ? left : right).push(it.el));
    c.edges = c.edges.filter(q => q !== e);
    addEdge(c, e.a, m, left); addEdge(c, m, e.b, right);
    return m;
}

export function segDist(p: Vec, a: Vec, b: Vec): number {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

export type Hit =
    | { kind: 'node'; id: string }
    | { kind: 'el'; edge: string; el: string }
    | { kind: 'edge'; edge: string; s: number }
    | { kind: 'none' };

/** Hit test of nodes, elements (incl. labels) and branches. `tol` = sheet units per screen px (× touch factor). */
export function hitTest(c: Circuit, p: Vec, tol: number, opt: { noEl?: boolean } = {}): Hit {
    for (const n of c.nodes) if (Math.hypot(p.x - n.x, p.y - n.y) < 10 * tol) return { kind: 'node', id: n.id };
    if (!opt.noEl) for (const e of c.edges) {
        const g = edgeGeom(c, e);
        for (const it of g.items) {
            const u = (p.x - it.c.x) * g.d.x + (p.y - it.c.y) * g.d.y, v = (p.x - it.c.x) * g.n.x + (p.y - it.c.y) * g.n.y, T = TYPES[it.el.type];
            if (Math.abs(u) <= T.h + 4 * tol && Math.abs(v) <= T.w + 5 * tol) return { kind: 'el', edge: e.id, el: it.el.id };
            const lb = labelLines(it, g);
            if (lb) { const b = lb.box; if (p.x >= b.x - 3 && p.x <= b.x + b.w + 3 && p.y >= b.y - 3 && p.y <= b.y + b.h + 5) return { kind: 'el', edge: e.id, el: it.el.id }; }
        }
    }
    let best: Hit = { kind: 'none' }, bd = 10 * tol;
    for (const e of c.edges) {
        const g = edgeGeom(c, e), q = projOnto(p, g), dd = Math.hypot(p.x - q.x, p.y - q.y);
        if (dd < bd) { bd = dd; best = { kind: 'edge', edge: e.id, s: q.s }; }
    }
    return best;
}

// ---- drawing wires ----
/** `dir`: the snap direction used (set only when the end was snapped to a direction). */
export type End =
    | { kind: 'node'; id: string; x: number; y: number; snap?: boolean; dir?: Vec }
    | { kind: 'split'; edge: string; x: number; y: number; snap?: boolean; dir?: Vec }
    | { kind: 'free'; x: number; y: number; snap?: boolean; dir?: Vec };
/** Snapping options: `angTol` in degrees (larger for pen / finger), `prevDir` = direction snapped on the previous move
 *  (kept until the pointer leaves 1.6 × angTol – hysteresis, so the snap doesn't flicker). */
export interface SnapOpts { angTol?: number; prevDir?: Vec | null }

/** Directions a new wire snaps to: axes, 45° and the start branch's direction and its perpendicular. */
export function snapDirs(c: Circuit, from: End): [number, number][] {
    const ds: [number, number][] = [[1, 0], [0, 1], [Math.SQRT1_2, Math.SQRT1_2], [Math.SQRT1_2, -Math.SQRT1_2]];
    const addE = (e: CircuitEdge) => { const g = edgeGeom(c, e); ds.unshift([g.d.x, g.d.y], [g.n.x, g.n.y]); };
    if (from.kind === 'node') for (const e of c.edges) { if (e.a === from.id || e.b === from.id) addE(e); }
    if (from.kind === 'split') { const e = edgeById(c, from.edge); if (e) addE(e); }
    return ds;
}
/** Intersection of the ray o + t·u with branch e (null if parallel, behind, or too close to its ends). */
export function rayHitEdge(c: Circuit, o: Vec, u: Vec, e: CircuitEdge): Vec | null {
    const g = edgeGeom(c, e), den = u.x * g.d.y - u.y * g.d.x;
    if (Math.abs(den) < 1e-6) return null;
    const wx = g.A.x - o.x, wy = g.A.y - o.y, t = (wx * g.d.y - wy * g.d.x) / den, s = (wx * u.y - wy * u.x) / den;
    if (t <= 1 || s < 8 || s > g.L - 8) return null;
    return { x: o.x + u.x * t, y: o.y + u.y * t };
}
const r1 = (v: number) => Math.round(v * 10) / 10;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Ray o + t·u against branch e without range checks: t along the ray, s along the branch. */
function rayEdge(c: Circuit, o: Vec, u: Vec, e: CircuitEdge): { x: number; y: number; t: number; s: number; L: number } | null {
    const g = edgeGeom(c, e), den = u.x * g.d.y - u.y * g.d.x;
    if (Math.abs(den) < 1e-6) return null;
    const wx = g.A.x - o.x, wy = g.A.y - o.y, t = (wx * g.d.y - wy * g.d.x) / den, s = (wx * u.y - wy * u.x) / den;
    return { x: o.x + u.x * t, y: o.y + u.y * t, t, s, L: g.L };
}

/** Direction snapping of a wire end (axes, 45°, the start branch and its perpendicular). The end lands exactly on the
 *  intersection with a branch it points at, or on a node lying on the ray; otherwise on the ray at a 20 px step. */
function snapAlong(c: Circuit, p: Vec, from: End, tol: number, hitEdge: CircuitEdge | undefined, opts: SnapOpts): End | null {
    const vx = p.x - from.x, vy = p.y - from.y, len = Math.hypot(vx, vy);
    if (len <= 12) return null;
    const ang = (opts.angTol ?? 6) * Math.PI / 180;
    // Directions of the start's branches (parallel / perpendicular) win over the generic axes and 45°:
    // on a slanted branch its perpendicular is often only a few degrees away from 45°.
    const all = snapDirs(c, from), rel = all.slice(0, all.length - 4), generic = all.slice(all.length - 4);
    const pick = (ds: [number, number][]) => {
        let b: Vec | null = null, bc = Math.cos(ang);
        for (const [dx, dy] of ds) for (const sg of [1, -1]) {
            const cs = (vx * dx * sg + vy * dy * sg) / len;
            if (cs > bc) { bc = cs; b = { x: dx * sg, y: dy * sg }; }
        }
        return b;
    };
    let best = pick(rel) ?? pick(generic);
    const pd = opts.prevDir;
    if (pd && (vx * pd.x + vy * pd.y) / len > Math.cos(ang * 1.6)) best = pd;      // hysteresis
    if (!best) return null;
    const dir = best, magnet = 12 * tol;
    const fromEdge = from.kind === 'split' ? from.edge : null;
    // 1) a branch the ray hits close to the pointer (or the branch under the pointer) → end exactly on it
    let hit: End | null = null, hd = Infinity;
    for (const e of c.edges) {
        if (e.id === fromEdge || (from.kind === 'node' && (e.a === from.id || e.b === from.id))) continue;
        const q = rayEdge(c, from, dir, e);
        if (!q || q.t <= 1 || q.s < -1 || q.s > q.L + 1) continue;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (!(d <= magnet || e === hitEdge) || d >= hd) continue;
        if (q.s < 8 || q.s > q.L - 8) {
            const nid = q.s < 8 ? e.a : e.b, n = nodeById(c, nid)!;
            // the end node itself lies on the ray → use it; otherwise the intersection is too close to the end
            if (Math.abs((n.x - from.x) * dir.y - (n.y - from.y) * dir.x) < 1.5) { hit = { kind: 'node', id: n.id, x: n.x, y: n.y, snap: true, dir }; hd = d; }
            continue;
        }
        hit = { kind: 'split', edge: e.id, x: r2(q.x), y: r2(q.y), snap: true, dir }; hd = d;
    }
    if (hit) return hit;
    // 2) a node lying on the ray near the pointer
    for (const n of c.nodes) {
        const t = (n.x - from.x) * dir.x + (n.y - from.y) * dir.y;
        if (t <= 1) continue;
        if (Math.abs((n.x - from.x) * dir.y - (n.y - from.y) * dir.x) < 1.5 && Math.hypot(n.x - p.x, n.y - p.y) <= magnet) return { kind: 'node', id: n.id, x: n.x, y: n.y, snap: true, dir };
    }
    if (hitEdge) return null;      // pointer on a branch the ray doesn't reach → plain split under the pointer
    // 3) free point on the ray, length rounded to the grid step
    const t = Math.max(G, Math.round((vx * dir.x + vy * dir.y) / G) * G), q = { x: from.x + dir.x * t, y: from.y + dir.y * t };
    const nn = c.nodes.find(n => Math.hypot(n.x - q.x, n.y - q.y) < 9);
    if (nn) return { kind: 'node', id: nn.id, x: nn.x, y: nn.y };
    return { kind: 'free', x: r2(q.x), y: r2(q.y), snap: true, dir };
}

/** Where a wire starts / ends: an existing node, a point on a branch (split) or a free grid point. */
export function resolveEnd(c: Circuit, p: Vec, from: End | null, tol: number, opts: SnapOpts = {}): End {
    const h = hitTest(c, p, tol);
    if (h.kind === 'node') { const n = nodeById(c, h.id)!; return { kind: 'node', id: n.id, x: n.x, y: n.y }; }
    const hitEdge = h.kind === 'edge' || h.kind === 'el' ? edgeById(c, h.edge) : undefined;
    if (from) {
        const snapped = snapAlong(c, p, from, tol, hitEdge, opts);
        if (snapped) return snapped;
    }
    if (hitEdge) {
        const g = edgeGeom(c, hitEdge), q = projOnto(p, g);
        if (q.s < 8) return { kind: 'node', id: hitEdge.a, x: g.A.x, y: g.A.y };
        if (q.s > g.L - 8) return { kind: 'node', id: hitEdge.b, x: g.B.x, y: g.B.y };
        const gx = Math.round(q.x / G) * G, gy = Math.round(q.y / G) * G;
        const off = Math.abs((gx - g.A.x) * g.n.x + (gy - g.A.y) * g.n.y), sg = (gx - g.A.x) * g.d.x + (gy - g.A.y) * g.d.y;
        if (off < 1.5 && sg > 8 && sg < g.L - 8) return { kind: 'split', edge: hitEdge.id, x: gx, y: gy };
        return { kind: 'split', edge: hitEdge.id, x: r1(q.x), y: r1(q.y) };
    }
    let x = Math.round(p.x / G) * G, y = Math.round(p.y / G) * G;
    if (from) { if (Math.abs(x - from.x) < 14) x = from.x; if (Math.abs(y - from.y) < 14) y = from.y; }
    return { kind: 'free', x, y };
}
/** Turns an End into a node id (creating / splitting as needed). */
export function materialize(c: Circuit, r: End): string {
    if (r.kind === 'node') return r.id;
    if (r.kind === 'split' && edgeById(c, r.edge)) return splitEdge(c, r.edge, r.x, r.y);
    const ex = c.nodes.find(n => Math.hypot(n.x - r.x, n.y - r.y) < 1);
    if (ex) return ex.id;
    return addNode(c, r.x, r.y);
}
/** Adds a wire from `st` to `en`. Returns the branch (existing one if the two nodes are already joined), or null. */
export function addWire(c: Circuit, st: End, en: End, tol: number): CircuitEdge | null {
    if (Math.hypot(en.x - st.x, en.y - st.y) < 10) return null;
    const a = materialize(c, st);
    let en2 = en;
    // The start may have split the very branch the end points at – resolve the end again.
    if (en.kind === 'split' && !edgeById(c, en.edge)) {
        en2 = resolveEnd(c, { x: en.x, y: en.y }, null, tol);
        if (en2.kind === 'free') en2 = { ...en2, x: en.x, y: en.y };
    }
    const b = materialize(c, en2);
    if (a === b) return null;
    return c.edges.find(q => (q.a === a && q.b === b) || (q.a === b && q.b === a)) ?? addEdge(c, a, b);
}

// ---- parallel branch ----
/** Visible part of the sheet (editor px): a parallel branch must stay inside it. */
export interface SheetBounds { x0: number; y0: number; x1: number; y1: number }
export const DEFAULT_BOUNDS: SheetBounds = { x0: 0, y0: 0, x1: SHEET_W, y1: SHEET_H };

/** Adds a branch parallel to `eid`. Returns the new branch, or null when there is no room inside `bounds`. */
export function parallel(c: Circuit, eid: string, bounds: SheetBounds = DEFAULT_BOUNDS): CircuitEdge | null {
    const e = edgeById(c, eid); if (!e) return null;
    const g = edgeGeom(c, e), A = g.A, B = g.B, nn = canonNormal(g.d);
    const sampleFree = (P: Vec, Q: Vec) => {
        const L = Math.hypot(Q.x - P.x, Q.y - P.y), n = Math.max(1, Math.ceil(L / 6));
        for (let i = 0; i <= n; i++) {
            const p = { x: P.x + (Q.x - P.x) * i / n, y: P.y + (Q.y - P.y) * i / n };
            if ([A, B, P, Q].some(r => Math.hypot(p.x - r.x, p.y - r.y) < 14)) continue;
            if (p.x < bounds.x0 + 10 || p.y < bounds.y0 + 10 || p.x > bounds.x1 - 10 || p.y > bounds.y1 - 10) return false;
            for (const m of c.nodes) if (Math.hypot(p.x - m.x, p.y - m.y) < 14) return false;
            const nearEnd = Math.hypot(p.x - A.x, p.y - A.y) < 26 || Math.hypot(p.x - B.x, p.y - B.y) < 26;
            for (const q of c.edges) {
                if (nearEnd && [e.a, e.b].some(id => q.a === id || q.b === id)) continue;
                if (segDist(p, nodeById(c, q.a)!, nodeById(c, q.b)!) < 12) return false;
            }
        }
        return true;
    };
    type Plan = { kind: 'node'; id: string } | { kind: 'split'; edge: string } | { kind: 'new' } | null;
    /** How to join node nid (at P) with point Q: along an existing rail (split) or with a new wire. */
    const plan = (nid: string, P: Vec, Q: Vec): Plan => {
        const L = Math.hypot(Q.x - P.x, Q.y - P.y), ux = (Q.x - P.x) / L, uy = (Q.y - P.y) / L;
        for (const q of c.edges) {
            if (q === e || (q.a !== nid && q.b !== nid)) continue;
            const o = nodeById(c, q.a === nid ? q.b : q.a)!, ql = Math.hypot(o.x - P.x, o.y - P.y);
            if (((o.x - P.x) * ux + (o.y - P.y) * uy) / ql > 0.999) {
                if (Math.abs(ql - L) < 1) return { kind: 'node', id: o.id };
                if (ql > L + 8) {
                    const gq = edgeGeom(c, q), s = (Q.x - gq.A.x) * gq.d.x + (Q.y - gq.A.y) * gq.d.y;
                    if (gq.items.some(it => Math.abs(it.s - s) < it.h + 8)) return null;
                    return { kind: 'split', edge: q.id };
                }
                return null;
            }
        }
        return sampleFree(P, Q) ? { kind: 'new' } : null;
    };
    const railLen = (nid: string, P: Vec, sd: number) => {
        let best = 0;
        for (const q of c.edges) {
            if (q === e || (q.a !== nid && q.b !== nid)) continue;
            const o = nodeById(c, q.a === nid ? q.b : q.a)!, ql = Math.hypot(o.x - P.x, o.y - P.y);
            if (((o.x - P.x) * nn.x * sd + (o.y - P.y) * nn.y * sd) / ql > 0.999) best = ql;
        }
        return best;
    };
    for (const sd of [1, -1]) {
        const r = Math.min(railLen(e.a, A, sd) || Infinity, railLen(e.b, B, sd) || Infinity);
        const Ds = [...(isFinite(r) ? [Math.max(40, Math.round(r / 2 / G) * G)] : []), 80, 100, 120, 160, 60, 200];
        for (const D of Ds) {
            if (D < 40) continue;
            // Axis-aligned branches stay on the grid; diagonal ones are offset exactly along the normal.
            const ax = Math.abs(nn.x) < 1e-6 || Math.abs(nn.y) < 1e-6;
            const ox = ax ? Math.round(nn.x * sd * D / G) * G : nn.x * sd * D, oy = ax ? Math.round(nn.y * sd * D / G) * G : nn.y * sd * D;
            const Q1 = { x: A.x + ox, y: A.y + oy }, Q2 = { x: B.x + ox, y: B.y + oy };
            const pa = plan(e.a, A, Q1), pb = plan(e.b, B, Q2);
            if (!pa || !pb || !sampleFree(Q1, Q2)) continue;
            const mk = (pl: NonNullable<Plan>, nid: string, Q: Vec) => {
                if (pl.kind === 'node') return pl.id;
                if (pl.kind === 'split') return splitEdge(c, pl.edge, Q.x, Q.y);
                const m = addNode(c, Q.x, Q.y); addEdge(c, nid, m); return m;
            };
            const a2 = mk(pa, e.a, Q1), b2 = mk(pb, e.b, Q2);
            return addEdge(c, a2, b2);
        }
    }
    return null;
}

// ---- deleting ----
export function deleteElement(c: Circuit, id: string) { const f = findEl(c, id); if (f) f.edge.els.splice(f.idx, 1); }
export function deleteEdges(c: Circuit, ids: string[]) { const s = new Set(ids); c.edges = c.edges.filter(e => !s.has(e.id)); cleanup(c); }
export function deleteNode(c: Circuit, id: string) {
    c.edges = c.edges.filter(e => e.a !== id && e.b !== id);
    c.nodes = c.nodes.filter(n => n.id !== id);
    cleanup(c);
}

// ---- moving ----
/** Re-points branches from node `from` to node `to`, removes `from` and zero-length branches. */
function mergeNode(c: Circuit, from: string, to: string) {
    for (const e of c.edges) { if (e.a === from) e.a = to; if (e.b === from) e.b = to; }
    c.nodes = c.nodes.filter(m => m.id !== from);
    c.edges = c.edges.filter(e => e.a !== e.b);
}
/** After a single node was moved: merge it into a node it landed on. Returns true when merged. */
export function settleNode(c: Circuit, id: string): boolean {
    const n = nodeById(c, id); if (!n) return false;
    const o = c.nodes.find(m => m !== n && Math.hypot(m.x - n.x, m.y - n.y) < 1);
    if (!o) return false;
    mergeNode(c, n.id, o.id);
    return true;
}
/** Nodes of the given branches with their original positions (start of a group move). */
export function groupOrigin(c: Circuit, edgeIds: string[]): [string, number, number][] {
    const ns = new Set<string>();
    for (const id of edgeIds) { const e = edgeById(c, id); if (e) { ns.add(e.a); ns.add(e.b); } }
    return [...ns].map(id => { const n = nodeById(c, id)!; return [id, n.x, n.y]; });
}
/** Moves a group by (dx, dy) rounded to the grid step (off-grid nodes keep their offset). */
export function moveGroup(c: Circuit, orig: [string, number, number][], dx: number, dy: number) {
    const rx = Math.round(dx / G) * G, ry = Math.round(dy / G) * G;
    for (const [id, x, y] of orig) { const n = nodeById(c, id); if (n) { n.x = x + rx; n.y = y + ry; } }
}
/** End of a group move: moved nodes landing on other nodes are merged, zero-length branches go away. */
export function settleGroup(c: Circuit, orig: [string, number, number][]) {
    const moved = new Set(orig.map(o => o[0]));
    for (const id of moved) {
        const n = nodeById(c, id); if (!n) continue;
        const o = c.nodes.find(m => !moved.has(m.id) && Math.hypot(m.x - n.x, m.y - n.y) < 1);
        if (o) mergeNode(c, id, o.id);
    }
    c.edges = c.edges.filter(e => e.a !== e.b);
}
/** Moves an element to the place on branch `toEdge` nearest to p. */
export function moveElement(c: Circuit, elId: string, toEdge: string, p: Vec) {
    const f = findEl(c, elId), te = edgeById(c, toEdge); if (!f || !te) return;
    const el = f.edge.els.splice(f.idx, 1)[0];
    te.els.splice(insertIndexAt(c, te, p), 0, el);
}
/** Swaps an element with its neighbour (dir -1 / +1). */
export function shiftElement(c: Circuit, elId: string, dir: -1 | 1): boolean {
    const f = findEl(c, elId); if (!f) return false;
    const j = f.idx + dir, arr = f.edge.els; if (j < 0 || j >= arr.length) return false;
    [arr[f.idx], arr[j]] = [arr[j], arr[f.idx]];
    return true;
}

// ---- lasso ----
export function pointInPolygon(P: [number, number][], x: number, y: number): boolean {
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const [xi, yi] = P[i], [xj, yj] = P[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}
/** Branches with BOTH ends inside the lasso loop. */
export function lassoEdges(c: Circuit, loop: [number, number][]): string[] {
    if (loop.length < 3) return [];
    const inL = (id: string) => { const n = nodeById(c, id)!; return pointInPolygon(loop, n.x, n.y); };
    return c.edges.filter(e => inL(e.a) && inL(e.b)).map(e => e.id);
}

// ---- "+" slots ----
export function plusSlots(g: EdgeGeom): { k: number; x: number; y: number; s: number }[] {
    if (g.L < 26) return [];
    const b = [0, ...g.items.map(it => it.s), g.L], out: { k: number; x: number; y: number; s: number }[] = [];
    for (let k = 0; k < b.length - 1; k++) {
        const s = (b[k] + b[k + 1]) / 2;
        out.push({ k, x: g.A.x + g.d.x * s, y: g.A.y + g.d.y * s, s });
    }
    return out;
}
