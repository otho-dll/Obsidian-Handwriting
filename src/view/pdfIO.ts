import { defineMixin } from './mixin';
import { canUseDisk, writeToDisk, revealInFolder } from '../disk';
import { Notice, Platform, TFile, TFolder, loadPdfJs } from 'obsidian';
import { inkForPaper, drawPageTemplate } from '../templates';
import { canvasToBlob, blobToDataUrl, loadImageEl } from '../utils';
import { PdfPageImage, encodeCanvasForPdf, buildPdf } from '../pdf';
import { A4_W, A4_H } from '../pageFormat';
import { PdfTarget, cleanFileName, joinPath, PdfTargetModal } from '../pdfTargetModal';
import { PDF_TARGET_WIDTH, PDF_MAX_HEIGHT } from '../constants';
import { PageData } from '../types';

export const pdfIOMixin = defineMixin({
    // --- PDF EXPORT ---
    // Pages are redrawn from vector data at high resolution (not from the screen canvases),
    // encoded losslessly (Flate) and assembled into a PDF file saved in the vault next to the note. No print dialog.
    /** Decides where to save the PDF (per settings: ask / default folder / next to the note). */
    async pickPdfTarget(): Promise<PdfTarget | null> {
        const st = this.plugin.settings;
        const title = this.file?.basename ?? 'Handwritten Note';
        const noteFolderRaw = this.file?.parent?.path ?? '';
        const noteFolder = noteFolderRaw === '/' ? '' : noteFolderRaw;
        const name = cleanFileName(title);
        if (st.pdfExportMode === 'note') return { kind: 'vault', path: joinPath(noteFolder, name) };
        if (st.pdfExportMode === 'disk' && canUseDisk() && st.pdfExportDiskFolder.trim()) {
            return { kind: 'disk', folder: st.pdfExportDiskFolder.trim(), name };
        }
        if (st.pdfExportMode === 'folder') {
            const f = st.pdfExportFolder.trim();
            return { kind: 'vault', path: joinPath(f || noteFolder, name) };
        }
        const folders = this.app.vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder && f.path !== '/').map(f => f.path).sort();
        const canDisk = canUseDisk();
        return new Promise<PdfTarget | null>(resolve => {
            new PdfTargetModal(this.app, name, st.pdfLastFolder || noteFolder, folders,
                { canDisk, diskFolder: st.pdfLastDisk || st.pdfExportDiskFolder, startKind: st.pdfLastKind },
                resolve).open();
        });
    },

    /**
     * Draws page i at high resolution from the vector data (not from the screen canvases):
     * paper, pattern or PDF background, images, highlighter under the pen. Used by PDF export and printing.
     */
    async renderPageForExport(i: number, scale: number): Promise<HTMLCanvasElement> {
        const page = this.noteData.pages[i];
        const canvas = document.createElement('canvas');
        const PW = this.pageW(i), PH = this.pageH(i);
        // Long ("endless") page: lower resolution so the canvas fits the browser limits.
        const S = Math.min(scale, 30000 / PH, Math.sqrt(160e6 / (PW * PH)));
        canvas.width = Math.round(PW * S);
        canvas.height = Math.round(PH * S);
        const ctx = canvas.getContext('2d')!;
        const eff = this.effectiveStyle(i);
        ctx.fillStyle = eff.paper;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const hasBg = !!(page.bgPath || page.bgImage);
        if (!hasBg) {
            // Page pattern (dots, lines, grid...) – same as on screen
            drawPageTemplate(ctx, S, eff.tpl, inkForPaper(eff.paper), PW, PH);
        } else {
            // Background (imported PDF) – fitted as on screen (contain)
            const bgUrl = await this.getPageBgUrl(page);
            const bg = bgUrl ? await loadImageEl(bgUrl) : null;
            if (bg) {
                const k = Math.min(canvas.width / bg.naturalWidth, canvas.height / bg.naturalHeight);
                const dw = bg.naturalWidth * k, dh = bg.naturalHeight * k;
                ctx.drawImage(bg, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
            }
        }

        // Inserted images (with rotation)
        for (const img of page.images ?? []) {
            const url = await this.getImageUrl(img);
            const el = url ? await loadImageEl(url) : null;
            if (!el) continue;
            ctx.save();
            ctx.translate((img.x + img.w / 2) * S, (img.y + img.h / 2) * S);
            if (img.rot) ctx.rotate(img.rot);
            ctx.drawImage(el, (-img.w / 2) * S, (-img.h / 2) * S, img.w * S, img.h * S);
            ctx.restore();
        }

        // Strokes: highlighter (semi-transparent) under the pen
        const hasHigh = page.strokes.some(s => s.isHighlighter);
        const bottom = document.createElement('canvas');
        bottom.width = canvas.width;
        bottom.height = canvas.height;
        const bCtx = bottom.getContext('2d')!;
        bCtx.scale(S, S);
        let hCtx: CanvasRenderingContext2D | null = null;
        let high: HTMLCanvasElement | null = null;
        if (hasHigh) {
            high = document.createElement('canvas');
            high.width = canvas.width;
            high.height = canvas.height;
            hCtx = high.getContext('2d')!;
            hCtx.scale(S, S);
        }
        this.drawPageStrokes(hCtx, bCtx, page.strokes);
        if (high) {
            ctx.globalAlpha = 0.4;
            ctx.drawImage(high, 0, 0);
            ctx.globalAlpha = 1;
            high.width = 0;
        }
        ctx.drawImage(bottom, 0, 0);
        bottom.width = 0;
        return canvas;
    },

    async exportToPDF() {
        const target = await this.pickPdfTarget();
        if (!target) return;
        const notice = new Notice('Preparing PDF…', 0);
        const SCALE = Platform.isMobile ? Math.min(2, this.plugin.settings.pdfScale) : this.plugin.settings.pdfScale;
        const pdfPages: PdfPageImage[] = [];
        try {
            for (let i = 0; i < this.noteData.pages.length; i++) {
                notice.setMessage(`Preparing PDF… page ${i + 1}/${this.noteData.pages.length}`);
                const canvas = await this.renderPageForExport(i, SCALE);
                const PW = this.pageW(i), PH = this.pageH(i);
                const encoded = await encodeCanvasForPdf(canvas);
                canvas.width = 0;
                // Page size in points: A4 (800 units) = 595.28 pt wide.
                if (encoded) pdfPages.push({ ...encoded, pw: Math.round(PW * 595.28 / A4_W * 100) / 100, ph: Math.round(PH * 841.89 / A4_H * 100) / 100 });
            }
            if (pdfPages.length === 0) throw new Error('no pages');

            notice.setMessage('Saving PDF…');
            const title = this.file?.basename ?? 'Handwritten Note';
            // Page titles go into the PDF as bookmarks (the PDF reader's table of contents).
            const outline = this.noteData.pages.map((p, i) => ({ title: p.title ?? '', page: i })).filter(o => o.title);
            const bytes = buildPdf(pdfPages, title, pdfPages.length === this.noteData.pages.length ? outline : []);
            const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
            if (target.kind === 'vault') {
                const path = target.path;
                const slash = path.lastIndexOf('/');
                const folder = slash >= 0 ? path.slice(0, slash) : '';
                if (folder) await this.ensureFolder(folder);
                const existing = this.app.vault.getAbstractFileByPath(path);
                let pdfFile: TFile;
                if (existing instanceof TFile) {
                    await this.app.vault.modifyBinary(existing, buffer);
                    pdfFile = existing;
                } else {
                    pdfFile = await this.app.vault.createBinary(path, buffer);
                }
                if (this.plugin.settings.pdfExportMode === 'ask' && (this.plugin.settings.pdfLastFolder !== folder || this.plugin.settings.pdfLastKind !== 'vault')) {
                    this.plugin.settings.pdfLastFolder = folder;
                    this.plugin.settings.pdfLastKind = 'vault';
                    void this.plugin.saveSettings();
                }
                new Notice(`PDF saved: ${path}`, 6000);
                await this.app.workspace.getLeaf('tab').openFile(pdfFile);
            } else if (target.kind === 'disk') {
                const full = writeToDisk(target.folder, target.name, bytes);
                const stg = this.plugin.settings;
                if (stg.pdfExportMode === 'ask' && (stg.pdfLastKind !== 'disk' || stg.pdfLastDisk !== target.folder)) {
                    stg.pdfLastKind = 'disk';
                    stg.pdfLastDisk = target.folder;
                    void this.plugin.saveSettings();
                }
                new Notice(`PDF saved: ${full}`, 8000);
                revealInFolder(full);
            } else if (target.kind === 'handle') {
                const w = await target.handle.createWritable();
                await w.write(bytes);
                await w.close();
                new Notice(`PDF saved: ${target.handle.name ?? 'file'}`, 6000);
            } else {
                const url = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = target.name;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.setTimeout(() => URL.revokeObjectURL(url), 10000);
                new Notice(`PDF downloaded: ${target.name}`, 6000);
            }
        } catch (e) {
            console.error('Handwriting: export failed', e);
            new Notice('PDF export failed.');
        } finally {
            notice.hide();
        }
    },

    // --- PDF IMPORT ---
    importPDF() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/pdf';
        input.onchange = () => {
            const file = input.files?.[0];
            if (file) void this.importPdfFile(file);
        };
        input.click();
    },

    async importPdfFile(file: File) {
        const notice = new Notice('Importing PDF…', 0);
        try {
            const arrayBuffer = await file.arrayBuffer();

            // pdf.js built into Obsidian – nothing downloaded from the internet (works offline too).
            const pdfjsLib = await loadPdfJs();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

            const newPages: PageData[] = [];

            for (let i = 1; i <= pdf.numPages; i++) {
                notice.setMessage(`Importing PDF… page ${i}/${pdf.numPages}`);
                const page = await pdf.getPage(i);
                const base = page.getViewport({ scale: 1 });
                // High resolution: at maximum zoom the page must not look pixelated.
                const scale = Math.min(PDF_TARGET_WIDTH / base.width, PDF_MAX_HEIGHT / base.height);
                const viewport = page.getViewport({ scale });

                const canvas = document.createElement('canvas');
                canvas.width = Math.round(viewport.width);
                canvas.height = Math.round(viewport.height);
                const ctx = canvas.getContext('2d')!;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                await page.render({ canvasContext: ctx, viewport: viewport }).promise;

                const blob = await canvasToBlob(canvas, 'image/jpeg', 0.88);
                canvas.width = 0;
                if (!blob) continue;

                // The image goes to a separate file in the vault – the note stays small and saves quickly.
                const path = await this.saveAsset(await blob.arrayBuffer(), 'jpg');
                const np: PageData = path ? { strokes: [], bgPath: path } : { strokes: [], bgImage: await blobToDataUrl(blob) };
                // A landscape page in the PDF = a landscape A4 page in the note.
                if (base.width > base.height * 1.05) { np.w = A4_H; np.h = A4_W; }
                newPages.push(np);
            }

            if (newPages.length === 0) { new Notice('Nothing to import.'); return; }

            // If the only page was empty, replace it with the imported ones. Otherwise append at the end.
            const only = this.noteData.pages[0];
            if (this.noteData.pages.length === 1 && only.strokes.length === 0 && !only.bgImage && !only.bgPath && !(only.images && only.images.length)) {
                this.noteData.pages = newPages;
            } else {
                this.noteData.pages.push(...newPages);
            }

            this.requestSave();
            this.buildPageElements();
        } catch (e) {
            console.error('Handwriting: PDF import failed', e);
            new Notice('PDF import failed – the file may be damaged or password-protected.');
        } finally {
            notice.hide();
        }
    },
});
export type PdfIOMethods = typeof pdfIOMixin;
