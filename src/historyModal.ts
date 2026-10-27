import { App, Modal, Notice, setIcon } from 'obsidian';
import type { HandwritingView } from '../main';
import { NoteData } from './types';
import { REASON_LABEL, SnapshotInfo } from './versionStore';

/** "Version history" dialog: snapshot list on the left, page preview on the right, restore and copy. */
export class VersionHistoryModal extends Modal {
    private listEl!: HTMLElement;
    private previewWrap!: HTMLElement;
    private canvas!: HTMLCanvasElement;
    private infoEl!: HTMLElement;
    private pagerLabel!: HTMLElement;
    private prevBtn!: HTMLButtonElement;
    private nextBtn!: HTMLButtonElement;
    private restoreBtn!: HTMLButtonElement;
    private copyBtn!: HTMLButtonElement;
    private deleteBtn!: HTMLButtonElement;

    private versions: SnapshotInfo[] = [];
    private current: { info: SnapshotInfo; text: string; note: NoteData } | null = null;
    private pageIdx = 0;
    private loadToken = 0;

    constructor(app: App, private view: HandwritingView) { super(app); }

    onOpen() {
        this.modalEl.addClass('mod-hw-history');
        this.titleEl.setText(`Version history – ${this.view.file?.basename ?? ''}`);
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('hw-history');

        const top = contentEl.createDiv({ cls: 'hw-history-top' });
        top.createDiv({ cls: 'hw-history-hint', text: 'Versions are saved automatically while you work, when you close the note and before risky changes.' });
        const saveNow = top.createEl('button', { cls: 'hw-history-save' });
        setIcon(saveNow.createSpan(), 'save');
        saveNow.createSpan({ text: 'Save version now' });
        saveNow.onclick = async () => {
            const ok = await this.view.snapshotNow('manual');
            new Notice(ok ? 'Version saved.' : 'Nothing new to save – this state is already in the history.');
            await this.reload();
        };
        const delAll = top.createEl('button', { cls: 'hw-history-save hw-history-delall' });
        setIcon(delAll.createSpan(), 'trash-2');
        const delAllLabel = delAll.createSpan({ text: 'Delete all' });
        this.confirmButton(delAll, delAllLabel, 'Delete all', 'Click again to delete all', async () => {
            if (this.versions.length === 0) return;
            const n = await this.view.deleteVersions(this.versions);
            new Notice(`Deleted ${n} version${n === 1 ? '' : 's'}.`);
            await this.reload();
        });

        const body = contentEl.createDiv({ cls: 'hw-history-body' });
        this.listEl = body.createDiv({ cls: 'hw-history-list' });
        const right = body.createDiv({ cls: 'hw-history-right' });
        this.previewWrap = right.createDiv({ cls: 'hw-history-preview' });
        this.canvas = this.previewWrap.createEl('canvas');
        const pager = right.createDiv({ cls: 'hw-history-pager' });
        this.prevBtn = pager.createEl('button', { text: '‹' });
        this.pagerLabel = pager.createSpan({ cls: 'hw-history-pagelabel' });
        this.nextBtn = pager.createEl('button', { text: '›' });
        this.prevBtn.onclick = () => this.showPage(this.pageIdx - 1);
        this.nextBtn.onclick = () => this.showPage(this.pageIdx + 1);
        this.infoEl = right.createDiv({ cls: 'hw-history-info' });
        const btns = right.createDiv({ cls: 'hw-history-buttons' });
        this.deleteBtn = btns.createEl('button', { cls: 'hw-history-delete', text: 'Delete' });
        this.confirmButton(this.deleteBtn, this.deleteBtn, 'Delete', 'Delete?', async () => {
            if (this.current) await this.deleteOne(this.current.info);
        });
        this.copyBtn = btns.createEl('button', { text: 'Open as copy' });
        this.restoreBtn = btns.createEl('button', { text: 'Restore this version', cls: 'mod-cta' });
        this.copyBtn.onclick = async () => {
            if (!this.current) return;
            await this.view.openVersionAsCopy(this.current.text, this.current.info.time);
            this.close();
        };
        this.restoreBtn.onclick = async () => {
            if (!this.current) return;
            await this.view.restoreVersion(this.current.text);
            this.close();
        };
        void this.reload();
    }

    onClose() { this.contentEl.empty(); }

    /** Button with confirmation: the first click changes the label, the second (within 3 s) performs the action. */
    private confirmButton(btn: HTMLElement, label: HTMLElement, idle: string, ask: string, run: () => Promise<void>) {
        let armed = 0;
        btn.onclick = async (e) => {
            e.stopPropagation();
            if (!armed) {
                if (ask) label.setText(ask);
                btn.addClass('is-armed');
                armed = window.setTimeout(() => { armed = 0; if (idle) label.setText(idle); btn.removeClass('is-armed'); }, 3000);
                return;
            }
            window.clearTimeout(armed);
            armed = 0;
            if (idle) label.setText(idle);
            btn.removeClass('is-armed');
            await run();
        };
    }

