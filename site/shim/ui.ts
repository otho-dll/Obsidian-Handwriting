// Menu, Modal, FuzzySuggestModal, Notice and Setting – rendered as real DOM with Obsidian's class names,
// so the plugin's own CSS and the demo's Obsidian-like base styles apply.
import { Component } from './component';
import { setIcon } from './icons';
import type { App } from './workspace';

const setTip = (el: HTMLElement, tip: string) => { el.setAttribute('aria-label', tip); el.title = tip; };

// ---------------------------------------------------------------- Menu
export class MenuItem {
    dom: HTMLElement;
    iconEl: HTMLElement;
    titleEl: HTMLElement;
    checkEl: HTMLElement | null = null;
    disabled = false;
    section = '';
    callback: ((evt: MouseEvent | KeyboardEvent) => any) | null = null;

    constructor(private menu: Menu) {
        this.dom = createDiv({ cls: 'menu-item', attr: { role: 'menuitem', tabindex: '-1' } });
        this.iconEl = this.dom.createDiv({ cls: 'menu-item-icon' });
        this.titleEl = this.dom.createDiv({ cls: 'menu-item-title' });
        this.dom.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.run(e); });
        this.dom.addEventListener('pointerenter', () => this.menu.select(this));
    }
    run(evt: MouseEvent | KeyboardEvent) {
        if (this.disabled) return;
        const cb = this.callback;
        this.menu.hide();
        if (cb) { try { cb(evt); } catch (e) { console.error(e); } }
    }
    setTitle(t: string | DocumentFragment) { this.titleEl.setText(t); return this; }
    setIcon(id: string | null) { if (id) setIcon(this.iconEl, id); else this.iconEl.empty(); return this; }
    setChecked(v: boolean | null) {
        this.dom.toggleClass('mod-checked', !!v);
        if (v) {
            if (!this.checkEl) { this.checkEl = this.dom.createDiv({ cls: 'menu-item-icon mod-checked' }); setIcon(this.checkEl, 'check'); }
        } else { this.checkEl?.remove(); this.checkEl = null; }
        return this;
    }
    setDisabled(v: boolean) { this.disabled = v; this.dom.toggleClass('is-disabled', v); this.dom.setAttribute('aria-disabled', String(v)); return this; }
    setWarning(v: boolean) { this.dom.toggleClass('is-warning', v); return this; }
    setIsLabel(v: boolean) { this.dom.toggleClass('is-label', v); return this; }
    setSection(s: string) { this.section = s; return this; }
    onClick(cb: (evt: MouseEvent | KeyboardEvent) => any) { this.callback = cb; return this; }
}

let openMenu: Menu | null = null;

export class Menu extends Component {
    dom: HTMLElement;
    private scrollEl: HTMLElement;
    private items: MenuItem[] = [];
    private selected = -1;
    private hideCbs: (() => any)[] = [];
    private shown = false;
    private cleanup: (() => void)[] = [];

    constructor() {
        super();
        this.dom = createDiv({ cls: 'menu', attr: { role: 'menu' } });
        this.scrollEl = this.dom.createDiv({ cls: 'menu-scroll' });
        this.dom.addEventListener('contextmenu', e => e.preventDefault());
    }
    addItem(cb: (item: MenuItem) => any) {
        const it = new MenuItem(this);
        cb(it);
        this.items.push(it);
        this.scrollEl.appendChild(it.dom);
        return this;
    }
    addSeparator() {
        // No separator at the start or twice in a row (Obsidian drops those as well).
        const last = this.scrollEl.lastElementChild;
        if (last && !last.hasClass('menu-separator')) this.scrollEl.createDiv({ cls: 'menu-separator' });
        return this;
    }
    setNoIcon() { this.dom.addClass('mod-no-icon'); return this; }
    setUseNativeMenu(_v: boolean) { return this; }
    onHide(cb: () => any) { this.hideCbs.push(cb); }

