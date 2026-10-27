/**
 * Hidden data folder of a note – lives next to the note and contains everything the note needs:
 *
 *   Studies/Physics/Lecture 1.hnote
 *   Studies/Physics/.Lecture 1.hnote-data/
 *       attachments/   images, screenshots, pages of imported PDFs
 *       history/       note versions (*.hnote.gz)
 *       meta.json      { "id": "<note id>", "note": "Lecture 1.hnote" }
 *
 * In the note file, files from this folder are stored as relative paths with the "@/" prefix, e.g. "@/attachments/abc.png".
 * This makes the note + its folder self-contained (they can be moved or processed outside Obsidian),
 * and renaming a note only requires renaming the folder – the paths in the file don't change.
 */
export const DATA_SUFFIX = '.hnote-data';
export const LOCAL_PREFIX = '@/';

/** Minimal interface of Obsidian's vault adapter (also works on mobile and with hidden folders). */
export interface VaultAdapter {
    exists(path: string): Promise<boolean>;
    mkdir(path: string): Promise<void>;
    list(path: string): Promise<{ files: string[]; folders: string[] }>;
    read(path: string): Promise<string>;
    write(path: string, data: string): Promise<void>;
    readBinary(path: string): Promise<ArrayBuffer>;
    writeBinary(path: string, data: ArrayBuffer): Promise<void>;
    remove(path: string): Promise<void>;
    rename(from: string, to: string): Promise<void>;
    stat(path: string): Promise<{ size: number; mtime: number } | null>;
    trashSystem?(path: string): Promise<boolean>;
    trashLocal?(path: string): Promise<void>;
}

function splitNotePath(notePath: string): { dir: string; base: string } {
    const i = notePath.lastIndexOf('/');
    const dir = i >= 0 ? notePath.slice(0, i) : '';
    const name = i >= 0 ? notePath.slice(i + 1) : notePath;
    return { dir, base: name.replace(/\.hnote$/i, '') };
}

/** Path of the hidden data folder for the note at the given path. */
export function dataDirFor(notePath: string): string {
    const { dir, base } = splitNotePath(notePath);
    return `${dir ? dir + '/' : ''}.${base}${DATA_SUFFIX}`;
}

export const isLocalRef = (p: string | undefined): p is string => !!p && p.startsWith(LOCAL_PREFIX);

/**
 * Files the note no longer uses but older versions (history) or undo still need
 * live in history/attachments/. The attachments/ folder therefore holds exactly the images present in the note.
 */
export const HISTORY_ATTACH = 'history/attachments';

/** Fallback path of the file "@/attachments/x" in history/attachments/ (or null for other paths). */
export function historyAttachPath(notePath: string, ref: string): string | null {
    if (!isLocalRef(ref) || !ref.startsWith(`${LOCAL_PREFIX}attachments/`)) return null;
    return `${dataDirFor(notePath)}/${HISTORY_ATTACH}/${ref.slice(`${LOCAL_PREFIX}attachments/`.length)}`;
}

/** Vault path for a path stored in the note ("@/…" = relative to the note's data folder). */
export function resolveRef(notePath: string, ref: string): string {
    return isLocalRef(ref) ? `${dataDirFor(notePath)}/${ref.slice(LOCAL_PREFIX.length)}` : ref;
}

export async function ensureDir(a: VaultAdapter, dir: string) {
    let cur = '';
    for (const part of dir.split('/')) {
        if (!part) continue;
        cur = cur ? `${cur}/${part}` : part;
        if (!(await a.exists(cur))) {
            try { await a.mkdir(cur); } catch { /* may have been created in parallel */ }
        }
    }
}

/** Writes meta.json; without an id it keeps the existing one (e.g. after renaming the note). */
export async function writeDataMeta(a: VaultAdapter, notePath: string, id: string | undefined) {
    const dir = dataDirFor(notePath);
    try {
        if (id === undefined) id = (await readDataMeta(a, dir))?.id;
        await ensureDir(a, dir);
        const name = notePath.slice(notePath.lastIndexOf('/') + 1);
        await a.write(`${dir}/meta.json`, JSON.stringify({ id: id ?? null, note: name, format: 3 }, null, 2));
    } catch { /* only auxiliary information */ }
}

export async function readDataMeta(a: VaultAdapter, dir: string): Promise<{ id?: string; note?: string } | null> {
    try {
        const p = `${dir}/meta.json`;
        if (!(await a.exists(p))) return null;
        return JSON.parse(await a.read(p));
    } catch {
        return null;
    }
}

/**
 * Copies an "@/…" file from one note's folder to another's (e.g. when pasting images between notes).
 * Returns the "@/…" path in the target note.
 */
export async function copyLocalRef(a: VaultAdapter, fromNote: string, toNote: string, ref: string, newName?: () => string): Promise<string> {
    if (!isLocalRef(ref)) return ref;
    const src = resolveRef(fromNote, ref);
    let rel = ref.slice(LOCAL_PREFIX.length);
    let dst = `${dataDirFor(toNote)}/${rel}`;
    if (src === dst) return ref;
    if (await a.exists(dst)) {
        const ext = rel.slice(rel.lastIndexOf('.'));
        rel = `${rel.slice(0, rel.lastIndexOf('/') + 1)}${newName ? newName() : Date.now().toString(36)}${ext}`;
        dst = `${dataDirFor(toNote)}/${rel}`;
    }
    await ensureDir(a, dst.slice(0, dst.lastIndexOf('/')));
    // The file may have been moved to history/attachments (image removed from the note).
    const alt = historyAttachPath(fromNote, ref);
    const from = (await a.exists(src)) || !alt ? src : alt;
    await a.writeBinary(dst, await a.readBinary(from));
    return LOCAL_PREFIX + rel;
}

/** Moves the data folder along with its note (rename / move). */
export async function moveDataFolder(a: VaultAdapter, oldNote: string, newNote: string): Promise<boolean> {
    const from = dataDirFor(oldNote), to = dataDirFor(newNote);
    if (from === to || !(await a.exists(from)) || (await a.exists(to))) return false;
    const parent = to.slice(0, Math.max(0, to.lastIndexOf('/')));
    if (parent) await ensureDir(a, parent);
    await a.rename(from, to);
    return true;
}

/** When a note is deleted, its data folder goes to the trash (system trash or .trash in the vault). */
export async function trashDataFolder(a: VaultAdapter, notePath: string): Promise<void> {
    const dir = dataDirFor(notePath);
    if (!(await a.exists(dir))) return;
    if (a.trashSystem && (await a.trashSystem(dir))) return;
    if (a.trashLocal) await a.trashLocal(dir);
}
