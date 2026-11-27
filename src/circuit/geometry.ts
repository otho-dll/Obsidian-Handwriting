import { displayLabel, layoutText, type Polyline, type Pt } from './font';
import { TYPES, type Circuit, type CircuitEdge, type CircuitElement, type CircuitNode, type ElType } from './types';

export interface Vec { x: number; y: number }
export interface EdgeItem { el: CircuitElement; s: number; h: number; c: Vec }
export interface EdgeGeom { e: CircuitEdge; A: CircuitNode; B: CircuitNode; L: number; d: Vec; n: Vec; items: EdgeItem[] }

export const LABEL_SIZE = 13;

export function nodeById(c: Circuit, id: string): CircuitNode | undefined { return c.nodes.find(n => n.id === id); }
export function edgeById(c: Circuit, id: string): CircuitEdge | undefined { return c.edges.find(e => e.id === id); }

export function circlePts(r: number, cx = 0, cy = 0, n = 36): Polyline {
    const p: Polyline = [];
    for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return p;
}
const arrowLocal = (len: number): Polyline[] => [[[-len, 0], [len, 0]], [[len - 5, -4.5], [len, 0], [len - 5, 4.5]]];
const diamond = (r: number): Polyline => [[-r, 0], [0, -r], [r, 0], [0, r], [-r, 0]];

/** Symbol in local coordinates: x along the branch (centre = 0), y across. */
export function symbolLocal(type: ElType): { lines: Polyline[]; arrow?: Polyline[]; letter?: string } {
    switch (type) {
        case 'R': return { lines: [[[-24, -9], [24, -9], [24, 9], [-24, 9], [-24, -9]]] };
        case 'L': {
            const p: Polyline = [];
            for (let k = 0; k < 3; k++) {
                const cx = -12 + 12 * k;
                for (let i = k ? 1 : 0; i <= 14; i++) { const a = Math.PI - i / 14 * Math.PI; p.push([cx + 6 * Math.cos(a), -6 * Math.sin(a)]); }
            }
            return { lines: [p] };
        }
        case 'C': return { lines: [[[-6, -14], [-6, 14]], [[6, -14], [6, 14]]] };
        case 'E': return { lines: [circlePts(16)], arrow: arrowLocal(10) };
        case 'J': return { lines: [circlePts(16), circlePts(12)], arrow: arrowLocal(7.5) };
        case 'U': return { lines: [diamond(17)], arrow: arrowLocal(9) };
        case 'I': return { lines: [diamond(17), diamond(12.5)], arrow: arrowLocal(6.5) };
        case 'A': return { lines: [circlePts(14)], letter: 'A' };
        case 'V': return { lines: [circlePts(14)], letter: 'V' };
    }
}

export function edgeGeom(c: Circuit, e: CircuitEdge): EdgeGeom {
    const A = nodeById(c, e.a)!, B = nodeById(c, e.b)!;
    const dx = B.x - A.x, dy = B.y - A.y, L = Math.hypot(dx, dy) || 1;
    const d = { x: dx / L, y: dy / L }, n = { x: -d.y, y: d.x };
    const k = e.els.length;
    const items = e.els.map((el, i) => {
        const s = L * (i + 1) / (k + 1);
        return { el, s, h: TYPES[el.type].h, c: { x: A.x + d.x * s, y: A.y + d.y * s } };
    });
    return { e, A, B, L, d, n, items };
}
export const at = (g: EdgeGeom, s: number): Pt => [g.A.x + g.d.x * s, g.A.y + g.d.y * s];
export function projOnto(p: Vec, g: EdgeGeom): { s: number; x: number; y: number } {
    let s = (p.x - g.A.x) * g.d.x + (p.y - g.A.y) * g.d.y;
    s = Math.max(0, Math.min(g.L, s));
    return { s, x: g.A.x + g.d.x * s, y: g.A.y + g.d.y * s };
}
/** "Canonical" normal: up for horizontal-ish branches, right for vertical-ish ones. */
export function canonNormal(d: Vec): Vec {
    let n = { x: -d.y, y: d.x };
    if (Math.abs(d.x) >= Math.abs(d.y)) { if (n.y > 0) n = { x: -n.x, y: -n.y }; }
    else if (n.x < 0) n = { x: -n.x, y: -n.y };
    return n;
}

