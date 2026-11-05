// App, Workspace, WorkspaceLeaf, FileManager and the settings window (app.setting).
// The demo has one leaf. Files that no registered view can show (e.g. an exported PDF) are downloaded instead.
import { Events } from './component';
import { Modal } from './ui';
import { TAbstractFile, TFile, Vault } from './vault';
import type { Command, SettingTab } from './plugin';
import type { View } from './views';
import { FileView } from './views';

export function downloadBlob(data: BlobPart, name: string, type: string) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export class WorkspaceLeaf extends Events {
    app: App;
    view: View | null = null;
    containerEl: HTMLElement;
    constructor(app: App, containerEl: HTMLElement) {
        super();
        this.app = app;
        this.containerEl = containerEl;
    }
    getViewState() { return { type: this.view?.getViewType() ?? 'empty' }; }
    async setViewState(_s: unknown) { /* single-view demo */ }
    getDisplayText() { return this.view?.getDisplayText() ?? ''; }

    async openFile(file: TFile, _state?: unknown) {
        const type = this.app.viewRegistry.extensions[file.extension];
        const factory = type ? this.app.viewRegistry.views[type] : undefined;
        if (!factory) {
            // Not viewable here (e.g. the exported PDF): hand the file to the browser.
            const data = await this.app.vault.readBinary(file);
            const mime = file.extension === 'pdf' ? 'application/pdf' : 'application/octet-stream';
            downloadBlob(data, file.name, mime);
            this.app.workspace.trigger('demo:download', file);
            return;
        }
        if (!this.view || this.view.getViewType() !== type) {
            if (this.view) await this.view.close();
            this.view = factory(this);
            await this.view.open(this.containerEl);
        }
        if (this.view instanceof FileView) await this.view.loadFile(file);
        this.app.workspace.activeLeaf = this;
        this.app.workspace.trigger('file-open', file);
        this.app.workspace.trigger('active-leaf-change', this);
    }
    async detach() {
        if (this.view) await this.view.close();
        this.view = null;
    }
}

export class Workspace extends Events {
    activeLeaf: WorkspaceLeaf | null = null;
    leaves: WorkspaceLeaf[] = [];
    containerEl: HTMLElement = document.body;
    layoutReady = true;
    constructor(private app: App) { super(); }

    getActiveViewOfType<T>(type: abstract new (...args: any[]) => T): T | null {
        const v = this.activeLeaf?.view;
        return v instanceof (type as any) ? (v as unknown as T) : null;
    }
    getActiveFile(): TFile | null {
        const v = this.activeLeaf?.view;
        return v instanceof FileView ? v.file : null;
    }
    getLeaf(_newLeaf?: boolean | string): WorkspaceLeaf {
        if (!this.activeLeaf) throw new Error('No leaf');
        return this.activeLeaf;
    }
    getMostRecentLeaf() { return this.activeLeaf; }
    getLeavesOfType(type: string): WorkspaceLeaf[] { return this.leaves.filter(l => l.view?.getViewType() === type); }
    iterateAllLeaves(cb: (l: WorkspaceLeaf) => any) { this.leaves.forEach(cb); }
    async openLinkText(linktext: string, _source: string, _newLeaf?: boolean | string) {
        const f = this.app.vault.getAbstractFileByPath(linktext) ?? this.app.vault.getAbstractFileByPath(`${linktext}.md`);
        if (f instanceof TFile) await this.getLeaf().openFile(f);
    }
    onLayoutReady(cb: () => any) { cb(); }
    requestSaveLayout() { /* nothing */ }
}

export class FileManager {
    constructor(private app: App) { }
    async renameFile(file: TAbstractFile, newPath: string) { await this.app.vault.rename(file, newPath); }
    async trashFile(file: TAbstractFile) { await this.app.vault.trash(file, true); }
    async getAvailablePathForAttachment(name: string, sourcePath?: string) {
        const i = sourcePath ? sourcePath.lastIndexOf('/') : -1;
        const dir = i >= 0 ? sourcePath!.slice(0, i) : '';
        return dir ? `${dir}/${name}` : name;
    }
}

/** Settings window: shows a plugin's PluginSettingTab in a modal. */
class SettingsModal extends Modal {
    constructor(app: App, private tab: SettingTab, private title: string) { super(app); }
    onOpen() {
        this.modalEl.addClass('mod-settings', 'hw-demo-settings');
        this.titleEl.setText(this.title);
        this.contentEl.appendChild(this.tab.containerEl);
        this.tab.display();
    }
    onClose() { this.tab.hide(); this.tab.containerEl.remove(); }
}

export class AppSetting {
    private tabs = new Map<string, SettingTab>();
    private modal: SettingsModal | null = null;
    private openId: string | null = null;
    constructor(private app: App) { }
    addTab(id: string, tab: SettingTab) { this.tabs.set(id, tab); }
    open() { /* the tab is chosen with openTabById (the demo has one plugin) */ this.openId = null; queueMicrotask(() => { if (!this.modal) this.openTabById(this.tabs.keys().next().value ?? ''); }); }
    openTabById(id: string) {
        const tab = this.tabs.get(id);
        if (!tab) return;
        if (this.modal && this.openId === id) return;
        this.close();
        this.openId = id;
        this.modal = new SettingsModal(this.app, tab, 'Settings – Handwritten A4 Notebook');
        const m = this.modal;
        const origClose = m.onClose.bind(m);
        m.onClose = () => { origClose(); if (this.modal === m) { this.modal = null; this.openId = null; } };
        m.open();
    }
    close() { this.modal?.close(); this.modal = null; this.openId = null; }
}

export class App {
    vault: Vault;
    workspace: Workspace;
    fileManager: FileManager;
    setting: AppSetting;
    commands = { commands: {} as Record<string, Command>, executeCommandById: (id: string) => this.runCommand(id) };
    viewRegistry = { views: {} as Record<string, (leaf: WorkspaceLeaf) => View>, extensions: {} as Record<string, string> };
    metadataCache = new Events();
    /** Plugin data used when nothing was saved yet (demo defaults). */
    defaultPluginData: unknown = null;
    /** Set when the demo is reset and this app is thrown away. */
    disposed = false;

    constructor(vault: Vault) {
        this.vault = vault;
        this.workspace = new Workspace(this);
        this.fileManager = new FileManager(this);
        this.setting = new AppSetting(this);
    }
    private runCommand(id: string): boolean {
        const c = this.commands.commands[id];
        if (!c) return false;
        if (c.checkCallback) return c.checkCallback(false) !== false;
        c.callback?.();
        return true;
    }
}
