/**
 * Calculator evaluation on values: real numbers, complex numbers (3+4i, 10∠30) and matrices ([1,2;3,4]).
 * Plain numbers use the same function implementation as the plots (expression.ts).
 * Also: integral int(f, a, b), derivative der(f, x0), equation solving solve(f, x0) – f is an expression in x.
 */
import { Node, CONSTANTS, SPECIAL_FORMS, numericCall, fact, formatNumber, parseExpression } from './expression';
import { convertUnits, splitConversion } from './units';

export interface Cx { re: number; im: number; }
export interface Mat { rows: number; cols: number; d: number[]; }
export type Value = number | Cx | Mat;

export const isCx = (v: Value): v is Cx => typeof v === 'object' && 're' in v;
export const isMat = (v: Value): v is Mat => typeof v === 'object' && 'rows' in v;

const cx = (re: number, im: number): Cx => ({ re, im });
const toCx = (v: number | Cx): Cx => typeof v === 'number' ? cx(v, 0) : v;
/** A complex number with a negligible imaginary part becomes a plain number. */
function simplify(c: Cx): number | Cx {
    return Math.abs(c.im) <= 1e-13 * Math.max(1, Math.abs(c.re)) ? c.re : c;
}

// --- complex arithmetic ---
const cAdd = (a: Cx, b: Cx) => cx(a.re + b.re, a.im + b.im);
const cMul = (a: Cx, b: Cx) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
function cDiv(a: Cx, b: Cx): Cx {
    const d = b.re * b.re + b.im * b.im;
    return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
}
const cAbs = (a: Cx) => Math.hypot(a.re, a.im);
const cArg = (a: Cx) => Math.atan2(a.im, a.re);
const cExp = (a: Cx) => { const r = Math.exp(a.re); return cx(r * Math.cos(a.im), r * Math.sin(a.im)); };
const cLn = (a: Cx) => cx(Math.log(cAbs(a)), cArg(a));
function cPow(a: Cx, b: Cx): Cx {
    if (a.re === 0 && a.im === 0) return (b.re === 0 && b.im === 0) ? cx(1, 0) : cx(0, 0);
    return cExp(cMul(b, cLn(a)));
}
const cSqrt = (a: Cx) => { const r = cAbs(a), t = cArg(a) / 2, s = Math.sqrt(r); return cx(s * Math.cos(t), s * Math.sin(t)); };
const cSin = (a: Cx) => cx(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im));
const cCos = (a: Cx) => cx(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im));

// --- matrices ---
function mat(rows: number, cols: number, d: number[]): Mat { return { rows, cols, d }; }
function mGet(m: Mat, r: number, c: number) { return m.d[r * m.cols + c]; }
function mMul(a: Mat, b: Mat): Mat {
    if (a.cols !== b.rows) throw new Error(`Cannot multiply ${a.rows}×${a.cols} by ${b.rows}×${b.cols}`);
    const out = new Array(a.rows * b.cols).fill(0);
    for (let i = 0; i < a.rows; i++) for (let j = 0; j < b.cols; j++) {
        let s = 0;
        for (let k = 0; k < a.cols; k++) s += mGet(a, i, k) * mGet(b, k, j);
        out[i * b.cols + j] = s;
    }
    return mat(a.rows, b.cols, out);
}
function mEach(a: Mat, f: (x: number, i: number) => number): Mat { return mat(a.rows, a.cols, a.d.map(f)); }
function mZip(a: Mat, b: Mat, f: (x: number, y: number) => number, op: string): Mat {
    if (a.rows !== b.rows || a.cols !== b.cols) throw new Error(`Cannot ${op} ${a.rows}×${a.cols} and ${b.rows}×${b.cols} matrices`);
    return mat(a.rows, a.cols, a.d.map((x, i) => f(x, b.d[i])));
}
function mIdentity(n: number): Mat { const d = new Array(n * n).fill(0); for (let i = 0; i < n; i++) d[i * n + i] = 1; return mat(n, n, d); }
function mTrans(a: Mat): Mat {
    const out: number[] = [];
    for (let j = 0; j < a.cols; j++) for (let i = 0; i < a.rows; i++) out.push(mGet(a, i, j));
    return mat(a.cols, a.rows, out);
}
/** Gaussian elimination with pivoting: determinant and inverse matrix. */
function mLU(a: Mat): { det: number; inv: Mat | null } {
    if (a.rows !== a.cols) throw new Error('The matrix must be square');
    const n = a.rows;
    const m = a.d.slice();
    const inv = mIdentity(n).d;
    let det = 1;
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(m[r * n + c]) > Math.abs(m[p * n + c])) p = r;
        if (Math.abs(m[p * n + c]) < 1e-14) return { det: 0, inv: null };
        if (p !== c) {
            for (let k = 0; k < n; k++) {
                [m[p * n + k], m[c * n + k]] = [m[c * n + k], m[p * n + k]];
                [inv[p * n + k], inv[c * n + k]] = [inv[c * n + k], inv[p * n + k]];
            }
            det = -det;
        }
        const piv = m[c * n + c];
        det *= piv;
        for (let k = 0; k < n; k++) { m[c * n + k] /= piv; inv[c * n + k] /= piv; }
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = m[r * n + c];
            if (f === 0) continue;
            for (let k = 0; k < n; k++) { m[r * n + k] -= f * m[c * n + k]; inv[r * n + k] -= f * inv[c * n + k]; }
        }
    }
    return { det, inv: mat(n, n, inv) };
}
function mInv(a: Mat): Mat {
    const { inv } = mLU(a);
    if (!inv) throw new Error('The matrix is singular (determinant = 0)');
    return inv;
}

