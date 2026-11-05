import { Platform } from 'obsidian';

/**
 * The only place where the plugin reaches for Node.js / Electron APIs (desktop Obsidian only).
 * On phones and tablets these functions return null and the plugin uses solutions available everywhere
 * (export to the vault, browser clipboard, Ctrl+V). This way the plugin works on all devices
 * (isDesktopOnly: false), and desktop-only extras are turned off when they aren't available.
 *
 * Only the few members the plugin uses are typed below (Node / Electron types are not a dependency).
 */

export interface NodeFs {
    mkdirSync(path: string, options: { recursive: boolean }): unknown;
    writeFileSync(path: string, data: Uint8Array): void;
}
export interface NodePath {
    join(...parts: string[]): string;
}
export interface NativeImage {
    isEmpty(): boolean;
    getSize(): { width: number; height: number };
    toBitmap(): Uint8Array<ArrayBuffer>;
    toPNG(): Uint8Array<ArrayBuffer>;
}
export interface ElectronClipboard {
    readImage(): NativeImage;
}
interface ElectronDialog {
    showOpenDialog(options: { properties: string[]; defaultPath?: string }): Promise<{ canceled: boolean; filePaths?: string[] }>;
}
interface ElectronShell {
    openExternal(url: string): Promise<void>;
    showItemInFolder(path: string): void;
}
interface ElectronModule {
    clipboard?: ElectronClipboard;
    shell?: ElectronShell;
    remote?: { dialog?: ElectronDialog };
}
interface NodeModules {
    fs: NodeFs;
    path: NodePath;
    electron: ElectronModule;
    '@electron/remote': { dialog?: ElectronDialog };
}

/** A Node / Electron module, or null on phones and tablets (or when it can't be loaded). */
export function nodeRequire<K extends keyof NodeModules>(name: K): NodeModules[K] | null {
    if (!Platform.isDesktopApp) return null;
    try {
        const req = (window as unknown as { require?: (id: string) => unknown }).require;
        return typeof req === 'function' ? (req(name) as NodeModules[K]) : null;
    } catch { return null; }
}

/** Electron clipboard (images from the Snipping Tool, pasting without browser permissions). */
export function electronClipboard(): ElectronClipboard | null {
    return nodeRequire('electron')?.clipboard ?? null;
}

/** System folder dialog (desktop only). */
export function electronDialog(): ElectronDialog | null {
    let dialog: ElectronDialog | undefined;
    try { dialog = nodeRequire('@electron/remote')?.dialog; } catch { /* not available */ }
    if (!dialog) { try { dialog = nodeRequire('electron')?.remote?.dialog; } catch { /* not available */ } }
    return dialog ?? null;
}

/** Opens a URL in the system (e.g. ms-screenclip: – the Windows snipping tool). */
export async function openExternal(uri: string): Promise<boolean> {
    const shell = nodeRequire('electron')?.shell;
    if (shell?.openExternal) { await shell.openExternal(uri); return true; }
    return false;
}
