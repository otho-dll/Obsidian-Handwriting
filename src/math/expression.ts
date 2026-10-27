/**
 * Safe parser and compiler of math expressions (no eval).
 * Supports: + - * / ^ % !, brackets, implicit multiplication (2x, 2(x+1), x sin x), constants and functions.
 */

export type Vars = Record<string, number>;
export type Compiled = (v: Vars) => number;

export interface CompileOptions {
    /** Names of allowed variables (e.g. ['x'] or ['x','y']). */
    vars?: string[];
    /** Extra named values (e.g. ans, the calculator's own variables). */
    scope?: Vars;
    /** Degree mode for trigonometric functions. */
    degrees?: boolean;
}

type Tok =
    | { t: 'num'; v: number }
    | { t: 'id'; v: string }
    | { t: 'op'; v: string };

export const CONSTANTS: Vars = {
    pi: Math.PI, 'π': Math.PI, e: Math.E, tau: Math.PI * 2, phi: (1 + Math.sqrt(5)) / 2,
};

export function fact(n: number): number {
    if (n < 0 || !isFinite(n)) return NaN;
    if (Number.isInteger(n)) {
        if (n > 170) return Infinity;
        let r = 1;
        for (let i = 2; i <= n; i++) r *= i;
        return r;
    }
    return gamma(n + 1);
}

export function gamma(z: number): number {
    // Lanczos approximation.
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
    z -= 1;
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
        -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    let x = c[0];
    for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
    const t = z + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

function tokenize(src: string): Tok[] {
    const s = src
        .replace(/[×·∙]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/√/g, 'sqrt').replace(/²/g, '^2').replace(/³/g, '^3');
    const out: Tok[] = [];
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (/\s/.test(c)) { i++; continue; }
        if (/[0-9.]/.test(c)) {
            let j = i;
            while (j < s.length && /[0-9]/.test(s[j])) j++;
            if (s[j] === '.') { j++; while (j < s.length && /[0-9]/.test(s[j])) j++; }
            if ((s[j] === 'e' || s[j] === 'E') && /[0-9]/.test(s[j + 1] ?? '') ) {
                j++; while (j < s.length && /[0-9]/.test(s[j])) j++;
            } else if ((s[j] === 'e' || s[j] === 'E') && /[+-]/.test(s[j + 1] ?? '') && /[0-9]/.test(s[j + 2] ?? '')) {
                j += 2; while (j < s.length && /[0-9]/.test(s[j])) j++;
            }
            const v = parseFloat(s.slice(i, j));
            if (isNaN(v)) throw new Error(`Bad number "${s.slice(i, j)}"`);
            out.push({ t: 'num', v });
            i = j; continue;
        }
        if (/[A-Za-z_πθ]/.test(c)) {
            let j = i + 1;
            while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
            out.push({ t: 'id', v: s.slice(i, j) });
            i = j; continue;
        }
        if ('+-*/^%!(),=[];∠°'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
        throw new Error(`Unexpected character "${c}"`);
    }
    return out;
}

export type Node =
    | { k: 'num'; v: number }
    | { k: 'var'; n: string }
    | { k: 'neg'; a: Node }
    | { k: 'bin'; op: string; a: Node; b: Node }   // op: + - * / % ^ ∠
    | { k: 'fact'; a: Node }
    | { k: 'deg'; a: Node }                        // 30° – angle in degrees
    | { k: 'mat'; rows: Node[][] }                 // [1, 2; 3, 4]
    | { k: 'call'; n: string; args: Node[] };

const FUNCS_1 = new Set(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh',
    'sqrt', 'cbrt', 'abs', 'exp', 'ln', 'log', 'log10', 'log2', 'floor', 'ceil', 'round', 'trunc', 'sign', 'fact', 'gamma',
    'sec', 'csc', 'cot', 'deg', 'rad',
    // calculator only (complex numbers and matrices)
    're', 'im', 'arg', 'conj', 'det', 'inv', 'trans', 'transpose', 'trace']);
const FUNCS_N = new Set(['min', 'max', 'atan2', 'pow', 'mod', 'hypot', 'log', 'ncr', 'npr', 'gcd', 'lcm', 'polar',
    // calculator only: integral, derivative, equation solving (the first argument is an expression in x)
    'int', 'der', 'solve']);
/** Functions whose first argument is an expression in x (evaluated lazily). */
export const SPECIAL_FORMS = new Set(['int', 'der', 'solve']);
const ALIASES: Record<string, string> = { ncr: 'ncr', npr: 'npr', nCr: 'ncr', nPr: 'npr', transpose: 'trans' };