    select(item: MenuItem | number) {
        const idx = typeof item === 'number' ? item : this.items.indexOf(item);
        this.items.forEach((it, i) => it.dom.toggleClass('selected', i === idx));
        this.selected = idx;
        this.items[idx]?.dom.focus({ preventScroll: false });
    }

    showAtMouseEvent(evt: MouseEvent) { return this.showAtPosition({ x: evt.clientX, y: evt.clientY }); }

    showAtPosition(pos: { x: number; y: number; width?: number; overlap?: boolean; left?: boolean }) {
        if (openMenu && openMenu !== this) openMenu.hide();
        // Trailing separator is not shown.
        const last = this.scrollEl.lastElementChild;
        if (last?.hasClass('menu-separator')) last.remove();
        if (this.items.length === 0) return this;
        openMenu = this;
        this.shown = true;
        this.load();
        const host = document.fullscreenElement && !(document.fullscreenElement === document.documentElement) ? document.fullscreenElement : document.body;
        host.appendChild(this.dom);
        // measured at the top-left corner (.menu in obsidian.css), then moved next to the pointer / button
        this.dom.style.removeProperty('left');
        this.dom.style.removeProperty('top');
        const r = this.dom.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight, pad = 6;
        let x = pos.left ? pos.x - r.width : pos.x;
        let y = pos.y;
        if (x + r.width > vw - pad) x = vw - pad - r.width;
        if (x < pad) x = pad;
        if (y + r.height > vh - pad) y = Math.max(pad, (pos.y - r.height > pad ? pos.y - r.height : vh - pad - r.height));
        this.dom.style.left = `${Math.round(x)}px`;
        this.dom.style.top = `${Math.round(y)}px`;
        this.dom.style.maxHeight = `${vh - 2 * pad}px`;

        const onDown = (e: PointerEvent) => { if (!this.dom.contains(e.target as Node)) this.hide(); };
        const onKey = (e: KeyboardEvent) => {
            const enabled = this.items.map((it, i) => it.disabled ? -1 : i).filter(i => i >= 0);
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.hide(); }
            else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (!enabled.length) return;
                const at = enabled.indexOf(this.selected);
                const next = e.key === 'ArrowDown' ? enabled[(at + 1) % enabled.length] : enabled[(at - 1 + enabled.length) % enabled.length];
                this.select(next);
            } else if (e.key === 'Enter' || e.key === ' ') {
                const it = this.items[this.selected];
                if (it) { e.preventDefault(); it.run(e); }
            }
        };
        const onBlur = () => this.hide();
        // Registered on the next frame, so the event that opened the menu does not close it again.
        const t = window.setTimeout(() => {
            window.addEventListener('pointerdown', onDown, true);
            window.addEventListener('blur', onBlur);
        }, 0);
        window.addEventListener('keydown', onKey, true);
        this.cleanup.push(() => {
            window.clearTimeout(t);
            window.removeEventListener('pointerdown', onDown, true);
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('blur', onBlur);
        });
        return this;
    }

    hide() {
        if (!this.shown) return this;
        this.shown = false;
        if (openMenu === this) openMenu = null;
        this.cleanup.splice(0).forEach(fn => fn());
        this.dom.remove();
        this.unload();
        for (const cb of this.hideCbs) { try { cb(); } catch (e) { console.error(e); } }
        return this;
    }
    close() { return this.hide(); }
}

// ---------------------------------------------------------------- Modal
const modalStack: Modal[] = [];

export class Scope {
    private keys: { mods: string[]; key: string | null; fn: (e: KeyboardEvent) => any }[] = [];
    register(mods: string[] | null, key: string | null, fn: (e: KeyboardEvent) => any) { const k = { mods: mods ?? [], key, fn }; this.keys.push(k); return k; }
    unregister(k: unknown) { this.keys = this.keys.filter(x => x !== k); }
    /** Returns true when a handler consumed the key. */
    handle(e: KeyboardEvent): boolean {
        for (const k of this.keys) {
            if (k.key !== null && k.key !== e.key) continue;
            const mods = new Set(k.mods);
            if (mods.has('Mod') !== (e.ctrlKey || e.metaKey) && k.mods.length) continue;
            if (k.fn(e) === false) { e.preventDefault(); return true; }
        }
        return false;
    }
}

