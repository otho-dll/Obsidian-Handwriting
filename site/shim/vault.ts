// In-memory vault: file tree (TFile / TFolder), Vault API, DataAdapter API and change events.
// Like in Obsidian, paths with a hidden segment (".something") are not part of the file tree – they are only
// reachable through the adapter (the plugin keeps attachments and history in ".<note>.hnote-data/").
import { Events } from './component';
import { StoredEntry, loadAllFiles, saveFiles } from './storage';

type Data = string | ArrayBuffer;
interface Entry { folder: boolean; data: Data; mtime: number; ctime: number; }

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
const parentOf = (p: string) => { const i = p.lastIndexOf('/'); return i >= 0 ? p.slice(0, i) : ''; };
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const isHidden = (p: string) => p.split('/').some(s => s.startsWith('.'));
const enc = new TextEncoder();
const dec = new TextDecoder();
const toText = (d: Data) => typeof d === 'string' ? d : dec.decode(d);
const toBuf = (d: Data): ArrayBuffer => typeof d === 'string' ? enc.encode(d).buffer : d.slice(0);

export abstract class TAbstractFile {
    vault!: Vault;
    path = '';
    name = '';
    parent: TFolder | null = null;
}

export class TFile extends TAbstractFile {
    basename = '';
    extension = '';
    stat = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
    children: TAbstractFile[] = [];
    isRoot() { return this.path === '/'; }
}

function setPath(f: TAbstractFile, path: string) {
    f.path = path || '/';
    f.name = path ? nameOf(path) : '';
    if (f instanceof TFile) {
        const dot = f.name.lastIndexOf('.');
        f.basename = dot > 0 ? f.name.slice(0, dot) : f.name;
        f.extension = dot > 0 ? f.name.slice(dot + 1) : '';
    }
}

export class DataAdapter {
    constructor(private vault: Vault) { }
    getName() { return 'Demo vault'; }
    async exists(path: string) { return this.vault._entries.has(norm(path)) || norm(path) === ''; }
    async stat(path: string) {
        const e = this.vault._entries.get(norm(path));
        if (!e) return null;
        return { type: e.folder ? 'folder' : 'file', ctime: e.ctime, mtime: e.mtime, size: e.folder ? 0 : (typeof e.data === 'string' ? enc.encode(e.data).length : e.data.byteLength) };
    }
    async list(path: string) {
        const dir = norm(path);
        const files: string[] = [], folders: string[] = [];
        for (const [p, e] of this.vault._entries) {
            if (parentOf(p) !== dir || p === dir) continue;
            (e.folder ? folders : files).push(p);
        }
        return { files, folders };
    }
    async mkdir(path: string) { this.vault._mkdirs(norm(path)); }
    async read(path: string) { return toText(this.vault._get(norm(path))); }
    async readBinary(path: string) { return toBuf(this.vault._get(norm(path))); }
    async write(path: string, data: string) { this.vault._write(norm(path), data); }
    async writeBinary(path: string, data: ArrayBuffer) { this.vault._write(norm(path), data.slice(0)); }
    async append(path: string, data: string) {
        const p = norm(path);
        const old = this.vault._entries.has(p) ? toText(this.vault._get(p)) : '';
        this.vault._write(p, old + data);
    }
    async remove(path: string) {
        const p = norm(path);
        const e = this.vault._entries.get(p);
        if (!e || e.folder) throw new Error(`No such file: ${path}`);
        this.vault._delete(p);
    }
    async rmdir(path: string, recursive: boolean) {
        const p = norm(path);
        if (!recursive && [...this.vault._entries.keys()].some(k => k.startsWith(p + '/'))) throw new Error('Folder not empty');
        this.vault._delete(p);
    }
    async rename(from: string, to: string) { this.vault._rename(norm(from), norm(to)); }
    async copy(from: string, to: string) { this.vault._write(norm(to), toBuf(this.vault._get(norm(from)))); }
    async trashSystem(_path: string) { return false; }
    async trashLocal(path: string) { this.vault._delete(norm(path)); }
    getResourcePath(path: string) { return this.vault._resourceUrl(norm(path)); }
}

export class Vault extends Events {
    _entries = new Map<string, Entry>();
    private files = new Map<string, TAbstractFile>();
    private root: TFolder;
    adapter: DataAdapter;
    configDir = '.demo-config';
    private dirty = new Set<string>();
    private deleted = new Set<string>();
    private flushTimer: number | null = null;
    private urls = new Map<string, { url: string; mtime: number }>();
    /** False while restoring / seeding (no events, no persistence). */
    persist = true;

    constructor() {
        super();
        this.adapter = new DataAdapter(this);
        this.root = new TFolder();
        this.root.vault = this;
        setPath(this.root, '');
        this.files.set('', this.root);
    }

    getName() { return 'Demo vault'; }
    getRoot() { return this.root; }

