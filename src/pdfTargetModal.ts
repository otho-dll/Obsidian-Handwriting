import { App, Modal, Notice } from 'obsidian';
import { pickDiskFolder } from './disk';

export type PdfTarget =
    | { kind: 'vault'; path: string }
    | { kind: 'disk'; folder: string; name: string }
    | { kind: 'download'; name: string }
    | { kind: 'handle'; handle: any };

export const cleanFileName = (n: string) => (n.replace(/\.pdf$/i, '').replace(/[\\/:*?"<>|]/g, '-').trim() || 'Note') + '.pdf';
export const joinPath = (folder: string, name: string) => { const f = folder.replace(/^\/+|\/+$/g, ''); return f ? `${f}/${name}` : name; };

export interface PdfModalOptions {
    /** Whether saving to a folder on the computer is possible (desktop version). */
    canDisk: boolean;
    /** Suggested folder on the computer. */
    diskFolder: string;
    /** Which target is selected initially. */
    startKind: 'vault' | 'disk';
}

/** Dialog choosing where to save the PDF: a folder in the vault or a folder on the computer. */
export class PdfTargetModal extends Modal {
    private resolved = false;
    constructor(app: App, private defName: string, private defFolder: string, private folders: string[], private opts: PdfModalOptions, private done: (t: PdfTarget | null) => void) { super(app); }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('hw-pdf-modal');
        this.titleEl.setText('Export to PDF');
        const { canDisk } = this.opts;
        let kind: 'vault' | 'disk' = canDisk && this.opts.startKind === 'disk' ? 'disk' : 'vault';

        const nameRow = contentEl.createDiv({ cls: 'hw-pdf-row' });
        nameRow.createEl('label', { text: 'File name' });
        const nameIn = nameRow.createEl('input', { type: 'text' });
        nameIn.value = this.defName.replace(/\.pdf$/i, '');

        const tabs = contentEl.createDiv({ cls: 'hw-pdf-tabs' });
        const tVault = tabs.createEl('button', { text: 'Folder in the vault' });
        const tDisk = tabs.createEl('button', { text: 'Folder on this computer' });
        if (!canDisk) tDisk.style.display = 'none';

        const vaultRow = contentEl.createDiv({ cls: 'hw-pdf-row' });
        vaultRow.createEl('label', { text: 'Folder in the vault (empty = vault root)' });
        const folderIn = vaultRow.createEl('input', { type: 'text' });
        folderIn.value = this.defFolder;
        const listId = 'hw-pdf-folders-' + Math.random().toString(36).slice(2, 8);
        folderIn.setAttribute('list', listId);
        const dl = vaultRow.createEl('datalist');
        dl.id = listId;
        this.folders.forEach(f => dl.createEl('option', { value: f }));

        const diskRow = contentEl.createDiv({ cls: 'hw-pdf-row' });
        diskRow.createEl('label', { text: 'Folder on this computer (full path)' });
        const diskLine = diskRow.createDiv({ cls: 'hw-pdf-diskline' });
        const diskIn = diskLine.createEl('input', { type: 'text' });
        diskIn.value = this.opts.diskFolder;
        diskIn.placeholder = 'C:\\Users\\You\\Documents';
        const browse = diskLine.createEl('button', { text: 'Browse…' });
        browse.onclick = async () => {
            const picked = await pickDiskFolder(diskIn.value);
            if (picked) diskIn.value = picked;
            else new Notice('The folder picker is not available here: type the path instead.');
        };

        const btns = contentEl.createDiv({ cls: 'hw-pdf-buttons' });
        const bCancel = btns.createEl('button', { text: 'Cancel' });
        const bElse = btns.createEl('button', { text: 'Save as…' });
        const bSave = btns.createEl('button', { cls: 'mod-cta' });

        const refreshKind = () => {
            vaultRow.style.display = kind === 'vault' ? '' : 'none';
            diskRow.style.display = kind === 'disk' ? '' : 'none';
            tVault.toggleClass('is-active', kind === 'vault');
            tDisk.toggleClass('is-active', kind === 'disk');
            bSave.setText(kind === 'vault' ? 'Save in vault' : 'Save to computer');
        };
        tVault.onclick = () => { kind = 'vault'; refreshKind(); };
        tDisk.onclick = () => { kind = 'disk'; refreshKind(); };
        refreshKind();

        const save = () => {
            const name = cleanFileName(nameIn.value);
            if (kind === 'vault') {
                this.finish({ kind: 'vault', path: joinPath(folderIn.value.trim(), name) });
            } else {
                const folder = diskIn.value.trim();
                if (!folder) { new Notice('Choose a folder on this computer first.'); return; }
                this.finish({ kind: 'disk', folder, name });
            }
        };
        bSave.onclick = save;
        bCancel.onclick = () => this.finish(null);
        bElse.onclick = async () => {
            const name = cleanFileName(nameIn.value);
            const picker = (window as any).showSaveFilePicker;
            if (typeof picker === 'function') {
                try {
                    // We get the handle right away (user gesture); saving happens after the pages are rendered.
                    const handle = await picker({ suggestedName: name, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
                    this.finish({ kind: 'handle', handle });
                } catch { /* selection cancelled */ }
            } else {
                this.finish({ kind: 'download', name });
            }
        };
        for (const el of [nameIn, folderIn, diskIn]) el.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
        window.setTimeout(() => { nameIn.focus(); nameIn.select(); }, 30);
    }

    private finish(t: PdfTarget | null) {
        if (this.resolved) return;
        this.resolved = true;
        this.done(t);
        this.close();
    }

    onClose() {
        if (!this.resolved) { this.resolved = true; this.done(null); }
        this.contentEl.empty();
    }
}
