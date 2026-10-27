import { canvasToBlob } from './utils';

// --- PDF WRITING (no print dialog): each page is one RGB image (Flate, lossless) ---
export interface PdfPageImage { w: number; h: number; filter: 'FlateDecode' | 'DCTDecode'; data: Uint8Array; /** page size in PDF points (missing = A4) */ pw?: number; ph?: number; }
/** PDF bookmark (table of contents): title and page number (from 0). */
export interface PdfOutlineItem { title: string; page: number; }

const pdfText = (t: string) => { let hex = 'FEFF'; for (let i = 0; i < t.length; i++) hex += t.charCodeAt(i).toString(16).padStart(4, '0'); return `<${hex}>`; };

export async function encodeCanvasForPdf(canvas: HTMLCanvasElement): Promise<PdfPageImage | null> {
    const w = canvas.width, h = canvas.height;
    const CS = (window as any).CompressionStream;
    if (CS) {
        const px = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
        const rgb = new Uint8Array(w * h * 3);
        for (let i = 0, j = 0; i < px.length; i += 4, j += 3) { rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; }
        const stream = new Blob([rgb]).stream().pipeThrough(new CS('deflate'));
        return { w, h, filter: 'FlateDecode', data: new Uint8Array(await new Response(stream).arrayBuffer()) };
    }
    // Fallback (very old browsers): high-quality JPEG
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
    if (!blob) return null;
    return { w, h, filter: 'DCTDecode', data: new Uint8Array(await blob.arrayBuffer()) };
}

export function buildPdf(pages: PdfPageImage[], title: string, outline: PdfOutlineItem[] = []): Uint8Array {
    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let len = 0;
    const offsets: number[] = [];
    const push = (d: Uint8Array | string) => {
        const b = typeof d === 'string' ? enc.encode(d) : d;
        chunks.push(b);
        len += b.length;
    };
    const begin = (n: number) => { offsets[n] = len; push(`${n} 0 obj\n`); };
    const PW = 595.28, PH = 841.89;   // A4 in points
    const n = pages.length;

    push('%PDF-1.4\n%âãÏÓ\n');
    // Objects: 1 catalog, 2 page tree, 3+3k pages, then info, then bookmarks (table of contents).
    const infoObj = 3 + 3 * n;
    const outRoot = infoObj + 1;
    const outItems = outline.filter(o => o.page >= 0 && o.page < n);
    begin(1); push(`<< /Type /Catalog /Pages 2 0 R${outItems.length ? ` /Outlines ${outRoot} 0 R /PageMode /UseOutlines` : ''} >>\nendobj\n`);
    const kids = pages.map((_, k) => `${3 + 3 * k} 0 R`).join(' ');
    begin(2); push(`<< /Type /Pages /Count ${n} /Kids [${kids}] >>\nendobj\n`);
    pages.forEach((p, k) => {
        const pageObj = 3 + 3 * k, contentObj = 4 + 3 * k, imageObj = 5 + 3 * k;
        begin(pageObj);
        const pw = p.pw ?? PW, ph = p.ph ?? PH;
        push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>\nendobj\n`);
        const cs = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
        begin(contentObj);
        push(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream\nendobj\n`);
        begin(imageObj);
        push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${p.filter} /Length ${p.data.length} >>\nstream\n`);
        push(p.data);
        push('\nendstream\nendobj\n');
    });
    begin(infoObj); push(`<< /Title ${pdfText(title)} /Producer (Handwriting plugin) >>\nendobj\n`);

    let total = infoObj;
    if (outItems.length) {
        const first = outRoot + 1, last = outRoot + outItems.length;
        begin(outRoot); push(`<< /Type /Outlines /First ${first} 0 R /Last ${last} 0 R /Count ${outItems.length} >>\nendobj\n`);
        outItems.forEach((o, k) => {
            const obj = first + k;
            const pageObj = 3 + 3 * o.page;
            const ph = pages[o.page].ph ?? PH;
            begin(obj);
            push(`<< /Title ${pdfText(o.title)} /Parent ${outRoot} 0 R${k > 0 ? ` /Prev ${obj - 1} 0 R` : ''}${k < outItems.length - 1 ? ` /Next ${obj + 1} 0 R` : ''} /Dest [${pageObj} 0 R /XYZ 0 ${ph} 0] >>\nendobj\n`);
        });
        total = last;
    }
    const xref = len;
    push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
    for (let k = 1; k <= total; k++) push(`${String(offsets[k]).padStart(10, '0')} 00000 n \n`);
    push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info ${infoObj} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const out = new Uint8Array(len);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
}