    /** Restores the vault from IndexedDB. Returns false when there was nothing stored. */
    async restore(): Promise<boolean> {
        const all = await loadAllFiles();
        if (!all || all.length === 0) return false;
        all.sort((a, b) => a.path.length - b.path.length);
        for (const e of all) {
            const p = norm(e.path);
            if (!p) continue;
            this._entries.set(p, { folder: !!e.folder, data: e.data ?? '', mtime: e.mtime, ctime: e.ctime });
            this.indexPath(p);
        }
        return true;
    }

    /** Clears everything (Reset demo). */
    reset() {
        this._entries.clear();
        this.files.clear();
        this.root.children = [];
        this.files.set('', this.root);
        this.dirty.clear();
        this.deleted.clear();
        this.urls.forEach(u => URL.revokeObjectURL(u.url));
        this.urls.clear();
    }

    // ---- tree index ----
    private indexPath(p: string) {
        if (!p || isHidden(p) || this.files.has(p)) return;
        const e = this._entries.get(p);
        if (!e) return;
        const parentPath = parentOf(p);
        if (parentPath && !this.files.has(parentPath)) this.indexPath(parentPath);
        const pf = this.files.get(parentPath);
        const parent = pf instanceof TFolder ? pf : this.root;
        const f: TAbstractFile = e.folder ? new TFolder() : new TFile();
        f.vault = this;
        setPath(f, p);
        f.parent = parent;
        parent.children.push(f);
        this.files.set(p, f);
        this.updateStat(f);
    }
    private unindex(p: string) {
        const f = this.files.get(p);
        if (!f || !p) return;
        if (f instanceof TFolder) [...f.children].forEach(c => this.unindex(c.path));
        if (f.parent) f.parent.children = f.parent.children.filter(c => c !== f);
        this.files.delete(p);
    }
    private updateStat(f: TAbstractFile) {
        if (!(f instanceof TFile)) return;
        const e = this._entries.get(f.path);
        if (!e) return;
        f.stat = { ctime: e.ctime, mtime: e.mtime, size: typeof e.data === 'string' ? e.data.length : e.data.byteLength };
    }

    // ---- low level (used by the adapter and the vault API) ----
    _get(p: string): Data {
        const e = this._entries.get(p);
        if (!e || e.folder) throw new Error(`File not found: ${p}`);
        return e.data;
    }
    _mkdirs(p: string) {
        if (!p) return;
        const parts = p.split('/');
        let cur = '';
        for (const part of parts) {
            cur = cur ? `${cur}/${part}` : part;
            if (!this._entries.has(cur)) {
                const now = Date.now();
                this._entries.set(cur, { folder: true, data: '', mtime: now, ctime: now });
                this.markDirty(cur);
                this.indexPath(cur);
                const f = this.files.get(cur);
                if (f && this.persist) this.trigger('create', f);
            }
        }
    }
    _write(p: string, data: Data): TAbstractFile | null {
        this._mkdirs(parentOf(p));
        const now = Date.now();
        const old = this._entries.get(p);
        if (old?.folder) throw new Error(`A folder exists at ${p}`);
        this._entries.set(p, { folder: false, data, mtime: now, ctime: old?.ctime ?? now });
        this.markDirty(p);
        const isNew = !this.files.has(p);
        this.indexPath(p);
        const f = this.files.get(p) ?? null;
        if (f) {
            this.updateStat(f);
            if (this.persist) this.trigger(isNew ? 'create' : 'modify', f);
        }
        return f;
    }
    _delete(p: string) {
        const f = this.files.get(p);
        for (const k of [...this._entries.keys()]) {
            if (k === p || k.startsWith(p + '/')) {
                this._entries.delete(k);
                this.markDeleted(k);
            }
        }
        if (f) { this.unindex(p); this.trigger('delete', f); }
    }
    _rename(from: string, to: string) {
        if (!this._entries.has(from)) throw new Error(`Not found: ${from}`);
        if (this._entries.has(to)) throw new Error(`Already exists: ${to}`);
        this._mkdirs(parentOf(to));
        const moved: [string, Entry][] = [];
        for (const [k, e] of this._entries) if (k === from || k.startsWith(from + '/')) moved.push([k, e]);
        const f = this.files.get(from);
        for (const [k] of moved) { this._entries.delete(k); this.markDeleted(k); }
        for (const [k, e] of moved) { const nk = to + k.slice(from.length); this._entries.set(nk, e); this.markDirty(nk); }
        if (f) this.unindex(from);
        // Re-index the moved paths (keeps TFile objects only for the renamed item itself, as Obsidian does).
        if (f && !isHidden(to)) {
            setPath(f, to);
            const parentPath = parentOf(to);
            if (parentPath && !this.files.has(parentPath)) this.indexPath(parentPath);
            const pf = this.files.get(parentPath);
            const parent = pf instanceof TFolder ? pf : this.root;
            f.parent = parent;
            parent.children.push(f);
            this.files.set(to, f);
            if (f instanceof TFolder) {
                f.children = [];
                for (const [k] of moved) { const nk = to + k.slice(from.length); if (nk !== to) this.indexPath(nk); }
            }
            this.trigger('rename', f, from);
        } else if (!f) {
            for (const [k] of moved) this.indexPath(to + k.slice(from.length));
        }
    }
    _resourceUrl(p: string): string {
        const e = this._entries.get(p);
        if (!e || e.folder) return '';
        const hit = this.urls.get(p);
        if (hit && hit.mtime === e.mtime) return hit.url;
        if (hit) URL.revokeObjectURL(hit.url);
        const ext = p.slice(p.lastIndexOf('.') + 1).toLowerCase();
        const type = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf' } as Record<string, string>)[ext] ?? 'application/octet-stream';
        const url = URL.createObjectURL(new Blob([e.data], { type }));
        this.urls.set(p, { url, mtime: e.mtime });
        return url;
    }

