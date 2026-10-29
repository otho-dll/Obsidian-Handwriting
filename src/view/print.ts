import { defineMixin } from './mixin';
import { Notice, Platform } from 'obsidian';
import { canvasToBlob } from '../utils';
import { A4_W, A4_H, contentBottom } from '../pageFormat';

/**
 * Printing straight from the plugin.
 * Desktop: every page is drawn at print resolution (the same renderer as PDF export), placed in a hidden
 * frame with one sheet per page (A4 portrait or landscape; an endless page is cut into A4 sheets) and the
 * system print dialog opens – choose a printer, page range or "Save as PDF" there.
 * Phone / tablet: there is no print dialog for plugins, so a PDF is exported and the user prints it
 * from the system viewer (Share → Print).
 */
const MM_PER_UNIT = 210 / A4_W;

export const printMixin = defineMixin({
    async printNote() {
        if (Platform.isMobile) {
            new Notice('Printing works through a PDF on this device: the PDF is saved now – open it in your PDF viewer and use Share → Print.', 9000);
            await this.exportToPDF();
            return;
        }
        if (this.printCleanup) this.printCleanup();
        const pages = this.noteData.pages;
        const notice = new Notice('Preparing to print…', 0);
        const urls: string[] = [];
        const sheets: { url: string; landscape: boolean; wMm: number; hMm: number }[] = [];
        // ~300 dpi on A4 (800 units = 210 mm) is enough for print; the PDF export setting can lower it.
        const scale = Math.min(3, Math.max(1.5, this.plugin.settings.pdfScale));
        try {
            for (let i = 0; i < pages.length; i++) {
                notice.setMessage(`Preparing to print… page ${i + 1}/${pages.length}`);
                const canvas = await this.renderPageForExport(i, scale);
                const PW = this.pageW(i), PH = this.pageH(i);
                const landscape = PW > PH;
                // An endless page is cut into sheets with the A4 proportions of its width.
                const sheetUnits = landscape ? PH : Math.min(PH, PW * A4_H / A4_W);
                const pxPerUnit = canvas.height / PH;
                // Empty space at the bottom of an endless page is not printed (no blank sheets).
                const printH = this.noteData.pages[i].endless ? Math.min(PH, Math.max(sheetUnits, contentBottom(this.noteData.pages[i]) + 40)) : PH;
                for (let top = 0; top < printH - 0.5; top += sheetUnits) {
                    const hUnits = Math.min(sheetUnits, printH - top);
                    let part = canvas;
                    if (hUnits < PH - 0.5) {
                        part = document.createElement('canvas');
                        part.width = canvas.width;
                        part.height = Math.round(hUnits * pxPerUnit);
                        const ctx = part.getContext('2d')!;
                        ctx.drawImage(canvas, 0, Math.round(top * pxPerUnit), canvas.width, part.height, 0, 0, part.width, part.height);
                    }
                    const blob = await canvasToBlob(part, 'image/png');
                    if (part !== canvas) part.width = 0;
                    if (!blob) continue;
                    const url = URL.createObjectURL(blob);
                    urls.push(url);
                    sheets.push({ url, landscape, wMm: PW * MM_PER_UNIT, hMm: hUnits * MM_PER_UNIT });
                }
                canvas.width = 0;
            }
            if (sheets.length === 0) throw new Error('nothing to print');

            notice.setMessage('Opening the print dialog…');
            const frame = document.body.createEl('iframe', { cls: 'hw-print-frame' });
            frame.setAttribute('aria-hidden', 'true');
            const doc = frame.contentDocument;
            const win = frame.contentWindow;
            if (!doc || !win) throw new Error('no print frame');
            doc.title = this.file?.basename ?? 'Handwritten note';
            const style = doc.createElement('style');
            style.textContent = [
                '@page { size: A4 portrait; margin: 0; }',
                '@page landscape { size: A4 landscape; margin: 0; }',
                'html, body { margin: 0; padding: 0; background: #fff; }',
                '.sheet { break-after: page; page-break-after: always; overflow: hidden; display: flex; align-items: flex-start; justify-content: center; }',
                '.sheet:last-child { break-after: auto; page-break-after: auto; }',
                '.sheet.portrait { width: 210mm; height: 296.5mm; }',
                '.sheet.landscape { page: landscape; width: 297mm; height: 209.5mm; align-items: center; }',
                '.sheet img { display: block; max-width: 100%; max-height: 100%; }',
                '* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
            ].join('\n');
            doc.head.appendChild(style);
            const imgs: HTMLImageElement[] = [];
            for (const s of sheets) {
                const sheet = doc.createElement('div');
                sheet.className = `sheet ${s.landscape ? 'landscape' : 'portrait'}`;
                const img = doc.createElement('img');
                img.src = s.url;
                img.style.width = `${s.wMm}mm`;
                img.style.height = `${s.hMm}mm`;
                sheet.appendChild(img);
                doc.body.appendChild(sheet);
                imgs.push(img);
            }
            await Promise.all(imgs.map(img => img.decode().catch(() => undefined)));

            let cleaned = false;
            const cleanup = () => {
                if (cleaned) return;
                cleaned = true;
                window.clearTimeout(timer);
                frame.remove();
                urls.forEach(u => URL.revokeObjectURL(u));
                if (this.printCleanup === cleanup) this.printCleanup = null;
            };
            // The frame stays until the dialog is closed (afterprint); a timer is the safety net.
            const timer = window.setTimeout(cleanup, 10 * 60 * 1000);
            this.printCleanup = cleanup;
            this.register(cleanup);
            win.addEventListener('afterprint', () => window.setTimeout(cleanup, 500));
            notice.hide();
            win.focus();
            win.print();
        } catch (e) {
            console.error('Handwriting: print failed', e);
            urls.forEach(u => URL.revokeObjectURL(u));
            new Notice('Printing failed. You can export to PDF and print the PDF instead.', 8000);
        } finally {
            notice.hide();
        }
    },
});
export type PrintMethods = typeof printMixin;
