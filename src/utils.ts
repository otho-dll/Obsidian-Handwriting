

// --- HELPER FUNCTIONS ---
export const r2 = (n: number) => Math.round(n * 100) / 100;

export function mimeFromPath(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'svg') return 'image/svg+xml';
    return 'image/png';
}

export function extFromMime(type: string): string {
    if (type === 'image/jpeg') return 'jpg';
    if (type === 'image/webp') return 'webp';
    if (type === 'image/gif') return 'gif';
    if (type === 'image/svg+xml') return 'svg';
    return 'png';
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

export function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(fr.error ?? new Error('The file could not be read.'));
        fr.readAsDataURL(blob);
    });
}

export function loadImageEl(url: string): Promise<HTMLImageElement | null> {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}

export function newId(): string {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function rotatePointAbout(p: { x: number; y: number }, cx: number, cy: number, a: number): { x: number; y: number } {
    const cos = Math.cos(a), sin = Math.sin(a);
    const dx = p.x - cx, dy = p.y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/**
 * Corners of a triangle shape drawn in the box from (ax, ay) to (bx, by). Isosceles: apex in the middle of the
 * starting edge; right: the right angle at (ax, by). The drag direction flips the triangle.
 */
export function triangleVerts(ax: number, ay: number, bx: number, by: number, right: boolean): { x: number; y: number }[] {
    return right
        ? [{ x: ax, y: ay }, { x: bx, y: by }, { x: ax, y: by }]
        : [{ x: (ax + bx) / 2, y: ay }, { x: bx, y: by }, { x: ax, y: by }];
}

/** Shrinks a canvas to 1 × 1 px (frees its memory): the bitmap and its displayed size. */
export function shrinkCanvas(c: HTMLCanvasElement) {
    c.width = 1; c.height = 1;
    c.style.width = `${c.width}px`;
    c.style.height = `${c.height}px`;
}