export function symbolWorld(it: EdgeItem, g: EdgeGeom): Polyline[] {
    const sym = symbolLocal(it.el.type), f = it.el.flip ? -1 : 1;
    const tr = ([x, y]: Pt): Pt => { x *= f; return [it.c.x + g.d.x * x + g.n.x * y, it.c.y + g.d.y * x + g.n.y * y]; };
    const out = sym.lines.map(l => l.map(tr));
    if (sym.arrow) out.push(...sym.arrow.map(l => l.map(tr)));
    if (sym.letter) {
        const t = layoutText(sym.letter, 12);
        out.push(...t.lines.map(l => l.map(([x, y]) => [x + it.c.x - t.width / 2, y + it.c.y + 6] as Pt)));
    }
    return out;
}

export function labelLines(it: EdgeItem, g: EdgeGeom): { lines: Polyline[]; box: { x: number; y: number; w: number; h: number } } | null {
    if (!it.el.label) return null;
    const size = LABEL_SIZE;
    const t = layoutText(displayLabel(it.el.label), size);
    const nn = canonNormal(g.d), sd = it.el.side || 1;
    const nl = { x: nn.x * sd, y: nn.y * sd };
    const dist = TYPES[it.el.type].w + 7;
    const P = { x: it.c.x + nl.x * dist, y: it.c.y + nl.y * dist };
    const left = nl.x > 0.35 ? P.x : nl.x < -0.35 ? P.x - t.width : P.x - t.width / 2;
    const base = nl.y < -0.35 ? P.y : nl.y > 0.35 ? P.y + size : P.y + size / 2;
    return { lines: t.lines.map(l => l.map(([x, y]) => [x + left, y + base] as Pt)), box: { x: left, y: base - size, w: t.width, h: size } };
}

export function degrees(c: Circuit): Map<string, number> {
    const d = new Map<string, number>();
    for (const e of c.edges) { d.set(e.a, (d.get(e.a) ?? 0) + 1); d.set(e.b, (d.get(e.b) ?? 0) + 1); }
    return d;
}

export interface Scene { geoms: Map<string, EdgeGeom>; elLines: Map<string, Polyline[]>; wires: Polyline[]; wireEdge: string[]; dots: CircuitNode[] }

/** The whole circuit as polylines – the SAME geometry goes to the editor preview and to the note. */
export function scene(c: Circuit, opts: { dots: boolean }): Scene {
    const geoms = new Map<string, EdgeGeom>(), elLines = new Map<string, Polyline[]>(), wires: Polyline[] = [], wireEdge: string[] = [];
    for (const e of c.edges) {
        const g = edgeGeom(c, e); geoms.set(e.id, g);
        let cur = 0;
        for (const it of g.items) {
            const a = it.s - it.h;
            if (a > cur + 0.5) { wires.push([at(g, cur), at(g, a)]); wireEdge.push(e.id); }
            cur = Math.max(cur, it.s + it.h);
        }
        if (g.L > cur + 0.5) { wires.push([at(g, cur), at(g, g.L)]); wireEdge.push(e.id); }
        for (const it of g.items) {
            const lines = symbolWorld(it, g);
            const lb = labelLines(it, g);
            if (lb) lines.push(...lb.lines);
            elLines.set(it.el.id, lines);
        }
    }
    const deg = degrees(c);
    const dots = opts.dots ? c.nodes.filter(n => (deg.get(n.id) ?? 0) >= 3) : [];
    return { geoms, elLines, wires, wireEdge, dots };
}

export function circuitToPolylines(c: Circuit, opts: { dots: boolean }): Polyline[] {
    const sc = scene(c, opts);
    const out: Polyline[] = [...sc.wires];
    for (const l of sc.elLines.values()) out.push(...l);
    // Junction dot: concentric circles close enough to look filled even with a thin pen.
    for (const n of sc.dots) { out.push(circlePts(3, n.x, n.y, 16)); out.push(circlePts(2.1, n.x, n.y, 12)); out.push(circlePts(1.3, n.x, n.y, 10)); out.push(circlePts(0.5, n.x, n.y, 6)); }
    return out;
}