// --- operations on values ---
function needReal(v: Value, what: string): number {
    if (typeof v === 'number') return v;
    if (isCx(v)) throw new Error(`${what} needs a real number`);
    throw new Error(`${what} needs a number, not a matrix`);
}

function add(a: Value, b: Value): Value {
    if (isMat(a) && isMat(b)) return mZip(a, b, (x, y) => x + y, 'add');
    if (isMat(a) || isMat(b)) throw new Error('Cannot add a number and a matrix');
    if (typeof a === 'number' && typeof b === 'number') return a + b;
    return simplify(cAdd(toCx(a), toCx(b)));
}
function neg(a: Value): Value {
    if (isMat(a)) return mEach(a, x => -x);
    if (typeof a === 'number') return -a;
    return cx(-a.re, -a.im);
}
function mul(a: Value, b: Value): Value {
    if (isMat(a) && isMat(b)) return mMul(a, b);
    if (isMat(a) || isMat(b)) {
        const m = (isMat(a) ? a : b) as Mat, s = isMat(a) ? b : a;
        if (typeof s !== 'number') throw new Error('Matrices with complex numbers are not supported');
        return mEach(m, x => x * s);
    }
    if (typeof a === 'number' && typeof b === 'number') return a * b;
    return simplify(cMul(toCx(a), toCx(b)));
}
function div(a: Value, b: Value): Value {
    if (isMat(b)) {
        if (isMat(a)) return mMul(a, mInv(b));
        return mul(a, mInv(b));
    }
    if (isMat(a)) {
        if (typeof b !== 'number') throw new Error('Matrices with complex numbers are not supported');
        return mEach(a, x => x / b);
    }
    if (typeof a === 'number' && typeof b === 'number') return a / b;
    return simplify(cDiv(toCx(a), toCx(b)));
}
function pow(a: Value, b: Value): Value {
    if (isMat(b)) throw new Error('A matrix cannot be an exponent');
    if (isMat(a)) {
        if (typeof b !== 'number' || !Number.isInteger(b)) throw new Error('A matrix can only be raised to a whole power');
        if (a.rows !== a.cols) throw new Error('The matrix must be square');
        let base = b < 0 ? mInv(a) : a;
        let n = Math.abs(b);
        let r = mIdentity(a.rows);
        while (n > 0) { if (n & 1) r = mMul(r, base); base = mMul(base, base); n >>= 1; }
        return r;
    }
    if (typeof a === 'number' && typeof b === 'number') {
        const r = Math.pow(a, b);
        if (!Number.isNaN(r) || Number.isNaN(a) || Number.isNaN(b)) return r;
        // Negative base and fractional exponent: complex result (e.g. (-4)^0.5 = 2i).
    }
    return simplify(cPow(toCx(a as number | Cx), toCx(b)));
}
function mod(a: Value, b: Value): Value {
    const x = needReal(a, '%'), d = needReal(b, '%');
    const r = x % d;
    return r !== 0 && (r < 0) !== (d < 0) ? r + d : r;
}