export class Modal {
    app: App;
    containerEl: HTMLElement;
    bgEl: HTMLElement;
    modalEl: HTMLElement;
    titleEl: HTMLElement;
    contentEl: HTMLElement;
    scope = new Scope();
    shouldRestoreSelection = true;
    private isOpen = false;
    private keyHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(app: App) {
        this.app = app;
        this.containerEl = createDiv({ cls: 'modal-container mod-dim' });
        this.bgEl = this.containerEl.createDiv({ cls: 'modal-bg' });
        this.modalEl = this.containerEl.createDiv({ cls: 'modal', attr: { role: 'dialog', 'aria-modal': 'true' } });
        const close = this.modalEl.createDiv({ cls: 'modal-close-button', attr: { 'aria-label': 'Close', role: 'button', tabindex: '0' } });
        setIcon(close, 'x');
        close.addEventListener('click', () => this.close());
        const header = this.modalEl.createDiv({ cls: 'modal-header' });
        this.titleEl = header.createDiv({ cls: 'modal-title' });
        this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });
        this.bgEl.addEventListener('click', () => this.close());
    }
    setTitle(t: string) { this.titleEl.setText(t); return this; }
    setContent(c: string | DocumentFragment) { this.contentEl.setText(c); return this; }

    open() {
        if (this.isOpen) return;
        this.isOpen = true;
        const host = document.fullscreenElement && document.fullscreenElement !== document.documentElement ? document.fullscreenElement : document.body;
        host.appendChild(this.containerEl);
        modalStack.push(this);
        document.body.addClass('demo-modal-open');
        this.keyHandler = (e: KeyboardEvent) => {
            if (modalStack[modalStack.length - 1] !== this) return;
            if (this.scope.handle(e)) return;
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
        };
        window.addEventListener('keydown', this.keyHandler, true);
        try { void this.onOpen(); } catch (e) { console.error(e); }
        // Focus the dialog for keyboard users (inputs focus themselves in onOpen).
        window.setTimeout(() => { if (!this.modalEl.contains(document.activeElement)) this.modalEl.focus({ preventScroll: true }); }, 0);
        this.modalEl.tabIndex = -1;
    }
    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler, true);
        const i = modalStack.indexOf(this);
        if (i >= 0) modalStack.splice(i, 1);
        if (modalStack.length === 0) document.body.removeClass('demo-modal-open');
        this.containerEl.remove();
        try { void this.onClose(); } catch (e) { console.error(e); }
    }
    onOpen(): void | Promise<void> { /* overridden */ }
    onClose(): void { /* overridden */ }
}

// ---------------------------------------------------------------- Suggest modals
export interface FuzzyMatch<T> { item: T; match: { score: number; matches: [number, number][] }; }

export abstract class SuggestModal<T> extends Modal {
    inputEl: HTMLInputElement;
    resultContainerEl: HTMLElement;
    emptyStateText = 'No results found.';
    limit = 50;
    private instructionsEl: HTMLElement;
    private current: T[] = [];
    private sel = 0;