class Parser {
    private p = 0;
    constructor(private toks: Tok[]) {}

    parse(): Node {
        const n = this.add();
        if (this.p < this.toks.length) throw new Error(`Unexpected "${this.describe(this.toks[this.p])}"`);
        return n;
    }
    private describe(t: Tok) { return t.t === 'num' ? String(t.v) : t.v; }
    private peek(): Tok | undefined { return this.toks[this.p]; }
    private isOp(v: string) { const t = this.peek(); return !!t && t.t === 'op' && t.v === v; }
    private startsPrimary(): boolean {
        const t = this.peek();
        if (!t) return false;
        return t.t === 'num' || t.t === 'id' || (t.t === 'op' && (t.v === '(' || t.v === '['));
    }

    private add(): Node {
        let a = this.mul();
        for (;;) {
            if (this.isOp('+')) { this.p++; a = { k: 'bin', op: '+', a, b: this.mul() }; }
            else if (this.isOp('-')) { this.p++; a = { k: 'bin', op: '-', a, b: this.mul() }; }
            else return a;
        }
    }
    private mul(): Node {
        let a = this.angle();
        for (;;) {
            if (this.isOp('*')) { this.p++; a = { k: 'bin', op: '*', a, b: this.angle() }; }
            else if (this.isOp('/')) { this.p++; a = { k: 'bin', op: '/', a, b: this.angle() }; }
            else if (this.isOp('%')) { this.p++; a = { k: 'bin', op: '%', a, b: this.angle() }; }
            else if (this.startsPrimary()) a = { k: 'bin', op: '*', a, b: this.angle() }; // implicit multiplication
            else return a;
        }
    }
    // Polar form of a complex number: 10∠30 (modulus ∠ angle).
    private angle(): Node {
        let a = this.unary();
        while (this.isOp('∠')) { this.p++; a = { k: 'bin', op: '∠', a, b: this.unary() }; }
        return a;
    }
    private unary(): Node {
        if (this.isOp('-')) { this.p++; return { k: 'neg', a: this.unary() }; }
        if (this.isOp('+')) { this.p++; return this.unary(); }
        return this.pow();
    }
    private pow(): Node {
        const base = this.postfix();
        if (this.isOp('^')) { this.p++; return { k: 'bin', op: '^', a: base, b: this.unary() }; }
        return base;
    }
    private postfix(): Node {
        let a = this.primary();
        for (;;) {
            if (this.isOp('!')) { this.p++; a = { k: 'fact', a }; }
            else if (this.isOp('°')) { this.p++; a = { k: 'deg', a }; }
            else return a;
        }
    }
    private primary(): Node {
        const t = this.peek();
        if (!t) throw new Error('Unexpected end of expression');
        if (t.t === 'num') { this.p++; return { k: 'num', v: t.v }; }
        if (t.t === 'id') {
            this.p++;
            const name0 = t.v.toLowerCase() === t.v ? t.v : (CONSTANTS[t.v] !== undefined ? t.v : t.v.toLowerCase());
            const name = ALIASES[name0] ?? name0;
            const isFn = FUNCS_1.has(name) || FUNCS_N.has(name);
            if (isFn) {
                if (this.isOp('(')) {
                    this.p++;
                    const args: Node[] = [];
                    if (!this.isOp(')')) {
                        args.push(this.add());
                        while (this.isOp(',')) { this.p++; args.push(this.add()); }
                    }
                    if (!this.isOp(')')) throw new Error('Missing )');
                    this.p++;
                    return { k: 'call', n: name, args };
                }
                // Function without brackets: "sin x", "sqrt 2".
                return { k: 'call', n: name, args: [this.unary()] };
            }
            return { k: 'var', n: name };
        }
        if (t.v === '(') {
            this.p++;
            const e = this.add();
            if (!this.isOp(')')) throw new Error('Missing )');
            this.p++;
            return e;
        }
        if (t.v === '[') {
            // Matrix: rows separated by a semicolon, elements by a comma – [1, 2; 3, 4].
            this.p++;
            const rows: Node[][] = [[]];
            if (!this.isOp(']')) {
                rows[0].push(this.add());
                for (;;) {
                    if (this.isOp(',')) { this.p++; rows[rows.length - 1].push(this.add()); }
                    else if (this.isOp(';')) { this.p++; rows.push([this.add()]); }
                    else break;
                }
            }
            if (!this.isOp(']')) throw new Error('Missing ]');
            this.p++;
            const n = rows[0].length;
            if (n === 0 || rows.some(r => r.length !== n)) throw new Error('All matrix rows must have the same length');
            return { k: 'mat', rows };
        }
        throw new Error(`Unexpected "${t.v}"`);
    }
}

