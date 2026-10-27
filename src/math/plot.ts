import { compile, Compiled, parseExpression, buildNumeric, Node } from './expression';

/** 2D curve type: y = f(x), parametric (x(t), y(t)), polar r(θ) or data points (with a fitted curve). */
export type CurveType = 'fx' | 'param' | 'polar' | 'points';
export type FitType = 'none' | 'linear' | 'quad' | 'exp' | 'log' | 'power';

export interface PlotCurve {
    expr: string;          // y = f(x) | x(t) | r(θ)
    color: string;
    type?: CurveType;      // missing = 'fx' (older plots)
    expr2?: string;        // y(t) for a parametric curve
    tmin?: number; tmax?: number;   // range of parameter t / angle θ
    data?: string;         // points: "x, y" on each line
    fit?: FitType;         // fit to the points
}

export type PlotSize = 'standard' | 'wide' | 'square' | 'strip';

export interface Plot2D {
    kind: '2d';
    curves: PlotCurve[];
    xmin: number; xmax: number; ymin: number; ymax: number;
    autoY: boolean;
    grid: boolean;
    piX?: boolean;         // x-axis ticks in multiples of π
    size?: PlotSize;       // image proportions
    clean?: boolean;       // "note" style: axes with arrows, no frame or grid, transparent background
    legend?: boolean;      // missing = yes
    equal?: boolean;       // same scale on both axes (circles are round)
    lineWidth?: number;    // curve width
    xLabel?: string; yLabel?: string;
}

export interface Plot3D {
    kind: '3d';
    expr: string;           // z = f(x, y)
    xmin: number; xmax: number; ymin: number; ymax: number;
    yaw: number; pitch: number;   // degrees
    palette: 'rainbow' | 'heat' | 'ocean' | 'mono';
    wire: boolean;
}

export type PlotSpec = Plot2D | Plot3D;

export const PLOT_COLORS = ['#d62728', '#1f77b4', '#2ca02c', '#ff7f0e', '#9467bd'];

export function defaultPlot2D(): Plot2D {
    return { kind: '2d', curves: [{ expr: 'sin(x)', color: PLOT_COLORS[0], type: 'fx' }], xmin: -10, xmax: 10, ymin: -5, ymax: 5, autoY: true, grid: true, legend: true, size: 'standard', lineWidth: 2.2 };
}
export function defaultPlot3D(): Plot3D {
    return { kind: '3d', expr: 'sin(sqrt(x^2+y^2))', xmin: -6, xmax: 6, ymin: -6, ymax: 6, yaw: 35, pitch: 30, palette: 'rainbow', wire: true };
}

export const PLOT_W = 800;
export const PLOT_H = 600;
const SIZES: Record<PlotSize, [number, number]> = { standard: [800, 600], wide: [1000, 420], square: [640, 640], strip: [1200, 320] };
export function plotSize(spec: PlotSpec): [number, number] {
    return spec.kind === '2d' ? SIZES[spec.size ?? 'standard'] ?? SIZES.standard : [PLOT_W, PLOT_H];
}

function niceStep(range: number, target: number): number {
    const raw = range / target;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    const m = f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10;
    return m * pow;
}
function fmtTick(v: number, step: number): string {
    if (Math.abs(v) < step * 1e-6) return '0';
    const dec = Math.max(0, -Math.floor(Math.log10(step)));
    const s = v.toFixed(Math.min(dec, 8));
    return Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4) ? v.toExponential(1) : s;
}

// ---------- π ----------
/** Tick step that is a "nice" multiple of π (π/6, π/4, π/2, π, 2π…). */
function piStep(range: number, target: number): number {
    const want = range / target;
    const cands = [1 / 12, 1 / 6, 1 / 4, 1 / 3, 1 / 2, 1, 2, 4, 5, 10, 20, 50, 100].map(k => k * Math.PI);
    return cands.find(c => c >= want) ?? cands[cands.length - 1];
}
/** Fraction p/q (q ≤ 12) approximating x, or null. */
function rational(x: number, maxQ = 12): [number, number] | null {
    for (let q = 1; q <= maxQ; q++) {
        const p = Math.round(x * q);
        if (Math.abs(p / q - x) < 1e-9 * Math.max(1, Math.abs(x))) return [p, q];
    }
    return null;
}
/** Number written as a multiple of π ("3π/2", "-π"), or null when it is not a multiple of π. */
export function piText(v: number): string | null {
    if (Math.abs(v) < 1e-12) return '0';
    const r = rational(v / Math.PI);
    if (!r) return null;
    const [p, q] = r;
    const sign = p < 0 ? '-' : '';
    const n = Math.abs(p);
    const num = n === 1 ? 'π' : `${n}π`;
    return q === 1 ? sign + num : `${sign}${num}/${q}`;
}

