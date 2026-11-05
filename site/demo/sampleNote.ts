// Generates the sample note "Demo.hnote" (deterministic – the same note every time).
// Handwriting comes from a tiny single-stroke font below, with slant, wobble and pen pressure,
// so it looks written rather than typeset. Coordinates: page units (A4 = 800 × 1131).

type Pt = { x: number; y: number; pressure: number };
interface Stroke {
    points: Pt[]; color: string; width: number; isHighlighter: boolean;
    shape?: 'line' | 'rect' | 'ellipse'; dash?: 'solid' | 'dashed' | 'dotted' | 'dashdot';
    fill?: boolean; fillAlpha?: number; noLine?: boolean; arrow?: boolean; alpha?: number; g?: string;
}
interface Page { strokes: Stroke[]; tpl?: string; paper?: string; w?: number; h?: number; title?: string; }

// ---- deterministic randomness ----
let seed = 20261104;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const jit = (a: number) => (rnd() * 2 - 1) * a;

// ---- the font ----
// Each glyph: width and strokes; a stroke is a list of commands in a box where y=0 is the cap line, y=0.5 the
// x-height and y=1 the baseline (y grows downwards). Commands:
//   ['L', x1, y1, x2, y2, …]           straight segments through the points
//   ['S', x1, y1, x2, y2, …]           smooth curve through the points (Catmull-Rom)
//   ['A', cx, cy, rx, ry, a0, a1]      elliptic arc, angles in degrees (0 = right, 90 = down)
type Cmd = (string | number)[];
interface Glyph { w: number; s: Cmd[][]; }

const O = (cx: number, cy: number, r: number): Cmd => ['A', cx, cy, r, r, -90, -450];
const DOT = (x: number, y: number): Cmd => ['L', x, y, x + 0.01, y + 0.01];

