import { defineMixin } from './mixin';
import { loadImageEl } from '../utils';
import { pageWidth, pageHeight } from '../pageFormat';
import { Stroke, ImageItem, PageData } from '../types';
import { PageTemplate, drawPageTemplate, inkForPaper } from '../templates';

/** Thumbnail canvases that have been drawn at least once. */
const paintedThumbs = new WeakSet<HTMLCanvasElement>();

export const minimapMixin = defineMixin({
    // --- PAGE MINIMAP ---
    buildMinimap() {
        this.thumbDirty.clear();
        if (this.thumbTimer !== null) { window.clearTimeout(this.thumbTimer); this.thumbTimer = null; }
        if (this.minimapEl) { this.minimapEl.remove(); this.minimapEl = null; }
        if (this.minimapBadge) { this.minimapBadge.remove(); this.minimapBadge = null; }
        if (this.minimapCloseTimer !== null) { window.clearTimeout(this.minimapCloseTimer); this.minimapCloseTimer = null; }
        this.minimapInner = null;
        this.minimapVp = null;
        this.minimapCells = [];
        this.minimapCanvases = [];
        this.minimapCurrent = -1;
        const st = this.plugin.settings;
        if (!this.scrollArea || st.minimap === 'off') return;

        const w = st.minimapSize === 'large' ? 120 : st.minimapSize === 'medium' ? 84 : 56;
        const gap = 6;
        this.minimapW = w;
        // Each page has its own thumbnail height (landscape pages are lower, endless ones taller).
        this.minimapHs = this.noteData.pages.map(p => Math.round(w * pageHeight(p) / pageWidth(p)));
        this.layoutMinimapTops();

        const rail = st.minimapStyle === 'rail';
        this.minimapOpen = !rail;
        // Thumbnails are drawn right away in rail mode too – they are ready when the minimap expands.
        this.thumbStale = false;
        const el = this.scrollArea.createEl("div", { cls: `hw-minimap hw-minimap-${st.minimapSide}${st.minimap === 'auto' ? ' hw-minimap-auto' : ''}${rail ? ' hw-mm-rail' : ' hw-mm-open'}` });
        el.style.width = `${w + 12}px`;
        if (rail) this.minimapBadge = this.scrollArea.createEl("div", { cls: `hw-minimap-badge hw-minimap-badge-${st.minimapSide}` });
        const inner = el.createEl("div", { cls: "hw-minimap-inner" });
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        this.noteData.pages.forEach((p, i) => {
            const th = this.minimapHs[i];
            const cell = inner.createEl("div", { cls: "hw-minimap-page" });
            if (this.displayPaper(this.effectiveStyle(i).paper) !== this.effectiveStyle(i).paper) cell.addClass('hw-oled-inv');
            cell.style.width = `${w}px`;
            cell.style.height = `${th}px`;
            cell.style.marginBottom = `${gap}px`;
            let canvas: HTMLCanvasElement | null = null;
            if (st.minimapThumbs) {
                canvas = cell.createEl("canvas");
                canvas.width = Math.round(w * dpr);
                canvas.height = Math.round(th * dpr);
                this.thumbDirty.add(i);
            }
            cell.createEl("span", { cls: "hw-minimap-num", text: String(i + 1) });
            if (p.title) {
                // Page with a title (contents entry): marker and a tooltip with the title.
                cell.addClass('hw-mm-titled');
                cell.setAttribute('title', `${i + 1}. ${p.title}`);
            }
            this.minimapCells.push(cell);
            this.minimapCanvases.push(canvas);
        });
        const vp = inner.createEl("div", { cls: "hw-minimap-vp" });

        // Touching / dragging the minimap scrolls the note. It must not start gestures on the page.
        el.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (e.pointerType === 'touch' && this.shouldRejectTouch(e)) return;
            this.stopInertia();
            this.minimapDragging = true;
            this.setMinimapOpen(true);
            el.setPointerCapture(e.pointerId);
            this.minimapNavigate(e.clientY);
        });
        el.addEventListener('pointermove', (e) => {
            if (!this.minimapDragging) return;
            e.stopPropagation();
            this.minimapNavigate(e.clientY);
        });
        const end = (e: PointerEvent) => {
            if (!this.minimapDragging) return;
            this.minimapDragging = false;
            if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
            this.resizeAndRedrawAll();
            this.updateMinimap();
            this.scheduleMinimapClose(e.pointerType === 'mouse' ? 500 : 1800);
        };
        el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.setMinimapOpen(true); });
        el.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !this.minimapDragging) this.scheduleMinimapClose(500); });
        el.addEventListener('pointerup', end);
        el.addEventListener('pointercancel', end);
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });

        this.minimapEl = el;
        this.minimapInner = inner;
        this.minimapVp = vp;
        this.scheduleThumbs(30);
        this.updateMinimap();
    },

    /** Thumbnail positions in the minimap (top edges) – computed from the thumbnail heights. */
    layoutMinimapTops() {
        const tops: number[] = [];
        let y = 0;
        for (const h of this.minimapHs) { tops.push(y); y += h + 6; }
        this.minimapTops = tops;
        this.minimapTotal = Math.max(0, y - 6);
    },

    /** Height of one page changed (an endless page grew): adjust its thumbnail. */
    updateMinimapPageSize(i: number) {
        const cell = this.minimapCells[i];
        if (!cell) return;
        const p = this.noteData.pages[i];
        const th = Math.round(this.minimapW * pageHeight(p) / pageWidth(p));
        if (th === this.minimapHs[i]) return;
        this.minimapHs[i] = th;
        this.layoutMinimapTops();
        cell.style.height = `${th}px`;
        const c = this.minimapCanvases[i];
        if (c) {
            const dpr = Math.min(2, window.devicePixelRatio || 1);
            c.height = Math.round(th * dpr);
            this.markThumbDirty(i);
        }
        this.updateMinimap();
    },

    /** Index of the page under point y (page column coordinates) and the offset from its top edge. */
    pageAtWrapperY(y: number): { i: number; within: number } {
        const tops = this.pageTops();
        let i = 0;
        while (i + 1 < tops.length && y >= tops[i + 1] - 7.5) i++;
        return { i, within: y - tops[i] };
    },

    wrapperToMinimapY(y: number): number {
        if (this.minimapTops.length === 0) return 0;
        const { i, within } = this.pageAtWrapperY(y);
        const ph = this.pageH(i);
        const f = Math.max(0, Math.min(1, within / ph));
        // The gap between pages (15) maps to the gap between thumbnails (6).
        const gapPart = within > ph ? Math.min(6, (within - ph) / 15 * 6) : 0;
        return this.minimapTops[i] + f * this.minimapHs[i] + gapPart + (within < 0 ? within / 15 * 6 : 0);
    },

    minimapToWrapperY(my: number): number {
        const tops = this.minimapTops;
        if (tops.length === 0) return 0;
        let i = 0;
        while (i + 1 < tops.length && my >= tops[i + 1]) i++;
        const within = Math.max(0, Math.min(this.minimapHs[i], my - tops[i]));
        return this.pageTops()[i] + (within / Math.max(1, this.minimapHs[i])) * this.pageH(i);
    },

    minimapNavigate(clientY: number) {
        const inner = this.minimapInner;
        if (!inner) return;
        const r = inner.getBoundingClientRect();
        const n = this.minimapCells.length;
        const my = Math.max(0, Math.min(this.minimapTotal, clientY - r.top));
        void n;
        const y = this.minimapToWrapperY(my);
        this.pagePositionY = this.scrollArea.clientHeight / 2 - y * this.currentZoom;
        this.applyManualZoom();
    },

    // View frame in the minimap, scrolling the minimap itself (many pages) and highlighting the current page.
    updateMinimap() {
        const el = this.minimapEl, inner = this.minimapInner, vp = this.minimapVp;
        if (!el || !inner || !vp || !this.scrollArea) return;
        const viewH = this.scrollArea.clientHeight;
        const z = this.currentZoom;
        const n = this.minimapCells.length;
        if (n === 0) return;
        const total = this.minimapTotal;
        const avail = Math.max(60, viewH - 16);
        const elH = Math.min(total + 12, avail);
        el.style.height = `${elH}px`;

        const t0 = this.wrapperToMinimapY(-this.pagePositionY / z);
        const b0 = this.wrapperToMinimapY((viewH - this.pagePositionY) / z);
        const t = Math.max(0, Math.min(total, t0));
        const b = Math.max(t + 6, Math.min(total, b0));
        vp.style.top = `${t}px`;
        vp.style.height = `${b - t}px`;

        const innerAvail = elH - 12;
        if (!this.minimapDragging) {
            this.minimapOffset = total <= innerAvail ? 0 : Math.max(0, Math.min(total - innerAvail, (t + b) / 2 - innerAvail / 2));
        }
        inner.style.transform = `translateY(${-this.minimapOffset}px)`;
        // After the minimap scrolled, draw the thumbnails that just appeared.
        if (this.thumbDirty.size > 0 && this.thumbTimer === null) {
            const [va, vb] = this.minimapVisibleRange();
            for (const i of this.thumbDirty) if (i >= va && i <= vb) { this.scheduleThumbs(150); break; }
        }

        const cy = (viewH / 2 - this.pagePositionY) / z;
        const idx = Math.max(0, Math.min(n - 1, this.pageAtWrapperY(cy).i));
        if (idx !== this.minimapCurrent) {
            this.minimapCells[this.minimapCurrent]?.removeClass('current');
            this.minimapCells[idx]?.addClass('current');
            this.minimapCurrent = idx;
        }

        // "3 / 12" label next to the slim rail while scrolling
        const badge = this.minimapBadge;
        if (badge && !this.minimapOpen) {
            badge.setText(`${idx + 1} / ${n}`);
            const by = 8 + 2 + (t + b) / 2 - this.minimapOffset;
            badge.style.top = `${Math.max(8, Math.min(viewH - 30, by - 11))}px`;
            badge.addClass('hw-mm-badge-on');
            if (this.minimapBadgeTimer !== null) window.clearTimeout(this.minimapBadgeTimer);
            this.minimapBadgeTimer = window.setTimeout(() => { this.minimapBadgeTimer = null; badge.removeClass('hw-mm-badge-on'); }, 900);
        } else if (badge) {
            badge.removeClass('hw-mm-badge-on');
        }

        if (this.plugin.settings.minimap === 'auto') {
            el.addClass('hw-mm-visible');
            if (this.minimapHideTimer !== null) window.clearTimeout(this.minimapHideTimer);
            this.minimapHideTimer = window.setTimeout(() => {
                this.minimapHideTimer = null;
                if (!this.minimapDragging) el.removeClass('hw-mm-visible');
            }, 1600);
        }
    },

    // The slim rail expands into thumbnails on touch / hover and collapses again after a moment.
    setMinimapOpen(open: boolean) {
        const el = this.minimapEl;
        if (!el || this.plugin.settings.minimapStyle !== 'rail') return;
        if (this.minimapCloseTimer !== null) { window.clearTimeout(this.minimapCloseTimer); this.minimapCloseTimer = null; }
        if (open === this.minimapOpen) return;
        this.minimapOpen = open;
        el.toggleClass('hw-mm-open', open);
        if (open && this.thumbStale) {
            this.thumbStale = false;
            this.minimapCanvases.forEach((c, i) => { if (c) this.thumbDirty.add(i); });
            this.scheduleThumbs(20);
        }
    },

    scheduleMinimapClose(delay: number) {
        if (this.plugin.settings.minimapStyle !== 'rail') return;
        if (this.minimapCloseTimer !== null) window.clearTimeout(this.minimapCloseTimer);
        this.minimapCloseTimer = window.setTimeout(() => {
            this.minimapCloseTimer = null;
            if (!this.minimapDragging) this.setMinimapOpen(false);
        }, delay);
    },

    markThumbDirty(i: number) {
        // Page content changed: an endless page may need more room (checked with a delay).
        if (this.noteData.pages[i]?.endless) {
            if (this.roomTimer !== null) window.clearTimeout(this.roomTimer);
            this.roomTimer = window.setTimeout(() => { this.roomTimer = null; this.ensurePageRoom(i); }, 250);
        }
        if (!this.minimapCanvases[i]) return;
        if (this.plugin.settings.minimapStyle === 'rail' && !this.minimapOpen) { this.thumbStale = true; return; }
        this.thumbDirty.add(i);
        this.scheduleThumbs(450);
    },

    scheduleThumbs(delay: number) {
        if (this.thumbTimer !== null) return;
        this.thumbTimer = window.setTimeout(() => {
            this.thumbTimer = null;
            this.processThumbs();
        }, delay);
    },

    /** Range of pages whose thumbnails are visible in the minimap now (with a small margin). */
    minimapVisibleRange(): [number, number] {
        const el = this.minimapEl;
        if (!el) return [0, -1];
        const h = Math.max(0, el.clientHeight - 12);
        const tops = this.minimapTops;
        let a = 0;
        while (a + 1 < tops.length && tops[a + 1] < this.minimapOffset) a++;
        let b = a;
        while (b + 1 < tops.length && tops[b + 1] < this.minimapOffset + h) b++;
        return [Math.max(0, a - 2), b + 2];
    },

    // Thumbnails are drawn from vector data, 2 at a time, so writing isn't blocked. Only those
    // visible in the minimap are drawn (nearest to the current page first) – the rest wait until the minimap gets there.
    processThumbs() {
        // Don't draw thumbnails while the user is writing / moving the view (prevents stutter).
        // Exception: thumbnails never drawn yet (empty minimap) are always drawn.
        const busy = performance.now() - this.lastActivityAt < 1200;
        // Long notes: only (and first) the thumbnails visible in the minimap; shorter ones – all.
        const [a, b] = this.minimapCanvases.length > 60 ? this.minimapVisibleRange() : [0, Infinity];
        const cur = Math.max(0, this.minimapCurrent);
        const todo = Array.from(this.thumbDirty).filter(i => i >= a && i <= b && (!busy || !paintedThumbs.has(this.minimapCanvases[i]!)))
            .sort((x, y) => Math.abs(x - cur) - Math.abs(y - cur));
        if (busy && todo.length === 0) { if (this.thumbDirty.size) this.scheduleThumbs(500); return; }
        this.posLog('minimap: render', todo.slice(0, 2), 'of', this.thumbDirty.size, 'dirty');
        let done = 0;
        for (const i of todo) {
            this.thumbDirty.delete(i);
            void this.renderThumb(i);
            if (++done >= 2) break;
        }
        if (todo.length > done || (busy && this.thumbDirty.size)) this.scheduleThumbs(busy ? 500 : 30);
    },

    // Downscaled image copy for thumbnails (so large bitmaps aren't kept in memory).
    // Successful copies are cached; after a failure we retry at the earliest after 4 s.
    async getThumbSprite(img: ImageItem): Promise<HTMLCanvasElement | null> {
        const hit = this.thumbSprites.get(img.id);
        if (hit) return hit;
        const failed = this.thumbFailAt.get(img.id);
        if (failed !== undefined && Date.now() - failed < 4000) return null;
        try {
            const url = await this.getImageUrl(img);
            const el = url ? await loadImageEl(url) : null;
            if (!el || el.naturalWidth <= 0) throw new Error('image could not be loaded');
            const k = Math.min(1, 220 / Math.max(el.naturalWidth, el.naturalHeight));
            const sprite = document.createElement('canvas');
            sprite.width = Math.max(1, Math.round(el.naturalWidth * k));
            sprite.height = Math.max(1, Math.round(el.naturalHeight * k));
            sprite.getContext('2d')!.drawImage(el, 0, 0, sprite.width, sprite.height);
            this.thumbSprites.set(img.id, sprite);
            this.thumbFailAt.delete(img.id);
            return sprite;
        } catch (e) {
            console.warn('Handwriting: minimap thumbnail image failed', img.path ?? '(embedded)', e);
            this.thumbFailAt.set(img.id, Date.now());
            return null;
        }
    },

    async renderThumb(i: number) {
        try {
            await this.renderThumbInner(i);
        } catch (e) {
            console.error('Handwriting: minimap thumbnail failed', e);
            this.posLog('minimap: error', i, e);
        }
    },

    // Simplified stroke drawing for thumbnails: constant-width polyline that skips points denser than a thumbnail pixel.
    drawThumbStroke(ctx: CanvasRenderingContext2D, st: Stroke, minW: number, k: number) {
        if (st.shape) { this.drawShape(ctx, { ...st, width: Math.max(st.width, minW) }); return; }
        const pts = st.points;
        if (pts.length === 0) return;
        if (st.alpha !== undefined && !st.isHighlighter) {
            const prev = ctx.globalAlpha;
            ctx.globalAlpha = prev * st.alpha;
            this.drawThumbStroke(ctx, { ...st, alpha: undefined }, minW, k);
            ctx.globalAlpha = prev;
            return;
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = st.color;
        ctx.lineWidth = Math.max(st.width, minW);
        ctx.lineCap = st.isHighlighter ? 'butt' : 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        const step = 1.2 / k;
        let lx = pts[0].x, ly = pts[0].y;
        for (let i = 1; i < pts.length; i++) {
            const p = pts[i];
            if (i === pts.length - 1 || Math.abs(p.x - lx) + Math.abs(p.y - ly) >= step) { ctx.lineTo(p.x, p.y); lx = p.x; ly = p.y; }
        }
        if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
        ctx.stroke();
    },

    async renderThumbInner(i: number, target?: HTMLCanvasElement) {
        const c = target ?? this.minimapCanvases[i];
        const page = this.noteData.pages[i];
        if (!c || !page) return;
        const token = (this.thumbRenderId.get(i) ?? 0) + 1;
        if (!target) this.thumbRenderId.set(i, token);
        const style = this.effectiveStyle(i);
        const hasImages = (page.images?.length ?? 0) > 0 || !!page.bgPath || !!page.bgImage;
        // Right away: paper and ink (without waiting for images) – a thumbnail is never left empty.
        const live = this.pageViews[i]?.bgEl;
        const liveBg = live && live.complete && live.naturalWidth > 0 ? live : null;
        this.paintThumb(c, page, style.paper, [], liveBg, style.tpl);
        if (!hasImages) return;
        // Then images and the PDF background (wait at most 8 s – a stuck image doesn't block the thumbnail).
        const loaded = await Promise.race([
            this.loadThumbSources(page, i),
            new Promise<null>(res => window.setTimeout(() => res(null), 8000)),
        ]);
        if (!target && (this.thumbRenderId.get(i) !== token || this.minimapCanvases[i] !== c)) return;
        if (!loaded) { this.posLog('minimap: images timed out', i); if (!target) { this.thumbDirty.add(i); this.scheduleThumbs(4200); } return; }
        this.paintThumb(c, page, style.paper, loaded.sources, loaded.bg, style.tpl);
        // If an image failed to load, try again in a moment.
        if (loaded.missing && !target) { this.thumbDirty.add(i); this.scheduleThumbs(4200); }
    },

    /** Page images for a thumbnail: the already decoded <img> element from the page, or a downscaled copy. */
    async loadThumbSources(page: PageData, liveIndex?: number, bgFull = false): Promise<{ sources: (CanvasImageSource | null)[]; bg: CanvasImageSource | null; missing: boolean }> {
        const sources: (CanvasImageSource | null)[] = [];
        let missing = false;
        // Page background (imported PDF): the <img> already loaded on the page, a downscaled copy for thumbnails,
        // and the full image for the large preview (version history).
        let bg: CanvasImageSource | null = null;
        if (page.bgPath || page.bgImage) {
            const live = liveIndex !== undefined ? this.pageViews[liveIndex]?.bgEl : null;
            if (live && live.complete && live.naturalWidth > 0) bg = live;
            else {
                const pseudo: ImageItem = { id: 'bg:' + (page.bgPath ?? String(page.bgImage?.length)), path: page.bgPath, data: page.bgImage, x: 0, y: 0, w: pageWidth(page), h: pageHeight(page) };
                if (bgFull) { const url = await this.getImageUrl(pseudo); bg = url ? await loadImageEl(url) : null; }
                else bg = await this.getThumbSprite(pseudo);
                if (!bg) missing = true;
            }
        }
        for (const im of page.images ?? []) {
            const live = liveIndex !== undefined ? this.pageViews[liveIndex]?.imgEls.get(im.id) : undefined;
            if (live && live.complete && live.naturalWidth > 0) { sources.push(live); continue; }
            if (bgFull) { const url = await this.getImageUrl(im); const el = url ? await loadImageEl(url) : null; if (!el) missing = true; sources.push(el); continue; }
            const sp = await this.getThumbSprite(im);
            if (!sp) missing = true;
            sources.push(sp);
        }
        return { sources, bg, missing };
    },

    /** Draws a scaled-down page (background, images, strokes) on a canvas of any size. */
    paintThumb(c: HTMLCanvasElement, page: PageData, paper: string, sources: (CanvasImageSource | null)[], bg?: CanvasImageSource | null, tpl?: PageTemplate) {
        const ctx = c.getContext('2d');
        if (!ctx) return;
        paintedThumbs.add(c);
        // Page fitted into the canvas (a landscape page in a portrait preview is centred);
        // an endless page fills the width (its beginning is shown).
        const PW = pageWidth(page), PH = pageHeight(page);
        const k = page.endless ? c.width / PW : Math.min(c.width / PW, c.height / PH);
        const ox = Math.round((c.width - PW * k) / 2), oy = page.endless ? 0 : Math.round((c.height - PH * k) / 2);
        const dw = Math.round(PW * k), dh = Math.min(c.height, Math.round(PH * k));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, c.width, c.height);
        const hasBg = !!(page.bgPath || page.bgImage);
        ctx.fillStyle = hasBg ? '#ffffff' : paper;
        ctx.fillRect(ox, oy, dw, dh);
        if (hasBg) {
            if (bg) ctx.drawImage(bg, ox, oy, dw, dh);
            else { ctx.fillStyle = '#eef2f7'; ctx.fillRect(ox, oy, dw, dh); }
        } else if (tpl && c.width >= 160) {
            // Page pattern (dots, lines…) – only in larger previews; in a small thumbnail it would be invisible.
            ctx.save();
            ctx.translate(ox, oy);
            drawPageTemplate(ctx, k, tpl, inkForPaper(paper), PW, PH);
            ctx.restore();
        }
        ctx.setTransform(k, 0, 0, k, ox, oy);
        (page.images ?? []).forEach((im, n) => {
            const src = sources[n];
            ctx.save();
            ctx.translate(im.x + im.w / 2, im.y + im.h / 2);
            if (im.rot) ctx.rotate(im.rot);
            if (src) {
                ctx.drawImage(src, -im.w / 2, -im.h / 2, im.w, im.h);
            } else {
                // The image could not be loaded: a visible placeholder rectangle with a border
                ctx.fillStyle = '#dbe2ea';
                ctx.fillRect(-im.w / 2, -im.h / 2, im.w, im.h);
                ctx.strokeStyle = '#94a3b8';
                ctx.lineWidth = 2 / k;
                ctx.strokeRect(-im.w / 2, -im.h / 2, im.w, im.h);
            }
            ctx.restore();
        });
        const minW = 1.4 / k;   // thin strokes are thickened so they are visible in the thumbnail
        ctx.globalAlpha = 0.4;
        for (const st of page.strokes) {
            if (st.isHighlighter && !st.isEraser) this.drawThumbStroke(ctx, st, minW, k);
        }
        ctx.globalAlpha = 1;
        for (const st of page.strokes) {
            if (!st.isHighlighter && !st.isEraser) this.drawThumbStroke(ctx, st, minW, k);
        }
    },
});
export type MinimapMethods = typeof minimapMixin;