/** Returns the error (text) of the first invalid function, or null. */
export function validatePlot(spec: PlotSpec): string | null {
    try {
        if (spec.kind === '2d') {
            if (spec.curves.length === 0) return 'Add at least one function.';
            for (const c of spec.curves) {
                const t = c.type ?? 'fx';
                if (t === 'fx') compile(c.expr, { vars: ['x', 't'] });
                else if (t === 'param') { compile(c.expr, { vars: ['t'] }); compile(c.expr2 ?? '', { vars: ['t'] }); }
                else if (t === 'polar') compile(c.expr, { vars: POLAR_VARS });
                else if (parsePoints(c.data ?? '').length === 0) return 'Enter data points as "x, y" – one point per line.';
                if ((t === 'param' || t === 'polar') && !((c.tmax ?? 0) > (c.tmin ?? 0))) return 'The parameter range must not be empty.';
            }
            if (!(spec.xmax > spec.xmin)) return 'x max must be greater than x min.';
            if (!spec.autoY && !(spec.ymax > spec.ymin)) return 'y max must be greater than y min.';
        } else {
            compile(spec.expr, { vars: ['x', 'y'] });
            if (!(spec.xmax > spec.xmin) || !(spec.ymax > spec.ymin)) return 'Max must be greater than min.';
        }
    } catch (e) {
        return e instanceof Error ? e.message : String(e);
    }
    return null;
}

const POLAR_VARS = ['t', 'theta', 'θ'];

// ---------- points and fitting ----------
export function parsePoints(text: string): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        // "1, 2", "1;2", "1 2", "1\t2" – and a decimal comma when the separator is ; or a tab/space
        const parts = /[;\t]/.test(t) ? t.split(/[;\t]+/) : t.includes(',') && !/\d,\d+\s+\d/.test(t) ? t.split(/\s*,\s*/) : t.split(/\s+/);
        if (parts.length < 2) continue;
        const x = parseFloat(parts[0].replace(',', '.')), y = parseFloat(parts[1].replace(',', '.'));
        if (isFinite(x) && isFinite(y)) out.push({ x, y });
    }
    return out;
}

/** System of normal equations (Gaussian elimination) – for polynomial regression. */
function solveLinear(A: number[][], b: number[]): number[] | null {
    const n = b.length;
    const M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
        if (Math.abs(M[p][c]) < 1e-14) return null;
        [M[p], M[c]] = [M[c], M[p]];
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = M[r][c] / M[c][c];
            for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
        }
    }
    return M.map((r, i) => r[n] / r[i]);
}
function polyFit(xs: number[], ys: number[], deg: number): number[] | null {
    const A: number[][] = [], b: number[] = [];
    for (let i = 0; i <= deg; i++) {
        A.push([]);
        for (let j = 0; j <= deg; j++) A[i].push(xs.reduce((s, x) => s + Math.pow(x, i + j), 0));
        b.push(xs.reduce((s, x, k) => s + Math.pow(x, i) * ys[k], 0));
    }
    return solveLinear(A, b);
}

export interface FitResult { f: (x: number) => number; label: string; r2: number; }

const n4 = (v: number) => parseFloat(v.toPrecision(4)).toString();
const signed = (v: number) => (v < 0 ? ' − ' : ' + ') + n4(Math.abs(v));

