import { App, Notice, Platform, TFile } from 'obsidian';
import { HNOTE2PDF_PY } from './converterScript';

/**
 * The hnote2pdf.py script (Python) converts .hnote notes to PDF without Obsidian – e.g. when you stop
 * using Obsidian or want to convert many notes at once. The plugin saves it in the vault root folder.
 */
export const CONVERTER_FILE = 'hnote2pdf.py';

/** Full path of the vault root folder on disk (desktop version only). */
function vaultBasePath(app: App): string | null {
    const a = app.vault.adapter as unknown as { getBasePath?: () => string };
    return typeof a.getBasePath === 'function' ? a.getBasePath() : null;
}

/** Saves (or updates) hnote2pdf.py in the vault root folder. */
export async function saveConverterScript(app: App, quiet = false): Promise<string | null> {
    try {
        await app.vault.adapter.write(CONVERTER_FILE, HNOTE2PDF_PY);
        const base = vaultBasePath(app);
        if (!quiet) new Notice(`Saved ${CONVERTER_FILE} in the root of your vault${base ? ` (${base})` : ''}.`, 6000);
        return CONVERTER_FILE;
    } catch (e) {
        console.error('Handwriting: could not save the converter script', e);
        new Notice(`Could not save ${CONVERTER_FILE}.`);
        return null;
    }
}

/** Terminal command that converts the given note (or the whole vault) to PDF. */
export function converterCommand(app: App, note?: TFile | null): string {
    const base = vaultBasePath(app);
    const py = Platform.isWin ? 'python' : 'python3';
    const sep = Platform.isWin ? '\\' : '/';
    const full = (rel: string) => base ? `${base}${sep}${rel.split('/').join(sep)}` : rel;
    const target = note ? `"${full(note.path)}"` : `"${base ?? '.'}" -r -o "${full('PDF export')}"`;
    return `${py} "${full(CONVERTER_FILE)}" ${target}`;
}

/** Saves the script and copies the ready command to the clipboard. */
export async function copyConverterCommand(app: App, note?: TFile | null) {
    if (!(await saveConverterScript(app, true))) return;
    const cmd = converterCommand(app, note);
    try {
        await navigator.clipboard.writeText(cmd);
        new Notice(`Command copied – paste it into a terminal:\n${cmd}`, 9000);
    } catch {
        new Notice(cmd, 15000);
    }
}
