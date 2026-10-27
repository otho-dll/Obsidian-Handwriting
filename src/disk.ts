import { Platform } from 'obsidian';

import { nodeRequire } from './desktop';

/** Access to files on the computer (outside the vault) – desktop Obsidian only (Electron / Node), see desktop.ts. */

export function canUseDisk(): boolean {
    return Platform.isDesktopApp && !!nodeRequire('fs') && !!nodeRequire('path');
}

/** System folder picker dialog. Returns null when cancelled or when the dialog isn't available. */
export async function pickDiskFolder(start?: string): Promise<string | null> {
    let dialog: any = null;
    try { dialog = nodeRequire('@electron/remote')?.dialog; } catch { /* not available */ }
    if (!dialog) { try { dialog = nodeRequire('electron')?.remote?.dialog; } catch { /* not available */ } }
    if (!dialog) return null;
    const res = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], defaultPath: start || undefined });
    if (res.canceled || !res.filePaths?.length) return null;
    return res.filePaths[0] as string;
}

/** Writes bytes to a file in the given folder (creates missing folders). Returns the full path. */
export function writeToDisk(folder: string, fileName: string, bytes: Uint8Array): string {
    const fs = nodeRequire('fs');
    const path = nodeRequire('path');
    if (!fs || !path) throw new Error('Saving to the computer is not available here.');
    const dir = folder.trim();
    if (!dir) throw new Error('No folder chosen.');
    fs.mkdirSync(dir, { recursive: true });
    const full = path.join(dir, fileName);
    fs.writeFileSync(full, bytes);
    return full as string;
}

export function revealInFolder(fullPath: string) {
    try { nodeRequire('electron')?.shell?.showItemInFolder(fullPath); } catch { /* not important */ }
}