export interface EvalCtx {
    vars: Record<string, Value>;
    degrees: boolean;
    /** Local variables (x in int/der/solve). */
    local?: Record<string, number>;
}

// --- integrals, derivatives, equations ---
function integrate(f: (x: number) => number, a: number, b: number): number {
    if (a === b) return 0;
    if (!isFinite(a) || !isFinite(b)) throw new Error('Integration limits must be finite');
    const simpson = (x0: number, x1: number, f0: number, fm: number, f1: number) => (x1 - x0) / 6 * (f0 + 4 * fm + f1);
    let calls = 0;
    const rec = (x0: number, x1: number, f0: number, fm: number, f1: number, whole: number, eps: number, depth: number): number => {
        const m = (x0 + x1) / 2, lm = (x0 + m) / 2, rm = (m + x1) / 2;
        const flm = f(lm), frm = f(rm);
        calls += 2;
        const left = simpson(x0, m, f0, flm, fm), right = simpson(m, x1, fm, frm, f1);
        const diff = left + right - whole;
        if (depth <= 0 || calls > 200000 || Math.abs(diff) <= 15 * eps) return left + right + diff / 15;
        return rec(x0, m, f0, flm, fm, left, eps / 2, depth - 1) + rec(m, x1, fm, frm, f1, right, eps / 2, depth - 1);
    };
    // Split the interval into pieces so narrow peaks aren't missed.
    const parts = 16, h = (b - a) / parts;
    let sum = 0;
    for (let k = 0; k < parts; k++) {
        const x0 = a + k * h, x1 = x0 + h, f0 = f(x0), f1 = f(x1), fm = f((x0 + x1) / 2);
        sum += rec(x0, x1, f0, fm, f1, simpson(x0, x1, f0, fm, f1), 1e-11, 40);
    }
    if (!isFinite(sum)) throw new Error('The integral does not converge on this interval');
    return sum;
}

function derivative(f: (x: number) => number, x0: number): number {
    const h = 1e-3 * Math.max(1, Math.abs(x0));
    const d = (-f(x0 + 2 * h) + 8 * f(x0 + h) - 8 * f(x0 - h) + f(x0 - 2 * h)) / (12 * h);
    if (!isFinite(d)) throw new Error('The derivative does not exist at this point');
    return d;
}

function solve(f: (x: number) => number, a: number, b?: number): number {
    const tol = 1e-12;
    if (b !== undefined) {
        // Bisection on the interval [a, b].
        let lo = Math.min(a, b), hi = Math.max(a, b);
        let flo = f(lo);
        const fhi = f(hi);
        if (flo === 0) return lo;
        if (fhi === 0) return hi;
        if (Math.sign(flo) === Math.sign(fhi)) throw new Error('f(a) and f(b) must have opposite signs');
        for (let i = 0; i < 200 && hi - lo > tol * Math.max(1, Math.abs(lo)); i++) {
            const m = (lo + hi) / 2, fm = f(m);
            if (Math.sign(fm) === Math.sign(flo)) { lo = m; flo = fm; } else hi = m;
        }
        return (lo + hi) / 2;
    }
    // Newton's method with a numerical derivative (starting from a).
    let x = a;
    for (let i = 0; i < 100; i++) {
        const fx = f(x);
        if (!isFinite(fx)) break;
        if (Math.abs(fx) < 1e-14) return x;
        const h = 1e-7 * Math.max(1, Math.abs(x));
        const d = (f(x + h) - f(x - h)) / (2 * h);
        if (!isFinite(d) || d === 0) break;
        const nx = x - fx / d;
        if (Math.abs(nx - x) < tol * Math.max(1, Math.abs(x))) { x = nx; return x; }
        x = nx;
    }
    if (Math.abs(f(x)) < 1e-9) return x;
    throw new Error('No solution found near this starting point – try another one, or give a range: solve(f, a, b)');
}

