import { defineMixin } from './mixin';
import { PageTitleModal, GoToPageModal } from '../contentsModals';

/**
 * Table of contents: pages may have titles (the page `title` field). Titles are shown in the "Contents" panel,
 * in the minimap (marker) and as bookmarks in PDF export.
 */
export const contentsMixin = defineMixin({
    /** Dialog for setting / changing a page title. */
    editPageTitle(i: number) {
        const page = this.noteData.pages[i];
        if (!page || !this.canEdit()) return;
        new PageTitleModal(this.app, i + 1, page.title ?? '', (t) => this.setPageTitle(i, t)).open();
    },

    setPageTitle(i: number, title: string) {
        const page = this.noteData.pages[i];
        if (!page) return;
        const t = title.trim();
        if ((page.title ?? '') === t) return;
        if (t) page.title = t; else delete page.title;
        this.requestSave();
        this.buildMinimap();
        this.refreshContentsPanel();
    },

    /** Pages with titles (in page order). */
    titledPages(): { index: number; title: string }[] {
        const out: { index: number; title: string }[] = [];
        this.noteData.pages.forEach((p, index) => { if (p.title) out.push({ index, title: p.title }); });
        return out;
    },

    /** "Go to page…" – search by titles and numbers. */
    openGoToPage() {
        const entries = this.noteData.pages.map((p, index) => ({ index, title: p.title ?? '' }));
        new GoToPageModal(this.app, entries, (i) => this.scrollToPage(i)).open();
    },

    /** Table of contents panel (under the toolbar button or the "More" menu). */
    toggleContentsPanel(anchor: HTMLElement) {
        if (this.contentsPanel) { this.closeContentsPanel(); return; }
        const panel = document.body.createDiv({ cls: 'hw-menu hw-contents' });
        this.contentsPanel = panel;
        this.contentsAnchor = anchor;
        this.refreshContentsPanel();
        // Position: under the button, within the window.
        const r = anchor.getBoundingClientRect();
        panel.style.display = 'flex';
        const w = panel.offsetWidth, h = panel.offsetHeight;
        panel.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
        let top = r.bottom + 8;
        if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
        panel.style.top = `${top}px`;
        const outside = (e: PointerEvent) => {
            const t = e.target as Node;
            if (panel.contains(t) || anchor.contains(t)) return;
            this.closeContentsPanel();
        };
        document.addEventListener('pointerdown', outside, true);
        this.contentsCleanup = () => document.removeEventListener('pointerdown', outside, true);
    },

    closeContentsPanel() {
        this.contentsCleanup?.();
        this.contentsCleanup = null;
        this.contentsPanel?.remove();
        this.contentsPanel = null;
    },

    refreshContentsPanel() {
        const panel = this.contentsPanel;
        if (!panel) return;
        panel.empty();
        panel.createDiv({ cls: 'hw-menu-title', text: 'Contents' });
        const list = panel.createDiv({ cls: 'hw-contents-list' });
        const cur = this.pageIndexAtViewCenter();
        const titled = this.titledPages();
        // Current "section": the last title on this page or before it.
        let section = -1;
        for (const t of titled) if (t.index <= cur) section = t.index;
        if (titled.length === 0) {
            list.createDiv({ cls: 'hw-contents-empty', text: 'No titled pages yet. Give a page a title to build the table of contents – it also becomes a bookmark in exported PDFs.' });
        }
        for (const t of titled) {
            const row = list.createEl('button', { cls: 'hw-contents-item' });
            if (t.index === section) row.addClass('active');
            row.createSpan({ cls: 'hw-contents-title', text: t.title });
            row.createSpan({ cls: 'hw-contents-page', text: String(t.index + 1) });
            row.onclick = () => { this.scrollToPage(t.index); this.closeContentsPanel(); };
            row.oncontextmenu = (e) => { e.preventDefault(); this.closeContentsPanel(); this.editPageTitle(t.index); };
        }
        const foot = panel.createDiv({ cls: 'hw-contents-foot' });
        const has = !!this.noteData.pages[cur]?.title;
        const edit = foot.createEl('button', { text: has ? `Rename page ${cur + 1}…` : `Title page ${cur + 1}…` });
        edit.disabled = !this.canEdit();
        edit.onclick = () => { this.closeContentsPanel(); this.editPageTitle(cur); };
        const go = foot.createEl('button', { text: 'Go to page…' });
        go.onclick = () => { this.closeContentsPanel(); this.openGoToPage(); };
    },
});
export type ContentsMethods = typeof contentsMixin;
