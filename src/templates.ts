import { A4_W, A4_H } from './pageFormat';

export type PageTemplate = 'dots' | 'lines' | 'grid' | 'blank' | 'cornell' | 'isometric' | 'margin' | 'checklist' | 'mm' | 'music';
export const PAGE_TEMPLATES: { id: PageTemplate; label: string }[] = [
    { id: 'dots', label: 'Dots' },
    { id: 'lines', label: 'Lines' },
    { id: 'grid', label: 'Grid' },
    { id: 'blank', label: 'Blank' },
    { id: 'cornell', label: 'Cornell' },
    { id: 'isometric', label: 'Isometric' },
    { id: 'margin', label: 'Lines + margin' },
    { id: 'checklist', label: 'Checklist' },
    { id: 'mm', label: 'Millimeter' },
    { id: 'music', label: 'Music staff' },
];
export const PAPER_COLORS = ['#ffffff', '#fffbea', '#fef3c7', '#f1f5f9', '#e0f2fe', '#dcfce7', '#fce7f3', '#1f2937'];
export const isTemplate = (v: any): v is PageTemplate => PAGE_TEMPLATES.some(t => t.id === v);
export const isHexColor = (v: any): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

export interface PageInk { line: string; dot: string; accent: string; fine: string; strong: string; }
// Line / dot colours matched to the paper brightness (dark paper gets light lines).
export function inkForPaper(paper: string): PageInk {
    const r = parseInt(paper.slice(1, 3), 16), g = parseInt(paper.slice(3, 5), 16), b = parseInt(paper.slice(5, 7), 16);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    if (lum < 0.45) return { line: 'rgba(226,232,240,0.20)', dot: 'rgba(226,232,240,0.28)', accent: 'rgba(248,113,113,0.45)', fine: 'rgba(226,232,240,0.09)', strong: 'rgba(226,232,240,0.34)' };
    return { line: 'rgba(71,85,105,0.22)', dot: 'rgba(71,85,105,0.26)', accent: 'rgba(220,38,38,0.35)', fine: 'rgba(71,85,105,0.10)', strong: 'rgba(71,85,105,0.38)' };
}

/*
 * Pattern geometry. Spacing is fixed (independent of the page size), so on landscape and endless pages
 * lines and squares have the same size as on A4. The same geometry draws the pattern on screen (CSS), in thumbnails,
 * in PDF export and in the tools/hnote2pdf.py script – make changes in all of these places.
 */
const GX = A4_W / 42;          // grid / dot step horizontally (≈ 5 mm)
const GY = A4_H / 56;          // dot step vertically
const SP = A4_H / 42;          // line spacing
const MM = A4_W / 210;         // 1 mm
const MARGIN_X = 96;           // vertical margin (Lines + margin)
const CORNELL_SUMMARY = 204;   // height of the summary box (Cornell)
const STAFF_GAP = 9;           // spacing of staff lines
const STAFF_MIN_SPACE = 48;    // minimum space between staves
const STAFF_MARGIN_Y = 64, STAFF_MARGIN_X = 48;
/** Floor that tolerates floating-point errors (1131 / (1131/42) = 41.99999…). */
const fl = (x: number) => Math.floor(x + 1e-6);

export interface TemplateGeometry {
    dots?: { sx: number; sy: number; nx: number; ny: number };
    /** Horizontal lines: y of the first one (top edge of a 1-pixel line), spacing, count, horizontal range. */
    lines?: { y0: number; step: number; n: number; x0: number; x1: number };
    grid?: { step: number };
    iso?: { step: number };
    mm?: { x0: number; y0: number; cols: number; rows: number };   // number of 1 cm squares
    staves?: { x0: number; x1: number; y0: number; pitch: number; n: number };
    checks?: { x: number; size: number };   // small squares next to the lines (to-do list)
    /** Accent lines (red): [x, y, w, h]. */
    accents?: [number, number, number, number][];
}

export function templateGeometry(tpl: PageTemplate, W: number, H: number): TemplateGeometry {
    const linesFrom = (bottom: number) => ({ y0: 2 * SP + SP - 1, step: SP, n: Math.max(0, fl(bottom / SP) - 2), x0: 0, x1: W });
    switch (tpl) {
        case 'dots': {
            const nx = Math.max(2, Math.round(W / GX)), ny = Math.max(2, Math.round(H / GY));
            return { dots: { sx: W / nx, sy: H / ny, nx, ny } };
        }
        case 'lines': return { lines: { ...linesFrom(H), n: Math.max(0, fl(H / SP) - 3) } };
        case 'margin': return { lines: { ...linesFrom(H), n: Math.max(0, fl(H / SP) - 3) }, accents: [[MARGIN_X, 0, 1.5, H]] };
        case 'checklist': return { lines: { ...linesFrom(H), n: Math.max(0, fl(H / SP) - 3) }, checks: { x: 26, size: 13 } };
        case 'cornell': {
            const cue = Math.round(W * 0.28), sum = H - CORNELL_SUMMARY;
            return { lines: linesFrom(sum), accents: [[cue, 0, 1.5, sum], [0, sum, W, 1.5]] };
        }
        case 'grid': return { grid: { step: GX } };
        case 'isometric': return { iso: { step: GX } };
        case 'mm': {
            const cm = 10 * MM;
            const cols = Math.max(1, fl((W - 16 * MM) / cm)), rows = Math.max(1, fl((H - 16 * MM) / cm));
            return { mm: { x0: Math.round((W - cols * cm) / 2), y0: Math.round((H - rows * cm) / 2), cols, rows } };
        }
        case 'music': {
            const staff = 4 * STAFF_GAP;
            const n = Math.max(1, fl((H - 2 * STAFF_MARGIN_Y + STAFF_MIN_SPACE) / (staff + STAFF_MIN_SPACE)));
            const pitch = n > 1 ? (H - 2 * STAFF_MARGIN_Y - staff) / (n - 1) : 0;
            return { staves: { x0: STAFF_MARGIN_X, x1: W - STAFF_MARGIN_X, y0: STAFF_MARGIN_Y, pitch, n } };
        }
        default: return {};
    }
}

