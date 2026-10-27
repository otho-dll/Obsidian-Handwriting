import { App, Modal, Notice, setIcon } from 'obsidian';
import { formatNumber } from './expression';
import { Value, evaluateInput, formatPolar, isCx, isMat, valueToInput } from './values';
import { UNIT_GROUPS, convertUnits } from './units';

/** Calculator state lives with the plugin (history and variables survive closing the window). */
export interface CalcState {
    /** Whether the history panel next to the calculator is open. */
    historyOpen?: boolean;
    /** Position of the floating panel (px relative to the view) – remembered between openings. */
    pos?: { x: number; y: number };
    /** Tab: basic (small) or scientific. */
    tab?: 'basic' | 'sci';
    /** Whether the unit converter is expanded (scientific tab). */
    unitsOpen?: boolean;
    unitGroup?: string;
    /** expr – the entry, result – result to display, ins – result to insert back (without the unit). */
    history: { expr: string; result: string; ins?: string }[];
    vars: Record<string, Value>;
    degrees: boolean;
    ans: Value;
}
export function newCalcState(): CalcState { return { history: [], vars: {}, degrees: false, ans: 0, tab: 'basic' }; }

type Key = string | [label: string, insert: string, title?: string];

// Basic: operations, powers, roots, trigonometry and logarithms – 5 columns × 6 rows.
const BASIC_KEYS: Key[] = [
    ['sin', 'sin('], ['cos', 'cos('], ['tan', 'tan('], ['ln', 'ln('], ['log', 'log('],
    ['√', 'sqrt('], ['x²', '^2'], ['xʸ', '^'], ['(', '('], [')', ')'],
    '7', '8', '9', '÷', '⌫',
    '4', '5', '6', '×', 'C',
    '1', '2', '3', '-', ['π', 'pi'],
    '0', '.', ['ans', 'ans'], '+', '=',
];

// Scientific: extra functions above the regular keypad – 6 columns.
const SCI_KEYS: Key[] = [
    ['asin', 'asin('], ['acos', 'acos('], ['atan', 'atan('], ['sinh', 'sinh('], ['cosh', 'cosh('], ['tanh', 'tanh('],
    ['eˣ', 'exp('], ['10ˣ', '10^'], ['x⁻¹', '^(-1)'], ['|x|', 'abs('], ['n!', '!'], ['nCr', 'nCr(', 'Combinations nCr(n, r)'],
    ['i', 'i', 'Imaginary unit'], ['∠', '∠', 'Polar form: 10∠30'], ['°', '°', 'Degrees, e.g. 30°'], ['re', 're('], ['im', 'im('], ['arg', 'arg(', 'Angle of a complex number'],
    ['[', '[', 'Matrix: [1, 2; 3, 4]'], [']', ']'], [',', ','], [';', ';', 'Next matrix row'], ['det', 'det(', 'Determinant'], ['inv', 'inv(', 'Inverse matrix'],
    ['∫', 'int(', 'Integral: int(x^2, 0, 1)'], ['d/dx', 'der(', 'Derivative: der(x^3, 2)'], ['solve', 'solve(', 'Solve f(x) = 0: solve(x^2 - 2, 1)'], ['x', 'x', 'Variable for ∫, d/dx and solve'], ['e', 'e'], ['%', '%', 'Modulo'],
];

/** Shared calculator UI: used in the dialog (command) and in the floating panel on the note. */
export class CalculatorCore {
    private input!: HTMLInputElement;
    private resultEl!: HTMLElement;
    private histEl!: HTMLElement;
    private modeBtn!: HTMLButtonElement;
    private histPane!: HTMLElement;
    private histBtn!: HTMLElement;
    private main!: HTMLElement;
    private sciEl!: HTMLElement;
    private unitsEl!: HTMLElement;
    private tabBtns: Record<'basic' | 'sci', HTMLElement> = {} as Record<'basic' | 'sci', HTMLElement>;

    constructor(private contentEl: HTMLElement, private st: CalcState, private noSoftKeyboard = false, private onLayout?: () => void) {}

    build() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('hw-calc-row');
        const main = this.main = contentEl.createDiv({ cls: 'hw-calc-main' });