/** Curve fit to the points (least squares) with the equation and R². */
export function fitPoints(pts: { x: number; y: number }[], type: FitType): FitResult | null {
    if (type === 'none' || pts.length < 2) return null;
    let f: ((x: number) => number) | null = null, label = '';
    const X = pts.map(p => p.x), Y = pts.map(p => p.y);
    if (type === 'linear' || type === 'quad') {
        const c = polyFit(X, Y, type === 'linear' ? 1 : 2);
        if (!c) return null;
        if (type === 'linear') { f = x => c[0] + c[1] * x; label = `y = ${n4(c[1])}x${signed(c[0])}`; }
        else { f = x => c[0] + c[1] * x + c[2] * x * x; label = `y = ${n4(c[2])}x²${signed(c[1])}x${signed(c[0])}`; }
    } else if (type === 'exp') {
        const ok = pts.filter(p => p.y > 0);
        if (ok.length < 2) return null;
        const c = polyFit(ok.map(p => p.x), ok.map(p => Math.log(p.y)), 1);
        if (!c) return null;
        const A = Math.exp(c[0]), B = c[1];
        f = x => A * Math.exp(B * x); label = `y = ${n4(A)}·e^(${n4(B)}x)`;
    } else if (type === 'log') {
        const ok = pts.filter(p => p.x > 0);
        if (ok.length < 2) return null;
        const c = polyFit(ok.map(p => Math.log(p.x)), ok.map(p => p.y), 1);
        if (!c) return null;
        f = x => c[0] + c[1] * Math.log(x); label = `y = ${n4(c[1])}·ln(x)${signed(c[0])}`;
    } else if (type === 'power') {
        const ok = pts.filter(p => p.x > 0 && p.y > 0);
        if (ok.length < 2) return null;
        const c = polyFit(ok.map(p => Math.log(p.x)), ok.map(p => Math.log(p.y)), 1);
        if (!c) return null;
        const A = Math.exp(c[0]), B = c[1];
        f = x => A * Math.pow(x, B); label = `y = ${n4(A)}·x^${n4(B)}`;
    }
    if (!f) return null;
    const mean = Y.reduce((s, y) => s + y, 0) / Y.length;
    const ssTot = Y.reduce((s, y) => s + (y - mean) ** 2, 0);
    const ssRes = pts.reduce((s, p) => s + (p.y - f!(p.x)) ** 2, 0);
    return { f, label, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1 };
}

// ---------- function period ----------
/**
 * Smallest period of y = f(x). First from the structure of the expression (sin(a·x + b) has period 2π/|a|, tan – π/|a|;
 * for a sum – the least common multiple), then a numeric check and a try of shorter periods
 * (e.g. |sin x| and sin²x have period π). If that fails – a numeric search in the given range.
 */
export function findPeriod(expr: string, searchRange = 20): number | null {
    let ast: Node;
    let f: Compiled;
    try { ast = parseExpression(expr); f = compile(expr, { vars: ['x', 't'] }); } catch { return null; }
    const val = (x: number) => f({ x, t: x });
    const periods: number[] = [];
    const visit = (n: Node) => {
        if (n.k === 'call') {
            const trig = ['sin', 'cos', 'sec', 'csc'].includes(n.n) ? 2 * Math.PI : ['tan', 'cot'].includes(n.n) ? Math.PI : 0;
            if (trig && n.args.length === 1) {
                try {
                    const g = buildNumeric(n.args[0], { vars: ['x', 't'] });
                    const gv = (x: number) => g({ x, t: x });
                    const a = gv(1) - gv(0);
                    // Argument linear in x?
                    if (Math.abs(a) > 1e-12 && Math.abs((gv(2.7) - gv(1.3)) - a * 1.4) < 1e-9 * Math.max(1, Math.abs(a))) periods.push(trig / Math.abs(a));
                } catch { /* skip */ }
            }
            n.args.forEach(visit);
        } else if (n.k === 'bin') { visit(n.a); visit(n.b); }
        else if (n.k === 'neg' || n.k === 'fact' || n.k === 'deg') visit(n.a);
    };
    visit(ast);
    const isPeriod = (T: number) => {
        if (!(T > 0) || !isFinite(T)) return false;
        let scale = 0, err = 0, cnt = 0;
        for (let k = 0; k < 41; k++) {
            const x = -1.37 * T + k * 0.173 * T + 0.0123;
            const a = val(x), b = val(x + T);
            if (!isFinite(a) || !isFinite(b)) continue;
            scale = Math.max(scale, Math.abs(a));
            err = Math.max(err, Math.abs(a - b));
            cnt++;
        }
        return cnt >= 10 && err <= 1e-7 * Math.max(1, scale);
    };
    let T: number | null = null;
    if (periods.length > 0) {
        const big = Math.max(...periods);
        for (let m = 1; m <= 60 && T === null; m++) {
            const cand = big * m;
            if (periods.every(p => Math.abs(cand / p - Math.round(cand / p)) < 1e-6) && isPeriod(cand)) T = cand;
        }
    }
    if (T === null) {
        // Numeric search: the smallest shift after which the graph repeats.
        const N = 4000, dx = searchRange / N;
        for (let i = 4; i < N / 2 && T === null; i++) {
            if (isPeriod(i * dx)) {
                // refine with golden-section search around i·dx
                let lo = (i - 1) * dx, hi = (i + 1) * dx;
                const err = (t: number) => { let e = 0; for (let k = 0; k < 25; k++) { const x = 0.31 + k * 0.137 * t; e += Math.abs(val(x) - val(x + t)) || 0; } return e; };
                for (let it = 0; it < 80; it++) {
                    const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
                    if (err(m1) < err(m2)) hi = m2; else lo = m1;
                }
                T = (lo + hi) / 2;
            }
        }
    }
    if (T === null) return null;
    // Shorter period (|sin x|, sin² x …)?
    for (let d = 12; d >= 2; d--) if (isPeriod(T / d)) { T = T / d; break; }
    // Nice value: a multiple of π, or rounded.
    const r = rational(T / Math.PI, 24);
    if (r) return r[0] / r[1] * Math.PI;
    return parseFloat(T.toPrecision(10));
}

