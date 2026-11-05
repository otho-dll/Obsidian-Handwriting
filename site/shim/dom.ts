// Obsidian's DOM helpers (createEl, createDiv, addClass, empty, …) installed on the DOM prototypes.
// Obsidian adds these globally; the plugin code calls them on any element (also on document.body).
// The method types come from the `obsidian` package (its global DOM augmentations), so the shim is checked against them.

export interface DomElementInfo {
    cls?: string | string[];
    text?: string | DocumentFragment;
    attr?: Record<string, string | number | boolean | null>;
    title?: string;
    parent?: Node;
    value?: string;
    type?: string;
    prepend?: boolean;
    placeholder?: string;
    href?: string;
}

type AttrValue = string | number | boolean | null;
type ElCallback = (el: HTMLElement) => void;

function splitCls(cls: string | string[]): string[] {
    return (Array.isArray(cls) ? cls : cls.split(' ')).map(c => c.trim()).filter(Boolean);
}

function applyInfo(el: HTMLElement, o: DomElementInfo | string | undefined) {
    if (o === undefined) return;
    if (typeof o === 'string') o = { cls: o };
    if (o.cls) el.classList.add(...splitCls(o.cls));
    if (o.text !== undefined) {
        if (typeof o.text === 'string') el.textContent = o.text;
        else el.appendChild(o.text);
    }
    if (o.attr) {
        for (const [k, v] of Object.entries(o.attr)) {
            if (v === null || v === false) continue;
            el.setAttribute(k, v === true ? '' : String(v));
        }
    }
    if (o.title !== undefined) el.title = o.title;
    if (o.type !== undefined) el.setAttribute('type', o.type);
    if (o.value !== undefined) (el as HTMLInputElement).value = o.value;
    if (o.placeholder !== undefined) el.setAttribute('placeholder', o.placeholder);
    if (o.href !== undefined) el.setAttribute('href', o.href);
}

/** The page's document (the demo has one window; this is what Obsidian calls activeDocument). */
const pageDocument = window.document;

function createElIn(parent: Node | null, tag: string, o?: DomElementInfo | string, cb?: ElCallback): HTMLElement {
    const doc = parent?.ownerDocument ?? pageDocument;
    const el = doc.createElement(tag);
    applyInfo(el, o);
    const info = typeof o === 'object' ? o : undefined;
    const target = info?.parent ?? parent;
    if (target) {
        if (info?.prepend) target.insertBefore(el, target.firstChild);
        else target.appendChild(el);
    }
    if (cb) cb(el);
    return el;
}

/** Obsidian-style show / hide: an inline display (none = hidden), removed again by show(). The plugin reads
 *  style.display, so it has to be an inline style, not a class. */
function setDisplay(el: HTMLElement, value: string | null) {
    if (value === null) el.style.removeProperty('display');
    else el.style.setProperty('display', value);
}

let installed = false;

export function installDomHelpers() {
    if (installed) return;
    installed = true;

    Object.assign(Node.prototype, {
        createEl: function (this: Node, tag: string, o?: DomElementInfo | string, cb?: ElCallback) { return createElIn(this, tag, o, cb); } as unknown as Node['createEl'],
        createDiv: function (this: Node, o?: DomElementInfo | string, cb?: ElCallback) { return createElIn(this, 'div', o, cb); } as unknown as Node['createDiv'],
        createSpan: function (this: Node, o?: DomElementInfo | string, cb?: ElCallback) { return createElIn(this, 'span', o, cb); },
        empty(this: Node) { while (this.firstChild) this.removeChild(this.firstChild); },
        detach(this: Node) { this.parentNode?.removeChild(this); },
        indexOf(this: Node, child: Node) { return Array.prototype.indexOf.call(this.childNodes, child); },
        setChildrenInPlace(this: Node, children: Node[]) { this.empty(); children.forEach(c => this.appendChild(c)); },
        appendText(this: Node, t: string) { this.appendChild((this.ownerDocument ?? pageDocument).createTextNode(t)); },
    });

    Object.assign(Element.prototype, {
        setText(this: Element, t: string | DocumentFragment) {
            if (typeof t === 'string') this.textContent = t;
            else { this.textContent = ''; this.appendChild(t); }
        },
        getText(this: Element) { return this.textContent ?? ''; },
        addClass(this: Element, ...cls: string[]) { this.classList.add(...cls.flatMap(splitCls)); },
        addClasses(this: Element, cls: string[]) { this.addClass(...cls); },
        removeClass(this: Element, ...cls: string[]) { this.classList.remove(...cls.flatMap(splitCls)); },
        removeClasses(this: Element, cls: string[]) { this.removeClass(...cls); },
        toggleClass(this: Element, cls: string | string[], value: boolean) { for (const c of splitCls(cls)) this.classList.toggle(c, value); },
        hasClass(this: Element, cls: string) { return this.classList.contains(cls); },
        setAttr(this: Element, k: string, v: AttrValue) {
            if (v === null || v === false) this.removeAttribute(k); else this.setAttribute(k, v === true ? '' : String(v));
        },
        setAttrs(this: Element, o: Record<string, AttrValue>) { for (const [k, v] of Object.entries(o)) this.setAttr(k, v); },
        getAttr(this: Element, k: string) { return this.getAttribute(k); },
    });

    Object.assign(HTMLElement.prototype, {
        show(this: HTMLElement) { setDisplay(this, null); },
        hide(this: HTMLElement) { setDisplay(this, 'none'); },
        toggle(this: HTMLElement, show: boolean) { if (show) this.show(); else this.hide(); },
        toggleVisibility(this: HTMLElement, show: boolean) { this.toggle(show); },
        isShown(this: HTMLElement) { return this.style.display !== 'none' && !!this.offsetParent; },
        setCssStyles(this: HTMLElement, s: Partial<CSSStyleDeclaration>) { Object.assign(this.style, s); },
        setCssProps(this: HTMLElement, p: Record<string, string>) { for (const [k, v] of Object.entries(p)) this.style.setProperty(k, v); },
    });

    // Globals Obsidian provides (createEl without a parent, the active window / document).
    window.createEl = ((tag: string, o?: DomElementInfo | string, cb?: ElCallback) => createElIn(null, tag, o, cb)) as unknown as typeof window.createEl;
    window.createDiv = ((o?: DomElementInfo | string, cb?: ElCallback) => createElIn(null, 'div', o, cb)) as unknown as typeof window.createDiv;
    window.createSpan = (o?: DomElementInfo | string, cb?: ElCallback) => createElIn(null, 'span', o, cb);
    window.createFragment = (cb?: (f: DocumentFragment) => void) => { const f = pageDocument.createDocumentFragment(); cb?.(f); return f; };
    window.activeDocument = pageDocument;
    window.activeWindow = window;
}

// Install as soon as the module is evaluated: plugin modules may create elements at import time.
installDomHelpers();