        // Bar: tabs + angle mode + copy + history (icons, so it takes little space).
        const top = main.createDiv({ cls: 'hw-calc-top' });
        const tabs = top.createDiv({ cls: 'hw-calc-tabs' });
        for (const [k, label] of [['basic', 'Basic'], ['sci', 'Scientific']] as const) {
            const b = tabs.createEl('button', { text: label, cls: 'hw-calc-tab' });
            b.onclick = () => this.setTab(k);
            this.tabBtns[k] = b;
        }
        top.createDiv({ cls: 'hw-calc-topspace' });
        this.modeBtn = top.createEl('button', { cls: 'hw-calc-mode' });
        this.modeBtn.setAttribute('aria-label', 'Angle unit (radians / degrees)');
        this.modeBtn.onclick = () => { this.st.degrees = !this.st.degrees; this.updateMode(); this.preview(); };
        const copy = top.createEl('button', { cls: 'hw-calc-icon' });
        setIcon(copy, 'copy');
        copy.setAttribute('aria-label', 'Copy result');
        copy.onclick = () => {
            const last = this.st.history[this.st.history.length - 1];
            const txt = this.resultEl.dataset.value ?? last?.result;
            if (txt) { void navigator.clipboard.writeText(txt); new Notice('Copied: ' + txt); }
        };
        this.histBtn = top.createEl('button', { cls: 'hw-calc-icon hw-calc-histbtn' });
        setIcon(this.histBtn, 'history');
        this.histBtn.setAttribute('aria-label', 'Show or hide the history');
        this.histBtn.onclick = () => this.setHistoryOpen(!this.st.historyOpen);

        this.input = main.createEl('input', { type: 'text', cls: 'hw-calc-input' });
        this.input.placeholder = '0';
        if (this.noSoftKeyboard) this.input.setAttribute('inputmode', 'none');
        this.resultEl = main.createDiv({ cls: 'hw-calc-result' });

        // History panel next to the calculator (on the left, like the Windows calculator): scrolling list + clear.
        this.histPane = contentEl.createDiv({ cls: 'hw-calc-histpane' });
        const histInner = this.histPane.createDiv({ cls: 'hw-calc-histinner' });
        const histHead = histInner.createDiv({ cls: 'hw-calc-histhead' });
        histHead.createSpan({ text: 'History', cls: 'hw-calc-histtitle' });
        const clr = histHead.createEl('button', { cls: 'hw-calc-histclear' });
        setIcon(clr.createSpan(), 'trash-2');
        clr.createSpan({ text: ' Clear' });
        clr.setAttribute('aria-label', 'Clear history');
        clr.onclick = () => { this.st.history = []; this.drawHistory(); };
        this.histEl = histInner.createDiv({ cls: 'hw-calc-history' });
        this.histPane.addEventListener('pointerdown', (e) => e.stopPropagation());
        contentEl.insertBefore(this.histPane, main);

        // Scientific tab: extra functions + unit converter (above the regular keypad).
        this.sciEl = main.createDiv({ cls: 'hw-calc-sci' });
        const sciPad = this.sciEl.createDiv({ cls: 'hw-calc-pad hw-calc-pad6' });
        for (const k of SCI_KEYS) this.addKey(sciPad, k);
        const unitsBar = this.sciEl.createDiv({ cls: 'hw-calc-unitsbar' });
        const unitsToggle = unitsBar.createEl('button', { cls: 'hw-calc-unitsbtn' });
        setIcon(unitsToggle.createSpan(), 'ruler');
        unitsToggle.createSpan({ text: ' Unit converter' });
        this.unitsEl = this.sciEl.createDiv({ cls: 'hw-calc-units' });
        unitsToggle.onclick = () => { this.st.unitsOpen = !this.st.unitsOpen; this.updateTab(); };
        this.buildUnits();
        this.sciEl.createDiv({ cls: 'hw-calc-help', text: 'Examples: (3+4i)·2 · 10∠30 · [1,2;3,4]·[5;6] · int(x^2,0,1) · solve(x^2-2,1) · 100 km/h to m/s' });

        const pad = main.createDiv({ cls: 'hw-calc-pad' });
        for (const k of BASIC_KEYS) this.addKey(pad, k);