// ---------- 2D ----------

function sampleCurve(f: Compiled, xmin: number, xmax: number, n: number): { xs: number[]; ys: number[] } {
    const xs: number[] = [], ys: number[] = [];
    const v = { x: 0, t: 0 };
    for (let i = 0; i <= n; i++) {
        const x = xmin + (xmax - xmin) * i / n;
        v.x = x; v.t = x;
        let y = f(v);
        if (!isFinite(y)) y = NaN;
        xs.push(x); ys.push(y);
    }
    return { xs, ys };
}

/** Parametric and polar curves as (x, y) points. */
function sampleParam(c: PlotCurve, n: number): { xs: number[]; ys: number[] } | null {
    const t0 = c.tmin ?? 0, t1 = c.tmax ?? 2 * Math.PI;
    const xs: number[] = [], ys: number[] = [];
    try {
        if (c.type === 'param') {
            const fx = compile(c.expr, { vars: ['t'] }), fy = compile(c.expr2 ?? '', { vars: ['t'] });
            const v = { t: 0 };
            for (let i = 0; i <= n; i++) { v.t = t0 + (t1 - t0) * i / n; const x = fx(v), y = fy(v); xs.push(isFinite(x) ? x : NaN); ys.push(isFinite(y) ? y : NaN); }
        } else {
            const fr = compile(c.expr, { vars: POLAR_VARS });
            const v: Record<string, number> = { t: 0, theta: 0, 'θ': 0 };
            for (let i = 0; i <= n; i++) {
                const th = t0 + (t1 - t0) * i / n;
                v.t = v.theta = v['θ'] = th;
                const r = fr(v);
                xs.push(isFinite(r) ? r * Math.cos(th) : NaN); ys.push(isFinite(r) ? r * Math.sin(th) : NaN);
            }
        }
    } catch { return null; }
    return { xs, ys };
}

interface Prepared {
    c: PlotCurve;
    fx?: Compiled;                                    // y = f(x)
    pts?: { xs: number[]; ys: number[] };             // param / polar
    data?: { x: number; y: number }[];                // points
    fit?: FitResult | null;
}

function prepare(spec: Plot2D): Prepared[] {
    return spec.curves.map(c => {
        const t = c.type ?? 'fx';
        if (t === 'fx') { try { return { c, fx: compile(c.expr, { vars: ['x', 't'] }) }; } catch { return { c }; } }
        if (t === 'points') { const data = parsePoints(c.data ?? ''); return { c, data, fit: fitPoints(data, c.fit ?? 'none') }; }
        return { c, pts: sampleParam(c, 1500) ?? undefined };
    });
}

export function autoYRange(spec: Plot2D, prepared?: Prepared[]): [number, number] {
    const prep = prepared ?? prepare(spec);
    const vals: number[] = [];
    for (const p of prep) {
        if (p.fx) { for (const y of sampleCurve(p.fx, spec.xmin, spec.xmax, 800).ys) if (!isNaN(y)) vals.push(y); }
        if (p.pts) { p.pts.ys.forEach((y, i) => { const x = p.pts!.xs[i]; if (!isNaN(y) && x >= spec.xmin && x <= spec.xmax) vals.push(y); }); }
        if (p.data) for (const d of p.data) if (d.x >= spec.xmin && d.x <= spec.xmax) vals.push(d.y);
        if (p.fit) for (const y of sampleCurve((v) => p.fit!.f(v.x), spec.xmin, spec.xmax, 200).ys) if (!isNaN(y)) vals.push(y);
    }
    if (vals.length === 0) return [-5, 5];
    vals.sort((a, b) => a - b);
    // Clip extreme values (asymptotes) so the plot stays readable.
    const lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.ceil(vals.length * 0.98) - 1];
    let a = lo, b = hi;
    if (b - a < 1e-9) { a -= 1; b += 1; }
    const pad = (b - a) * 0.1;
    return [a - pad, b + pad];
}

