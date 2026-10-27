/**
 * Version of the .hnote file format and migrations between versions.
 *
 * v1 – the oldest notes: { strokes } or { pages } without a "v" field.
 * v2 – { v: 2, pages, defaults? }; points stored as [x, y] or [x, y, pressure].
 * v3 – like v2 + a permanent note id, optional item fields g (group) and lock,
 *      and image paths relative to the note's hidden folder: "@/attachments/abc.png" means the file
 *      ".<note name>.hnote-data/attachments/abc.png" next to the note (see dataFolder.ts).
 *
 * v4 – like v3 + optional page fields: w, h (page size; missing = A4 portrait 800×1131), endless (the page
 *      grows downwards), title (page title for the table of contents) and defaults.format (format of new pages).
 *      A note without these fields is still saved as v3 – an older plugin opens it normally.
 *
 * Each migration converts data from version n to n+1, so an old note goes through the whole chain.
 * A note saved by a NEWER plugin version is opened read-only so it doesn't get damaged.
 */
export const NOTE_FORMAT_VERSION = 4;

/** Version stored in the data (1 when there is no "v" field). */
export function detectVersion(raw: unknown): number {
    const v = (raw as { v?: unknown } | null)?.v;
    return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1;
}

type Migration = (d: any) => any;

const MIGRATIONS: Record<number, Migration> = {
    // v1 -> v2: a single stroke list becomes the first page.
    1: (d) => {
        if (d && Array.isArray(d.strokes) && !Array.isArray(d.pages)) return { pages: [{ strokes: d.strokes }] };
        return d ?? { pages: [] };
    },
    // v2 -> v3: the new fields are optional; normalizeNote assigns the note id on load.
    2: (d) => d,
    // v3 -> v4: only new optional fields.
    3: (d) => d,
};

export interface MigrationResult {
    /** Data in the current format (ready for normalization). */
    data: any;
    /** Version the note was loaded from. */
    from: number;
    /** The note comes from a newer plugin version – we open it read-only. */
    tooNew: boolean;
}

export function migrateNote(raw: unknown): MigrationResult {
    const from = detectVersion(raw);
    if (from > NOTE_FORMAT_VERSION) return { data: raw, from, tooNew: true };
    let d: any = raw;
    for (let v = from; v < NOTE_FORMAT_VERSION; v++) {
        const m = MIGRATIONS[v];
        if (m) d = m(d);
    }
    return { data: d, from, tooNew: false };
}