export function parseExpression(src: string): Node {
    const toks = tokenize(src);
    if (toks.length === 0) throw new Error('Empty expression');
    return new Parser(toks).parse();
}

export function compile(src: string, opts: CompileOptions = {}): Compiled {
    return buildNumeric(parseExpression(src), opts);
}

/** Function value for numeric arguments (shared implementation for plots and the calculator). */
export function numericCall(name: string, args: number[], degrees: boolean): number {
    return buildNumeric({ k: 'call', n: name, args: args.map(v => ({ k: 'num', v }) as Node) }, { degrees })({});
}

function gcd2(a: number, b: number): number {
    a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
    while (b) [a, b] = [b, a % b];
    return a;
}
function binom(n: number, r: number): number {
    if (!Number.isInteger(n) || !Number.isInteger(r) || r < 0 || n < 0 || r > n) return n >= 0 && r > n ? 0 : NaN;
    r = Math.min(r, n - r);
    let x = 1;
    for (let i = 1; i <= r; i++) x = x * (n - r + i) / i;
    return Math.round(x);
}

export function buildNumeric(ast: Node, opts: CompileOptions = {}): Compiled {
    const allowed = new Set(opts.vars ?? []);
    const scope = opts.scope ?? {};
    const k = opts.degrees ? Math.PI / 180 : 1;

    const build = (n: Node): Compiled => {
        switch (n.k) {
            case 'num': { const v = n.v; return () => v; }
            case 'var': {
                const name = n.n;
                if (allowed.has(name)) return (v) => v[name];
                if (scope[name] !== undefined) { const val = scope[name]; return () => val; }
                if (CONSTANTS[name] !== undefined) { const val = CONSTANTS[name]; return () => val; }
                throw new Error(`Unknown name "${name}"`);
            }
            case 'neg': { const a = build(n.a); return (v) => -a(v); }
            case 'fact': { const a = build(n.a); return (v) => fact(a(v)); }
            case 'deg': { const a = build(n.a); const f = Math.PI / 180 / k; return (v) => a(v) * f; }
            case 'mat': throw new Error('Matrices work in the calculator only');
            case 'bin': {
                const a = build(n.a), b = build(n.b);
                switch (n.op) {
                    case '+': return (v) => a(v) + b(v);
                    case '-': return (v) => a(v) - b(v);
                    case '*': return (v) => a(v) * b(v);
                    case '/': return (v) => a(v) / b(v);
                    case '%': return (v) => { const d = b(v); const r = a(v) % d; return r !== 0 && (r < 0) !== (d < 0) ? r + d : r; };
                    case '∠': throw new Error('Complex numbers (∠) work in the calculator only');
                    default: return (v) => Math.pow(a(v), b(v));
                }
            }
            case 'call': {
                const args = n.args.map(build);
                const f = n.n;
                const need1 = () => { if (args.length !== 1) throw new Error(`${f}() takes 1 argument`); return args[0]; };
                switch (f) {
                    case 'sin': { const a = need1(); return (v) => Math.sin(a(v) * k); }
                    case 'cos': { const a = need1(); return (v) => Math.cos(a(v) * k); }
                    case 'tan': { const a = need1(); return (v) => Math.tan(a(v) * k); }
                    case 'sec': { const a = need1(); return (v) => 1 / Math.cos(a(v) * k); }
                    case 'csc': { const a = need1(); return (v) => 1 / Math.sin(a(v) * k); }
                    case 'cot': { const a = need1(); return (v) => 1 / Math.tan(a(v) * k); }
                    case 'asin': { const a = need1(); return (v) => Math.asin(a(v)) / k; }
                    case 'acos': { const a = need1(); return (v) => Math.acos(a(v)) / k; }
                    case 'atan': { const a = need1(); return (v) => Math.atan(a(v)) / k; }
                    case 'deg': { const a = need1(); return (v) => a(v) * 180 / Math.PI; }
                    case 'rad': { const a = need1(); return (v) => a(v) * Math.PI / 180; }
                    case 'sinh': { const a = need1(); return (v) => Math.sinh(a(v)); }
                    case 'cosh': { const a = need1(); return (v) => Math.cosh(a(v)); }
                    case 'tanh': { const a = need1(); return (v) => Math.tanh(a(v)); }
                    case 'asinh': { const a = need1(); return (v) => Math.asinh(a(v)); }
                    case 'acosh': { const a = need1(); return (v) => Math.acosh(a(v)); }
                    case 'atanh': { const a = need1(); return (v) => Math.atanh(a(v)); }
                    case 'sqrt': { const a = need1(); return (v) => Math.sqrt(a(v)); }
                    case 'cbrt': { const a = need1(); return (v) => Math.cbrt(a(v)); }
                    case 'abs': { const a = need1(); return (v) => Math.abs(a(v)); }
                    case 'exp': { const a = need1(); return (v) => Math.exp(a(v)); }
                    case 'ln': { const a = need1(); return (v) => Math.log(a(v)); }
                    case 'log10': { const a = need1(); return (v) => Math.log10(a(v)); }
                    case 'log2': { const a = need1(); return (v) => Math.log2(a(v)); }
                    case 'log': {
                        if (args.length === 2) { const [a, b] = args; return (v) => Math.log(a(v)) / Math.log(b(v)); }
                        const a = need1(); return (v) => Math.log10(a(v));
                    }
                    case 'floor': { const a = need1(); return (v) => Math.floor(a(v)); }
                    case 'ceil': { const a = need1(); return (v) => Math.ceil(a(v)); }
                    case 'round': { const a = need1(); return (v) => Math.round(a(v)); }
                    case 'trunc': { const a = need1(); return (v) => Math.trunc(a(v)); }
                    case 'sign': { const a = need1(); return (v) => Math.sign(a(v)); }
                    case 'fact': { const a = need1(); return (v) => fact(a(v)); }
                    case 'gamma': { const a = need1(); return (v) => gamma(a(v)); }
                    case 'min': return (v) => Math.min(...args.map(a => a(v)));
                    case 'max': return (v) => Math.max(...args.map(a => a(v)));
                    case 'hypot': return (v) => Math.hypot(...args.map(a => a(v)));
                    case 'atan2': { if (args.length !== 2) throw new Error('atan2() takes 2 arguments'); const [a, b] = args; return (v) => Math.atan2(a(v), b(v)) / k; }
                    case 'pow': { if (args.length !== 2) throw new Error('pow() takes 2 arguments'); const [a, b] = args; return (v) => Math.pow(a(v), b(v)); }
                    case 'mod': { if (args.length !== 2) throw new Error('mod() takes 2 arguments'); const [a, b] = args; return (v) => { const d = b(v); const r = a(v) % d; return r !== 0 && (r < 0) !== (d < 0) ? r + d : r; }; }
                    case 'ncr': { if (args.length !== 2) throw new Error('nCr() takes 2 arguments'); const [a, b] = args; return (v) => binom(a(v), b(v)); }
                    case 'npr': { if (args.length !== 2) throw new Error('nPr() takes 2 arguments'); const [a, b] = args; return (v) => { const n0 = a(v), r0 = b(v); return binom(n0, r0) * fact(r0); }; }
                    case 'gcd': return (v) => args.map(a => a(v)).reduce((x, y) => gcd2(x, y));
                    case 'lcm': return (v) => args.map(a => a(v)).reduce((x, y) => { const g = gcd2(x, y); return g === 0 ? 0 : Math.abs(Math.round(x) * Math.round(y)) / g; });
                    case 're': { const a = need1(); return (v) => a(v); }
                    case 'im': { need1(); return () => 0; }
                    case 'conj': { const a = need1(); return (v) => a(v); }
                    case 'arg': { const a = need1(); return (v) => (a(v) < 0 ? Math.PI : 0) / k; }
                    default:
                        if (SPECIAL_FORMS.has(f) || ['det', 'inv', 'trans', 'trace', 'polar'].includes(f)) throw new Error(`${f}() works in the calculator only`);
                        throw new Error(`Unknown function "${f}"`);
                }
            }
        }
    };
    return build(ast);
}

/** Formats a result: up to ~12 significant digits, without floating-point noise. */
export function formatNumber(x: number): string {
    if (Number.isNaN(x)) return 'NaN';
    if (!isFinite(x)) return x > 0 ? '∞' : '-∞';
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e15 || a < 1e-9) return x.toExponential(8).replace(/\.?0+e/, 'e').replace('e+', 'e');
    const s = parseFloat(x.toPrecision(12)).toString();
    return s;
}
