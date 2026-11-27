import { HERSHEY } from './hersheyData';

/** A polyline as [x, y] pairs (editor px or page units). */
export type Pt = [number, number];
export type Polyline = Pt[];

interface Glyph { lines: Polyline[]; left: number; right: number }

const CAP = 21;          // Hershey cap height (y = -12 … 9)
const BASE = 9;          // Hershey baseline

function decode(data: string): Glyph {
    const left = data.charCodeAt(0) - 82, right = data.charCodeAt(1) - 82;
    const lines: Polyline[] = [];
    let cur: Polyline = [];
    for (let i = 2; i + 1 < data.length; i += 2) {
        if (data[i] === ' ' && data[i + 1] === 'R') { if (cur.length) lines.push(cur); cur = []; continue; }
        cur.push([data.charCodeAt(i) - 82, data.charCodeAt(i + 1) - 82]);
    }
    if (cur.length) lines.push(cur);
    return { lines, left, right };
}

/** Polish letters: base glyph + a small diacritic (Hershey units). */
const DIACRITICS: Record<string, [string, 'acute' | 'dot' | 'ogonek' | 'stroke']> = {
    'ą': ['a', 'ogonek'], 'ę': ['e', 'ogonek'], 'ć': ['c', 'acute'], 'ń': ['n', 'acute'], 'ó': ['o', 'acute'],
    'ś': ['s', 'acute'], 'ź': ['z', 'acute'], 'ż': ['z', 'dot'], 'ł': ['l', 'stroke'],
    'Ą': ['A', 'ogonek'], 'Ę': ['E', 'ogonek'], 'Ć': ['C', 'acute'], 'Ń': ['N', 'acute'], 'Ó': ['O', 'acute'],
    'Ś': ['S', 'acute'], 'Ź': ['Z', 'acute'], 'Ż': ['Z', 'dot'], 'Ł': ['L', 'stroke'],
};

const cache = new Map<string, Glyph | null>();

function glyph(ch: string): Glyph | null {
    if (cache.has(ch)) return cache.get(ch)!;
    let g: Glyph | null = null;
    if (HERSHEY[ch]) g = decode(HERSHEY[ch]);
    else if (ch === 'µ') g = glyph('μ');
    else if (DIACRITICS[ch]) {
        const [b, kind] = DIACRITICS[ch];
        const base = glyph(b);
        if (base) {
            const upper = b === b.toUpperCase();
            const cx = (base.left + base.right) / 2;
            const top = upper ? -12 : -5;
            const extra: Polyline[] = [];
            if (kind === 'acute') extra.push([[cx - 1, top - 3], [cx + 2, top - 6]]);
            else if (kind === 'dot') extra.push([[cx, top - 4], [cx + 0.3, top - 4.3], [cx, top - 4.6], [cx - 0.3, top - 4.3], [cx, top - 4]]);
            else if (kind === 'ogonek') extra.push([[cx + 3, 9], [cx + 1.5, 11], [cx + 2, 13], [cx + 4, 13]]);
            else if (b === 'l') extra.push([[cx - 3, 2], [cx + 3, -3]]);
            else extra.push([[base.left + 1, 3], [base.left + 8, -2]]);
            g = { left: base.left, right: base.right, lines: [...base.lines, ...extra] };
        }
    }
    cache.set(ch, g);
    return g;
}

/** Label text as typed → text as drawn: "ohm" → Ω, "uF"/"uH"/… → μF/μH. */
export function displayLabel(l: string): string {
    return l.replace(/ohm/gi, 'Ω').replace(/(^|[^A-Za-z])u(?=[FHAVs](\b|$))/g, '$1μ');
}

/** Lays out a label with the single-stroke font. `size` = cap height. "_x" / "_{xy}" make subscripts.
 *  Returns polylines relative to (left edge, baseline) and the text width. */
export function layoutText(str: string, size: number): { lines: Polyline[]; width: number } {
    const toks: [string, boolean][] = [];
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '_' && i + 1 < str.length) {
            if (str[i + 1] === '{') {
                let j = str.indexOf('}', i + 2); if (j < 0) j = str.length;
                for (const c of str.slice(i + 2, j)) toks.push([c, true]);
                i = j;
            } else { toks.push([str[i + 1], true]); i++; }
            continue;
        }
        toks.push([ch, false]);
    }
    const lines: Polyline[] = [];
    let x = 0;
    for (const [ch, sub] of toks) {
        const k = (size / CAP) * (sub ? 0.62 : 1);
        const dy = sub ? size * 0.3 : 0;
        const g = glyph(ch) ?? glyph('?')!;
        for (const pl of g.lines) lines.push(pl.map(([gx, gy]) => [x + (gx - g.left) * k, (gy - BASE) * k + dy] as Pt));
        x += (g.right - g.left) * k;
    }
    return { lines, width: x };
}
