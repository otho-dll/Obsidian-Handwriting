/**
 * Inserts an SVG icon into an element without innerHTML: the SVG text is parsed as XML (DOMParser),
 * so it can't contain scripts or HTML. Used for the plugin icons (constant strings from icons.ts).
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgElement(svg: string): SVGElement | null {
    const src = svg.includes('xmlns=') ? svg : svg.replace('<svg', `<svg xmlns="${SVG_NS}"`);
    const doc = new DOMParser().parseFromString(src, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
    return document.importNode(root, true) as unknown as SVGElement;
}

/** Replaces the element content with an SVG icon. */
export function setSvg(el: HTMLElement, svg: string) {
    el.empty();
    const node = svgElement(svg);
    if (node) el.appendChild(node);
}

/** Appends an SVG icon at the end of the element (without clearing). */
export function appendSvg(el: HTMLElement, svg: string) {
    const node = svgElement(svg);
    if (node) el.appendChild(node);
}
