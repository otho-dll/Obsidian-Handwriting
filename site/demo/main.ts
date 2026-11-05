// Live demo: runs the real plugin (src/main.ts) in the page on top of the fake Obsidian API in site/shim/.
import '../shim/dom';
import HandwritingPlugin, { HandwritingView } from '../../src/main';
import { App, Notice, TFile, Vault, WorkspaceLeaf } from '../shim/obsidian';
import { downloadBlob } from '../shim/workspace';
import { clearAll, kvGet, kvSet } from '../shim/storage';
import { buildSampleNote, SAMPLE_VERSION } from './sampleNote';
import manifestJson from '../../manifest.json';

const NOTE_PATH = 'Demo.hnote';

/** Settings the demo starts with (instead of Obsidian's empty data.json). */
const DEMO_SETTINGS = {
    pdfExportMode: 'note',       // Export PDF → download at once (Settings can switch back to "ask")
    zoomPresets: [],
    pagesPanelIntro: true,
    toolbarHidden: [],
    quickActions: ['calculator', 'zoom', 'contents', 'pages'],
    minimap: 'always',
};

interface DemoState { app: App; vault: Vault; plugin: HandwritingPlugin; leaf: WorkspaceLeaf; }
let state: DemoState | null = null;

function seed(vault: Vault) {
    vault.persist = false;
    void vault.create(NOTE_PATH, buildSampleNote());
    vault.persist = true;
}

function currentView(): HandwritingView | null {
    const v = state?.leaf.view;
    return v instanceof HandwritingView ? v : null;
}

/** Starts the demo. Returns true when the sample note was created fresh (first visit or after a reset). */
async function boot(host: HTMLElement): Promise<boolean> {
    const vault = new Vault();
    vault.persist = false;
    let restored = false;
    try { restored = await vault.restore(); } catch { restored = false; }
    vault.persist = true;
    // A visitor who still has an older sample note gets the current one (once, when SAMPLE_VERSION is raised).
    const outdated = restored && (await kvGet<number>('sample-version')) !== SAMPLE_VERSION;
    const fresh = !restored || outdated || !(vault.getAbstractFileByPath(NOTE_PATH) instanceof TFile);
    if (fresh) {
        if (outdated) await clearAll();   // also drops the old note's history and attachments
        vault.reset();
        seed(vault);
        await vault.flush();              // store the new sample at once (otherwise the old one could come back)
        await kvSet('sample-version', SAMPLE_VERSION);
    }

    const app = new App(vault);
    app.defaultPluginData = DEMO_SETTINGS;
    const manifest = { ...manifestJson, dir: `.obsidian/plugins/${manifestJson.id}` };
    const plugin = new HandwritingPlugin(app as any, manifest as any);
    await (plugin as any).loadAsync();

    host.empty();
    const leaf = new WorkspaceLeaf(app, host);
    app.workspace.leaves.push(leaf);
    app.workspace.activeLeaf = leaf;
    state = { app, vault, plugin, leaf };

    const file = vault.getAbstractFileByPath(NOTE_PATH) as TFile;
    await leaf.openFile(file);
    const v = currentView();
    if (v) {
        // First visit on a narrow screen (phone): the page would be wider than the view at 100 % – fit it.
        if (!plugin.settings.lastPositions[NOTE_PATH]) {
            requestAnimationFrame(() => { if (v.scrollArea && v.pageW(0) * v.currentZoom > v.scrollArea.clientWidth - 8) v.fitToWidth(); });
        }
    }
    (window as any).hwDemo = { app, vault, plugin, get view() { return currentView(); } };
    return fresh;
}

async function resetDemo(host: HTMLElement) {
    const old = state;
    state = null;
    if (old) {
        old.app.disposed = true;
        old.vault.dispose();
        try { await old.leaf.detach(); } catch (e) { console.error(e); }
        try { old.plugin.unload(); } catch (e) { console.error(e); }
    }
    document.querySelectorAll('body > .menu, body > .modal-container').forEach(el => el.remove());
    await clearAll();
    await boot(host);
    new Notice('Demo reset.');
}

async function downloadNote() {
    const v = currentView();
    if (!v) return;
    const name = v.file?.name ?? NOTE_PATH;
    downloadBlob(v.getViewData(), name, 'application/json');
}

/** Fullscreen hides the browser UI. Where it is not supported (e.g. iPhone) the button is hidden. */
function setupFullscreen(btn: HTMLButtonElement) {
    const root = document.documentElement;
    if (!root.requestFullscreen || !document.fullscreenEnabled) { btn.hidden = true; return; }
    const label = btn.querySelector('.demo-btn-label');
    const sync = () => {
        const on = !!document.fullscreenElement;
        btn.setAttribute('aria-pressed', String(on));
        btn.title = on ? 'Exit fullscreen' : 'Fullscreen';
        if (label) label.textContent = on ? 'Exit' : 'Fullscreen';
    };
    btn.addEventListener('click', async () => {
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
            else await root.requestFullscreen();
        } catch { /* refused by the browser */ }
    });
    document.addEventListener('fullscreenchange', sync);
}

function init() {
    const host = document.getElementById('demo-view');
    if (!host) return;
    const on = (id: string, fn: () => unknown) => document.getElementById(id)?.addEventListener('click', () => { void fn(); });
    on('demo-reset', () => resetDemo(host));
    on('demo-download', () => downloadNote());
    on('demo-export', () => currentView()?.exportToPDF());
    on('demo-settings', () => state?.app.setting.openTabById(manifestJson.id));
    const fs = document.getElementById('demo-fullscreen') as HTMLButtonElement | null;
    if (fs) setupFullscreen(fs);

    // Unsaved changes are written before the page is left.
    const flush = () => { const v = currentView(); if (v) void v.save(); void state?.vault.flush(); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);

    boot(host).then(async () => {
        if (await kvGet('demo-welcomed')) return;
        void kvSet('demo-welcomed', true);
        const welcome = host.dataset.welcome;   // site/content.mjs → demo.welcome
        if (welcome) new Notice(welcome, 9000);
    }).catch(e => {
        console.error('Demo failed to start', e);
        host.textContent = 'The demo could not start in this browser.';
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
