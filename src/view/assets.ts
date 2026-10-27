import { defineMixin } from './mixin';
import { Notice, TFile, TFolder } from 'obsidian';
import { IMAGE_MAX_SIDE } from '../constants';
import { ImageItem, PageData } from '../types';
import { mimeFromPath, extFromMime, canvasToBlob, newId } from '../utils';
import { VaultAdapter, DATA_SUFFIX, LOCAL_PREFIX, dataDirFor, resolveRef, isLocalRef, historyAttachPath, ensureDir, writeDataMeta, readDataMeta, copyLocalRef } from '../dataFolder';

/** Image and attachment files of the note (hidden data folder, image URLs). */
export const assetsMixin = defineMixin({
    // --- IMAGE FILES IN THE VAULT ---
    // Images go to the attachment folder configured in Obsidian, into a subfolder named after the note.
    // Attachment folder per Obsidian settings for a note at the given path (no side effects); null = cannot be determined.
    attachmentBaseDir(notePath: string): string | null {
        const cfg = (this.app.vault as any).getConfig?.('attachmentFolderPath');
        if (typeof cfg !== 'string') return null;
        const noteDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
        const join = (a: string, b: string) => a && b ? `${a}/${b}` : (a || b);
        const p = cfg.trim();
        if (p === '' || p === '/') return '';
        if (p === '.' || p === './') return noteDir;
        if (p.startsWith('./')) return join(noteDir, p.slice(2).replace(/^\/+|\/+$/g, ''));
        return p.replace(/^\/+|\/+$/g, '');
    },

    adapterA(): VaultAdapter { return this.app.vault.adapter as VaultAdapter; },

    // By default images go to the hidden data folder next to the note (.<name>.hnote-data/attachments)
    // and are stored in the note as a relative path "@/attachments/…". Optionally: Obsidian's attachment folder.
    async getAssetDir(): Promise<string> {
        const note = this.file;
        const name = note?.basename ?? 'note';
        let attDir: string | null = note ? this.attachmentBaseDir(note.path) : null;
        if (attDir === null) {
            // Fallback: Obsidian's official attachment path query
            attDir = '';
            try {
                const fm: any = this.app.fileManager;
                if (note && typeof fm.getAvailablePathForAttachment === 'function') {
                    const probe: string = await fm.getAvailablePathForAttachment('handwriting-probe.png', note.path);
                    const i = probe.lastIndexOf('/');
                    attDir = i >= 0 ? probe.slice(0, i) : '';
                } else {
                    attDir = note?.parent?.path ?? '';
                }
            } catch (e) {
                attDir = note?.parent?.path ?? '';
            }
        }
        if (attDir === '/') attDir = '';
        return `${attDir ? attDir + '/' : ''}${name}`;
    },

    // After renaming / moving a note, moves its image folder along and fixes the stored paths,
    // so old paths don't point to a missing folder (and new images don't land somewhere else).
    async onNoteRenamed(oldPath: string) {
        const note = this.file;
        if (!note) return;
        const oldBase = this.attachmentBaseDir(oldPath);
        const newBase = this.attachmentBaseDir(note.path);
        if (oldBase === null || newBase === null) return;
        const oldName = oldPath.slice(oldPath.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
        const oldDir = oldBase ? `${oldBase}/${oldName}` : oldName;
        const newDir = newBase ? `${newBase}/${note.basename}` : note.basename;
        if (oldDir === newDir) return;
        // Another note with the same name may share this folder – then we leave it alone.
        if (this.app.vault.getFiles().some(f => f.extension === 'hnote' && f !== note && f.basename === oldName)) return;
        const folder = this.app.vault.getAbstractFileByPath(oldDir);
        if (!(folder instanceof TFolder) || this.app.vault.getAbstractFileByPath(newDir)) return;
        try {
            const parent = newDir.includes('/') ? newDir.slice(0, newDir.lastIndexOf('/')) : '';
            if (parent) await this.ensureFolder(parent);
            await this.app.fileManager.renameFile(folder, newDir);
        } catch (e) {
            console.error('Handwriting: could not move the attachments folder', e);
            return;
        }
        const fix = (p?: string) => (p && p.startsWith(oldDir + '/')) ? newDir + p.slice(oldDir.length) : p;
        for (const page of this.noteData.pages) {
            page.bgPath = fix(page.bgPath);
            for (const im of page.images ?? []) im.path = fix(im.path);
        }
        this.assetUrls.forEach(url => URL.revokeObjectURL(url));
        this.assetUrls.clear();
        this.requestSave();
    },

    /**
     * Moves this note's images and PDF pages (saved earlier in a regular folder) into its hidden data folder.
     * The originals go to the trash only when no other note uses them.
     */
    async moveAttachmentsToHidden() {
        if (!this.canEdit() || !this.file) return;
        const notePath = this.file.path;
        const old = new Set<string>();
        for (const p of this.noteData.pages) {
            if (p.bgPath && !isLocalRef(p.bgPath)) old.add(p.bgPath);
            for (const im of p.images ?? []) if (im.path && !isLocalRef(im.path)) old.add(im.path);
        }
        if (old.size === 0) { new Notice('All images of this note are already in its hidden folder.'); return; }
        const notice = new Notice('Moving images…', 0);
        await this.snapshotNow('manual');
        const a = this.adapterA();
        const dir = `${dataDirFor(notePath)}/attachments`;
        await ensureDir(a, dir);
        const map = new Map<string, string>();
        for (const p of old) {
            const f = this.app.vault.getAbstractFileByPath(p);
            if (!(f instanceof TFile)) continue;
            let name = f.name;
            if (await a.exists(`${dir}/${name}`)) name = `${newId()}.${f.extension}`;
            await a.writeBinary(`${dir}/${name}`, await this.app.vault.readBinary(f));
            map.set(p, `${LOCAL_PREFIX}attachments/${name}`);
        }
        for (const p of this.noteData.pages) {
            if (p.bgPath && map.has(p.bgPath)) p.bgPath = map.get(p.bgPath);
            for (const im of p.images ?? []) if (im.path && map.has(im.path)) im.path = map.get(im.path);
        }
        await writeDataMeta(a, notePath, this.noteData.id);
        this.requestSave();
        await this.save();
        // Originals to the trash – only those no other note uses.
        const others = this.app.vault.getFiles().filter(f => f.extension === 'hnote' && f !== this.file);
        const texts = await Promise.all(others.map(f => this.app.vault.cachedRead(f).catch(() => '')));
        let trashed = 0;
        const parents = new Set<TFolder>();
        for (const p of map.keys()) {
            if (texts.some(t => t.includes(JSON.stringify(p).slice(1, -1)))) continue;
            const f = this.app.vault.getAbstractFileByPath(p);
            if (!(f instanceof TFile)) continue;
            if (f.parent) parents.add(f.parent);
            try { await this.app.vault.trash(f, true); trashed++; } catch (e) { /* stays */ }
        }
        for (const folder of parents) {
            if (folder.children.length === 0 && folder.path !== '/') { try { await this.app.vault.trash(folder, true); } catch (e) { /* stays */ } }
        }
        notice.hide();
        new Notice(`Moved ${map.size} file${map.size === 1 ? '' : 's'} to the note's hidden folder${trashed < map.size ? ` (${map.size - trashed} original${map.size - trashed === 1 ? ' is' : 's are'} still used by other notes and stayed in place)` : ''}.`, 8000);
    },

    /**
     * A note copied with "Make a copy" doesn't have its own data folder yet. We look next to it for a folder
     * with the same note id and copy the attachments from it (not the history – the copy starts its own).
     */
    async repairDataFolder() {
        const file = this.file;
        if (!file || this.readOnly) return;
        const refs = new Set<string>();
        for (const p of this.noteData.pages) {
            if (isLocalRef(p.bgPath)) refs.add(p.bgPath);
            for (const im of p.images ?? []) if (isLocalRef(im.path)) refs.add(im.path);
        }
        if (refs.size === 0) return;
        const a = this.adapterA();
        const own = dataDirFor(file.path);
        if (await a.exists(own)) return;
        const parent = file.parent?.path && file.parent.path !== '/' ? file.parent.path : '';
        let listing: { folders: string[] };
        try { listing = await a.list(parent || '/'); } catch (e) { return; }
        for (const dir of listing.folders) {
            const name = dir.slice(dir.lastIndexOf('/') + 1);
            if (!name.startsWith('.') || !name.endsWith(DATA_SUFFIX)) continue;
            const meta = await readDataMeta(a, dir);
            if (!meta?.id || meta.id !== this.noteData.id) continue;
            const srcNote = `${parent ? parent + '/' : ''}${name.slice(1, -DATA_SUFFIX.length)}.hnote`;
            if (srcNote === file.path) continue;
            for (const ref of refs) { try { await copyLocalRef(a, srcNote, file.path, ref); } catch (e) { /* missing file */ } }
            // The copy gets its own id (so the next copy doesn't confuse the source).
            this.noteData.id = newId();
            await writeDataMeta(a, file.path, this.noteData.id);
            this.requestSave();
            this.assetUrls.forEach(url => URL.revokeObjectURL(url));
            this.assetUrls.clear();
            this.pageViews.forEach((v, i) => { v.imgEls.forEach(el => { el.removeAttribute('src'); delete el.dataset.src; }); if (v.active) { this.redrawPage(i, false); void this.loadBg(i); } });
            return;
        }
    },

    async ensureFolder(path: string) {
        let cur = '';
        for (const part of path.split('/')) {
            if (!part) continue;
            cur = cur ? `${cur}/${part}` : part;
            if (!this.app.vault.getAbstractFileByPath(cur)) {
                try { await this.app.vault.createFolder(cur); } catch (e) { /* may have been created in parallel */ }
            }
        }
    },

    /** Saves an image file and returns the path to store in the note ("@/attachments/…" or a vault path). */
    async saveAsset(data: ArrayBuffer, ext: string): Promise<string | null> {
        try {
            const name = `${newId()}.${ext}`;
            if (this.plugin.settings.attachmentLocation === 'hidden' && this.file) {
                const a = this.adapterA();
                const dir = `${dataDirFor(this.file.path)}/attachments`;
                await ensureDir(a, dir);
                await a.writeBinary(`${dir}/${name}`, data);
                await writeDataMeta(a, this.file.path, this.noteData.id);
                return `${LOCAL_PREFIX}attachments/${name}`;
            }
            const dir = await this.getAssetDir();
            await this.ensureFolder(dir);
            const path = `${dir}/${name}`;
            await this.app.vault.createBinary(path, data);
            return path;
        } catch (e) {
            console.error('Handwriting: could not save asset', e);
            return null;
        }
    },

    /** Image URL to display. The cache is keyed by the stored path, so it survives renaming the note. */
    async getAssetUrl(ref: string): Promise<string | null> {
        const cached = this.assetUrls.get(ref);
        if (cached) return cached;
        let pending = this.assetLoading.get(ref);
        if (!pending) {
            pending = (async () => {
                try {
                    const path = this.file ? resolveRef(this.file.path, ref) : ref;
                    const f = this.app.vault.getAbstractFileByPath(path);
                    const alt = this.file ? historyAttachPath(this.file.path, ref) : null;
                    let buf: ArrayBuffer;
                    if (f instanceof TFile) buf = await this.app.vault.readBinary(f);
                    else if (await this.app.vault.adapter.exists(path)) buf = await this.app.vault.adapter.readBinary(path);   // hidden folder
                    else if (alt && await this.app.vault.adapter.exists(alt)) buf = await this.app.vault.adapter.readBinary(alt);   // set-aside image (undone removal, older version)
                    else return null;
                    const url = URL.createObjectURL(new Blob([buf], { type: mimeFromPath(path) }));
                    this.assetUrls.set(ref, url);
                    return url;
                } catch (e) {
                    return null;
                }
            })().then(url => { this.assetLoading.delete(ref); return url; });
            this.assetLoading.set(ref, pending);
        }
        return pending;
    },

    async getPageBgUrl(page: PageData): Promise<string | null> {
        if (page.bgPath) return this.getAssetUrl(page.bgPath);
        return page.bgImage ?? null;
    },

    async getImageUrl(img: ImageItem): Promise<string | null> {
        if (img.path) return this.getAssetUrl(img.path);
        return img.data ?? null;
    },

    // Scales down images that are too large; returns bytes ready to save.
    async prepareImage(blob: Blob): Promise<{ data: ArrayBuffer; ext: string; w: number; h: number; type: string } | null> {
        try {
            const bmp = await createImageBitmap(blob);
            const w = bmp.width, h = bmp.height;
            const maxSide = Math.max(w, h);
            if (maxSide <= IMAGE_MAX_SIDE) {
                bmp.close();
                const type = blob.type || 'image/png';
                return { data: await blob.arrayBuffer(), ext: extFromMime(type), w, h, type };
            }
            const k = IMAGE_MAX_SIDE / maxSide;
            const cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(h * k));
            const canvas = document.createElement('canvas');
            canvas.width = cw;
            canvas.height = ch;
            canvas.getContext('2d')!.drawImage(bmp, 0, 0, cw, ch);
            bmp.close();
            const keepAlpha = blob.type === 'image/png' || blob.type === 'image/webp' || blob.type === 'image/gif';
            const type = keepAlpha ? 'image/png' : 'image/jpeg';
            const out = await canvasToBlob(canvas, type, 0.92);
            canvas.width = 0;
            if (!out) return null;
            return { data: await out.arrayBuffer(), ext: extFromMime(type), w: cw, h: ch, type };
        } catch (e) {
            return null;
        }
    },
});
export type AssetsMethods = typeof assetsMixin;