// --- evaluating the expression tree ---
export function evalNode(n: Node, ctx: EvalCtx): Value {
    const k = ctx.degrees ? Math.PI / 180 : 1;
    switch (n.k) {
        case 'num': return n.v;
        case 'var': {
            const name = n.n;
            if (ctx.local && ctx.local[name] !== undefined) return ctx.local[name];
            if (ctx.vars[name] !== undefined) return ctx.vars[name];
            if (name === 'i' || name === 'j') return cx(0, 1);
            if (CONSTANTS[name] !== undefined) return CONSTANTS[name];
            if (name === 'x' && !ctx.local) throw new Error('x can be used inside int(), der() and solve()');
            throw new Error(`Unknown name "${name}"`);
        }
        case 'neg': return neg(evalNode(n.a, ctx));
        case 'fact': return fact(needReal(evalNode(n.a, ctx), '!'));
        case 'deg': return mul(evalNode(n.a, ctx), Math.PI / 180 / k);
        case 'mat': {
            const rows = n.rows.length, cols = n.rows[0].length;
            const d: number[] = [];
            for (const r of n.rows) for (const e of r) {
                const v = evalNode(e, ctx);
                if (typeof v !== 'number') throw new Error('Matrix elements must be real numbers');
                d.push(v);
            }
            return mat(rows, cols, d);
        }
        case 'bin': {
            const a = evalNode(n.a, ctx), b = evalNode(n.b, ctx);
            switch (n.op) {
                case '+': return add(a, b);
                case '-': return add(a, neg(b));
                case '*': return mul(a, b);
                case '/': return div(a, b);
                case '%': return mod(a, b);
                case '∠': {
                    const r = needReal(a, '∠'), t = needReal(b, '∠') * k;
                    return simplify(cx(r * Math.cos(t), r * Math.sin(t)));
                }
                default: return pow(a, b);
            }
        }
        case 'call': return callFn(n.n, n.args, ctx);
    }
}

function callFn(f: string, argNodes: Node[], ctx: EvalCtx): Value {
    const k = ctx.degrees ? Math.PI / 180 : 1;
    if (SPECIAL_FORMS.has(f)) {
        if (argNodes.length < 2) throw new Error(`${f}(f, …) needs an expression in x and a number`);
        const body = argNodes[0];
        const fn = (x: number) => {
            const v = evalNode(body, { ...ctx, local: { ...(ctx.local ?? {}), x } });
            return typeof v === 'number' ? v : NaN;
        };
        const nums = argNodes.slice(1).map(a => needReal(evalNode(a, ctx), `${f}()`));
        if (f === 'int') { if (nums.length !== 2) throw new Error('Use int(f, a, b)'); return integrate(fn, nums[0], nums[1]); }
        if (f === 'der') { if (nums.length !== 1) throw new Error('Use der(f, x0)'); return derivative(fn, nums[0]); }
        return solve(fn, nums[0], nums[1]);
    }
    const args = argNodes.map(a => evalNode(a, ctx));
    const one = () => { if (args.length !== 1) throw new Error(`${f}() takes 1 argument`); return args[0]; };

    // Matrix functions
    if (f === 'det' || f === 'inv' || f === 'trans' || f === 'trace') {
        const m = one();
        if (!isMat(m)) {
            if (f === 'inv') return div(1, m);
            return m;   // a number treated as a 1×1 matrix
        }
        if (f === 'det') return mLU(m).det;
        if (f === 'inv') return mInv(m);
        if (f === 'trans') return mTrans(m);
        if (m.rows !== m.cols) throw new Error('The matrix must be square');
        let t = 0; for (let i = 0; i < m.rows; i++) t += mGet(m, i, i);
        return t;
    }
    if (f === 'polar') {
        if (args.length !== 2) throw new Error('Use polar(r, angle)');
        const r = needReal(args[0], 'polar'), t = needReal(args[1], 'polar') * k;
        return simplify(cx(r * Math.cos(t), r * Math.sin(t)));
    }
    // Complex numbers
    if (['re', 'im', 'arg', 'conj', 'abs', 'sqrt', 'exp', 'ln', 'log', 'log10', 'sin', 'cos', 'tan', 'sinh', 'cosh'].includes(f)) {
        const anyCx = args.some(a => !isMat(a) && isCx(a));
        const a0 = args[0];
        if (args.length === 1 && a0 !== undefined && !isMat(a0)) {
            const z = toCx(a0);
            if (f === 're') return z.re;
            if (f === 'im') return z.im;
            if (f === 'arg') return cArg(z) / k;
            if (f === 'conj') return simplify(cx(z.re, -z.im));
            if (f === 'abs') return cAbs(z);
            const negReal = !anyCx && typeof a0 === 'number' && a0 < 0;
            if (anyCx || (negReal && (f === 'sqrt' || f === 'ln' || f === 'log' || f === 'log10'))) {
                switch (f) {
                    case 'sqrt': return simplify(cSqrt(z));
                    case 'exp': return simplify(cExp(z));
                    case 'ln': return simplify(cLn(z));
                    case 'log': case 'log10': { const l = cLn(z); return simplify(cx(l.re / Math.LN10, l.im / Math.LN10)); }
                    case 'sin': return simplify(cSin(cx(z.re * k, z.im * k)));
                    case 'cos': return simplify(cCos(cx(z.re * k, z.im * k)));
                    case 'tan': { const a = cx(z.re * k, z.im * k); return simplify(cDiv(cSin(a), cCos(a))); }
                    case 'sinh': return simplify(cMul(cx(0, -1), cSin(cx(-z.im, z.re))));
                    case 'cosh': return simplify(cCos(cx(-z.im, z.re)));
                }
            }
        }
        if (anyCx) throw new Error(`${f}() does not work with complex numbers here`);
    }
    if (args.some(a => isMat(a))) {
        // Number functions work element-wise on a matrix (e.g. abs([−1, 2])).
        if (args.length === 1 && isMat(args[0])) {
            const m = args[0];
            return mEach(m, x => numericCall(f, [x], ctx.degrees));
        }
        throw new Error(`${f}() does not work with matrices`);
    }
    if (args.some(a => isCx(a))) throw new Error(`${f}() does not work with complex numbers`);
    return numericCall(f, args as number[], ctx.degrees);
}

