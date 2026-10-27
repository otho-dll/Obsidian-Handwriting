import { Platform } from 'obsidian';

/**
 * The only place where the plugin reaches for Node.js / Electron APIs (desktop Obsidian only).
 * On phones and tablets these functions return null and the plugin uses solutions available everywhere
 * (export to the vault, browser clipboard, Ctrl+V). This way the plugin works on all devices
 * (isDesktopOnly: false), and desktop-only extras are turned off when they aren't available.
 */
export function nodeRequire(name: string): any | null {
    if (!Platform.isDesktopApp) return null;
    try {
        const req = (window as any).require;
        return typeof req === 'function' ? req(name) : null;
    } catch { return null; }
}

/** Electron clipboard (images from the Snipping Tool, pasting without browser permissions). */
export function electronClipboard(): any | null {
    return nodeRequire('electron')?.clipboard ?? null;
}

/** Opens a URL in the system (e.g. ms-screenclip: – the Windows snipping tool). */
export async function openExternal(uri: string): Promise<boolean> {
    const shell = nodeRequire('electron')?.shell;
    if (shell?.openExternal) { await shell.openExternal(uri); return true; }
    return false;
}