const G: Record<string, Glyph> = {
    a: { w: 0.5, s: [[['A', 0.25, 0.75, 0.25, 0.25, -20, -380]], [['L', 0.5, 0.52, 0.5, 1]]] },
    b: { w: 0.5, s: [[['L', 0, 0, 0, 1]], [O(0.25, 0.75, 0.25)]] },
    c: { w: 0.45, s: [[['A', 0.25, 0.75, 0.25, 0.25, -40, -320]]] },
    d: { w: 0.5, s: [[O(0.25, 0.75, 0.25)], [['L', 0.5, 0, 0.5, 1]]] },
    e: { w: 0.48, s: [[['L', 0.02, 0.76, 0.48, 0.76], ['A', 0.25, 0.75, 0.24, 0.25, 0, -310]]] },
    f: { w: 0.35, s: [[['A', 0.32, 0.2, 0.14, 0.18, -20, -180], ['L', 0.18, 0.2, 0.18, 1]], [['L', 0.02, 0.5, 0.36, 0.5]]] },
    g: { w: 0.5, s: [[O(0.25, 0.75, 0.25)], [['L', 0.5, 0.52, 0.5, 1.14], ['A', 0.26, 1.14, 0.24, 0.2, 0, 160]]] },
    h: { w: 0.48, s: [[['L', 0, 0, 0, 1]], [['L', 0, 0.78], ['A', 0.24, 0.76, 0.24, 0.24, 180, 360], ['L', 0.48, 0.76, 0.48, 1]]] },
    i: { w: 0.12, s: [[['L', 0.06, 0.52, 0.06, 1]], [DOT(0.06, 0.3)]] },
    j: { w: 0.28, s: [[['L', 0.24, 0.52, 0.24, 1.14], ['A', 0.06, 1.14, 0.18, 0.18, 0, 150]], [DOT(0.24, 0.3)]] },
    k: { w: 0.42, s: [[['L', 0, 0, 0, 1]], [['L', 0.4, 0.5, 0.02, 0.78, 0.42, 1]]] },
    l: { w: 0.12, s: [[['S', 0.04, 0, 0.04, 0.6, 0.06, 0.94, 0.14, 1]]] },
    m: { w: 0.8, s: [[['L', 0, 0.52, 0, 1]], [['L', 0, 0.72], ['A', 0.2, 0.72, 0.2, 0.2, 180, 360], ['L', 0.4, 0.72, 0.4, 1]], [['L', 0.4, 0.72], ['A', 0.6, 0.72, 0.2, 0.2, 180, 360], ['L', 0.8, 0.72, 0.8, 1]]] },
    n: { w: 0.46, s: [[['L', 0, 0.52, 0, 1]], [['L', 0, 0.76], ['A', 0.23, 0.74, 0.23, 0.22, 180, 360], ['L', 0.46, 0.74, 0.46, 1]]] },
    o: { w: 0.5, s: [[O(0.25, 0.75, 0.25)]] },
    p: { w: 0.5, s: [[['L', 0, 0.52, 0, 1.36]], [O(0.25, 0.75, 0.25)]] },
    q: { w: 0.5, s: [[O(0.25, 0.75, 0.25)], [['L', 0.5, 0.52, 0.5, 1.36]]] },
    r: { w: 0.34, s: [[['L', 0, 0.52, 0, 1]], [['L', 0, 0.8], ['A', 0.24, 0.76, 0.24, 0.24, 180, 300]]] },
    s: { w: 0.4, s: [[['S', 0.38, 0.56, 0.22, 0.5, 0.05, 0.56, 0.06, 0.68, 0.22, 0.75, 0.37, 0.83, 0.36, 0.95, 0.2, 1, 0.02, 0.95]]] },
    t: { w: 0.36, s: [[['S', 0.14, 0.18, 0.14, 0.7, 0.16, 0.95, 0.26, 1, 0.36, 0.97]], [['L', 0, 0.52, 0.34, 0.5]]] },
    u: { w: 0.46, s: [[['L', 0, 0.52, 0, 0.76], ['A', 0.23, 0.76, 0.23, 0.24, 180, 0], ['L', 0.46, 0.76, 0.46, 0.52]], [['L', 0.46, 0.52, 0.46, 1]]] },
    v: { w: 0.44, s: [[['L', 0, 0.52, 0.22, 1, 0.44, 0.52]]] },
    w: { w: 0.66, s: [[['L', 0, 0.52, 0.16, 1, 0.33, 0.6, 0.5, 1, 0.66, 0.52]]] },
    x: { w: 0.42, s: [[['L', 0, 0.52, 0.42, 1]], [['L', 0.42, 0.52, 0, 1]]] },
    y: { w: 0.46, s: [[['L', 0, 0.52, 0.23, 1]], [['L', 0.46, 0.52, 0.16, 1.36]]] },
    z: { w: 0.42, s: [[['L', 0.02, 0.52, 0.42, 0.52, 0, 1, 0.44, 1]]] },
    A: { w: 0.64, s: [[['L', 0, 1, 0.32, 0, 0.64, 1]], [['L', 0.13, 0.64, 0.51, 0.64]]] },
    C: { w: 0.66, s: [[['A', 0.36, 0.5, 0.34, 0.5, -40, -320]]] },
    E: { w: 0.5, s: [[['L', 0.5, 0, 0, 0, 0, 1, 0.52, 1]], [['L', 0, 0.5, 0.42, 0.5]]] },
    H: { w: 0.58, s: [[['L', 0, 0, 0, 1]], [['L', 0.58, 0, 0.58, 1]], [['L', 0, 0.5, 0.58, 0.5]]] },
    L: { w: 0.48, s: [[['L', 0, 0, 0, 1, 0.5, 1]]] },
    N: { w: 0.6, s: [[['L', 0, 1, 0, 0, 0.6, 1, 0.6, 0]]] },
    P: { w: 0.5, s: [[['L', 0, 1, 0, 0]], [['S', 0, 0.02, 0.32, 0.02, 0.5, 0.22, 0.34, 0.48, 0, 0.5]]] },
    S: { w: 0.52, s: [[['S', 0.5, 0.12, 0.3, 0, 0.08, 0.06, 0.05, 0.26, 0.26, 0.44, 0.48, 0.6, 0.5, 0.86, 0.3, 1, 0.02, 0.92]]] },
    T: { w: 0.62, s: [[['L', 0, 0, 0.62, 0]], [['L', 0.31, 0, 0.31, 1]]] },
    W: { w: 0.86, s: [[['L', 0, 0, 0.2, 1, 0.43, 0.3, 0.66, 1, 0.86, 0]]] },
    B: { w: 0.52, s: [[['L', 0, 1, 0, 0]], [['S', 0, 0.02, 0.32, 0.02, 0.46, 0.22, 0.3, 0.47, 0, 0.5]], [['S', 0, 0.5, 0.36, 0.52, 0.52, 0.75, 0.36, 0.98, 0, 1]]] },
    D: { w: 0.56, s: [[['L', 0, 0, 0, 1]], [['S', 0, 0.02, 0.3, 0.04, 0.55, 0.3, 0.55, 0.7, 0.3, 0.96, 0, 0.98]]] },
    F: { w: 0.48, s: [[['L', 0.5, 0, 0, 0, 0, 1]], [['L', 0, 0.5, 0.4, 0.5]]] },
    G: { w: 0.66, s: [[['A', 0.36, 0.5, 0.34, 0.5, -40, -320], ['L', 0.62, 0.82, 0.62, 0.56, 0.42, 0.56]]] },
    I: { w: 0.1, s: [[['L', 0.04, 0, 0.04, 1]]] },
    J: { w: 0.44, s: [[['L', 0.4, 0, 0.4, 0.75], ['A', 0.2, 0.75, 0.2, 0.25, 0, 180]]] },
    K: { w: 0.52, s: [[['L', 0, 0, 0, 1]], [['L', 0.5, 0, 0.02, 0.55, 0.52, 1]]] },
    M: { w: 0.72, s: [[['L', 0, 1, 0.04, 0, 0.36, 0.7, 0.68, 0, 0.72, 1]]] },
    O: { w: 0.72, s: [[['A', 0.36, 0.5, 0.36, 0.5, -90, -450]]] },
    Q: { w: 0.74, s: [[['A', 0.36, 0.5, 0.36, 0.5, -90, -450]], [['L', 0.42, 0.7, 0.74, 1.05]]] },
    R: { w: 0.52, s: [[['L', 0, 1, 0, 0]], [['S', 0, 0.02, 0.32, 0.02, 0.5, 0.22, 0.34, 0.48, 0, 0.5]], [['L', 0.2, 0.5, 0.52, 1]]] },
    U: { w: 0.54, s: [[['L', 0, 0, 0, 0.7], ['A', 0.27, 0.7, 0.27, 0.3, 180, 0], ['L', 0.54, 0.7, 0.54, 0]]] },
    V: { w: 0.6, s: [[['L', 0, 0, 0.3, 1, 0.6, 0]]] },
    X: { w: 0.56, s: [[['L', 0, 0, 0.56, 1]], [['L', 0.56, 0, 0, 1]]] },
    Y: { w: 0.56, s: [[['L', 0, 0, 0.28, 0.5, 0.56, 0]], [['L', 0.28, 0.5, 0.28, 1]]] },
    Z: { w: 0.56, s: [[['L', 0.02, 0, 0.54, 0, 0, 1, 0.56, 1]]] },
    '5': { w: 0.5, s: [[['L', 0.46, 0, 0.08, 0, 0.04, 0.42], ['S', 0.04, 0.42, 0.3, 0.36, 0.48, 0.56, 0.44, 0.86, 0.24, 1, 0.02, 0.92]]] },
    '6': { w: 0.5, s: [[['S', 0.42, 0.04, 0.2, 0.08, 0.04, 0.45, 0.06, 0.8, 0.25, 1, 0.45, 0.85, 0.44, 0.6, 0.25, 0.5, 0.05, 0.62]]] },
    '7': { w: 0.5, s: [[['L', 0, 0, 0.5, 0, 0.16, 1]]] },
    '8': { w: 0.5, s: [[['A', 0.25, 0.25, 0.2, 0.24, 90, 450]], [['A', 0.25, 0.74, 0.25, 0.26, -90, 270]]] },
    '9': { w: 0.5, s: [[['A', 0.24, 0.3, 0.22, 0.28, 0, 360], ['S', 0.46, 0.3, 0.44, 0.7, 0.3, 0.98, 0.06, 0.94]]] },
    '0': { w: 0.5, s: [[['A', 0.25, 0.5, 0.25, 0.5, -90, -450]]] },
    '1': { w: 0.3, s: [[['L', 0.04, 0.22, 0.26, 0, 0.26, 1]]] },
    '2': { w: 0.5, s: [[['S', 0.04, 0.22, 0.24, 0, 0.46, 0.14, 0.4, 0.44, 0, 1], ['L', 0, 1, 0.52, 1]]] },
    '3': { w: 0.5, s: [[['S', 0.04, 0.12, 0.28, 0, 0.46, 0.18, 0.2, 0.46], ['S', 0.2, 0.46, 0.48, 0.64, 0.38, 0.96, 0.04, 0.92]]] },
    '4': { w: 0.54, s: [[['L', 0.4, 1, 0.4, 0, 0, 0.66, 0.56, 0.66]]] },
    '!': { w: 0.12, s: [[['L', 0.06, 0, 0.06, 0.7]], [DOT(0.06, 0.95)]] },
    '?': { w: 0.44, s: [[['S', 0.02, 0.2, 0.2, 0, 0.42, 0.14, 0.36, 0.38, 0.2, 0.5, 0.2, 0.72]], [DOT(0.2, 0.95)]] },
    '.': { w: 0.1, s: [[DOT(0.04, 0.97)]] },
    ',': { w: 0.12, s: [[['L', 0.07, 0.94, 0.01, 1.12]]] },
    ':': { w: 0.1, s: [[DOT(0.04, 0.6)], [DOT(0.04, 0.96)]] },
    '-': { w: 0.32, s: [[['L', 0, 0.74, 0.32, 0.74]]] },
    '+': { w: 0.44, s: [[['L', 0, 0.72, 0.44, 0.72]], [['L', 0.22, 0.5, 0.22, 0.94]]] },
    '=': { w: 0.42, s: [[['L', 0, 0.64, 0.42, 0.64]], [['L', 0, 0.84, 0.42, 0.84]]] },
    "'": { w: 0.1, s: [[['L', 0.06, 0, 0.03, 0.22]]] },
    '/': { w: 0.36, s: [[['L', 0.36, 0, 0, 1.06]]] },
    '(': { w: 0.2, s: [[['A', 0.32, 0.55, 0.3, 0.6, 210, 150]]] },
    ')': { w: 0.2, s: [[['A', -0.12, 0.55, 0.3, 0.6, -30, 30]]] },
};

