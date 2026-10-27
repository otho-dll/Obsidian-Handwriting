/**
 * Note version history: snapshots in the hidden data folder next to the note.
 *
 *   .<note name>.hnote-data/history/20261015-084712_ab12cd34_auto.hnote.gz
 *
 * File name: date and time, content hash (to skip identical snapshots) and the save reason.
 * Snapshots are gzip-compressed (when the device supports it), and images are not copied – a snapshot points
 * to the same files in the attachments folder as the note.
 */
import { VaultAdapter, dataDirFor, ensureDir } from './dataFolder';

export type { VaultAdapter };

/** History folder for the note at the given path. */
export function historyDirFor(notePath: string): string { return `${dataDirFor(notePath)}/history`; }

export type SnapshotReason = 'auto' | 'open' | 'close' | 'manual' | 'restore' | 'delete';

export interface SnapshotInfo {
    path: string;
    time: number;          // ms since 1970
    hash: string;
    reason: SnapshotReason;
    size: number;          // bytes (0 when unknown)
}

export const REASON_LABEL: Record<SnapshotReason, string> = {
    auto: 'Automatic',
    open: 'Last saved state',
    close: 'When the note was closed',
    manual: 'Saved manually',
    restore: 'Before restoring another version',
    delete: 'Before deleting pages',
};

/** Fast text hash (FNV-1a, 32 bits) – to skip identical snapshots. */
/** Hash of the note CONTENT: without the note id (the same content with another id is the same version). */
export function contentHash(text: string): string {
    return hashText(text.replace(/"id":"[^"]*",?/, ''));
}

export function hashText(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function stamp(t: number): string {
    const d = new Date(t);
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const NAME_RE = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})_([0-9a-f]{8})_([a-z]+)\.hnote(\.gz)?$/;

export function parseSnapshotName(path: string): Omit<SnapshotInfo, 'size'> | null {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const m = NAME_RE.exec(name);
    if (!m) return null;
    const time = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    const reason = (m[8] in REASON_LABEL ? m[8] : 'auto') as SnapshotReason;
    return { path, time, hash: m[7], reason };
}

/** Gzip compression (CompressionStream). When the browser doesn't support it, returns null and we save plain text. */
async function gzip(text: string): Promise<ArrayBuffer | null> {
    const CS = (globalThis as any).CompressionStream;
    if (typeof CS !== 'function') return null;
    try {
        const stream = new Blob([text]).stream().pipeThrough(new CS('gzip'));
        return await new Response(stream).arrayBuffer();
    } catch {
        return null;
    }
}

async function gunzip(buf: ArrayBuffer): Promise<string> {
    const DS = (globalThis as any).DecompressionStream;
    if (typeof DS !== 'function') throw new Error('This device cannot read compressed history files.');
    const stream = new Blob([buf]).stream().pipeThrough(new DS('gzip'));
    return await new Response(stream).text();
}

/** Note snapshots, newest first. */
export async function listSnapshots(a: VaultAdapter, dir: string, withSize = false): Promise<SnapshotInfo[]> {
    if (!(await a.exists(dir))) return [];
    const { files } = await a.list(dir);
    const out: SnapshotInfo[] = [];
    for (const f of files) {
        const info = parseSnapshotName(f);
        if (!info) continue;
        let size = 0;
        if (withSize) { try { size = (await a.stat(f))?.size ?? 0; } catch { /* no data */ } }
        out.push({ ...info, size });
    }
    out.sort((x, y) => y.time - x.time);
    return out;
}

export async function readSnapshot(a: VaultAdapter, path: string): Promise<string> {
    if (path.endsWith('.gz')) return gunzip(await a.readBinary(path));
    return a.read(path);
}

export interface WriteResult { written: boolean; info?: SnapshotInfo; }

/** Snapshot writes of one note run in order (two simultaneous writes can't both pass the duplicate check). */
const queues = new Map<string, Promise<unknown>>();

/**
 * Saves a snapshot unless the same content is already in the history (any version – not just the newest).
 * Exception: "Save version now" only skips a repeat of the newest version.
 */
export function writeSnapshot(a: VaultAdapter, dir: string, text: string, reason: SnapshotReason, time = Date.now()): Promise<WriteResult> {
    const prev = queues.get(dir) ?? Promise.resolve();
    const job = prev.catch(() => undefined).then(() => writeSnapshotNow(a, dir, text, reason, time));
    queues.set(dir, job);
    void job.finally(() => { if (queues.get(dir) === job) queues.delete(dir); });
    return job;
}

async function writeSnapshotNow(a: VaultAdapter, dir: string, text: string, reason: SnapshotReason, time: number): Promise<WriteResult> {
    await ensureDir(a, dir);
    const hash = contentHash(text);
    const existing = await listSnapshots(a, dir);
    if (existing[0]?.hash === hash) return { written: false };
    if (reason !== 'manual' && existing.some(s => s.hash === hash)) return { written: false };
    const base = `${dir}/${stamp(time)}_${hash}_${reason}`;
    const gz = await gzip(text);
    let path: string;
    if (gz) { path = `${base}.hnote.gz`; await a.writeBinary(path, gz); }
    else { path = `${base}.hnote`; await a.write(path, text); }
    return { written: true, info: { path, time, hash, reason, size: gz ? gz.byteLength : text.length } };
}

export interface PruneOptions { keepAllHours: number; keepDays: number; maxBytes: number; }

/**
 * Cleanup: from the last `keepAllHours` hours all snapshots stay, from older days – the newest of each day,
 * those older than `keepDays` days are removed, and finally (when the total exceeds the limit) the oldest are removed.
 * The newest snapshot is never removed.
 */
export async function pruneSnapshots(a: VaultAdapter, dir: string, o: PruneOptions, now = Date.now()): Promise<number> {
    const all = await listSnapshots(a, dir, true);
    if (all.length <= 1) return 0;
    const keep: SnapshotInfo[] = [all[0]];
    const drop: SnapshotInfo[] = [];
    const seenDays = new Set<string>();
    const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
    seenDays.add(dayKey(all[0].time));
    for (const s of all.slice(1)) {
        const age = now - s.time;
        if (age <= o.keepAllHours * 3600e3) { keep.push(s); continue; }
        if (age > o.keepDays * 86400e3) { drop.push(s); continue; }
        const k = dayKey(s.time);
        if (seenDays.has(k)) { drop.push(s); continue; }
        seenDays.add(k);
        keep.push(s);
    }
    let total = keep.reduce((n, s) => n + s.size, 0);
    while (keep.length > 1 && total > o.maxBytes) {
        const s = keep.pop()!;
        total -= s.size;
        drop.push(s);
    }
    for (const s of drop) { try { await a.remove(s.path); } catch { /* the file may already be gone */ } }
    return drop.length;
}
