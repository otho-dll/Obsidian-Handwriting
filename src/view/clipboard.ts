import { defineMixin } from './mixin';
import { Notice } from 'obsidian';
import { ImageItem, PageData } from '../types';
import { newId } from '../utils';
import { VaultAdapter, isLocalRef, copyLocalRef, writeDataMeta } from '../dataFolder';

/** Cut / copy / paste of the selection (strokes and images) – also between pages and notes. */
export const clipboardMixin = defineMixin({
    copySelection(cut: boolean) {
        const sel = this.selection;
        if (!sel || (sel.strokes.length === 0 && sel.images.length === 0)) return;
        const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
        this.plugin.clip = { strokes: sel.strokes.map(s => clone(s)), images: sel.images.map(i => clone(i)), from: this.file?.path };
        const n = sel.strokes.length + sel.images.length;
        if (cut) this.deleteSelection();
        new Notice(`${cut ? 'Cut' : 'Copied'} ${n} item${n === 1 ? '' : 's'}. Paste with the right-click menu (Paste here) or Ctrl+V.`);
    },

    /** Pastes the plugin clipboard on the page under the pointer (or in the middle of the view). */
    pasteClip(at?: { clientX: number; clientY: number }) {
        const clip = this.plugin.clip;
        if (!clip) return;
        // Images from another note's hidden folder must first be copied to this note's folder.
        const here = this.file?.path;
        if (clip.from && here && clip.from !== here && clip.images.some(i => isLocalRef(i.path))) {
            const from = clip.from;
            void (async () => {
                const a = this.app.vault.adapter as VaultAdapter;
                const images: ImageItem[] = [];
                for (const im of clip.images) {
                    const c = { ...im };
                    if (isLocalRef(im.path)) {
                        try { c.path = await copyLocalRef(a, from, here, im.path, newId); }
                        catch { new Notice('An image could not be copied to this note.'); continue; }
                    }
                    images.push(c);
                }
                await writeDataMeta(a, here, this.noteData.id);
                this.plugin.clip = { strokes: clip.strokes, images, from: here };
                this.pasteClip(at);
            })();
            return;
        }
        let pageIndex = this.pageIndexAtViewCenter();
        let center: { x: number; y: number } | null = null;
        if (at) {
            const idx = this.pageIndexAt(at.clientX, at.clientY);
            if (idx >= 0) { pageIndex = idx; center = this.clientToPage(idx, at.clientX, at.clientY); }
        }
        const page = this.noteData.pages[pageIndex];
        if (!page) return;
        if (!center) center = this.getVisibleCenter(pageIndex);

        // Copies with new ids and new groups (a pasted group doesn't join the original).
        const { strokes, images } = this.cloneItems(clip.strokes, clip.images);

        // Centre of the pasted group → paste point (clamped to the page).
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const s of strokes) { const b = this.getStrokeBBox(s); x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
        for (const i of images) for (const p of this.imageCorners(i)) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
        if (!isFinite(x0)) return;
        let dx = center.x - (x0 + x1) / 2, dy = center.y - (y0 + y1) / 2;
        dx = Math.max(-x0, Math.min(this.pageW(pageIndex) - x1, dx));
        dy = Math.max(-y0, Math.min(this.pageH(pageIndex) - y1, dy));
        this.translateItems(strokes, images, dx, dy);

        page.strokes.push(...strokes);
        (page.images ?? (page.images = [])).push(...images);
        this.pushHistoryAction({ type: 'paste', page: pageIndex, strokes, images });
        this.requestSave();
        this.activateLassoForInsert();
        this.selection = { page: pageIndex, strokes: [...strokes], images: [...images] };
        this.updateSelectionUI();
        this.redrawPage(pageIndex);
    },

    /** Copies a whole page (content, background, pattern, paper, size) – "Paste page" inserts it in any note. */
    copyPage(i: number) {
        const page = this.noteData.pages[i];
        if (!page) return;
        this.plugin.pageClip = { page: JSON.parse(JSON.stringify(page)) as PageData, from: this.file?.path };
        new Notice('Page copied. Paste it in any note with the right-click menu (Paste page).');
    },

    /** Inserts the copied page as a new page at position `at`. */
    pastePage(at: number) {
        const clip = this.plugin.pageClip;
        if (!clip || !this.canEdit() || this.endlessBlocksPages()) return;
        if (clip.page.endless && this.noteData.pages.length > 0) {
            new Notice('An endless page can only be pasted into an empty note. Change the copied page to Portrait or Landscape first.', 7000);
            return;
        }
        const page = JSON.parse(JSON.stringify(clip.page)) as PageData;
        // Files from another note's hidden folder (images, PDF background) must first be copied to this note's folder.
        const here = this.file?.path;
        const from = clip.from;
        const refs = [page.bgPath, ...(page.images ?? []).map(im => im.path)];
        if (from && here && from !== here && refs.some(r => isLocalRef(r))) {
            void (async () => {
                const a = this.app.vault.adapter as VaultAdapter;
                try {
                    if (isLocalRef(page.bgPath)) page.bgPath = await copyLocalRef(a, from, here, page.bgPath, newId);
                } catch { new Notice('The page background could not be copied to this note.'); delete page.bgPath; }
                const images: ImageItem[] = [];
                for (const im of page.images ?? []) {
                    if (isLocalRef(im.path)) {
                        try { im.path = await copyLocalRef(a, from, here, im.path, newId); }
                        catch { new Notice('An image could not be copied to this note.'); continue; }
                    }
                    images.push(im);
                }
                if (page.images) page.images = images;
                await writeDataMeta(a, here, this.noteData.id);
                // The copied files are now in this note's folder: further pastes here need no copying.
                this.plugin.pageClip = { page: JSON.parse(JSON.stringify(page)) as PageData, from: here };
                this.pastePage(at);
            })();
            return;
        }
        for (const im of page.images ?? []) im.id = `${im.id}-${Math.random().toString(36).slice(2, 7)}`;
        const pages = [...this.noteData.pages];
        const pos = Math.max(0, Math.min(at, pages.length));
        pages.splice(pos, 0, page);
        this.applyPagesArray(pages, pos, 'Page pasted');
    },
});
export type ClipboardMethods = typeof clipboardMixin;