        this.input.addEventListener('input', () => this.preview());
        this.input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this.commit(); }
            else if (e.key === 'ArrowUp') {
                const last = this.st.history[this.st.history.length - 1];
                if (last && !this.input.value) { this.input.value = last.expr; e.preventDefault(); }
            }
        });
        this.updateMode();
        this.updateTab(false);
        this.drawHistory();
        this.setHistoryOpen(!!this.st.historyOpen, false);
    }

    private addKey(pad: HTMLElement, k: Key) {
        const [label, text, title] = typeof k === 'string' ? [k, k === '÷' ? '/' : k === '×' ? '*' : k, undefined] : k;
        const b = pad.createEl('button', { text: label });
        if (title) { b.setAttribute('aria-label', title); b.setAttribute('title', title); }
        if (label === '=') { b.addClass('mod-cta'); b.addClass('hw-calc-eq'); b.onclick = () => this.commit(); return; }
        if (label === '⌫') { b.addClass('hw-calc-op'); b.onclick = () => this.backspace(); return; }
        if (label === 'C') { b.addClass('hw-calc-op'); b.onclick = () => { this.input.value = ''; this.preview(); this.focusInput(); }; return; }
        if ('+-×÷'.includes(label) && label.length === 1) b.addClass('hw-calc-op');
        b.onclick = () => this.insert(text);
    }

    private setTab(tab: 'basic' | 'sci') {
        if (this.st.tab === tab) return;
        this.st.tab = tab;
        this.updateTab();
    }

    private updateTab(notify = true) {
        const tab = this.st.tab ?? 'basic';
        for (const k of ['basic', 'sci'] as const) this.tabBtns[k].toggleClass('is-active', k === tab);
        this.main.toggleClass('is-sci', tab === 'sci');
        this.sciEl.style.display = tab === 'sci' ? '' : 'none';
        this.unitsEl.style.display = this.st.unitsOpen ? '' : 'none';
        if (notify) this.onLayout?.();
    }

    /** Unit converter: quantity, value, "from" and "to" unit. */
    private buildUnits() {
        const el = this.unitsEl;
        el.empty();
        const groupSel = el.createEl('select', { cls: 'hw-calc-ugroup' });
        for (const g of UNIT_GROUPS) groupSel.createEl('option', { value: g.name, text: g.name });
        const group = UNIT_GROUPS.find(g => g.name === this.st.unitGroup) ?? UNIT_GROUPS[0];
        groupSel.value = group.name;
        const row = el.createDiv({ cls: 'hw-calc-urow' });
        const val = row.createEl('input', { type: 'text', cls: 'hw-calc-uval' });
        val.value = '1';
        if (this.noSoftKeyboard) val.setAttribute('inputmode', 'decimal');
        const from = row.createEl('select');
        row.createSpan({ text: '→' });
        const to = row.createEl('select');
        for (const u of group.units) { from.createEl('option', { value: u, text: u.replace('^2', '²').replace('^3', '³') }); to.createEl('option', { value: u, text: u.replace('^2', '²').replace('^3', '³') }); }
        to.selectedIndex = Math.min(1, group.units.length - 1);
        const out = el.createDiv({ cls: 'hw-calc-uout' });
        const update = () => {
            const v = parseFloat(val.value.replace(',', '.'));
            if (isNaN(v)) { out.setText(''); delete out.dataset.value; return; }
            try {
                const r = formatNumber(convertUnits(v, from.value, to.value));
                out.setText(`= ${r} ${to.options[to.selectedIndex]?.text ?? to.value}`);
                out.dataset.value = r;
            } catch (e) { out.setText(e instanceof Error ? e.message : 'Error'); delete out.dataset.value; }
        };
        out.setAttribute('title', 'Insert into the calculator');
        out.onclick = () => { if (out.dataset.value) this.insert(out.dataset.value); };
        val.oninput = update; from.onchange = update; to.onchange = update;
        groupSel.onchange = () => { this.st.unitGroup = groupSel.value; this.buildUnits(); this.onLayout?.(); };
        update();
    }

    private setHistoryOpen(open: boolean, notify = true) {
        this.st.historyOpen = open;
        this.histPane.style.display = open ? '' : 'none';
        this.histBtn.toggleClass('is-active', open);
        if (open) this.histEl.scrollTop = this.histEl.scrollHeight;
        if (notify) this.onLayout?.();
    }

    focus() { this.input.focus(); }
    private focusInput() { if (!this.noSoftKeyboard) this.input.focus(); }

    private updateMode() { this.modeBtn.setText(this.st.degrees ? 'DEG' : 'RAD'); }

    private insert(text: string) {
        const el = this.input;
        const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
        el.value = el.value.slice(0, s) + text + el.value.slice(e);
        const pos = s + text.length;
        el.setSelectionRange(pos, pos);
        this.focusInput();
        this.preview();
    }
    private backspace() {
        const el = this.input;
        const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
        if (s !== e) el.value = el.value.slice(0, s) + el.value.slice(e);
        else if (s > 0) { el.value = el.value.slice(0, s - 1) + el.value.slice(s); el.setSelectionRange(s - 1, s - 1); }
        this.focusInput();
        this.preview();
    }

    private ctx(vars: Record<string, Value>) {
        return { vars: { ...vars, ans: this.st.ans }, degrees: this.st.degrees };
    }

    /** Result on screen: a number, a complex number (also in polar form) or a matrix as a grid. */
    private showResult(v: Value, text: string) {
        const el = this.resultEl;
        el.empty();
        el.removeClass('is-error');
        el.dataset.value = text;
        if (isMat(v)) {
            const grid = el.createDiv({ cls: 'hw-calc-matrix' });
            grid.style.gridTemplateColumns = `repeat(${v.cols}, auto)`;
            for (const x of v.d) grid.createSpan({ text: formatNumber(x) });
            return;
        }
        el.createSpan({ text: '= ' + text });
        if (isCx(v)) el.createDiv({ cls: 'hw-calc-polar', text: formatPolar(v, this.st.degrees) });
    }

    private preview() {
        const src = this.input.value;
        this.resultEl.removeClass('is-error');
        delete this.resultEl.dataset.value;
        if (!src.trim()) { this.resultEl.empty(); return; }
        try {
            const r = evaluateInput(src, this.ctx({ ...this.st.vars }));
            this.showResult(r.value, r.text);
        } catch {
            this.resultEl.empty();   // errors don't get in the way while typing
        }
    }

    private commit() {
        const src = this.input.value.trim();
        if (!src) return;
        try {
            const c = this.ctx(this.st.vars);
            const r = evaluateInput(src, c);
            // An assignment goes into the calculator variables (without "ans").
            if (r.assigned) this.st.vars[r.assigned] = r.value;
            this.st.ans = r.value;
            this.st.history.push({ expr: src, result: r.assigned ? `${r.assigned} = ${r.text}` : r.text, ins: valueToInput(r.value) });
            if (this.st.history.length > 100) this.st.history.shift();
            this.input.value = '';
            this.showResult(r.value, r.text);
            this.drawHistory();
        } catch (e) {
            this.resultEl.empty();
            this.resultEl.addClass('is-error');
            this.resultEl.setText(e instanceof Error ? e.message : 'Error');
        }
        this.focusInput();
    }

    private drawHistory() {
        this.histEl.empty();
        if (this.st.history.length === 0) {
            this.histEl.createDiv({ text: 'There\'s no history yet.', cls: 'hw-calc-histempty' });
            return;
        }
        for (const h of this.st.history) {
            const row = this.histEl.createDiv({ cls: 'hw-calc-hrow' });
            row.createDiv({ text: h.expr, cls: 'hw-calc-hexpr' });
            const res = row.createDiv({ text: /^[a-z_]\w* = /i.test(h.result) ? h.result : '= ' + h.result, cls: 'hw-calc-hres' });
            row.onclick = () => this.insert(h.expr);
            res.onclick = (e) => {
                e.stopPropagation();
                // The result is inserted as a number (without the unit and without "a = ").
                this.insert(h.ins ?? h.result.replace(/^[a-z_]\w* = /i, ''));
            };
        }
        this.histEl.scrollTop = this.histEl.scrollHeight;
    }
}

export class CalculatorModal extends Modal {
    constructor(app: App, private st: CalcState) { super(app); }
    onOpen() {
        this.contentEl.addClass('hw-calc-modal');
        this.titleEl.setText('Calculator');
        const core = new CalculatorCore(this.contentEl, this.st);
        core.build();
        window.setTimeout(() => core.focus(), 30);
    }
    onClose() { this.contentEl.empty(); }
}
