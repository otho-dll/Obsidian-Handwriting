// Fake "obsidian" module for the browser demo. The site build aliases `obsidian` to this file
// (scripts/build-site.mjs); the plugin build is unchanged and still uses the real Obsidian API.
import './dom';

export { Component, Events } from './component';
export type { EventRef } from './component';
export { TAbstractFile, TFile, TFolder, Vault, DataAdapter } from './vault';
export { Platform } from './platform';
export { setIcon, addIcon, getIcon, getIconIds } from './icons';
export {
    Menu, MenuItem, Modal, Scope, SuggestModal, FuzzySuggestModal, Notice, Setting,
    ToggleComponent, DropdownComponent, SliderComponent, TextComponent, TextAreaComponent, ColorComponent,
    ButtonComponent, ExtraButtonComponent,
} from './ui';
export type { FuzzyMatch } from './ui';
export { View, ItemView, FileView, TextFileView } from './views';
export { Plugin, PluginSettingTab, SettingTab } from './plugin';
export type { PluginManifest, Command } from './plugin';
export { App, Workspace, WorkspaceLeaf, FileManager } from './workspace';

/**
 * pdf.js for PDF import, like Obsidian's built-in copy. Loaded only when a PDF is imported (a separate chunk);
 * the worker, fonts, character maps and image decoders are served from demo/pdfjs/ (see scripts/build-site.mjs) –
 * nothing is downloaded from elsewhere.
 */
type PdfJs = typeof import('pdfjs-dist');
type PdfSource = Exclude<Parameters<PdfJs['getDocument']>[0], string | URL | ArrayBuffer | ArrayLike<number> | undefined>;
let pdfjsPromise: Promise<PdfJs> | null = null;
export function loadPdfJs(): Promise<PdfJs> {
    pdfjsPromise ??= (async () => {
        const pdfjs = await import('pdfjs-dist');
        const base = new URL('./pdfjs/', import.meta.url).href;
        pdfjs.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
        const getDocument = (src: PdfSource = {}) => pdfjs.getDocument({
            cMapUrl: `${base}cmaps/`,
            cMapPacked: true,
            standardFontDataUrl: `${base}standard_fonts/`,
            wasmUrl: `${base}wasm/`,
            ...src,
        });
        return { ...pdfjs, getDocument };
    })();
    pdfjsPromise.catch(() => { pdfjsPromise = null; });   // a failed load can be retried
    return pdfjsPromise;
}

export function normalizePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '') || '/';
}

export function debounce<T extends unknown[]>(fn: (...args: T) => unknown, wait = 0, resetTimer = false) {
    let t: number | null = null;
    let last: T | null = null;
    const d = (...args: T) => {
        last = args;
        if (t !== null) { if (!resetTimer) return d; window.clearTimeout(t); }
        t = window.setTimeout(() => { t = null; if (last) fn(...last); }, wait);
        return d;
    };
    d.cancel = () => { if (t !== null) window.clearTimeout(t); t = null; return d; };
    d.run = () => { if (t !== null) { window.clearTimeout(t); t = null; if (last) fn(...last); } };
    return d;
}

export const apiVersion = '1.7.0';
