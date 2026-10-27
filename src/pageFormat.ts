import { PageData, NoteData } from './types';

/**
 * Page sizes and formats. Coordinates are "logical": an A4 page is 800 × 1131 units (1 mm ≈ 3.81 units).
 * A page may have its own size (w / h fields) – missing fields mean A4 portrait, so old notes don't change.
 */
export const A4_W = 800;
export const A4_H = 1131;
export type PageFormat = 'a4' | 'a4l' | 'endless';
export const PAGE_FORMATS: { id: PageFormat; label: string; hint: string }[] = [
    { id: 'a4', label: 'A4 portrait', hint: 'Standard page' },
    { id: 'a4l', label: 'A4 landscape', hint: 'Wide page' },
    { id: 'endless', label: 'Endless', hint: 'Grows down as you write' },
];
export const isFormat = (v: unknown): v is PageFormat => PAGE_FORMATS.some(f => f.id === v);

/** An "endless" page grows by half an A4 so there is always at least ENDLESS_ROOM of free space below the content. */
export const ENDLESS_STEP = Math.round(A4_H / 2);
export const ENDLESS_ROOM = 420;
/** Upper limit (16 A4 pages) – beyond this the page stops growing (PDF page size limit). */
export const ENDLESS_MAX = A4_H * 16;

export const pageWidth = (p?: PageData | null): number => p?.w ?? A4_W;
export const pageHeight = (p?: PageData | null): number => p?.h ?? A4_H;

export function formatOf(p: PageData): PageFormat {
    if (p.endless) return 'endless';
    return pageWidth(p) > pageHeight(p) ? 'a4l' : 'a4';
}

/** Lowest point of the page content (strokes and images). */
export function contentBottom(p: PageData): number {
    let y = 0;
    for (const s of p.strokes) for (const pt of s.points) if (pt.y + s.width > y) y = pt.y + s.width;
    for (const im of p.images ?? []) {
        // rotated image: the lowest of the corners
        const c = Math.abs(Math.cos(im.rot ?? 0)), sn = Math.abs(Math.sin(im.rot ?? 0));
        const half = (im.w * sn + im.h * c) / 2;
        y = Math.max(y, im.y + im.h / 2 + half);
    }
    return y;
}

/** Height an "endless" page needs (never less than A4). */
export function endlessHeight(p: PageData): number {
    const need = contentBottom(p) + ENDLESS_ROOM;
    return Math.min(ENDLESS_MAX, Math.max(A4_H, Math.ceil(need / ENDLESS_STEP) * ENDLESS_STEP));
}

/** Sets the page format (content stays in place; what sticks out of the new page comes back when the format is changed back). */
export function applyFormat(p: PageData, f: PageFormat) {
    delete p.w; delete p.h; delete p.endless;
    if (f === 'a4l') { p.w = A4_H; p.h = A4_W; }
    else if (f === 'endless') { p.endless = true; p.h = endlessHeight(p); }
}

/** New blank page in the note's default format. */
export function newPage(note: NoteData): PageData {
    const p: PageData = { strokes: [] };
    const f = note.defaults?.format;
    if (f && f !== 'a4') applyFormat(p, f);
    return p;
}

/** Whether the note uses format v4 fields (then we save "v":4, otherwise "v":3 for compatibility). */
export function usesV4(note: NoteData): boolean {
    return !!note.defaults?.format || note.pages.some(p => p.w !== undefined || p.h !== undefined || p.endless || p.title);
}
