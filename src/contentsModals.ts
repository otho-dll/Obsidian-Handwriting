import { App, FuzzySuggestModal, Modal } from 'obsidian';

/** Dialog for entering a page title (empty title = remove the title). */
export class PageTitleModal extends Modal {
    constructor(app: App, private pageNo: number, private current: string, private onDone: (title: string) => void) {
        super(app);
    }
    onOpen() {
        this.titleEl.setText(this.current ? `Rename page ${this.pageNo}` : `Title for page ${this.pageNo}`);
        this.contentEl.addClass('hw-title-modal');
        this.contentEl.createEl('p', { cls: 'setting-item-description', text: 'Titled pages appear in the table of contents, in the minimap and as bookmarks in exported PDFs.' });
        const input = this.contentEl.createEl('input', { type: 'text', cls: 'hw-title-input' });
        input.value = this.current;
        input.placeholder = 'e.g. Lecture 3 – Integrals';
        const row = this.contentEl.createDiv({ cls: 'hw-title-buttons' });
        if (this.current) {
            const rm = row.createEl('button', { text: 'Remove title' });
            rm.onclick = () => { this.onDone(''); this.close(); };
        }
        const ok = row.createEl('button', { cls: 'mod-cta', text: 'Save' });
        const save = () => { this.onDone(input.value.trim().slice(0, 200)); this.close(); };
        ok.onclick = save;
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); save(); }
        });
        window.setTimeout(() => { input.focus(); input.select(); }, 30);
    }
    onClose() { this.contentEl.empty(); }
}

export interface PageEntry { index: number; title: string; }

/** "Go to page…": search by page titles and numbers. */
export class GoToPageModal extends FuzzySuggestModal<PageEntry> {
    constructor(app: App, private entries: PageEntry[], private onPick: (index: number) => void) {
        super(app);
        this.setPlaceholder('Go to page – type a title or a page number');
    }
    getItems(): PageEntry[] { return this.entries; }
    getItemText(e: PageEntry): string { return `${e.index + 1}  ${e.title || `Page ${e.index + 1}`}`; }
    onChooseItem(e: PageEntry): void { this.onPick(e.index); }
}