    constructor(app: App) {
        super(app);
        this.modalEl.addClass('prompt');
        this.modalEl.querySelector('.modal-header')?.remove();
        this.modalEl.querySelector('.modal-close-button')?.remove();
        this.contentEl.remove();
        const inputWrap = this.modalEl.createDiv({ cls: 'prompt-input-container' });
        this.inputEl = inputWrap.createEl('input', { cls: 'prompt-input', type: 'text' }) as HTMLInputElement;
        this.inputEl.setAttribute('enterkeyhint', 'done');
        this.resultContainerEl = this.modalEl.createDiv({ cls: 'prompt-results' });
        this.instructionsEl = this.modalEl.createDiv({ cls: 'prompt-instructions' });
        this.inputEl.addEventListener('input', () => this.update());
        this.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); this.setSel(this.sel + 1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); this.setSel(this.sel - 1); }
            else if (e.key === 'Enter') { e.preventDefault(); this.choose(this.sel, e); }
        });
    }
    setPlaceholder(t: string) { this.inputEl.placeholder = t; }
    setInstructions(list: { command: string; purpose: string }[]) {
        this.instructionsEl.empty();
        for (const i of list) {
            const d = this.instructionsEl.createDiv({ cls: 'prompt-instruction' });
            d.createSpan({ cls: 'prompt-instruction-command', text: i.command });
            d.createSpan({ text: ' ' + i.purpose });
        }
    }
    onOpen() { this.update(); window.setTimeout(() => this.inputEl.focus(), 0); }
    private update() {
        this.current = this.getSuggestions(this.inputEl.value).slice(0, this.limit);
        this.resultContainerEl.empty();
        if (this.current.length === 0) this.resultContainerEl.createDiv({ cls: 'suggestion-empty', text: this.emptyStateText });
        this.current.forEach((it, i) => {
            const el = this.resultContainerEl.createDiv({ cls: 'suggestion-item' });
            this.renderSuggestion(it, el);
            el.addEventListener('pointerenter', () => this.setSel(i));
            el.addEventListener('click', (e) => this.choose(i, e));
        });
        this.setSel(0);
    }
    private setSel(i: number) {
        const n = this.current.length;
        if (!n) return;
        this.sel = (i + n) % n;
        Array.from(this.resultContainerEl.children).forEach((el, k) => (el as HTMLElement).toggleClass('is-selected', k === this.sel));
        (this.resultContainerEl.children[this.sel] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
    }
    private choose(i: number, e: MouseEvent | KeyboardEvent) {
        const it = this.current[i];
        if (it === undefined) return;
        this.close();
        this.onChooseSuggestion(it, e);
    }
    abstract getSuggestions(query: string): T[];
    abstract renderSuggestion(value: T, el: HTMLElement): void;
    abstract onChooseSuggestion(item: T, evt: MouseEvent | KeyboardEvent): void;
}

/** Simple fuzzy match: all query characters in order; earlier and contiguous matches score higher. */
function fuzzy(query: string, text: string): FuzzyMatch<null>['match'] | null {
    const q = query.toLowerCase().replace(/\s+/g, ''), t = text.toLowerCase();
    if (!q) return { score: 0, matches: [] };
    let ti = 0, score = 0, last = -2;
    const matches: [number, number][] = [];
    for (const ch of q) {
        const found = t.indexOf(ch, ti);
        if (found < 0) return null;
        score -= found - ti + (found === last + 1 ? 0 : 1);
        if (found === last + 1 && matches.length) matches[matches.length - 1][1] = found + 1; else matches.push([found, found + 1]);
        last = found;
        ti = found + 1;
    }
    return { score, matches };
}

export abstract class FuzzySuggestModal<T> extends SuggestModal<FuzzyMatch<T>> {
    getSuggestions(query: string): FuzzyMatch<T>[] {
        const out: FuzzyMatch<T>[] = [];
        for (const item of this.getItems()) {
            const m = fuzzy(query, this.getItemText(item));
            if (m) out.push({ item, match: m });
        }
        if (query.trim()) out.sort((a, b) => b.match.score - a.match.score);
        return out;
    }
    renderSuggestion(m: FuzzyMatch<T>, el: HTMLElement) {
        const text = this.getItemText(m.item);
        let pos = 0;
        for (const [a, b] of m.match.matches) {
            if (a > pos) el.appendText(text.slice(pos, a));
            el.createSpan({ cls: 'suggestion-highlight', text: text.slice(a, b) });
            pos = b;
        }
        if (pos < text.length) el.appendText(text.slice(pos));
    }
    onChooseSuggestion(m: FuzzyMatch<T>, evt: MouseEvent | KeyboardEvent) { this.onChooseItem(m.item, evt); }
    abstract getItems(): T[];
    abstract getItemText(item: T): string;
    abstract onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void;
}