/** Samples one stroke of a glyph into points in glyph coordinates. */
function sampleStroke(cmds: Cmd[]): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const c of cmds) {
        const op = c[0] as string;
        const n = c.slice(1) as number[];
        if (op === 'L') {
            const ps: [number, number][] = [];
            for (let i = 0; i < n.length; i += 2) ps.push([n[i], n[i + 1]]);
            if (ps.length === 1 && out.length) { out.push({ x: ps[0][0], y: ps[0][1] }); continue; }
            for (let i = 0; i < ps.length - 1; i++) {
                const [x0, y0] = ps[i], [x1, y1] = ps[i + 1];
                const steps = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.06));
                for (let k = i === 0 ? 0 : 1; k <= steps; k++) out.push({ x: x0 + (x1 - x0) * k / steps, y: y0 + (y1 - y0) * k / steps });
            }
        } else if (op === 'S') {
            const ps: [number, number][] = [];
            for (let i = 0; i < n.length; i += 2) ps.push([n[i], n[i + 1]]);
            for (let i = 0; i < ps.length - 1; i++) {
                const p0 = ps[Math.max(0, i - 1)], p1 = ps[i], p2 = ps[i + 1], p3 = ps[Math.min(ps.length - 1, i + 2)];
                const steps = 8;
                for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
                    const t = k / steps, t2 = t * t, t3 = t2 * t;
                    const f = (a: number, b: number, c2: number, d: number) => 0.5 * ((2 * b) + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t2 + (-a + 3 * b - 3 * c2 + d) * t3);
                    out.push({ x: f(p0[0], p1[0], p2[0], p3[0]), y: f(p0[1], p1[1], p2[1], p3[1]) });
                }
            }
        } else if (op === 'A') {
            const [cx, cy, rx, ry, a0, a1] = n;
            const steps = Math.max(6, Math.ceil(Math.abs(a1 - a0) / 12));
            for (let k = 0; k <= steps; k++) {
                const a = (a0 + (a1 - a0) * k / steps) * Math.PI / 180;
                out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
            }
        }
    }
    return out;
}

