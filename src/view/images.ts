import { defineMixin } from './mixin';
import { Notice } from 'obsidian';
import { mimeFromPath, extFromMime, canvasToBlob, blobToDataUrl, loadImageEl, rotatePointAbout } from '../utils';
import { Point, ImageItem, ImageSnap } from '../types';

export const imagesMixin = defineMixin({
    // --- IMAGE CROPPING ---
    clientToPage(idx: number, clientX: number, clientY: number): Point {
        const r = this.pageViews[idx].container.getBoundingClientRect();
        return this.mkPoint((clientX - r.left) * this.pageW(idx) / r.width, (clientY - r.top) * this.pageH(idx) / r.height);
    },

    imageAtPoint(page: number, pos: Point, includeLocked = false): ImageItem | null {
        const images = this.noteData.pages[page]?.images ?? [];
        for (let k = images.length - 1; k >= 0; k--) {
            const i = images[k];
            if (i.lock && !includeLocked) continue;
            const cx = i.x + i.w / 2, cy = i.y + i.h / 2;
            const local = i.rot ? rotatePointAbout(pos, cx, cy, -i.rot) : pos;
            if (Math.abs(local.x - cx) <= i.w / 2 && Math.abs(local.y - cy) <= i.h / 2) return i;
        }
        return null;
    },

    snapImage(i: ImageItem): ImageSnap {
        return { path: i.path, data: i.data, x: i.x, y: i.y, w: i.w, h: i.h, plot: i.plot };
    },

    applyImageSnap(i: ImageItem, snap: ImageSnap) {
        i.x = snap.x; i.y = snap.y; i.w = snap.w; i.h = snap.h;
        if (snap.plot) i.plot = snap.plot; else delete i.plot;
        if (snap.path) { i.path = snap.path; delete i.data; } else { delete i.path; i.data = snap.data; }
        // The <img> element must load the new file.
        for (const v of this.pageViews) {
            const el = v.imgEls.get(i.id);
            if (el) { el.removeAttribute('src'); delete el.dataset.src; }
        }
    },

    cancelCrop() {
        if (this.cropOverlay) { this.cropOverlay.remove(); this.cropOverlay = null; }
        if (this.cropBar) { this.cropBar.remove(); this.cropBar = null; }
        if (this.cropKeyHandler) { document.removeEventListener('keydown', this.cropKeyHandler, true); this.cropKeyHandler = null; }
    },

    // Crop mode: a frame with handles on the image; "Apply" saves the cropped part as a new file (undoable).
    startImageCrop(pageIndex: number, img: ImageItem) {
        this.cancelCrop();
        const view = this.pageViews[pageIndex];
        if (!view) return;
        this.selection = null;
        this.updateSelectionUI();
        this.redrawPage(pageIndex);
        const rot = img.rot ?? 0;
        const ov = view.container.createEl('div', { cls: 'hw-crop-overlay' });
        this.cropOverlay = ov;
        ov.style.left = `${img.x}px`;
        ov.style.top = `${img.y}px`;
        ov.style.width = `${img.w}px`;
        ov.style.height = `${img.h}px`;
        ov.style.transform = rot ? `rotate(${rot}rad)` : '';
        const box = ov.createEl('div', { cls: 'hw-crop-box' });
        for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
            const el = box.createEl('div', { cls: `hw-crop-handle hw-crop-h-${h}` });
            el.dataset.h = h;
        }
        let l = 0, t = 0, r = 1, b = 1;
        const MIN = 0.05;
        const layout = () => {
            box.style.left = `${l * 100}%`;
            box.style.top = `${t * 100}%`;
            box.style.width = `${(r - l) * 100}%`;
            box.style.height = `${(b - t) * 100}%`;
        };
        layout();

        let drag: { h: string; sx: number; sy: number; l: number; t: number; r: number; b: number } | null = null;
        const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
        ov.addEventListener('pointerdown', (e: PointerEvent) => {
            const target = e.target as HTMLElement;
            const h = target.dataset.h ?? (box.contains(target) ? 'move' : null);
            e.stopPropagation();
            e.preventDefault();
            if (!h) return;
            drag = { h, sx: e.clientX, sy: e.clientY, l, t, r, b };
            ov.setPointerCapture(e.pointerId);
        });
        ov.addEventListener('pointermove', (e: PointerEvent) => {
            if (!drag) return;
            e.stopPropagation();
            e.preventDefault();
            const rc = view.container.getBoundingClientRect();
            const k = this.pageW(pageIndex) / rc.width;
            const dx = (e.clientX - drag.sx) * k, dy = (e.clientY - drag.sy) * k;
            const c = Math.cos(rot), sn = Math.sin(rot);
            const fx = (dx * c + dy * sn) / img.w;      // shift in image coordinates (includes rotation)
            const fy = (-dx * sn + dy * c) / img.h;
            if (drag.h === 'move') {
                const mx = clamp(fx, -drag.l, 1 - drag.r), my = clamp(fy, -drag.t, 1 - drag.b);
                l = drag.l + mx; r = drag.r + mx; t = drag.t + my; b = drag.b + my;
            } else {
                if (drag.h.includes('w')) l = clamp(drag.l + fx, 0, drag.r - MIN);
                if (drag.h.includes('e')) r = clamp(drag.r + fx, drag.l + MIN, 1);
                if (drag.h.includes('n')) t = clamp(drag.t + fy, 0, drag.b - MIN);
                if (drag.h.includes('s')) b = clamp(drag.b + fy, drag.t + MIN, 1);
            }
            layout();
        });
        const endDrag = (e: PointerEvent) => {
            if (drag && ov.hasPointerCapture(e.pointerId)) ov.releasePointerCapture(e.pointerId);
            drag = null;
        };
        ov.addEventListener('pointerup', endDrag);
        ov.addEventListener('pointercancel', endDrag);

        const bar = this.scrollArea.createEl('div', { cls: 'hw-crop-bar' });
        this.cropBar = bar;
        bar.addEventListener('pointerdown', (e) => e.stopPropagation());
        bar.createEl('span', { text: 'Crop image', cls: 'hw-crop-title' });
        const bReset = bar.createEl('button', { text: 'Reset' });
        const bCancel = bar.createEl('button', { text: 'Cancel' });
        const bApply = bar.createEl('button', { text: 'Apply', cls: 'mod-cta' });
        bReset.onclick = () => { l = 0; t = 0; r = 1; b = 1; layout(); };
        bCancel.onclick = () => this.cancelCrop();

        let busy = false;
        const apply = async () => {
            if (busy) return;
            if (r - l > 0.998 && b - t > 0.998) { this.cancelCrop(); return; }
            busy = true;
            try {
                const url = await this.getImageUrl(img);
                const el = url ? await loadImageEl(url) : null;
                if (!el || el.naturalWidth <= 0) { new Notice('Could not read the image.'); return; }
                const nw = el.naturalWidth, nh = el.naturalHeight;
                const sx = Math.round(l * nw), sy = Math.round(t * nh);
                const sw = Math.max(1, Math.round((r - l) * nw)), sh = Math.max(1, Math.round((b - t) * nh));
                const canvas = document.createElement('canvas');
                canvas.width = sw;
                canvas.height = sh;
                canvas.getContext('2d')!.drawImage(el, sx, sy, sw, sh, 0, 0, sw, sh);
                const srcMime = img.path ? mimeFromPath(img.path) : (img.data?.startsWith('data:image/jpeg') ? 'image/jpeg' : 'image/png');
                const type = srcMime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
                const blob = await canvasToBlob(canvas, type, 0.92);
                canvas.width = 0;
                if (!blob) { new Notice('Could not crop the image.'); return; }

                const before = this.snapImage(img);
                const path = await this.saveAsset(await blob.arrayBuffer(), extFromMime(type));
                const cx = img.x + img.w / 2, cy = img.y + img.h / 2;
                const lcx = ((l + r) / 2 - 0.5) * img.w, lcy = ((t + b) / 2 - 0.5) * img.h;
                const c = Math.cos(rot), sn = Math.sin(rot);
                const wx = cx + lcx * c - lcy * sn, wy = cy + lcx * sn + lcy * c;
                const nwid = (r - l) * img.w, nhei = (b - t) * img.h;
                const after: ImageSnap = { x: wx - nwid / 2, y: wy - nhei / 2, w: nwid, h: nhei };
                if (path) after.path = path; else after.data = await blobToDataUrl(blob);
                this.applyImageSnap(img, after);
                this.pushHistoryAction({ type: 'cropImage', page: pageIndex, image: img, before, after });
                this.cancelCrop();
                this.requestSave();
                this.selection = { page: pageIndex, strokes: [], images: [img] };
                this.updateSelectionUI();
                this.redrawPage(pageIndex);
            } finally {
                busy = false;
            }
        };
        bApply.onclick = () => { void apply(); };
        this.cropKeyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancelCrop(); }
            else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void apply(); }
        };
        document.addEventListener('keydown', this.cropKeyHandler, true);
    },
});
export type ImagesMethods = typeof imagesMixin;