// ---------------------------------------------------------------- Notice
function noticeHost(): HTMLElement {
    const host = document.fullscreenElement && document.fullscreenElement !== document.documentElement ? document.fullscreenElement : document.body;
    let c = host.querySelector(':scope > .notice-container') as HTMLElement | null;
    if (!c) c = host.createDiv({ cls: 'notice-container', attr: { 'aria-live': 'polite' } });
    return c;
}

export class Notice {
    noticeEl: HTMLElement;
    messageEl: HTMLElement;
    containerEl: HTMLElement;
    private timer: number | null = null;

    constructor(message: string | DocumentFragment, duration?: number) {
        this.containerEl = noticeHost();
        this.noticeEl = this.containerEl.createDiv({ cls: 'notice' });
        this.messageEl = this.noticeEl.createDiv({ cls: 'notice-message' });
        this.messageEl.setText(message);
        this.noticeEl.addEventListener('click', () => this.hide());
        const ms = duration ?? 4500;
        if (ms > 0) this.timer = window.setTimeout(() => this.hide(), ms);
    }
    setMessage(message: string | DocumentFragment) { this.messageEl.setText(message); return this; }
    hide() {
        if (this.timer !== null) { window.clearTimeout(this.timer); this.timer = null; }
        this.noticeEl.remove();
    }
}

// ---------------------------------------------------------------- Setting + components
abstract class BaseComponent {
    disabled = false;
    then(cb: (c: this) => any) { cb(this); return this; }
    setDisabled(v: boolean) { this.disabled = v; return this; }
}

abstract class ValueComponent<T> extends BaseComponent {
    abstract getValue(): T;
    abstract setValue(v: T): this;
    registerOptionListener(listeners: Record<string, (v?: T) => T>, key: string) {
        this.onChange(v => listeners[key](v));
        return this;
    }
    abstract onChange(cb: (v: T) => any): this;
}

export class ToggleComponent extends ValueComponent<boolean> {
    toggleEl: HTMLElement;
    private value = false;
    private cbs: ((v: boolean) => any)[] = [];
    constructor(containerEl: HTMLElement) {
        super();
        this.toggleEl = containerEl.createDiv({ cls: 'checkbox-container', attr: { role: 'switch', tabindex: '0', 'aria-checked': 'false' } });
        this.toggleEl.createEl('input', { type: 'checkbox', attr: { tabindex: '-1' } });
        const flip = () => { if (this.disabled) return; this.setValue(!this.value); this.cbs.forEach(cb => cb(this.value)); };
        this.toggleEl.addEventListener('click', (e) => { e.preventDefault(); flip(); });
        this.toggleEl.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
    }
    getValue() { return this.value; }
    setValue(v: boolean) {
        this.value = !!v;
        this.toggleEl.toggleClass('is-enabled', this.value);
        this.toggleEl.setAttribute('aria-checked', String(this.value));
        (this.toggleEl.querySelector('input') as HTMLInputElement).checked = this.value;
        return this;
    }
    setDisabled(v: boolean) { super.setDisabled(v); this.toggleEl.toggleClass('is-disabled', v); return this; }
    setTooltip(t: string) { setTip(this.toggleEl, t); return this; }
    onChange(cb: (v: boolean) => any) { this.cbs.push(cb); return this; }
    onClick() { this.toggleEl.click(); }
}

export class DropdownComponent extends ValueComponent<string> {
    selectEl: HTMLSelectElement;
    constructor(containerEl: HTMLElement) {
        super();
        this.selectEl = containerEl.createEl('select', { cls: 'dropdown' }) as HTMLSelectElement;
    }
    addOption(value: string, display: string) { this.selectEl.createEl('option', { value, text: display }); return this; }
    addOptions(o: Record<string, string>) { for (const [k, v] of Object.entries(o)) this.addOption(k, v); return this; }
    getValue() { return this.selectEl.value; }
    setValue(v: string) { this.selectEl.value = v; return this; }
    setDisabled(v: boolean) { super.setDisabled(v); this.selectEl.disabled = v; return this; }
    onChange(cb: (v: string) => any) { this.selectEl.addEventListener('change', () => cb(this.selectEl.value)); return this; }
}