// --- formatting results ---
export function formatComplex(c: Cx): string {
    const re = Math.abs(c.re) < 1e-12 * Math.abs(c.im) ? 0 : c.re;
    const im = c.im;
    const imAbs = Math.abs(im);
    const imStr = Math.abs(imAbs - 1) < 1e-15 ? 'i' : `${formatNumber(imAbs)}i`;
    if (re === 0) return (im < 0 ? '-' : '') + imStr;
    return `${formatNumber(re)} ${im < 0 ? '−' : '+'} ${imStr}`;
}

export function formatPolar(c: Cx, degrees: boolean): string {
    const a = cArg(c) * (degrees ? 180 / Math.PI : 1);
    return `${formatNumber(cAbs(c))} ∠ ${formatNumber(a)}${degrees ? '°' : ''}`;
}

export function formatValue(v: Value): string {
    if (typeof v === 'number') return formatNumber(v);
    if (isCx(v)) return formatComplex(v);
    const rows: string[] = [];
    for (let i = 0; i < v.rows; i++) rows.push(v.d.slice(i * v.cols, (i + 1) * v.cols).map(formatNumber).join(', '));
    return `[${rows.join('; ')}]`;
}

/** Result to put back into the calculator (no spaces and no "−" sign). */
export function valueToInput(v: Value): string {
    return formatValue(v).replace(/−/g, '-').replace(/ ([+-]) /g, '$1').replace('∞', 'Infinity');
}

export interface CalcResult { value: Value; text: string; assigned?: string; unit?: string; }

/** Evaluates a calculator entry: assignment "a = …", unit conversion "… to …" or a plain expression. */
export function evaluateInput(input: string, ctx: EvalCtx): CalcResult {
    const src = input.trim();
    const conv = splitConversion(src);
    if (conv) {
        const v = evalNode(parseExpression(conv.expr), ctx);
        const x = needReal(v, 'Unit conversion');
        const r = convertUnits(x, conv.from, conv.to);
        return { value: r, text: `${formatNumber(r)} ${conv.to}`, unit: conv.to };
    }
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(.+)$/.exec(src);
    if (m) {
        const name = m[1].toLowerCase();
        if (['pi', 'e', 'tau', 'phi', 'ans', 'i', 'j', 'x'].includes(name)) throw new Error(`"${name}" is reserved`);
        const value = evalNode(parseExpression(m[2]), ctx);
        ctx.vars[name] = value;
        return { value, text: formatValue(value), assigned: name };
    }
    const value = evalNode(parseExpression(src), ctx);
    return { value, text: formatValue(value) };
}
