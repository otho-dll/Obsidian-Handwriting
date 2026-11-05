import { defineMixin } from './mixin';
import { pageWidth, pageHeight } from '../pageFormat';

/**
 * Page rail: a thin strip along the whole edge of the view that works like a scrollbar for the note
 * (top = first page, bottom = last page; titled pages are small ticks).
 * Dragging along it shows a preview card of the page under the finger ("74 / 120" + section title);
 * releasing jumps there. A tap jumps at once.
 * Precision (Settings → Page navigation): 'fine' – moving the finger away from the edge slows the rail
 * down 4× and the preview snaps to section starts; 'simple' – the rail maps straight to the note.
 */
const FINE_DISTANCE = 56;   // px away from the rail where the fine mode starts
const FINE_FACTOR = 0.25;
const SNAP_PX = 8;          // rail px around a section tick that snap to it
const PREVIEW_W = 168;
const PREVIEW_CACHE = 48;   // rendered preview canvases kept (most recently used)
// Palm protection for touches on the rail (mouse and pen are not affected):
const RAIL_PALM_PX = 40;    // contact larger than this (CSS px) = a palm / the side of the hand
const RAIL_PEN_MS = 700;    // the pen was used this recently = the hand is resting while writing

export const pageRailMixin = defineMixin({
    buildPageRail() {
        if (this.railEl) { this.railEl.remove(); this.railEl = null; }
        if (this.railBadge) { this.railBadge.remove(); this.railBadge = null; }
        if (this.railPreview) { this.railPreview.remove(); this.railPreview = null; }
        this.railVp = null;
        this.railTicks = [];
        this.railCurrent = -1;   // pages were rebuilt: mark the current page again
        this.previewCache.clear();
        const st = this.plugin.settings;
        if (!this.scrollArea || st.minimap === 'off') { this.refreshPagesPanel(); return; }

        const side = st.minimapSide;
        const el = this.scrollArea.createDiv({ cls: `hw-rail hw-rail-${side}${st.minimap === 'auto' ? ' hw-rail-auto' : ''}` });
        el.setAttribute('aria-label', 'Page navigation – drag to preview, release to jump');
        const track = el.createDiv({ cls: 'hw-rail-track' });
        // Ticks: pages with a title (sections).
        const docH = this.railDocHeight();
        const tops = this.pageTops();
        this.noteData.pages.forEach((p, i) => {
            if (!p.title) return;
            const t = track.createDiv({ cls: 'hw-rail-tick' });
            t.style.top = `${(tops[i] / docH) * 100}%`;
            this.railTicks.push(i);
        });
        this.railVp = track.createDiv({ cls: 'hw-rail-vp' });
        this.railBadge = this.scrollArea.createDiv({ cls: `hw-rail-badge hw-rail-badge-${side}` });

        const preview = this.scrollArea.createDiv({ cls: `hw-rail-preview hw-rail-preview-${side}` });
        // The page thumbnail with a frame showing which part of the page the jump will show.
        const sheet = preview.createDiv({ cls: 'hw-rail-preview-sheet' });
        const pc = sheet.createEl('canvas');
        sheet.createDiv({ cls: 'hw-rail-preview-view' });
        pc.width = PREVIEW_W * 2; pc.height = Math.round(PREVIEW_W * 2 * 1.414);
        const meta = preview.createDiv({ cls: 'hw-rail-preview-meta' });
        meta.createSpan({ cls: 'hw-rail-preview-num' });
        meta.createSpan({ cls: 'hw-rail-preview-sec' });
        meta.createSpan({ cls: 'hw-rail-preview-whole-tag', text: 'whole page' });
        preview.createDiv({ cls: 'hw-rail-preview-title' });
        this.railPreview = preview;

        // --- scrubbing ---
        let drag: { id: number; docY: number; lastY: number; moved: boolean; startY: number; touch: boolean } | null = null;
        const railRect = () => track.getBoundingClientRect();
        const absDocY = (clientY: number) => {
            const r = railRect();
            return Math.max(0, Math.min(1, (clientY - r.top) / Math.max(1, r.height))) * this.railDocHeight();
        };
        const snapDocY = (docY: number) => {
            if (this.plugin.settings.railPrecision !== 'fine') return docY;
            const r = railRect();
            const H = this.railDocHeight();
            const tp = this.pageTops();
            for (const i of this.railTicks) {
                if (Math.abs((tp[i] - docY) / H * r.height) <= SNAP_PX) return tp[i] + 1;
            }
            return docY;
        };
        const bigContact = (e: PointerEvent) => Math.max(e.width || 0, e.height || 0) > RAIL_PALM_PX;
        /** Ends the scrubbing; `jump` = go to the chosen place (false: cancelled, the view stays where it was). */
        const finish = (pointerId: number, jump: boolean) => {
            if (!drag) return;
            const docY = snapDocY(drag.docY);
            drag = null;
            this.railDragging = false;
            try { if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId); } catch { /* ignore */ }
            el.removeClass('hw-rail-active');
            el.removeClass('hw-rail-fine');
            this.hideRailPreview();
            if (jump) this.jumpToDocY(docY);
            this.updatePageRail();
        };
        // A palm touching down elsewhere / the pen touching the screen cancels a finger scrub (no jump).
        this.cancelRailTouch = () => { if (drag?.touch) finish(drag.id, false); };
        el.addEventListener('pointerdown', (e: PointerEvent) => {
            e.stopPropagation();
            e.preventDefault();
            if (e.pointerType === 'touch') {
                // Fingers only: not a large contact, not a second touch on the screen, not right after writing.
                if (this.shouldRejectTouch(e) || bigContact(e) || this.touchIds.size > 1
                    || performance.now() - this.lastPenAt < RAIL_PEN_MS) return;
            }
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if (drag) return;
            this.stopInertia();
            try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
            const docY = absDocY(e.clientY);
            drag = { id: e.pointerId, docY, lastY: e.clientY, moved: false, startY: e.clientY, touch: e.pointerType === 'touch' };
            this.railDragging = true;
            el.addClass('hw-rail-active');
            this.showRailPreview(snapDocY(docY), e.clientY);
        });
        el.addEventListener('pointermove', (e: PointerEvent) => {
            if (!drag || e.pointerId !== drag.id) return;
            e.stopPropagation();
            // the contact grew (the hand settled down on the rail): a palm, not a finger
            if (drag.touch && bigContact(e)) { finish(e.pointerId, false); return; }
            const dy = e.clientY - drag.lastY;
            drag.lastY = e.clientY;
            if (Math.abs(e.clientY - drag.startY) > 3) drag.moved = true;
            const r = railRect();
            const far = this.plugin.settings.railPrecision === 'fine' && Math.abs(e.clientX - (r.left + r.width / 2)) > FINE_DISTANCE;
            const perPx = this.railDocHeight() / Math.max(1, r.height);
            // Near the rail the movement is 1:1 with the rail; away from it (fine mode) 4× slower.
            drag.docY = Math.max(0, Math.min(this.railDocHeight(), drag.docY + dy * perPx * (far ? FINE_FACTOR : 1)));
            el.toggleClass('hw-rail-fine', far);
            this.showRailPreview(snapDocY(drag.docY), e.clientY, far);
        });
        const end = (e: PointerEvent, cancel: boolean) => {
            if (!drag || e.pointerId !== drag.id) return;
            finish(e.pointerId, !cancel);
        };
        el.addEventListener('pointerup', (e) => end(e, false));
        el.addEventListener('pointercancel', (e) => end(e, true));
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });

        this.railEl = el;
        this.updatePageRail();
        this.refreshPagesPanel();
    },

    /** Index of the page under point y (page column coordinates) and the offset from its top edge. */
    pageAtWrapperY(y: number): { i: number; within: number } {
        const tops = this.pageTops();
        let i = 0;
        while (i + 1 < tops.length && y >= tops[i + 1] - 7.5) i++;
        return { i, within: y - (tops[i] ?? 0) };
    },

    /** Height of the whole page column (page coordinates). */
    railDocHeight(): number {
        const tops = this.pageTops();
        const n = tops.length;
        if (n === 0) return 1;
        return Math.max(1, tops[n - 1] + this.pageH(n - 1));
    },

    /**
     * Where a jump to docY lands: the page and the new vertical view position. A page starts at the top; a page much
     * taller than the view (zoomed in, endless page) is centred on docY. Used by the jump and by the preview frame,
     * so the preview always shows exactly the part of the page the jump will show.
     */
    railJumpTarget(docY: number): { i: number; posY: number; centred: boolean } {
        const { i, within } = this.pageAtWrapperY(docY);
        const z = this.currentZoom;
        const viewH = this.scrollArea.clientHeight / z;
        if (this.pageH(i) > viewH * 1.5 && within > viewH * 0.5) {
            return { i, posY: this.scrollArea.clientHeight / 2 - docY * z, centred: true };
        }
        const top = this.pageViews[i]?.outer.offsetTop ?? this.pageTops()[i] ?? 0;
        return { i, posY: -(top - 10) * z, centred: false };   // the same position as scrollToPage
    },

    /** Jumps so that the place docY is in view (see railJumpTarget). */
    jumpToDocY(docY: number) {
        const t = this.railJumpTarget(docY);
        if (t.centred) {
            this.stopInertia();
            this.pagePositionY = t.posY;
            this.applyManualZoom();
            this.scheduleRedrawAfterZoom();
        } else {
            this.scrollToPage(t.i);
        }
    },

    /**
     * Frame on the rail preview: the part of page i that will be visible after the jump (in thumbnail pixels).
     * Always shown – when the whole page fits in the view, the frame outlines the whole thumbnail ("whole page"),
     * and when the view reaches past the page, its bottom edge is dashed (the next page is visible too).
     */
    placeRailPreviewFrame(i: number, posY: number) {
        const frame = this.railPreview?.querySelector('.hw-rail-preview-view') as HTMLElement | null;
        const view = this.pageViews[i];
        if (!frame || !view || !this.scrollArea) return;
        const page = this.noteData.pages[i];
        const z = this.currentZoom;
        const PW = this.pageW(i), PH = this.pageH(i);
        const pageTop = view.outer.offsetTop + view.container.offsetTop;
        const pageLeft = view.outer.offsetLeft + view.container.offsetLeft;
        // visible part of the page after the jump (page coordinates; the horizontal position does not change)
        const viewBottom = (this.scrollArea.clientHeight - posY) / z - pageTop;
        const top = Math.max(0, -posY / z - pageTop);
        const bottom = Math.min(PH, viewBottom);
        const left = Math.max(0, -this.pagePositionX / z - pageLeft);
        const right = Math.min(PW, (this.scrollArea.clientWidth - this.pagePositionX) / z - pageLeft);
        const whole = top <= 1 && bottom >= PH - 1 && left <= 1 && right >= PW - 1;
        frame.toggleClass('is-on', bottom > top && right > left);
        frame.toggleClass('is-whole', whole);
        frame.toggleClass('is-more', viewBottom > PH + 20 && i < this.noteData.pages.length - 1);
        this.railPreview?.toggleClass('hw-rail-preview-whole', whole);
        // thumbnail scale: the page fills the width; an endless page shows its beginning (A4 proportions)
        const k = PREVIEW_W / PW;
        const shownH = page.endless ? PREVIEW_W * 1.414 : PH * k;
        let t = top * k, h = (bottom - top) * k;
        // beyond the shown part of an endless page: the frame stays at the bottom edge, marked as "further down"
        const below = t > shownH - 6;
        if (below) { t = shownH - 6; h = 6; }
        frame.toggleClass('is-below', below);
        frame.style.top = `${t}px`;
        frame.style.height = `${Math.max(4, Math.min(h, shownH - t))}px`;
        frame.style.left = `${left * k}px`;
        frame.style.width = `${Math.max(4, (right - left) * k)}px`;
    },

    /** Preview card next to the rail: page under the finger, its number and section. */
    showRailPreview(docY: number, clientY: number, fine = false) {
        const card = this.railPreview;
        if (!card || !this.scrollArea) return;
        // The accent marker follows the finger while scrubbing (not only after the jump).
        if (this.railVp) {
            this.railVp.addClass('is-scrubbing');
            this.railVp.style.top = `calc(${(docY / this.railDocHeight()) * 100}% - 7px)`;
            this.railVp.style.height = '14px';
        }
        const n = this.noteData.pages.length;
        const i = Math.max(0, Math.min(n - 1, this.pageAtWrapperY(docY).i));
        const area = this.scrollArea.getBoundingClientRect();
        card.addClass('hw-rail-preview-on');
        card.toggleClass('hw-rail-preview-fine', fine);
        const h = card.offsetHeight || 300;
        const y = Math.max(8, Math.min(area.height - h - 8, clientY - area.top - h / 2));
        card.style.top = `${y}px`;
        // The frame moves with every step (also while the page under the finger stays the same).
        const target = this.railJumpTarget(docY);
        this.placeRailPreviewFrame(i, target.i === i ? target.posY : -((this.pageViews[i]?.outer.offsetTop ?? 0) - 10) * this.currentZoom);
        if (this.railPreviewPage === i) return;
        this.railPreviewPage = i;
        const page = this.noteData.pages[i];
        const real = this.effectiveStyle(i).paper;
        card.toggleClass('hw-oled-inv', this.displayPaper(real) !== real);
        // Section = the last titled page at or before i.
        let sec = -1;
        for (let k = i; k >= 0; k--) if (this.noteData.pages[k].title) { sec = k; break; }
        (card.querySelector('.hw-rail-preview-num') as HTMLElement).setText(`${i + 1} / ${n}`);
        (card.querySelector('.hw-rail-preview-sec') as HTMLElement).setText(sec >= 0 ? `§ ${this.railTicks.indexOf(sec) + 1}` : '');
        (card.querySelector('.hw-rail-preview-title') as HTMLElement).setText(sec >= 0 ? this.noteData.pages[sec].title ?? '' : '');
        const c = card.querySelector('canvas') as HTMLCanvasElement;
        const ratio = page.endless ? 1.414 : pageHeight(page) / pageWidth(page);
        const ch = Math.round(PREVIEW_W * 2 * ratio);
        if (c.height !== ch) { c.height = ch; }
        c.style.height = `${Math.round(PREVIEW_W * ratio)}px`;
        const cached = this.previewCache.get(i);
        const ctx = c.getContext('2d')!;
        if (cached) {
            // most recently used goes to the end of the map
            this.previewCache.delete(i); this.previewCache.set(i, cached);
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.drawImage(cached, 0, 0, c.width, c.height);
            return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        // Drawn once per frame at most (fast scrubbing skips pages in between).
        if (this.railPreviewRaf) window.cancelAnimationFrame(this.railPreviewRaf);
        this.railPreviewRaf = window.requestAnimationFrame(() => {
            this.railPreviewRaf = 0;
            if (this.railPreviewPage !== i) return;
            const off = document.createElement('canvas');
            off.width = c.width; off.height = c.height;
            void this.renderThumbInner(i, off).then(() => {
                this.previewCache.set(i, off);
                while (this.previewCache.size > PREVIEW_CACHE) this.previewCache.delete(this.previewCache.keys().next().value as number);
                if (this.railPreviewPage === i) { ctx.clearRect(0, 0, c.width, c.height); ctx.drawImage(off, 0, 0); }
            });
            // paper and ink are painted synchronously – show them right away
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.drawImage(off, 0, 0);
        });
    },

    hideRailPreview() {
        this.railVp?.removeClass('is-scrubbing');
        this.railPreview?.removeClass('hw-rail-preview-on');
        this.railPreviewPage = -1;
    },

    /** Current view on the rail; the "12 / 40" badge while scrolling. Called after every view change. */
    updatePageRail() {
        const el = this.railEl, vp = this.railVp;
        const n = this.noteData.pages.length;
        const viewH = this.scrollArea?.clientHeight ?? 0;
        const z = this.currentZoom;
        const cy = (viewH / 2 - this.pagePositionY) / z;
        const idx = n ? Math.max(0, Math.min(n - 1, this.pageAtWrapperY(cy).i)) : 0;
        if (idx !== this.railCurrent) {
            this.railCurrent = idx;
            this.markPanelCurrent(idx);
        }
        this.placeCurrentFrame(idx);
        if (!el || !vp || viewH === 0) return;
        const H = this.railDocHeight();
        const t = Math.max(0, Math.min(1, (-this.pagePositionY / z) / H));
        const b = Math.max(t, Math.min(1, ((viewH - this.pagePositionY) / z) / H));
        vp.style.top = `${t * 100}%`;
        vp.style.height = `max(14px, ${(b - t) * 100}%)`;

        const badge = this.railBadge;
        if (badge && !this.railDragging) {
            badge.setText(`${idx + 1} / ${n}`);
            const trackH = el.clientHeight;
            const by = 8 + ((t + b) / 2) * trackH;
            badge.style.top = `${Math.max(8, Math.min(viewH - 30, by - 11))}px`;
            badge.addClass('hw-rail-badge-on');
            if (this.railBadgeTimer !== null) window.clearTimeout(this.railBadgeTimer);
            this.railBadgeTimer = window.setTimeout(() => { this.railBadgeTimer = null; badge.removeClass('hw-rail-badge-on'); }, 900);
        }
        if (this.plugin.settings.minimap === 'auto') {
            el.addClass('hw-rail-visible');
            if (this.railHideTimer !== null) window.clearTimeout(this.railHideTimer);
            this.railHideTimer = window.setTimeout(() => {
                this.railHideTimer = null;
                if (!this.railDragging) el.removeClass('hw-rail-visible');
            }, 1600);
        }
    },

    /**
     * Current page: an accent frame drawn in screen pixels over the page edge (not inside the zoomed pages),
     * so it is equally visible at every zoom level. Only when the note has more than one page.
     */
    placeCurrentFrame(i: number) {
        const area = this.scrollArea;
        if (!area) return;
        let fr = this.curFrame;
        const view = this.pageViews[i];
        const multi = this.noteData.pages.length >= 2 && !!view;
        // Other pages are dimmed (a veil inside each page), so the current one stands out.
        const want = multi ? view.outer : null;
        if (this.curPageEl !== want) {
            this.curPageEl?.removeClass('hw-page-current');
            want?.addClass('hw-page-current');
            this.curPageEl = want;
        }
        this.pagesWrapper?.toggleClass('hw-dim-others', multi);
        if (!multi) { if (fr) fr.style.display = 'none'; return; }
        if (!fr || fr.parentElement !== area) { fr?.remove(); fr = area.createDiv({ cls: 'hw-current-frame' }); this.curFrame = fr; }
        const z = this.currentZoom;
        const x = this.pagePositionX + (view.outer.offsetLeft + view.container.offsetLeft) * z;
        const y = this.pagePositionY + (view.outer.offsetTop + view.container.offsetTop) * z;
        fr.style.display = '';
        fr.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        fr.style.width = `${Math.round(this.pageW(i) * z)}px`;
        fr.style.height = `${Math.round(this.pageH(i) * z)}px`;
    },

    /** Height of one page changed (an endless page grew). */
    updatePageRailSize(i: number) {
        void i;
        this.updatePageRail();
    },

    /** Page content changed: thumbnails (preview cache, pages panel) are redrawn later. */
    markThumbDirty(i: number) {
        // An endless page may need more room (checked with a delay).
        if (this.noteData.pages[i]?.endless) {
            if (this.roomTimer !== null) window.clearTimeout(this.roomTimer);
            this.roomTimer = window.setTimeout(() => { this.roomTimer = null; this.ensurePageRoom(i); }, 250);
        }
        this.previewCache.delete(i);
        this.markPanelThumbDirty(i);
    },
});
export type PageRailMethods = typeof pageRailMixin;