interface WriteOpts { size?: number; color?: string; width?: number; slant?: number; spacing?: number; }

/** Writes text starting at (x, baseline y). size = cap height in page units. Returns the strokes and the end x. */
function write(text: string, x: number, y: number, o: WriteOpts = {}): { strokes: Stroke[]; end: number } {
    const size = o.size ?? 22, color = o.color ?? '#1f2328', width = o.width ?? 1.6, slant = o.slant ?? 0.16;
    const strokes: Stroke[] = [];
    let cx = x;
    for (const ch of text) {
        if (ch === ' ') { cx += size * 0.36; continue; }
        const g = G[ch];
        if (!g) { console.warn(`[demo] the handwriting font has no glyph for "${ch}"`); cx += size * 0.4; continue; }
        const k = size * (1 + jit(0.04));
        const dy = jit(size * 0.03);
        for (const s of g.s) {
            const raw = sampleStroke(s);
            if (raw.length === 0) continue;
            const pts: Pt[] = raw.map((p, i) => {
                const t = raw.length > 1 ? i / (raw.length - 1) : 0.5;
                const gx = p.x * k, gy = p.y * k;
                return {
                    x: Math.round((cx + gx + (1 - p.y) * slant * k + jit(0.25)) * 100) / 100,
                    y: Math.round((y - k + gy + dy + jit(0.25)) * 100) / 100,
                    pressure: Math.round(Math.min(0.95, Math.max(0.2, 0.42 + 0.28 * Math.sin(Math.PI * t) + jit(0.04))) * 100) / 100,
                };
            });
            strokes.push({ points: pts, color, width, isHighlighter: false });
        }
        cx += (g.w + (o.spacing ?? 0.16)) * k;
    }
    return { strokes, end: cx };
}

