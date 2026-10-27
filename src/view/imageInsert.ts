import { defineMixin } from './mixin';
import { electronClipboard, openExternal } from '../desktop';
import { Notice } from 'obsidian';
import { blobToDataUrl, newId } from '../utils';
import { ImageItem, ImageSnap } from '../types';
import { PlotModal } from '../math/plotModal';
import { plotSize } from '../math/plot';

export const imageInsertMixin = defineMixin({
    async addImageBlob(blob: Blob, pageIndex: number, cascade: number, at?: { x: number; y: number }): Promise<ImageItem | null> {
        const prep = await this.prepareImage(blob);
        if (!prep) { new Notice('Could not read this image.'); return null; }
        const path = await this.saveAsset(prep.data, prep.ext);
        let dataUrl: string | undefined;
        if (!path) dataUrl = await blobToDataUrl(new Blob([prep.data], { type: prep.type }));

        const page = this.noteData.pages[pageIndex];
        if (!page) return null;
        const PW = this.pageW(pageIndex), PH = Math.min(this.pageH(pageIndex), 1131);
        const k = Math.min(1, (PW * 0.6) / prep.w, (PH * 0.6) / prep.h);
        const w = prep.w * k, h = prep.h * k;
        const c = at ?? this.getVisibleCenter(pageIndex);
        const x = Math.max(0, Math.min(PW - w, c.x - w / 2 + cascade * 24));
        const y = Math.max(0, Math.min(this.pageH(pageIndex) - h, c.y - h / 2 + cascade * 24));
        const image: ImageItem = { id: newId(), path: path ?? undefined, data: dataUrl, x, y, w, h };
        if (!page.images) page.images = [];
        page.images.push(image);
        this.pushHistoryAction({ type: 'addImage', page: pageIndex, image, index: page.images.length - 1 });
        this.requestSave();
        this.redrawPage(pageIndex);
        return image;
    },

    // --- FUNCTION PLOTS ---
    insertPlot() {
        const pageIndex = this.pageIndexAtViewCenter();
        new PlotModal(this.app, null, async (spec, png) => {
            const img = await this.addImageBlob(png, pageIndex, 0);
            if (!img) return;
            img.plot = spec;
            this.requestSave();
            this.activateLassoForInsert();
            this.selection = { page: pageIndex, strokes: [], images: [img] };
            this.updateSelectionUI();
            this.redrawPage(pageIndex);
        }).open();
    },

    editPlot(pageIndex: number, img: ImageItem) {
        if (!img.plot) return;
        new PlotModal(this.app, img.plot, async (spec, png) => {
            const path = await this.saveAsset(await png.arrayBuffer(), 'png');
            const before = this.snapImage(img);
            // The aspect ratio may have changed (e.g. a "wide" plot): keep the width, height from the new image.
            const [pw, ph] = plotSize(spec);
            const h = img.w * ph / pw;
            const after: ImageSnap = { x: img.x, y: img.y + (img.h - h) / 2, w: img.w, h, plot: spec };
            if (path) after.path = path; else after.data = await blobToDataUrl(png);
            this.applyImageSnap(img, after);
            this.pushHistoryAction({ type: 'cropImage', page: pageIndex, image: img, before, after });
            this.requestSave();
            this.redrawPage(pageIndex);
        }).open();
    },

    async addImageBlobs(blobs: Blob[], drop?: { clientX: number; clientY: number }) {
        let pageIndex = this.activePageIndex;
        let at: { x: number; y: number } | undefined;
        if (drop) {
            const idx = this.pageIndexAt(drop.clientX, drop.clientY);
            if (idx >= 0) {
                pageIndex = idx;
                const r = this.pageViews[idx].container.getBoundingClientRect();
                at = { x: (drop.clientX - r.left) / (r.width / this.pageW(idx)), y: (drop.clientY - r.top) / (r.height / this.pageH(idx)) };
            }
        }
        const added: ImageItem[] = [];
        for (let n = 0; n < blobs.length; n++) {
            const img = await this.addImageBlob(blobs[n], pageIndex, n, at);
            if (img) added.push(img);
        }
        if (added.length > 0) {
            // After inserting switch to the lasso and select the images so they can be moved / scaled / rotated right away.
            this.activateLassoForInsert();
            this.selection = { page: pageIndex, strokes: [], images: added };
            this.updateSelectionUI();
            this.redrawPage(pageIndex);
        }
    },

    // --- SNIPPING TOOL (Windows) ---
    // Launches the system snipping tool (ms-screenclip:), then waits for a new image in the clipboard and inserts it on the page.
    stopSnipWatch() {
        if (this.snipTimer !== null) { window.clearInterval(this.snipTimer); this.snipTimer = null; }
    },

    async startSnip() {
        const clipboard = electronClipboard();

        // Short "signature" of the clipboard image, to tell a new screenshot from the one already there.
        const sig = (img: any): string => {
            try {
                if (!img || img.isEmpty()) return '';
                const sz = img.getSize();
                const b: Uint8Array = img.toBitmap();
                const step = Math.max(4, Math.floor(b.length / 509) & ~3);
                let h = 0;
                for (let i = 0; i + 2 < b.length; i += step) h = (h * 31 + b[i] + b[i + 1] * 7 + b[i + 2] * 13) | 0;
                return `${sz.width}x${sz.height}:${h}`;
            } catch (e) { return ''; }
        };
        const baseline = clipboard ? sig(clipboard.readImage()) : '';

        let launched = false;
        for (const uri of ['ms-screenclip:', 'ms-screensketch:']) {
            try {
                if (!(await openExternal(uri))) window.open(uri);
                launched = true;
                break;
            } catch (e) { /* try the next one */ }
        }
        if (!launched) {
            new Notice('Could not start the Snipping Tool. Press Win+Shift+S and paste the result with Ctrl+V.');
            return;
        }
        if (!clipboard) {
            new Notice('Select an area, then paste the screenshot with Ctrl+V.');
            return;
        }

        new Notice('Select an area to capture — the screenshot will be inserted automatically.', 5000);
        this.stopSnipWatch();
        const started = Date.now();
        this.snipTimer = window.setInterval(() => {
            if (Date.now() - started > 120000) { this.stopSnipWatch(); return; }
            const img = clipboard.readImage();
            if (!img || img.isEmpty()) return;
            if (sig(img) === baseline) return;
            this.stopSnipWatch();
            void this.addImageBlobs([new Blob([img.toPNG()], { type: 'image/png' })]);
        }, 700);
        this.registerInterval(this.snipTimer);
    },

    importImages(at?: { clientX: number; clientY: number }) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true;
        input.onchange = () => {
            const files = Array.from(input.files ?? []);
            if (files.length > 0) void this.addImageBlobs(files, at);
        };
        input.click();
    },

    // Pasting an image from the clipboard via the context menu (Clipboard API, or Electron's clipboard without permission).
    async pasteImageFromClipboard(at?: { clientX: number; clientY: number }) {
        const blobs: Blob[] = [];
        try {
            const items = await navigator.clipboard.read();
            for (const item of items) {
                const type = item.types.find(t => t.startsWith('image/'));
                if (type) blobs.push(await item.getType(type));
            }
        } catch (e) { /* no permission or empty clipboard */ }
        if (blobs.length === 0) {
            try {
                const img = electronClipboard()?.readImage?.();
                if (img && !img.isEmpty()) blobs.push(new Blob([img.toPNG()], { type: 'image/png' }));
            } catch (e) { /* no Electron (phone) */ }
        }
        if (blobs.length === 0) {
            new Notice('No image found in the clipboard.');
            return;
        }
        await this.addImageBlobs(blobs, at);
    },
});
export type ImageInsertMethods = typeof imageInsertMixin;