    // ---- persistence ----
    private markDirty(p: string) { this.deleted.delete(p); this.dirty.add(p); this.scheduleFlush(); }
    private markDeleted(p: string) { this.dirty.delete(p); this.deleted.add(p); this.scheduleFlush(); }
    /** Stops all persistence (the demo was reset and this vault is discarded). */
    dispose() {
        this.persist = false;
        this.disposed = true;
        if (this.flushTimer !== null) { window.clearTimeout(this.flushTimer); this.flushTimer = null; }
    }
    private disposed = false;
    private scheduleFlush() {
        if (!this.persist || this.disposed || this.flushTimer !== null) return;
        this.flushTimer = window.setTimeout(() => { this.flushTimer = null; void this.flush(); }, 400);
    }
    async flush() {
        if (this.flushTimer !== null) { window.clearTimeout(this.flushTimer); this.flushTimer = null; }
        if (this.disposed) return;
        const put: StoredEntry[] = [];
        for (const p of this.dirty) {
            const e = this._entries.get(p);
            if (e) put.push({ path: p, folder: e.folder || undefined, data: e.folder ? undefined : e.data, mtime: e.mtime, ctime: e.ctime });
        }
        const del = [...this.deleted];
        this.dirty.clear();
        this.deleted.clear();
        if (put.length || del.length) await saveFiles(put, del);
    }

    // ---- Vault API ----
    getAbstractFileByPath(path: string): TAbstractFile | null { return this.files.get(norm(path)) ?? null; }
    getFileByPath(path: string): TFile | null { const f = this.getAbstractFileByPath(path); return f instanceof TFile ? f : null; }
    getFolderByPath(path: string): TFolder | null { const f = this.getAbstractFileByPath(path); return f instanceof TFolder ? f : null; }
    getAllLoadedFiles(): TAbstractFile[] { return [...this.files.values()]; }
    getFiles(): TFile[] { return [...this.files.values()].filter((f): f is TFile => f instanceof TFile); }
    getMarkdownFiles(): TFile[] { return this.getFiles().filter(f => f.extension === 'md'); }

    async create(path: string, data: string): Promise<TFile> {
        const p = norm(path);
        if (this._entries.has(p)) throw new Error('File already exists.');
        return this.fileAt(this._write(p, data));
    }
    async createBinary(path: string, data: ArrayBuffer): Promise<TFile> {
        const p = norm(path);
        if (this._entries.has(p)) throw new Error('File already exists.');
        return this.fileAt(this._write(p, data.slice(0)));
    }
    async createFolder(path: string): Promise<TFolder> {
        const p = norm(path);
        if (this._entries.has(p)) throw new Error('Folder already exists.');
        this._mkdirs(p);
        const f = this.files.get(p);
        if (!(f instanceof TFolder)) throw new Error('Folder could not be created.');
        return f;
    }
    /** The file just written (an error if the path is not a file). */
    private fileAt(f: unknown): TFile {
        if (!(f instanceof TFile)) throw new Error('File could not be created.');
        return f;
    }
    async read(file: TFile) { return toText(this._get(file.path)); }
    async cachedRead(file: TFile) { return this.read(file); }
    async readBinary(file: TFile) { return toBuf(this._get(file.path)); }
    async modify(file: TFile, data: string) { this._write(file.path, data); }
    async modifyBinary(file: TFile, data: ArrayBuffer) { this._write(file.path, data.slice(0)); }
    async process(file: TFile, fn: (d: string) => string) { const t = fn(await this.read(file)); await this.modify(file, t); return t; }
    async delete(file: TAbstractFile) { this._delete(file.path); }
    async trash(file: TAbstractFile, _system: boolean) { this._delete(file.path); }
    async rename(file: TAbstractFile, newPath: string) { this._rename(file.path, norm(newPath)); }
    async copy(file: TFile, newPath: string) { return this.createBinary(newPath, toBuf(this._get(file.path))); }
    getResourcePath(file: TFile) { return this._resourceUrl(file.path); }
}
