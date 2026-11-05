// Obsidian's DOM helpers (createEl, createDiv, addClass, empty, …) installed on the DOM prototypes.
// Obsidian adds these globally; the plugin code calls them on any element (also on document.body).

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

function createElIn(parent: Node | null, tag: string, o?: DomElementInfo | string, cb?: (el: HTMLElement) => void): HTMLElement {
    const doc = (parent && parent.ownerDocument) || document;
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

let installed = false;

export function installDomHelpers() {
    if (installed) return;
    installed = true;
    const N = Node.prototype as any;
    const E = Element.prototype as any;
    const H = HTMLElement.prototype as any;

    N.createEl = function (tag: string, o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) { return createElIn(this, tag, o, cb); };
    N.createDiv = function (o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) { return createElIn(this, 'div', o, cb); };
    N.createSpan = function (o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) { return createElIn(this, 'span', o, cb); };
    N.empty = function () { while (this.firstChild) this.removeChild(this.firstChild); };
    N.detach = function () { this.parentNode?.removeChild(this); };
    N.indexOf = function (child: Node) { return Array.prototype.indexOf.call(this.childNodes, child); };
    N.setChildrenInPlace = function (children: Node[]) { this.empty(); children.forEach((c: Node) => this.appendChild(c)); };
    N.appendText = function (t: string) { this.appendChild(document.createTextNode(t)); };

    E.setText = function (t: string | DocumentFragment) {
        if (typeof t === 'string') this.textContent = t;
        else { this.textContent = ''; this.appendChild(t); }
    };
    E.getText = function () { return this.textContent ?? ''; };
    E.addClass = function (...cls: string[]) { this.classList.add(...cls.flatMap(splitCls)); };
    E.addClasses = function (cls: string[]) { this.addClass(...cls); };
    E.removeClass = function (...cls: string[]) { this.classList.remove(...cls.flatMap(splitCls)); };
    E.removeClasses = function (cls: string[]) { this.removeClass(...cls); };
    E.toggleClass = function (cls: string | string[], value: boolean) { for (const c of splitCls(cls)) this.classList.toggle(c, value); };
    E.hasClass = function (cls: string) { return this.classList.contains(cls); };
    E.setAttr = function (k: string, v: string | number | boolean | null) {
        if (v === null || v === false) this.removeAttribute(k); else this.setAttribute(k, v === true ? '' : String(v));
    };
    E.setAttrs = function (o: Record<string, string | number | boolean | null>) { for (const [k, v] of Object.entries(o)) this.setAttr(k, v); };
    E.getAttr = function (k: string) { return this.getAttribute(k); };

    H.show = function () { this.style.display = ''; };
    H.hide = function () { this.style.display = 'none'; };
    H.toggle = function (show: boolean) { if (show) this.show(); else this.hide(); };
    H.toggleVisibility = function (show: boolean) { this.toggle(show); };
    H.isShown = function () { return this.style.display !== 'none' && !!this.offsetParent; };
    H.setCssStyles = function (s: Partial<CSSStyleDeclaration>) { Object.assign(this.style, s); };
    H.setCssProps = function (p: Record<string, string>) { for (const [k, v] of Object.entries(p)) this.style.setProperty(k, v); };

    const g = window as any;
    g.createEl = (tag: string, o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) => createElIn(null, tag, o, cb);
    g.createDiv = (o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) => createElIn(null, 'div', o, cb);
    g.createSpan = (o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) => createElIn(null, 'span', o, cb);
    g.createFragment = (cb?: (f: DocumentFragment) => void) => { const f = document.createDocumentFragment(); cb?.(f); return f; };
    g.activeDocument = document;
    g.activeWindow = window;
}

// Install as soon as the module is evaluated: plugin modules may create elements at import time.
installDomHelpers();
