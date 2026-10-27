import { defineMixin } from './mixin';
import { Notice } from 'obsidian';
import { migrateNote } from '../format';
import { NoteData, PageData } from '../types';
import { contentHash, listSnapshots, readSnapshot, writeSnapshot, pruneSnapshots, historyDirFor, SnapshotInfo, SnapshotReason, VaultAdapter } from '../versionStore';
import { writeDataMeta, copyLocalRef, isLocalRef, dataDirFor, ensureDir, HISTORY_ATTACH } from '../dataFolder';
import { VersionHistoryModal } from '../historyModal';
import { newId } from '../utils';

const PRUNE_EVERY_MS = 3600e3;

/**
 * Note version history.
 * - On the first change in a session the state before editing is saved (dated by the last file save).
 * - While working: a snapshot at most every `historyInterval` minutes, when something changed and nobody is writing.
 * - When the note is closed and before risky operations (deleting pages, restoring a version).
 */
export const versionsMixin = defineMixin({
    adapter(): VaultAdapter { return this.app.vault.adapter as VaultAdapter; },

    historyOn(): boolean { return this.plugin.settings.historyEnabled && !this.readOnly && !!this.file; },

    /** Called after the note content is loaded (setViewData). */
    onNoteLoaded(data: string) {
        this.loadedData = data;
        this.lastSnapAt = Date.now();   // first "while working" snapshot only after a full interval
        this.baseSnapDone = false;
        this.snapDirty = false;
        this.baseCanonical = '';
        this.knownHash = null;
        if (this.snapTimer !== null) { window.clearTimeout(this.snapTimer); this.snapTimer = null; }
    },

    /**
     * Note state right after loading, in the form the plugin writes to the file. All snapshots and comparisons
     * use this form – otherwise the same note saved by an older plugin version (different key order,
     * rounding) looked like "different" content and duplicates appeared in the history.
     */
    captureLoadedState() {
        if (!this.historyOn()) return;
        this.baseCanonical = this.getViewData();
        this.knownHash = contentHash(this.baseCanonical);
    },

    /** Whether the note is empty (only empty pages) – such a version is not worth keeping. */
    isBlankNote(text: string): boolean {
        try {
            const d = JSON.parse(text);
            const pages = Array.isArray(d?.pages) ? d.pages : (Array.isArray(d?.strokes) ? [d] : []);
            return pages.every((p: any) => !(p?.strokes?.length) && !(p?.images?.length) && !p?.bgPath && !p?.bgImage);
        } catch { return false; }
    },

    /**
     * After opening a note: if its content is not in the history yet (changes from a previous session whose end
     * was not saved – e.g. Obsidian was closed), save it dated by the last file change. Content that is already
     * in the history is never saved twice.
     */
    snapshotOnOpen() {
        if (!this.historyOn() || !this.file) return;
        if (!this.baseCanonical) this.captureLoadedState();
        const text = this.baseCanonical;
        if (!text || this.isBlankNote(text)) return;
        const mtime = this.file.stat?.mtime ?? Date.now();
        const path = this.file.path;
        window.setTimeout(() => {
            if (this.file?.path !== path || this.baseSnapDone) return;
            this.baseSnapDone = true;
            void this.snapshotNow('open', text, mtime);
        }, 2500);
    },

    /** Called after every file save (TextFileView.save – also when a note is closed without changes). */
    afterSave() {
        if (!this.readOnly && this.file) this.scheduleAttachSync();
        if (!this.historyOn()) return;
        // Only a real change counts: content different from the last known one (loaded or saved in the history).
        const text = typeof this.data === 'string' && this.data ? this.data : this.getViewData();
        if (this.knownHash !== null && contentHash(text) === this.knownHash) return;
        this.snapDirty = true;
        if (!this.baseSnapDone) {
            // First change in this session: keep the state before editing (unless it is already in the history).
            this.baseSnapDone = true;
            const base = this.baseCanonical;
            const mtime = this.file?.stat?.mtime ?? Date.now();
            if (base && !this.isBlankNote(base)) void this.snapshotNow('open', base, mtime);
        }
        this.scheduleSnapshot();
    },

    scheduleSnapshot() {
        if (this.snapTimer !== null) return;
        const every = this.plugin.settings.historyInterval * 60e3;
        const due = Math.max(3000, this.lastSnapAt + every - Date.now());
        this.snapTimer = window.setTimeout(() => {
            this.snapTimer = null;
            if (!this.snapDirty || !this.historyOn()) return;
            // Don't interrupt writing: snapshot only after a few seconds without activity.
            if (performance.now() - this.lastActivityAt < 4000) { this.scheduleSnapshot(); return; }
            void this.snapshotNow('auto');
        }, due);
    },

    /**
     * Saves a snapshot. The content is taken immediately (synchronously), so calling this right before a change
     * keeps the state from before that change.
     */
    async snapshotNow(reason: SnapshotReason, text?: string, time?: number): Promise<boolean> {
        if (!this.historyOn() || !this.file) return false;
        const data = text ?? this.getViewData();
        // An empty note (e.g. just created) is not saved as a version – there is nothing to restore.
        if ((reason === 'open' || reason === 'auto' || reason === 'close') && this.isBlankNote(data)) return false;
        const notePath = this.file.path;
        if (!text) this.snapDirty = false;
        if (!text) this.knownHash = contentHash(data);   // the current state is now in the history
        try {
            const dir = historyDirFor(notePath);
            const res = await writeSnapshot(this.adapter(), dir, data, reason, time ?? Date.now());
            if (res.written) await writeDataMeta(this.adapter(), notePath, this.noteData.id);
            if (reason !== 'open') this.lastSnapAt = Date.now();
            const last = this.plugin.lastPrune.get(dir) ?? 0;
            if (Date.now() - last > PRUNE_EVERY_MS) {
                this.plugin.lastPrune.set(dir, Date.now());
                const st = this.plugin.settings;
                await pruneSnapshots(this.adapter(), dir, { keepAllHours: 24, keepDays: st.historyKeepDays, maxBytes: st.historyMaxMB * 1024 * 1024 });
                await this.dedupeHistory(notePath);
            }
            return res.written;
        } catch (e) {
            console.error('Handwriting: could not save a version snapshot', e);
            return false;
        }
    },

    /** On close: snapshot if something changed since the last one. */
    async snapshotOnClose(text: string, notePath: string) {
        if (!this.plugin.settings.historyEnabled || this.readOnly || !this.snapDirty || this.isBlankNote(text)) return;
        if (this.knownHash !== null && contentHash(text) === this.knownHash) return;   // nothing changed since the last version
        this.snapDirty = false;
        if (this.snapTimer !== null) { window.clearTimeout(this.snapTimer); this.snapTimer = null; }
        try {
            await writeSnapshot(this.adapter(), historyDirFor(notePath), text, 'close', Date.now());
        } catch (e) {
            console.error('Handwriting: could not save a version snapshot', e);
        }
    },

    /**
     * Attachment housekeeping. attachments/ holds exactly the images used by the note:
     * - a file the note no longer uses is moved to history/attachments/ right away (undo and older
     *   versions still find it – reading checks both places),
     * - a file used again (undo, restored version) moves back to attachments/,
     * - when the note is closed (`final`), files in history/attachments/ that no saved version uses are deleted.
     */
    async syncAttachments(notePath: string, text: string, final: boolean) {
        if (this.attachSyncing) return;
        this.attachSyncing = true;
        const a = this.adapter();
        const base = dataDirFor(notePath);
        const att = `${base}/attachments`, hist = `${base}/${HISTORY_ATTACH}`;
        try {
            const used = new Set<string>();
            const mark = (t: string, into: Set<string>) => { for (const m of t.matchAll(/"@\/attachments\/([^"]+)"/g)) into.add(m[1]); };
            mark(text, used);
            const clip = this.plugin.clip;
            if (clip && clip.from === notePath) mark(JSON.stringify(clip.images), used);
            const list = async (dir: string) => (await a.exists(dir)) ? (await a.list(dir)).files.map(f => f.slice(dir.length + 1)) : [];
            const inAtt = await list(att);
            const inHist = await list(hist);
            // 1. Unused -> history/attachments
            for (const n of inAtt) {
                if (used.has(n)) continue;
                try {
                    if (inHist.includes(n)) await a.remove(`${att}/${n}`);
                    else { await ensureDir(a, hist); await a.rename(`${att}/${n}`, `${hist}/${n}`); inHist.push(n); }
                } catch { /* next time */ }
            }
            // 2. Used again -> attachments
            for (const n of inHist) {
                if (!used.has(n)) continue;
                try {
                    if (inAtt.includes(n)) await a.remove(`${hist}/${n}`);
                    else { await ensureDir(a, att); await a.rename(`${hist}/${n}`, `${att}/${n}`); }
                } catch { /* next time */ }
            }
            if (!final) return;
            // 3. Delete files that can no longer be needed.
            const keep = new Set<string>(used);
            if (this.plugin.settings.historyEnabled) {
                for (const v of await listSnapshots(a, historyDirFor(notePath))) {
                    try { mark(await readSnapshot(a, v.path), keep); } catch { return; }   // unreadable version – delete nothing
                }
            }
            for (const n of await list(hist)) if (!keep.has(n)) { try { await a.remove(`${hist}/${n}`); } catch { /* stays */ } }
        } catch (e) {
            console.error('Handwriting: attachment clean-up failed', e);
        } finally {
            this.attachSyncing = false;
        }
    },

    /** After a save (delayed, while nobody is writing) moves unused images away. */
    scheduleAttachSync() {
        if (this.attachTimer !== null) window.clearTimeout(this.attachTimer);
        this.attachTimer = window.setTimeout(() => {
            this.attachTimer = null;
            if (!this.file || this.readOnly) return;
            if (performance.now() - this.lastActivityAt < 2000) { this.scheduleAttachSync(); return; }
            // The list of used files is enough (no need to serialize the whole note); if it didn't change – nothing to do.
            const refs: string[] = [];
            for (const p of this.noteData.pages) {
                if (isLocalRef(p.bgPath)) refs.push(p.bgPath);
                for (const im of p.images ?? []) if (isLocalRef(im.path)) refs.push(im.path);
            }
            const sig = this.file.path + '|' + refs.join('|');
            if (sig === this.lastAttachSig) return;
            this.lastAttachSig = sig;
            void this.syncAttachments(this.file.path, JSON.stringify(refs), false);
        }, 2500);
    },

    /**
     * Removes versions with identical content from the history (e.g. saved by an older plugin release in a different text form).
     * Content is compared after loading and re-serializing it in one common form; the oldest of the duplicates is kept.
     */
    async dedupeHistory(notePath: string): Promise<number> {
        const a = this.adapter();
        const list = await listSnapshots(a, historyDirFor(notePath));
        const seen = new Set<string>();
        let removed = 0;
        for (const v of [...list].reverse()) {   // oldest first
            let key: string;
            try {
                const mig = migrateNote(JSON.parse(await readSnapshot(a, v.path)));
                if (mig.tooNew) continue;
                key = contentHash(this.serializeNote(this.normalizeNote(mig.data)));
            } catch { continue; }
            if (seen.has(key)) { try { await a.remove(v.path); removed++; } catch { /* stays */ } }
            else seen.add(key);
        }
        return removed;
    },

    /**
     * Deletes the given versions from the history, then the images in history/attachments that neither the note
     * nor any remaining version uses.
     */
    async deleteVersions(list: SnapshotInfo[]): Promise<number> {
        if (!this.file) return 0;
        const a = this.adapter();
        let n = 0;
        for (const v of list) { try { await a.remove(v.path); n++; } catch { /* the file may already be gone */ } }
        if (n > 0 && !this.readOnly) await this.syncAttachments(this.file.path, this.getViewData(), true);
        return n;
    },

    async listVersions(): Promise<SnapshotInfo[]> {
        if (!this.file) return [];
        return listSnapshots(this.adapter(), historyDirFor(this.file.path), true);
    },

    /** Loads a snapshot as note data (after format migration and normalization). */
    async loadVersion(info: SnapshotInfo): Promise<{ text: string; note: NoteData }> {
        const text = await readSnapshot(this.adapter(), info.path);
        const mig = migrateNote(JSON.parse(text));
        if (mig.tooNew) throw new Error('This version was saved by a newer version of the plugin.');
        return { text, note: this.normalizeNote(mig.data) };
    },

    /** Page preview from a snapshot. */
    async renderVersionPage(canvas: HTMLCanvasElement, note: NoteData, index: number) {
        const page: PageData | undefined = note.pages[index];
        if (!page) return;
        const st = this.plugin.settings;
        const paper = page.paper ?? note.defaults?.paper ?? st.defaultPaper;
        const tpl = page.tpl ?? note.defaults?.tpl ?? st.defaultTemplate;
        const { sources, bg } = await this.loadThumbSources(page, undefined, true);
        this.paintThumb(canvas, page, paper, sources, bg, tpl);
    },

    /** Restores a version: saves the current state first (so the restore can be undone). */
    async restoreVersion(text: string) {
        if (!this.canEdit()) return;
        await this.snapshotNow('restore');
        const keepId = this.noteData.id;
        this.setViewData(text, false);
        if (keepId) this.noteData.id = keepId;
        this.baseSnapDone = true;
        this.requestSave();
        new Notice('Version restored. The previous state is kept in the version history.');
    },

    /** Saves a version as a new note next to the current one and opens it in a new tab. */
    async openVersionAsCopy(text: string, time: number) {
        const file = this.file;
        if (!file) return;
        let data: any;
        try { data = JSON.parse(text); } catch { new Notice('This version could not be read.'); return; }
        delete data.id;   // the copy gets its own history
        const d = new Date(time);
        const p = (n: number) => String(n).padStart(2, '0');
        const label = `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}-${p(d.getMinutes())}`;
        const dir = file.parent?.path && file.parent.path !== '/' ? file.parent.path + '/' : '';
        let path = `${dir}${file.basename} (version ${label}).hnote`;
        let n = 2;
        while (this.app.vault.getAbstractFileByPath(path)) path = `${dir}${file.basename} (version ${label}) ${n++}.hnote`;
        // The copy gets its own data folder: copy the images it uses into it.
        const a = this.adapter();
        const copyRef = async (ref?: string) => isLocalRef(ref) ? await copyLocalRef(a, file.path, path, ref, newId).catch(() => ref) : ref;
        for (const pg of Array.isArray(data.pages) ? data.pages : []) {
            if (pg.bgPath) pg.bgPath = await copyRef(pg.bgPath);
            for (const im of Array.isArray(pg.images) ? pg.images : []) if (im.path) im.path = await copyRef(im.path);
        }
        const created = await this.app.vault.create(path, JSON.stringify(data));
        await this.app.workspace.getLeaf('tab').openFile(created);
    },

    openVersionHistory() {
        if (!this.file) return;
        if (!this.plugin.settings.historyEnabled) {
            new Notice('Version history is turned off in the plugin settings.');
        }
        new VersionHistoryModal(this.app, this).open();
    },
});
export type VersionsMethods = typeof versionsMixin;
