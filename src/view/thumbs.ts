import { defineMixin } from './mixin';
import { loadImageEl } from '../utils';
import { pageWidth, pageHeight } from '../pageFormat';
import { Stroke, ImageItem, PageData } from '../types';
import { PageTemplate, drawPageTemplate, inkForPaper } from '../templates';

/** Page thumbnails drawn from vector data: pages panel, scrub preview of the page rail, version history. */
export const thumbsMixin = defineMixin({
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
            console.warn('Handwriting: thumbnail image failed', img.path ?? '(embedded)', e);
            this.thumbFailAt.set(img.id, Date.now());
            return null;
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

    /** Draws page i into the given canvas (pages panel, scrub preview, version history). Paper and ink first, images when loaded. */
    async renderThumbInner(i: number, c: HTMLCanvasElement) {
        const page = this.noteData.pages[i];
        if (!c || !page) return;
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
        if (!loaded || this.noteData.pages[i] !== page) return;
        this.paintThumb(c, page, style.paper, loaded.sources, loaded.bg, style.tpl);
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
export type ThumbsMethods = typeof thumbsMixin;