/** Page background settings (CSS) for the ::before (main pattern) and ::after (extras) pseudo-elements. */
export interface TemplateCss { [prop: string]: string; }
const px = (v: number) => `${Math.round(v * 1000) / 1000}px`;

/** CSS variables describing the page pattern – read by the .hw-page-a4::before / ::after rule in styles.css. */
export function templateCssVars(tpl: PageTemplate, W: number, H: number, ink: PageInk): TemplateCss {
    const g = templateGeometry(tpl, W, H);
    const v: TemplateCss = {};
    const box = (pre: string, l: number, t: number, w: number, h: number) => {
        v[`--hw-${pre}-l`] = px(l); v[`--hw-${pre}-t`] = px(t); v[`--hw-${pre}-w`] = px(w); v[`--hw-${pre}-h`] = px(h);
    };
    const main: string[] = [], size: string[] = [], pos: string[] = [];
    let rep = 'repeat';
    if (g.dots) {
        const d = g.dots;
        box('a', d.sx / 2, d.sy / 2, d.sx * (d.nx - 1), d.sy * (d.ny - 1));
        main.push(`radial-gradient(circle at center, ${ink.dot} 1.1px, transparent 1.5px)`);
        size.push(`${px(d.sx)} ${px(d.sy)}`); pos.push('0 0');
    } else if (g.lines) {
        const L = g.lines;
        box('a', L.x0, L.y0 - L.step + 1, L.x1 - L.x0, L.n * L.step);
        // A tile one spacing high with a line at its bottom edge (drawn like the grid – sharp at every zoom).
        main.push(`linear-gradient(to top, ${ink.line} 1px, transparent 1px)`);
        size.push(`100% ${px(L.step)}`); pos.push('0 0'); rep = 'repeat-y';
    } else if (g.grid) {
        box('a', 0, 0, W, H);
        main.push(`linear-gradient(${ink.line} 1px, transparent 1px)`, `linear-gradient(90deg, ${ink.line} 1px, transparent 1px)`);
        size.push(`${px(g.grid.step)} ${px(g.grid.step)}`, `${px(g.grid.step)} ${px(g.grid.step)}`); pos.push('0 0', '0 0');
    } else if (g.iso) {
        const s = g.iso.step;
        box('a', 3, 0, W - 6, H);
        main.push(`radial-gradient(circle at 50% 25%, ${ink.dot} 1.1px, transparent 1.5px)`, `radial-gradient(circle at 50% 75%, ${ink.dot} 1.1px, transparent 1.5px)`);
        size.push(`${px(s)} ${px(s * 0.866 * 2)}`, `${px(s)} ${px(s * 0.866 * 2)}`); pos.push('-3px 0', `${px(s / 2 - 3)} 0`);
    } else if (g.mm) {
        const m = g.mm, cm = 10 * MM;
        box('a', m.x0, m.y0, m.cols * cm + 1, m.rows * cm + 1);
        for (const [step, col] of [[cm, ink.strong], [cm / 2, ink.line], [MM, ink.fine]] as [number, string][]) {
            main.push(`linear-gradient(${col} 1px, transparent 1px)`, `linear-gradient(90deg, ${col} 1px, transparent 1px)`);
            size.push(`${px(step)} ${px(step)}`, `${px(step)} ${px(step)}`); pos.push('0 0', '0 0');
        }
    } else if (g.staves) {
        const s = g.staves, gap = STAFF_GAP;
        box('a', s.x0, s.y0, s.x1 - s.x0, (s.n - 1) * s.pitch + 4 * gap + 1);
        // Five layers – each is one line at the top of a tile one staff-gap high, shifted by k * gap.
        const tile = px(Math.max(s.pitch, 4 * gap + 1));
        for (let k = 0; k < 5; k++) {
            main.push(`linear-gradient(${ink.strong} 1px, transparent 1px)`);
            size.push(`100% ${tile}`); pos.push(`0 ${px(k * gap)}`);
        }
        rep = 'repeat-y';
    }
    if (main.length) {
        v['--hw-a-img'] = main.join(', ');
        v['--hw-a-size'] = size.join(', ');
        v['--hw-a-pos'] = pos.join(', ');
        v['--hw-a-rep'] = rep;
    }
    // Extras: accent lines or to-do list squares.
    const extra: string[] = [], esize: string[] = [], epos: string[] = [];
    if (g.checks && g.lines) {
        const c = g.checks, L = g.lines;
        box('b', c.x, L.y0 - L.step + 1, c.size + 2, L.n * L.step);
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${c.size + 2}' height='${L.step}'><rect x='1' y='${L.step - c.size - 6}' width='${c.size}' height='${c.size}' rx='2' fill='none' stroke='${ink.strong}' stroke-width='1.2'/></svg>`;
        extra.push(`url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
        esize.push(`${px(c.size + 2)} ${px(L.step)}`); epos.push('0 0');
        v['--hw-b-rep'] = 'repeat-y';
    } else if (g.accents) {
        box('b', 0, 0, W, H);
        for (const [x, y, w, h] of g.accents) {
            extra.push(`linear-gradient(${ink.accent}, ${ink.accent})`);
            esize.push(`${px(w)} ${px(h)}`); epos.push(`${px(x)} ${px(y)}`);
        }
        v['--hw-b-rep'] = 'no-repeat';
    }
    if (extra.length) {
        v['--hw-b-img'] = extra.join(', ');
        v['--hw-b-size'] = esize.join(', ');
        v['--hw-b-pos'] = epos.join(', ');
    }
    return v;
}

/** All variables set by templateCssVars (to clear before changing the pattern). */
export const TEMPLATE_CSS_VARS = ['a', 'b'].flatMap(p => ['l', 't', 'w', 'h', 'img', 'size', 'pos', 'rep'].map(k => `--hw-${p}-${k}`));

// Draws the page pattern on a canvas (thumbnails, PDF export). S = resolution multiplier.
export function drawPageTemplate(ctx: CanvasRenderingContext2D, S: number, tpl: PageTemplate, ink: PageInk, W = A4_W, H = A4_H) {
    const g = templateGeometry(tpl, W, H);
    const rect = (x: number, y: number, w: number, h: number) => ctx.fillRect(x * S, y * S, w * S, h * S);
    const dot = (x: number, y: number) => { ctx.beginPath(); ctx.arc(x * S, y * S, 1.2 * S, 0, Math.PI * 2); ctx.fill(); };
    if (g.dots) {
        ctx.fillStyle = ink.dot;
        const d = g.dots;
        for (let j = 1; j < d.ny; j++) for (let i = 1; i < d.nx; i++) dot(i * d.sx, j * d.sy);
    }
    if (g.lines) {
        ctx.fillStyle = ink.line;
        const L = g.lines;
        for (let k = 0; k < L.n; k++) rect(L.x0, L.y0 + k * L.step, L.x1 - L.x0, 1);
        if (g.checks) {
            ctx.strokeStyle = ink.strong;
            ctx.lineWidth = 1.2 * S;
            const c = g.checks;
            for (let k = 0; k < L.n; k++) {
                const y = L.y0 + k * L.step - c.size - 5;
                ctx.strokeRect((c.x + 1) * S, y * S, c.size * S, c.size * S);
            }
        }
    }
    if (g.grid) {
        ctx.fillStyle = ink.line;
        const st = g.grid.step;
        for (let k = 0; k * st < W - 0.01; k++) rect(k * st, 0, 1, H);
        for (let k = 0; k * st < H - 0.01; k++) rect(0, k * st, W, 1);
    }
    if (g.iso) {
        ctx.fillStyle = ink.dot;
        const s = g.iso.step, h = s * 0.866;
        for (let j = 0; (j + 0.5) * h < H; j++) {
            const y = (j + 0.5) * h;
            if (j % 2 === 0) for (let x = s / 2; x < W - 2; x += s) dot(x, y);
            else for (let x = s; x < W - 2; x += s) dot(x, y);
        }
    }
    if (g.mm) {
        const m = g.mm, cm = 10 * MM;
        const w = m.cols * cm, h = m.rows * cm;
        for (const [step, col] of [[MM, ink.fine], [cm / 2, ink.line], [cm, ink.strong]] as [number, string][]) {
            ctx.fillStyle = col;
            const n = Math.round(cm / step);
            for (let k = 0; k <= m.cols * n; k++) rect(m.x0 + k * step, m.y0, 1, h + 1);
            for (let k = 0; k <= m.rows * n; k++) rect(m.x0, m.y0 + k * step, w + 1, 1);
        }
    }
    if (g.staves) {
        ctx.fillStyle = ink.strong;
        const s = g.staves;
        for (let k = 0; k < s.n; k++) for (let l = 0; l < 5; l++) rect(s.x0, s.y0 + k * s.pitch + l * STAFF_GAP, s.x1 - s.x0, 1);
    }
    if (g.accents) {
        ctx.fillStyle = ink.accent;
        for (const [x, y, w, h] of g.accents) rect(x, y, w, h);
    }
}