export class SliderComponent extends ValueComponent<number> {
    sliderEl: HTMLInputElement;
    private tipEl: HTMLElement | null = null;
    private instant = false;
    constructor(containerEl: HTMLElement) {
        super();
        this.sliderEl = containerEl.createEl('input', { cls: 'slider', type: 'range' }) as HTMLInputElement;
        this.sliderEl.addEventListener('input', () => this.updateTip());
    }
    setLimits(min: number | null, max: number | null, step: number | 'any') {
        if (min !== null) this.sliderEl.min = String(min);
        if (max !== null) this.sliderEl.max = String(max);
        this.sliderEl.step = String(step);
        return this;
    }
    getValue() { return Number(this.sliderEl.value); }
    setValue(v: number) { this.sliderEl.value = String(v); this.updateTip(); return this; }
    getValuePretty() { return this.sliderEl.value; }
    setInstant(v: boolean) { this.instant = v; return this; }
    setDynamicTooltip() {
        if (!this.tipEl) {
            this.tipEl = createSpan({ cls: 'hw-demo-slider-value' });
            this.sliderEl.insertAdjacentElement('beforebegin', this.tipEl);
        }
        this.updateTip();
        return this;
    }
    showTooltip() { /* the value is always shown next to the slider */ }
    private updateTip() { if (this.tipEl) this.tipEl.textContent = this.sliderEl.value; this.sliderEl.title = this.sliderEl.value; }
    setDisabled(v: boolean) { super.setDisabled(v); this.sliderEl.disabled = v; return this; }
    onChange(cb: (v: number) => any) {
        this.sliderEl.addEventListener('input', () => { if (this.instant) cb(this.getValue()); });
        this.sliderEl.addEventListener('change', () => { if (!this.instant) cb(this.getValue()); });
        return this;
    }
}

export class TextComponent extends ValueComponent<string> {
    inputEl: HTMLInputElement;
    constructor(containerEl: HTMLElement) {
        super();
        this.inputEl = containerEl.createEl('input', { type: 'text' }) as HTMLInputElement;
        this.inputEl.spellcheck = false;
    }
    getValue() { return this.inputEl.value; }
    setValue(v: string) { this.inputEl.value = v; return this; }
    setPlaceholder(p: string) { this.inputEl.placeholder = p; return this; }
    setDisabled(v: boolean) { super.setDisabled(v); this.inputEl.disabled = v; return this; }
    onChanged() { this.inputEl.dispatchEvent(new Event('input')); }
    onChange(cb: (v: string) => any) { this.inputEl.addEventListener('input', () => cb(this.inputEl.value)); return this; }
}

export class TextAreaComponent extends ValueComponent<string> {
    inputEl: HTMLTextAreaElement;
    constructor(containerEl: HTMLElement) {
        super();
        this.inputEl = containerEl.createEl('textarea') as HTMLTextAreaElement;
    }
    getValue() { return this.inputEl.value; }
    setValue(v: string) { this.inputEl.value = v; return this; }
    setPlaceholder(p: string) { this.inputEl.placeholder = p; return this; }
    onChange(cb: (v: string) => any) { this.inputEl.addEventListener('input', () => cb(this.inputEl.value)); return this; }
}

export class ColorComponent extends ValueComponent<string> {
    colorPickerEl: HTMLInputElement;
    constructor(containerEl: HTMLElement) {
        super();
        this.colorPickerEl = containerEl.createEl('input', { type: 'color' }) as HTMLInputElement;
    }
    getValue() { return this.colorPickerEl.value; }
    setValue(v: string) { this.colorPickerEl.value = v; return this; }
    setDisabled(v: boolean) { super.setDisabled(v); this.colorPickerEl.disabled = v; return this; }
    onChange(cb: (v: string) => any) { this.colorPickerEl.addEventListener('change', () => cb(this.colorPickerEl.value)); return this; }
}

