// Plugin and PluginSettingTab. Plugin data (data.json) is kept in IndexedDB.
import { Component } from './component';
import { kvGet, kvSet } from './storage';
import type { App } from './workspace';
import type { View } from './views';
import type { WorkspaceLeaf } from './workspace';

export interface PluginManifest {
    id: string; name: string; version: string; minAppVersion: string; description: string; author: string;
    authorUrl?: string; isDesktopOnly?: boolean; dir?: string;
}

export interface Command {
    id: string; name: string; icon?: string;
    callback?: () => unknown; checkCallback?: (checking: boolean) => boolean | void;
}

export abstract class SettingTab {
    app!: App;
    containerEl: HTMLElement = createDiv({ cls: 'vertical-tab-content' });
    abstract display(): void;
    hide() { this.containerEl.empty(); }
}

export abstract class PluginSettingTab extends SettingTab {
    plugin: Plugin;
    constructor(app: App, plugin: Plugin) { super(); this.app = app; this.plugin = plugin; }
}

export abstract class Plugin extends Component {
    app: App;
    manifest: PluginManifest;
    constructor(app: App, manifest: PluginManifest) {
        super();
        this.app = app;
        this.manifest = manifest;
    }
    private get dataKey() { return `plugin-data:${this.manifest.id}`; }
    async loadData(): Promise<unknown> {
        const stored = await kvGet<string>(this.dataKey);
        if (stored) { try { return JSON.parse(stored); } catch { /* fall through */ } }
        return this.app.defaultPluginData ? JSON.parse(JSON.stringify(this.app.defaultPluginData)) : null;
    }
    async saveData(data: unknown): Promise<void> {
        if (this.app.disposed) return;   // the demo was reset: late timers of the old plugin must not write
        await kvSet(this.dataKey, JSON.stringify(data));
    }
    addCommand(cmd: Command) {
        const full = { ...cmd, id: `${this.manifest.id}:${cmd.id}` };
        this.app.commands.commands[full.id] = full;
        return full;
    }
    removeCommand(id: string) { delete this.app.commands.commands[`${this.manifest.id}:${id}`]; }
    addSettingTab(tab: PluginSettingTab) { this.app.setting.addTab(this.manifest.id, tab); }
    registerView(type: string, factory: (leaf: WorkspaceLeaf) => View) {
        this.app.viewRegistry.views[type] = factory;
        this.register(() => { delete this.app.viewRegistry.views[type]; });
    }
    registerExtensions(exts: string[], type: string) { for (const e of exts) this.app.viewRegistry.extensions[e] = type; }
    addRibbonIcon(_icon: string, title: string, _cb: (e: MouseEvent) => unknown) { return createDiv({ attr: { 'aria-label': title } }); }
    addStatusBarItem() { return createDiv(); }
    registerHoverLinkSource() { /* nothing */ }
    registerMarkdownPostProcessor() { /* nothing */ }
    registerObsidianProtocolHandler() { /* nothing */ }
    registerEditorExtension() { /* nothing */ }
    onExternalSettingsChange() { /* nothing */ }
}