const P = (x: number, y: number): Pt => ({ x, y, pressure: 0.5 });
const shape = (kind: 'line' | 'rect' | 'ellipse', x0: number, y0: number, x1: number, y1: number, extra: Partial<Stroke> = {}): Stroke =>
    ({ points: [P(x0, y0), P(x1, y1)], color: '#1f2328', width: 3, isHighlighter: false, shape: kind, ...extra });
const highlight = (x0: number, x1: number, y: number, color = '#facc15'): Stroke => {
    const pts: Pt[] = [];
    for (let x = x0; x <= x1; x += 6) pts.push(P(Math.round(x * 100) / 100, Math.round((y + jit(0.8)) * 100) / 100));
    return { points: pts, color, width: 25, isHighlighter: true };
};
/** A freehand pen line through points (smoothed), e.g. for curves and doodles. */
const freehand = (pts: [number, number][], color = '#1f2328', width = 1.6): Stroke => ({
    points: pts.map(([x, y], i) => ({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, pressure: Math.round((0.45 + 0.2 * Math.sin(i / pts.length * Math.PI)) * 100) / 100 })),
    color, width, isHighlighter: false,
});

const SP = 1131 / 42;               // line spacing of the "lines" pattern
const lineY = (k: number) => 3 * SP + k * SP - 4;   // baseline on line k (a little above the printed line)

/**
 * Version of the sample note. Raise it whenever the sample changes: the demo then replaces a copy of an older
 * sample that a visitor still has in the browser (once), so everyone sees the current note.
 */
export const SAMPLE_VERSION = 2;