function curveLabel(p: Prepared, spec: Plot2D): string {
    const c = p.c, t = c.type ?? 'fx';
    const y = spec.yLabel?.trim() || 'y';
    if (t === 'fx') return `${y} = ${c.expr}`;
    if (t === 'param') return `x = ${c.expr}, y = ${c.expr2 ?? ''}`;
    if (t === 'polar') return `r = ${c.expr}`;
    if (p.fit) return `${p.fit.label}   (R² = ${p.fit.r2.toFixed(4)})`;
    return `data (${p.data?.length ?? 0} points)`;
}

function render2D(ctx: CanvasRenderingContext2D, spec: Plot2D, W: number, H: number) {
    // Each function is compiled once (used for the Y range and for drawing the curve).
    const prep = prepare(spec);
    const clean = !!spec.clean;
    const { xmin, xmax } = spec;
    let ymin = spec.ymin, ymax = spec.ymax;
    if (spec.autoY) [ymin, ymax] = autoYRange(spec, prep);
    const L = clean ? 28 : 46, R = clean ? 28 : 14, T = clean ? 26 : 14, B = clean ? 26 : 30;
    const pw = W - L - R, ph = H - T - B;
    if (spec.equal) {
        // Same units per pixel horizontally and vertically (the narrower axis is expanded around its centre).
        const kx = (xmax - xmin) / pw, ky = (ymax - ymin) / ph;
        if (ky < kx) { const c = (ymin + ymax) / 2, h = kx * ph / 2; ymin = c - h; ymax = c + h; }
        else if (kx < ky) {
            // With a fixed x range (given by the user) only the y axis changes, so the x range is kept.
            const c = (ymin + ymax) / 2, h = kx * ph / 2;
            if (spec.autoY) { ymin = c - h; ymax = c + h; }
        }
    }
    const sx = (x: number) => L + (x - xmin) / (xmax - xmin) * pw;
    const sy = (y: number) => T + (1 - (y - ymin) / (ymax - ymin)) * ph;

    if (!clean) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H); }
    ctx.font = '12px sans-serif';

    const xstep = spec.piX ? piStep(xmax - xmin, clean ? 8 : 10) : niceStep(xmax - xmin, clean ? 8 : 10);
    const ystep = niceStep(ymax - ymin, clean ? 6 : 8);
    const xLab = (x: number) => spec.piX ? (piText(x) ?? fmtTick(x, xstep)) : fmtTick(x, xstep);
    // Axis position: through zero, or at the edge when zero is out of range.
    const ax = Math.round(sy(Math.min(ymax, Math.max(ymin, 0)))) + 0.5;
    const ay = Math.round(sx(Math.min(xmax, Math.max(xmin, 0)))) + 0.5;

    ctx.lineWidth = 1;
    for (let i = Math.ceil(xmin / xstep - 1e-9); i * xstep <= xmax + xstep * 1e-9; i++) {
        const x = i * xstep;
        const px = Math.round(sx(x)) + 0.5;
        if (spec.grid && !clean) { ctx.strokeStyle = '#e3e3e3'; ctx.beginPath(); ctx.moveTo(px, T); ctx.lineTo(px, T + ph); ctx.stroke(); }
        if (clean) {
            if (Math.abs(x) < xstep * 1e-6 && ay === px) continue;
            ctx.strokeStyle = '#222'; ctx.beginPath(); ctx.moveTo(px, ax - 4); ctx.lineTo(px, ax + 4); ctx.stroke();
            ctx.fillStyle = '#333'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText(xLab(x), px, ax + 6);
        } else {
            ctx.fillStyle = '#555'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
            ctx.fillText(xLab(x), px, T + ph + 6);
        }
    }
    for (let i = Math.ceil(ymin / ystep - 1e-9); i * ystep <= ymax + ystep * 1e-9; i++) {
        const y = i * ystep;
        const py = Math.round(sy(y)) + 0.5;
        if (spec.grid && !clean) { ctx.strokeStyle = '#e3e3e3'; ctx.beginPath(); ctx.moveTo(L, py); ctx.lineTo(L + pw, py); ctx.stroke(); }
        ctx.textBaseline = 'middle';
        if (clean) {
            if (Math.abs(y) < ystep * 1e-6) continue;
            ctx.strokeStyle = '#222'; ctx.beginPath(); ctx.moveTo(ay - 4, py); ctx.lineTo(ay + 4, py); ctx.stroke();
            ctx.fillStyle = '#333'; ctx.textAlign = 'right';
            ctx.fillText(fmtTick(y, ystep), ay - 7, py);
        } else {
            ctx.fillStyle = '#555'; ctx.textAlign = 'right';
            ctx.fillText(fmtTick(y, ystep), L - 6, py);
        }
    }
    // Axes.
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
    if (clean) {
        const arrow = (x0: number, y0: number, x1: number, y1: number) => {
            ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
            const a = Math.atan2(y1 - y0, x1 - x0), h = 9;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 - h * Math.cos(a - 0.4), y1 - h * Math.sin(a - 0.4));
            ctx.lineTo(x1 - h * Math.cos(a + 0.4), y1 - h * Math.sin(a + 0.4));
            ctx.closePath(); ctx.fillStyle = '#222'; ctx.fill();
        };
        arrow(L - 10, ax, L + pw + 18, ax);
        arrow(ay, T + ph + 10, ay, T - 16);
        ctx.font = 'italic 15px serif'; ctx.fillStyle = '#222';
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(spec.xLabel?.trim() || 'x', L + pw + 18, ax - 6);
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillText(spec.yLabel?.trim() || 'y', ay + 8, T - 18);
        ctx.font = '12px sans-serif';
    } else {
        if (ymin <= 0 && ymax >= 0) { ctx.beginPath(); ctx.moveTo(L, ax); ctx.lineTo(L + pw, ax); ctx.stroke(); }
        if (xmin <= 0 && xmax >= 0) { ctx.beginPath(); ctx.moveTo(ay, T); ctx.lineTo(ay, T + ph); ctx.stroke(); }
        ctx.strokeStyle = '#888'; ctx.lineWidth = 1;
        ctx.strokeRect(L + 0.5, T + 0.5, pw, ph);
        ctx.font = 'italic 13px sans-serif'; ctx.fillStyle = '#444';
        if (spec.xLabel?.trim()) { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(spec.xLabel.trim(), L + pw - 4, T + ph - 4); }
        if (spec.yLabel?.trim()) { ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(spec.yLabel.trim(), L + 6, T + 4 + (spec.legend === false ? 0 : spec.curves.length * 20 + 4)); }
        ctx.font = '12px sans-serif';
    }

    // Curves.
    ctx.save();
    ctx.beginPath(); ctx.rect(L, T - (clean ? 10 : 0), pw, ph + (clean ? 20 : 0)); ctx.clip();
    ctx.lineWidth = spec.lineWidth ?? 2.2; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const span = ymax - ymin;
    const polyline = (X: number[], Y: number[], jumps: boolean) => {
        ctx.beginPath();
        let pen = false;
        for (let i = 0; i < X.length; i++) {
            const y = Y[i];
            if (isNaN(y) || isNaN(X[i])) { pen = false; continue; }
            // A jump larger than the whole range = discontinuity (e.g. tan x) – don't connect.
            if (jumps && pen && i > 0 && !isNaN(Y[i - 1]) && Math.abs(y - Y[i - 1]) > span * 1.5 && Math.sign(y) !== Math.sign(Y[i - 1])) pen = false;
            const px = sx(X[i]), py = sy(Math.max(ymin - span * 4, Math.min(ymax + span * 4, y)));
            if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
        }
        ctx.stroke();
    };
    const n = Math.max(400, Math.round(pw * 2));
    for (const p of prep) {
        ctx.strokeStyle = p.c.color;
        ctx.fillStyle = p.c.color;
        if (p.fx) { const s = sampleCurve(p.fx, xmin, xmax, n); polyline(s.xs, s.ys, true); }
        if (p.pts) polyline(p.pts.xs, p.pts.ys, false);
        if (p.fit) { const s = sampleCurve((v) => p.fit!.f(v.x), xmin, xmax, n); polyline(s.xs, s.ys, true); }
        if (p.data) {
            const r = Math.max(3, (spec.lineWidth ?? 2.2) * 1.6);
            for (const d of p.data) { ctx.beginPath(); ctx.arc(sx(d.x), sy(d.y), r, 0, Math.PI * 2); ctx.fill(); }
        }
    }
    ctx.restore();

    // Legend.
    if (spec.legend !== false && (spec.curves.length > 1 || spec.curves[0]?.expr || spec.curves[0]?.data)) {
        ctx.font = '13px sans-serif';
        let ly = T + 10;
        const lx = clean ? Math.max(L, Math.min(W - 260, ay + 14)) : L + 8;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        for (const p of prep) {
            const label = curveLabel(p, spec);
            const w = ctx.measureText(label).width;
            ctx.fillStyle = 'rgba(255,255,255,0.85)';
            ctx.fillRect(lx, ly - 9, w + 34, 18);
            ctx.strokeStyle = p.c.color; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(lx + 4, ly); ctx.lineTo(lx + 20, ly); ctx.stroke();
            ctx.fillStyle = '#222'; ctx.fillText(label, lx + 26, ly);
            ly += 20;
        }
    }
}