export class ButtonComponent extends BaseComponent {
    buttonEl: HTMLButtonElement;
    constructor(containerEl: HTMLElement) {
        super();
        this.buttonEl = containerEl.createEl('button') as HTMLButtonElement;
    }
    setButtonText(t: string) { this.buttonEl.setText(t); return this; }
    setIcon(id: string) { setIcon(this.buttonEl, id); return this; }
    setCta() { this.buttonEl.addClass('mod-cta'); return this; }
    removeCta() { this.buttonEl.removeClass('mod-cta'); return this; }
    setWarning() { this.buttonEl.addClass('mod-warning'); return this; }
    setTooltip(t: string) { setTip(this.buttonEl, t); return this; }
    setClass(c: string) { this.buttonEl.addClass(c); return this; }
    setDisabled(v: boolean) { super.setDisabled(v); this.buttonEl.disabled = v; return this; }
    onClick(cb: (evt: MouseEvent) => any) { this.buttonEl.addEventListener('click', cb); return this; }
}

export class ExtraButtonComponent extends BaseComponent {
    extraSettingsEl: HTMLElement;
    constructor(containerEl: HTMLElement) {
        super();
        this.extraSettingsEl = containerEl.createDiv({ cls: 'clickable-icon extra-setting-button', attr: { role: 'button', tabindex: '0' } });
        this.extraSettingsEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.extraSettingsEl.click(); } });
    }
    setIcon(id: string) { setIcon(this.extraSettingsEl, id); return this; }
    setTooltip(t: string) { setTip(this.extraSettingsEl, t); return this; }
    setDisabled(v: boolean) { super.setDisabled(v); this.extraSettingsEl.toggleClass('is-disabled', v); return this; }
    onClick(cb: () => any) { this.extraSettingsEl.addEventListener('click', () => { if (!this.disabled) cb(); }); return this; }
}

export class Setting {
    settingEl: HTMLElement;
    infoEl: HTMLElement;
    nameEl: HTMLElement;
    descEl: HTMLElement;
    controlEl: HTMLElement;
    components: BaseComponent[] = [];

    constructor(containerEl: HTMLElement) {
        this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
        this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
        this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
        this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
        this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
    }
    setName(n: string | DocumentFragment) { this.nameEl.setText(n); return this; }
    setDesc(d: string | DocumentFragment) { this.descEl.setText(d); return this; }
    setClass(c: string) { this.settingEl.addClass(c); return this; }
    setTooltip(t: string) { setTip(this.nameEl, t); return this; }
    setHeading() { this.settingEl.addClass('setting-item-heading'); return this; }
    setDisabled(v: boolean) { this.settingEl.toggleClass('is-disabled', v); this.components.forEach(c => c.setDisabled(v)); return this; }
    private add<C extends BaseComponent>(c: C, cb: (c: C) => any) { this.components.push(c); cb(c); return this; }
    addToggle(cb: (c: ToggleComponent) => any) { return this.add(new ToggleComponent(this.controlEl), cb); }
    addDropdown(cb: (c: DropdownComponent) => any) { return this.add(new DropdownComponent(this.controlEl), cb); }
    addSlider(cb: (c: SliderComponent) => any) { return this.add(new SliderComponent(this.controlEl), cb); }
    addText(cb: (c: TextComponent) => any) { return this.add(new TextComponent(this.controlEl), cb); }
    addTextArea(cb: (c: TextAreaComponent) => any) { return this.add(new TextAreaComponent(this.controlEl), cb); }
    addSearch(cb: (c: TextComponent) => any) { return this.add(new TextComponent(this.controlEl), cb); }
    addColorPicker(cb: (c: ColorComponent) => any) { return this.add(new ColorComponent(this.controlEl), cb); }
    addButton(cb: (c: ButtonComponent) => any) { return this.add(new ButtonComponent(this.controlEl), cb); }
    addExtraButton(cb: (c: ExtraButtonComponent) => any) { return this.add(new ExtraButtonComponent(this.controlEl), cb); }
    then(cb: (s: this) => any) { cb(this); return this; }
}