export function buildSampleNote(): string {
    seed = 20261104;
    const pages: Page[] = [];
    const add = (arr: Stroke[], r: { strokes: Stroke[]; end: number }) => { arr.push(...r.strokes); return r.end; };

    // --- Page 1: welcome ---
    {
        const s: Stroke[] = [];
        s.push(highlight(86, 330, 150, '#a9c4ff'));
        add(s, write('Welcome!', 90, 168, { size: 54, width: 2.6, color: '#111827' }));
        add(s, write('This is the real plugin, running in your browser.', 92, 236, { size: 20, color: '#4b5563' }));
        const e1 = add(s, write('Pen', 120, 330, { size: 26, color: '#1f2328' }));
        add(s, write('pressure ink', e1 + 16, 330, { size: 18, color: '#4b5563' }));
        s.push(highlight(116, 300, 392, '#fde047'));
        add(s, write('Highlighter', 120, 400, { size: 26, color: '#1f2328' }));
        add(s, write('Shapes', 120, 470, { size: 26, color: '#dc2626' }));
        s.push(shape('rect', 300, 436, 420, 486, { color: '#0f49be', fill: true, fillAlpha: 0.25 }));
        s.push(shape('ellipse', 450, 432, 560, 490, { color: '#2563eb', dash: 'dashed' }));
        s.push(shape('line', 590, 486, 690, 436, { color: '#16a34a', arrow: true }));
        add(s, write('Try writing here', 230, 640, { size: 34, width: 2, color: '#0f49be' }));
        s.push(freehand([[250, 664], [330, 672], [430, 668], [520, 662]], '#0f49be', 1.4));
        s.push(shape('line', 400, 690, 400, 780, { color: '#0f49be', arrow: true, width: 3 }));
        s.push(shape('rect', 120, 800, 680, 1060, { color: '#6f9bff', dash: 'dotted', width: 1.5 }));
        add(s, write('right-click or long-press for the page menu', 150, 1095, { size: 15, color: '#737373' }));
        pages.push({ strokes: s, title: 'Welcome' });
    }

    // --- Page 2: lines ---
    {
        const s: Stroke[] = [];
        const lines = [
            ['Lecture notes', 30, '#111827'],
            ['', 0, ''],
            ['The pages panel shows every page', 22, '#1f2328'],
            ['as a thumbnail - drag them to reorder.', 22, '#1f2328'],
            ['', 0, ''],
            ['Tap the lasso, draw around words,', 22, '#1f2328'],
            ['then move, scale or rotate them.', 22, '#1f2328'],
            ['', 0, ''],
            ['Eraser: rub over a stroke to cut it.', 22, '#dc2626'],
        ] as const;
        lines.forEach(([t, size, color], i) => { if (t) add(s, write(t, 40, lineY(i + 1), { size, color, width: size > 24 ? 2.2 : 1.6 })); });
        s.push(highlight(36, 300, lineY(1) - 10, '#bbf7d0'));
        add(s, write('2 + 3 = 5', 60, lineY(12), { size: 22, color: '#2563eb' }));
        s.push(shape('ellipse', 44, lineY(12) - 30, 220, lineY(12) + 12, { color: '#2563eb', width: 1.5 }));
        pages.push({ strokes: s, tpl: 'lines' });
    }

    // --- Page 3: landscape grid with a sketch ---
    {
        const s: Stroke[] = [];
        const W = 1131, H = 800;
        add(s, write('Sketches', 60, 90, { size: 40, width: 2.4, color: '#111827' }));
        // axes
        s.push(shape('line', 120, 420, 820, 420, { arrow: true, width: 2, color: '#4b5563' }));
        s.push(shape('line', 140, 640, 140, 190, { arrow: true, width: 2, color: '#4b5563' }));
        // sine wave
        const wave: [number, number][] = [];
        for (let x = 140; x <= 800; x += 6) wave.push([x, 420 - 130 * Math.sin((x - 140) / 660 * 4 * Math.PI)]);
        s.push(freehand(wave, '#dc2626', 2.2));
        add(s, write('sin x', 700, 250, { size: 24, color: '#dc2626' }));
        // a small flow diagram
        s.push(shape('rect', 880, 200, 1060, 270, { color: '#0f49be', width: 2.5 }));
        add(s, write('idea', 930, 248, { size: 24, color: '#0f49be' }));
        s.push(shape('line', 970, 280, 970, 360, { arrow: true, color: '#0f49be', width: 2.5 }));
        s.push(shape('ellipse', 880, 370, 1060, 450, { color: '#16a34a', fill: true, fillAlpha: 0.25, width: 2.5 }));
        add(s, write('sketch', 915, 422, { size: 24, color: '#16a34a' }));
        s.push(shape('line', 970, 460, 970, 540, { arrow: true, color: '#16a34a', width: 2.5 }));
        s.push(shape('rect', 880, 550, 1060, 620, { color: '#2563eb', dash: 'dashed', width: 2.5 }));
        add(s, write('note', 935, 598, { size: 24, color: '#2563eb' }));
        pages.push({ strokes: s, tpl: 'grid', w: W, h: H, title: 'Sketches' });
    }

    // --- Page 4: checklist ---
    {
        const s: Stroke[] = [];
        const todo = ['Write with a pen or a mouse', 'Open the pages panel', 'Change the page style', 'Try the calculator', 'Export to PDF'];
        add(s, write('Things to try', 26, lineY(0) - SP - 2, { size: 28, width: 2.2, color: '#111827' }));
        todo.forEach((t, i) => {
            const y = lineY(i);
            add(s, write(t, 56, y, { size: 20, color: '#1f2328' }));
            if (i === 0) s.push(freehand([[28, y - 10], [33, y - 3], [44, y - 20]], '#16a34a', 2.2));
        });
        pages.push({ strokes: s, tpl: 'checklist', title: 'Things to try' });
    }

    const note = { v: 4, id: 'demo-note-0001', defaults: { tpl: 'dots', paper: '#ffffff', format: 'a4' }, pages };
    return JSON.stringify(note);
}