// ---------- 3D ----------

function palette(name: Plot3D['palette'], t: number): [number, number, number] {
    t = Math.max(0, Math.min(1, t));
    const lerp = (stops: number[][]) => {
        const p = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p)), f = p - i;
        return [0, 1, 2].map(k => stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f) as [number, number, number];
    };
    switch (name) {
        case 'heat': return lerp([[20, 20, 90], [180, 30, 120], [240, 100, 40], [255, 230, 90]]);
        case 'ocean': return lerp([[10, 30, 90], [20, 110, 190], [80, 200, 210], [220, 245, 240]]);
        case 'mono': return lerp([[70, 70, 80], [225, 225, 230]]);
        default: return lerp([[60, 40, 160], [30, 130, 220], [40, 190, 120], [240, 220, 60], [230, 60, 40]]);
    }
}

function render3D(ctx: CanvasRenderingContext2D, spec: Plot3D, W: number, H: number, N: number) {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    const f = compile(spec.expr, { vars: ['x', 'y'] });
    const gx: number[] = [], gy: number[] = [];
    for (let i = 0; i <= N; i++) { gx.push(spec.xmin + (spec.xmax - spec.xmin) * i / N); gy.push(spec.ymin + (spec.ymax - spec.ymin) * i / N); }
    const Z: number[][] = [];
    let zmin = Infinity, zmax = -Infinity;
    const v = { x: 0, y: 0 };
    for (let i = 0; i <= N; i++) {
        const row: number[] = [];
        for (let j = 0; j <= N; j++) {
            v.x = gx[i]; v.y = gy[j];
            const z = f(v);
            row.push(isFinite(z) ? z : NaN);
            if (isFinite(z)) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
        }
        Z.push(row);
    }
    if (!isFinite(zmin)) { zmin = -1; zmax = 1; }
    if (zmax - zmin < 1e-9) { zmin -= 1; zmax += 1; }

    // Normalize to the cube [-1,1]^3.
    const nx = (x: number) => (x - spec.xmin) / (spec.xmax - spec.xmin) * 2 - 1;
    const ny = (y: number) => (y - spec.ymin) / (spec.ymax - spec.ymin) * 2 - 1;
    const nz = (z: number) => (z - zmin) / (zmax - zmin) * 2 - 1;

    const yaw = spec.yaw * Math.PI / 180, pitch = spec.pitch * Math.PI / 180;
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    // Rotation around the Z axis (yaw), then tilt (pitch). Returns [screenX, screenY, depth].
    const rot = (x: number, y: number, z: number): [number, number, number] => {
        const x1 = x * cy - y * sy_, y1 = x * sy_ + y * cy;
        return [x1, -(z * cp - y1 * sp), y1 * cp + z * sp];
    };
    // Scale so the cube fits in the frame.
    const corners: [number, number, number][] = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) corners.push(rot(a, b, c));
    const ex = Math.max(...corners.map(c => Math.abs(c[0]))), ey = Math.max(...corners.map(c => Math.abs(c[1])));
    const scale = Math.min((W / 2 - 50) / ex, (H / 2 - 40) / ey);
    const P = (x: number, y: number, z: number) => {
        const r = rot(x, y, z);
        return { x: W / 2 + r[0] * scale, y: H / 2 + r[1] * scale, d: r[2] };
    };

    // Axis box (back edges, thin).
    const box = (stroke: string) => {
        ctx.strokeStyle = stroke; ctx.lineWidth = 1;
        const edges: [number[], number[]][] = [];
        for (const a of [-1, 1]) for (const b of [-1, 1]) {
            edges.push([[-1, a, b], [1, a, b]], [[a, -1, b], [a, 1, b]], [[a, b, -1], [a, b, 1]]);
        }
        ctx.beginPath();
        for (const [p, q] of edges) { const A = P(p[0], p[1], p[2]), Bq = P(q[0], q[1], q[2]); ctx.moveTo(A.x, A.y); ctx.lineTo(Bq.x, Bq.y); }
        ctx.stroke();
    };
    box('#d5d5d5');

    // Quads sorted by depth (painter's algorithm).
    interface Quad { pts: { x: number; y: number }[]; d: number; t: number; shade: number; }
    const quads: Quad[] = [];
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
        const zs = [Z[i][j], Z[i + 1][j], Z[i + 1][j + 1], Z[i][j + 1]];
        if (zs.some(z => isNaN(z))) continue;
        const idx: [number, number][] = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
        const pts = idx.map(([a, b], k) => P(nx(gx[a]), ny(gy[b]), nz(zs[k])));
        const d = pts.reduce((s, p) => s + p.d, 0) / 4;
        const zavg = (zs[0] + zs[1] + zs[2] + zs[3]) / 4;
        // Simple lighting model from the surface normal (in cube space).
        const dzdx = (zs[1] + zs[2] - zs[0] - zs[3]) / 2 / (zmax - zmin) * 2 / (2 / N);
        const dzdy = (zs[3] + zs[2] - zs[0] - zs[1]) / 2 / (zmax - zmin) * 2 / (2 / N);
        const nlen = Math.hypot(dzdx, dzdy, 1);
        const lx = -0.4, ly = -0.5, lz = 0.77;
        const dot = (-dzdx * lx - dzdy * ly + lz) / nlen;
        quads.push({ pts, d, t: (zavg - zmin) / (zmax - zmin), shade: 0.55 + 0.45 * Math.max(0, Math.min(1, dot)) });
    }
    quads.sort((a, b) => a.d - b.d);   // farthest first (smaller d = farther from the viewer)
    ctx.lineJoin = 'round';
    for (const q of quads) {
        const [r, g, b] = palette(spec.palette, q.t);
        const col = `rgb(${Math.round(r * q.shade)},${Math.round(g * q.shade)},${Math.round(b * q.shade)})`;
        ctx.beginPath();
        ctx.moveTo(q.pts[0].x, q.pts[0].y);
        for (let k = 1; k < 4; k++) ctx.lineTo(q.pts[k].x, q.pts[k].y);
        ctx.closePath();
        ctx.fillStyle = col; ctx.fill();
        ctx.strokeStyle = spec.wire ? 'rgba(0,0,0,0.28)' : col;
        ctx.lineWidth = spec.wire ? 0.6 : 0.8;
        ctx.stroke();
    }

    // Axis labels and ranges.
    ctx.font = '13px sans-serif'; ctx.fillStyle = '#333'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lab = (txt: string, x: number, y: number, z: number) => { const p = P(x, y, z); ctx.fillText(txt, p.x, p.y); };
    lab('x', 1.15, -1, -1); lab('y', -1, 1.15, -1); lab('z', -1.12, -1.12, 1);
    const f2 = (n: number) => parseFloat(n.toPrecision(3)).toString();
    ctx.font = '12px sans-serif'; ctx.fillStyle = '#666'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`x ∈ [${f2(spec.xmin)}, ${f2(spec.xmax)}]   y ∈ [${f2(spec.ymin)}, ${f2(spec.ymax)}]   z ∈ [${f2(zmin)}, ${f2(zmax)}]`, 12, H - 8);
    ctx.font = '13px sans-serif'; ctx.fillStyle = '#222'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('z = ' + spec.expr, 12, 10);
}

/** `preview` = faster live preview (coarser 3D grid); the inserted image is drawn in full quality. */
export function renderPlot(canvas: HTMLCanvasElement, spec: PlotSpec, scale = 1, preview = false) {
    const [W, H] = plotSize(spec);
    canvas.width = Math.round(W * scale); canvas.height = Math.round(H * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (spec.kind === '2d') render2D(ctx, spec, W, H);
    else render3D(ctx, spec, PLOT_W, PLOT_H, preview ? 32 : 56);
}

export function plotToPng(spec: PlotSpec, scale = 2): Promise<Blob | null> {
    const c = document.createElement('canvas');
    renderPlot(c, spec, scale);
    return new Promise(res => c.toBlob(b => res(b), 'image/png'));
}
