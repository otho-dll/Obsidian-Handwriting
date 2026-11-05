import { defineMixin } from './mixin';
import { PageTitleModal, GoToPageModal } from '../contentsModals';

/**
 * Table of contents: pages may have titles (the page `title` field). Titles are shown in the "Contents" panel,
 * in the pages panel (sections) and as bookmarks in PDF export.
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
        this.buildPageIndicator();
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

    /** Contents = a view of the pages panel (titled pages). */
    toggleContentsPanel(_anchor?: HTMLElement) {
        this.togglePagesPanel('contents');
    },

    closeContentsPanel() {
        if (this.ppTab === 'contents') this.closePagesPanel();
    },

    refreshContentsPanel() {
        if (this.pagesPanelEl) this.refreshPagesPanel();
    },
});
export type ContentsMethods = typeof contentsMixin;
