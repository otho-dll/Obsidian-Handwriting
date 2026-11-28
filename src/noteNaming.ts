/** Naming of new notes: continuing a numbered series in a folder (ćw1, ćw2 → ćw3). Pure functions, no Obsidian API. */

export interface NoteSeries {
    /** Text before the number, as written in the newest note of the series. */
    prefix: string;
    /** Text after the number (no letters, e.g. "" or ")"). */
    suffix: string;
    /** The next number (largest number in the series + 1). */
    next: number;
    /** Zero padding of the numbers (0 = none): "Lab 01" → 2. */
    width: number;
}

export interface NoteEntry { name: string; mtime?: number }

/** Name of the note number `n` of the series. */
export function seriesName(s: NoteSeries, n: number): string {
    return s.prefix + String(n).padStart(s.width, '0') + s.suffix;
}

/**
 * Finds the numbered series among the notes of a folder (names without the extension).
 * Names made by the settings' name scheme (folder + date, collision numbers) are skipped – their date would look like
 * a series ending in the year. The largest group of names with the same text around the number wins
 * (a tie: the group with the newest note). One note is enough to start a series.
 * The number must be the last digits of the name; only non-letters may follow it, so "Lecture 2nd law" is not a series.
 */
export function detectSeries(entries: NoteEntry[], isSchemeName: (name: string) => boolean): NoteSeries | null {
    type Group = { prefix: string; suffix: string; max: number; width: number; count: number; newest: number };
    const groups = new Map<string, Group>();
    for (const e of entries) {
        const name = e.name.trim();
        if (!name || isSchemeName(name)) continue;
        const m = /^(.*?)(\d+)([^\p{L}\d]*)$/u.exec(name);
        if (!m) continue;
        const [, prefix, digits, suffix] = m;
        const num = Number(digits);
        if (!Number.isSafeInteger(num)) continue;
        const key = prefix.toLowerCase() + '\u0000' + suffix.toLowerCase();
        const t = e.mtime ?? 0;
        const padded = digits.length > 1 && digits.startsWith('0') ? digits.length : 0;
        const g = groups.get(key);
        if (!g) { groups.set(key, { prefix, suffix, max: num, width: padded, count: 1, newest: t }); continue; }
        g.count++;
        g.max = Math.max(g.max, num);
        g.width = Math.max(g.width, padded);
        if (t >= g.newest) { g.newest = t; g.prefix = prefix; g.suffix = suffix; }
    }
    let best: Group | null = null;
    for (const g of groups.values()) {
        if (!best || g.count > best.count || (g.count === best.count && g.newest > best.newest)) best = g;
    }
    if (!best) return null;
    return { prefix: best.prefix, suffix: best.suffix, next: best.max + 1, width: best.width };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Test for names made by the name scheme of the settings (`buildNoteName`): the folder part, a date
 * DD<sep>MM[<sep>YYYY], and the optional collision number " 001".
 */
export function schemeMatcher(opts: { mode: 'folderDate' | 'folder' | 'date'; folderPart: string; separator: string; dateSeparator: string }): (name: string) => boolean {
    const ds = escapeRe(opts.dateSeparator);
    const date = `\\d{2}${ds}\\d{2}(?:${ds}\\d{4})?`;
    const folder = escapeRe(opts.folderPart);
    const sep = escapeRe(opts.separator === '' ? ' ' : opts.separator);
    const body = opts.mode === 'date' ? date : opts.mode === 'folder' ? folder : `${folder}${sep}${date}`;
    const re = new RegExp(`^${body}(?: \\d{3})?$`, 'iu');
    // Notes named by an earlier scheme (other folder part or separators) end with a full date too.
    const anyDate = /\d{2}[-._ ]\d{2}[-._ ]\d{4}(?: \d{3})?$/u;
    return (name) => re.test(name.trim()) || anyDate.test(name.trim());
}
