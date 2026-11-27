import { App, Modal, Notice } from 'obsidian';
import { canOpenDevTools, toggleDevTools } from './desktop';

/**
 * Debug log: with "Debug logging" on, diagnostic messages go to the developer console and also to this in-memory
 * buffer (last entries only, never saved or sent anywhere). The buffer can be viewed in a dialog – on a tablet or a
 * laptop in tablet mode there is no keyboard shortcut for the console.
 */
const MAX_ENTRIES = 1000;
const entries: string[] = [];
let version = 0;   // grows with every change (the buffer length stops growing once it is full)

function formatArg(a: unknown): string {
    if (typeof a === 'string') return a;
    if (typeof a === 'number' || typeof a === 'boolean' || a === null || a === undefined) return String(a);
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    try { return JSON.stringify(a) ?? typeof a; } catch { return `[${typeof a}]`; }
}

function timeStamp(): string {
    const d = new Date();
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Writes one message (when logging is on – the caller checks the setting). */
export function debugLog(...args: unknown[]) {
    console.debug('[Handwriting]', ...args);
    entries.push(`${timeStamp()}  ${args.map(formatArg).join(' ')}`);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    version++;
}

/** "Debug log" dialog: the collected messages, copy / clear, and (desktop) a button opening the developer console. */
export class DebugLogModal extends Modal {
    private listEl!: HTMLElement;
    private timer: number | null = null;
    private shown = -1;

    constructor(app: App, private enabled: () => boolean) { super(app); }

    onOpen() {
        this.modalEl.addClass('hw-debug-log-modal');
        this.titleEl.setText('Debug log');
        const { contentEl } = this;
        if (!this.enabled()) {
            contentEl.createEl('p', { cls: 'hw-debug-log-hint', text: 'Debug logging is off – turn it on in the plugin settings (Advanced) to collect messages.' });
        }
        const bar = contentEl.createDiv({ cls: 'hw-debug-log-bar' });
        const copyBtn = bar.createEl('button', { text: 'Copy', cls: 'mod-cta' });
        copyBtn.onclick = () => {
            void navigator.clipboard.writeText(entries.join('\n')).then(
                () => new Notice('Debug log copied.'),
                () => new Notice('Could not copy the debug log.'));
        };
        const clearBtn = bar.createEl('button', { text: 'Clear' });
        clearBtn.onclick = () => { entries.length = 0; version++; this.render(); };
        if (canOpenDevTools()) {
            const devBtn = bar.createEl('button', { text: 'Open developer console' });
            devBtn.setAttribute('title', 'The same as Ctrl+Shift+I: the full console with all messages');
            devBtn.onclick = () => { if (!toggleDevTools()) new Notice('The developer console is not available here.'); };
        }
        this.listEl = contentEl.createEl('pre', { cls: 'hw-debug-log-list' });
        this.render();
        // New messages appear while the dialog is open.
        this.timer = window.setInterval(() => this.render(), 1000);
    }

    private render() {
        if (this.shown === version) return;
        const el = this.listEl;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        this.shown = version;
        el.setText(entries.length ? entries.join('\n') : 'No messages yet.');
        if (atBottom) el.scrollTop = el.scrollHeight;
    }

    onClose() {
        if (this.timer !== null) window.clearInterval(this.timer);
        this.timer = null;
        this.contentEl.empty();
    }
}