    /** Deletes one version and selects the neighbouring one. */
    private async deleteOne(v: SnapshotInfo) {
        const idx = this.versions.findIndex(x => x.path === v.path);
        await this.view.deleteVersions([v]);
        this.versions = await this.view.listVersions();
        this.drawList();
        if (this.versions.length === 0) { this.showEmpty(); return; }
        void this.select(this.versions[Math.max(0, Math.min(idx, this.versions.length - 1))]);
    }

    private async reload() {
        this.listEl.empty();
        this.listEl.createDiv({ cls: 'hw-history-empty', text: 'Loading…' });
        try {
            if (this.view.file) await this.view.dedupeHistory(this.view.file.path);   // repeated versions disappear from the list
            this.versions = await this.view.listVersions();
        } catch (e) {
            this.versions = [];
            console.error('Handwriting: could not list versions', e);
        }
        this.drawList();
        if (this.versions.length > 0) void this.select(this.versions[0]);
        else this.showEmpty();
    }

    private showEmpty() {
        this.current = null;
        this.canvas.style.display = 'none';
        this.pagerLabel.setText('');
        this.prevBtn.disabled = this.nextBtn.disabled = true;
        this.restoreBtn.disabled = this.copyBtn.disabled = this.deleteBtn.disabled = true;
        this.infoEl.setText(this.view.plugin.settings.historyEnabled
            ? 'No versions yet. The first one is saved after you change something in this note.'
            : 'Version history is turned off in the plugin settings.');
    }

    private dayLabel(t: number): string {
        const d = new Date(t), now = new Date();
        const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
        const diff = Math.round((start(now) - start(d)) / 86400e3);
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Yesterday';
        return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    }

    private drawList() {
        this.listEl.empty();
        if (this.versions.length === 0) {
            this.listEl.createDiv({ cls: 'hw-history-empty', text: 'No versions yet.' });
            return;
        }
        let lastDay = '';
        for (const v of this.versions) {
            const day = this.dayLabel(v.time);
            if (day !== lastDay) { this.listEl.createDiv({ cls: 'hw-history-day', text: day }); lastDay = day; }
            const row = this.listEl.createDiv({ cls: 'hw-history-row' });
            row.dataset.path = v.path;
            row.createDiv({ cls: 'hw-history-time', text: new Date(v.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) });
            row.createDiv({ cls: 'hw-history-reason', text: REASON_LABEL[v.reason] ?? v.reason });
            const del = row.createEl('button', { cls: 'hw-history-rowdel' });
            setIcon(del, 'trash-2');
            del.setAttribute('aria-label', 'Delete this version (click twice)');
            del.setAttribute('title', 'Delete this version (click twice)');
            this.confirmButton(del, del, '', '', async () => { await this.deleteOne(v); });
            row.onclick = () => { void this.select(v); };
        }
    }

    private async select(v: SnapshotInfo) {
        this.listEl.querySelectorAll<HTMLElement>('.hw-history-row').forEach(el => el.toggleClass('is-active', el.dataset.path === v.path));
        const token = ++this.loadToken;
        this.infoEl.setText('Loading…');
        try {
            const { text, note } = await this.view.loadVersion(v);
            if (token !== this.loadToken) return;
            this.current = { info: v, text, note };
            this.canvas.style.display = '';
            this.restoreBtn.disabled = this.copyBtn.disabled = this.deleteBtn.disabled = false;
            const n = note.pages.length;
            const strokes = note.pages.reduce((s, p) => s + p.strokes.length, 0);
            const when = new Date(v.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
            const kb = v.size > 0 ? ` · ${Math.max(1, Math.round(v.size / 1024))} KB` : '';
            this.infoEl.setText(`${when} · ${n} page${n === 1 ? '' : 's'} · ${strokes} stroke${strokes === 1 ? '' : 's'}${kb}`);
            await this.showPage(Math.min(this.pageIdx, n - 1));
        } catch (e) {
            if (token !== this.loadToken) return;
            this.current = null;
            this.restoreBtn.disabled = this.copyBtn.disabled = true;
            this.infoEl.setText(e instanceof Error ? e.message : 'This version could not be read.');
        }
    }

    private async showPage(i: number) {
        const cur = this.current;
        if (!cur) return;
        const n = cur.note.pages.length;
        this.pageIdx = Math.max(0, Math.min(n - 1, i));
        this.pagerLabel.setText(`Page ${this.pageIdx + 1} / ${n}`);
        this.prevBtn.disabled = this.pageIdx === 0;
        this.nextBtn.disabled = this.pageIdx >= n - 1;
        const w = Math.round(Math.min(360, this.previewWrap.clientWidth || 300) * Math.min(2, window.devicePixelRatio || 1));
        this.canvas.width = w;
        this.canvas.height = Math.round(w * 1131 / 800);
        await this.view.renderVersionPage(this.canvas, cur.note, this.pageIdx);
    }
}
