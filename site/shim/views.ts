// View → ItemView → FileView → TextFileView, with Obsidian's loading / saving lifecycle.
import { Component } from './component';
import { TFile } from './vault';
import type { App, WorkspaceLeaf } from './workspace';

export abstract class View extends Component {
    app: App;
    leaf: WorkspaceLeaf;
    containerEl: HTMLElement;
    icon = '';
    navigation = true;

    constructor(leaf: WorkspaceLeaf) {
        super();
        this.leaf = leaf;
        this.app = leaf.app;
        this.containerEl = createDiv({ cls: 'workspace-leaf-content' });
    }
    abstract getViewType(): string;
    getDisplayText(): string { return ''; }
    getIcon() { return this.icon; }
    getState(): Record<string, unknown> { return {}; }
    async setState(_state: unknown, _result: unknown) { /* nothing */ }
    onResize() { /* nothing */ }
    async onOpen(): Promise<void> { /* overridden */ }
    async onClose(): Promise<void> { /* overridden */ }
    /** Called by the leaf. */
    async open(parent: HTMLElement) {
        parent.appendChild(this.containerEl);
        this.load();
        await this.onOpen();
    }
    async close() {
        await this.onClose();
        this.unload();
        this.containerEl.remove();
    }
}

export abstract class ItemView extends View {
    contentEl: HTMLElement;
    headerEl: HTMLElement;
    titleEl: HTMLElement;
    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
        this.headerEl = this.containerEl.createDiv({ cls: 'view-header' });
        this.titleEl = this.headerEl.createDiv({ cls: 'view-header-title' });
        this.contentEl = this.containerEl.createDiv({ cls: 'view-content' });
    }
    addAction(icon: string, title: string, cb: (e: MouseEvent) => unknown): HTMLElement {
        const el = this.headerEl.createEl('button', { cls: 'clickable-icon view-action', attr: { 'aria-label': title } });
        el.dataset.icon = icon;
        el.addEventListener('click', cb);
        return el;
    }
}

export abstract class FileView extends ItemView {
    file: TFile | null = null;
    allowNoFile = false;
    async onLoadFile(_file: TFile): Promise<void> { /* overridden */ }
    async onUnloadFile(_file: TFile): Promise<void> { /* overridden */ }
    async onRename(_file: TFile): Promise<void> { /* nothing */ }
    canAcceptExtension(_ext: string) { return true; }
    /** Called by the leaf to show a file. */
    async loadFile(file: TFile) {
        if (this.file === file) return;
        if (this.file) await this.onUnloadFile(this.file);
        this.file = file;
        this.titleEl.setText(this.getDisplayText());
        await this.onLoadFile(file);
    }
    async close() {
        if (this.file) { const f = this.file; await this.onUnloadFile(f); this.file = null; }
        await super.close();
    }
}

export abstract class TextFileView extends FileView {
    data = '';
    private saveTimer: number | null = null;
    /** Debounced save – 2 s like in Obsidian. */
    requestSave = () => {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => { this.saveTimer = null; void this.save(); }, 2000);
    };
    abstract getViewData(): string;
    abstract setViewData(data: string, clear: boolean): void;
    abstract clear(): void;

    async save(_clear?: boolean): Promise<void> {
        if (this.saveTimer !== null) { window.clearTimeout(this.saveTimer); this.saveTimer = null; }
        const file = this.file;
        if (!file) return;
        const data = this.getViewData();
        if (data === this.data && this.app.vault.getAbstractFileByPath(file.path)) return;
        this.data = data;
        await this.app.vault.modify(file, data);
    }
    async onLoadFile(file: TFile): Promise<void> {
        const data = await this.app.vault.read(file);
        this.data = data;
        this.setViewData(data, true);
    }
    async onUnloadFile(_file: TFile): Promise<void> {
        await this.save();
        this.clear();
    }
    /** True while a save is waiting (used by the demo before downloading / resetting). */
    get hasPendingSave() { return this.saveTimer !== null; }
}
