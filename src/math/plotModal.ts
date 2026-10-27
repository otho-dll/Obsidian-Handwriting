import { App, Modal, Notice } from 'obsidian';
import { Plot2D, Plot3D, PlotSpec, PLOT_COLORS, defaultPlot2D, defaultPlot3D, plotToPng, renderPlot, validatePlot, autoYRange, findPeriod, piText, CurveType, FitType, PlotSize } from './plot';
import { compile } from './expression';

/** Dialog for inserting / editing a function plot (2D: y=f(x), 3D: z=f(x,y)) with a live preview. */
export class PlotModal extends Modal {
    private p2: Plot2D;
    private p3: Plot3D;
    private kind: '2d' | '3d';
    private body!: HTMLElement;
    private preview!: HTMLCanvasElement;
    private errEl!: HTMLElement;
    private tabs: Record<string, HTMLElement> = {};
    private raf = 0;

    constructor(app: App, initial: PlotSpec | null, private onSubmit: (spec: PlotSpec, png: Blob) => void | Promise<void>) {
        super(app);
        this.p2 = initial?.kind === '2d' ? structuredCloneSafe(initial) : defaultPlot2D();
        this.p3 = initial?.kind === '3d' ? structuredCloneSafe(initial) : defaultPlot3D();
        this.kind = initial?.kind ?? '2d';
        this.editing = !!initial;
    }
    private editing: boolean;

    private get spec(): PlotSpec { return this.kind === '2d' ? this.p2 : this.p3; }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('hw-plot-modal');
        this.modalEl.addClass('mod-plot');
        this.titleEl.setText(this.editing ? 'Edit function plot' : 'Insert function plot');

        const tabs = contentEl.createDiv({ cls: 'hw-plot-tabs' });
        for (const [k, label] of [['2d', '2D  y = f(x)'], ['3d', '3D  z = f(x, y)']] as const) {
            const b = tabs.createEl('button', { text: label });
            b.onclick = () => { this.kind = k; this.refreshForm(); };
            this.tabs[k] = b;
        }
        const wrap = contentEl.createDiv({ cls: 'hw-plot-wrap' });
        this.body = wrap.createDiv({ cls: 'hw-plot-form' });
        const right = wrap.createDiv({ cls: 'hw-plot-right' });
        this.preview = right.createEl('canvas', { cls: 'hw-plot-preview' });
        this.errEl = right.createDiv({ cls: 'hw-plot-error' });

        const btns = contentEl.createDiv({ cls: 'hw-plot-buttons' });
        const cancel = btns.createEl('button', { text: 'Cancel' });
        cancel.onclick = () => this.close();
        const ok = btns.createEl('button', { text: this.editing ? 'Update plot' : 'Insert plot', cls: 'mod-cta' });
        ok.onclick = () => { void this.submit(); };
        this.refreshForm();
    }

    onClose() {
        cancelAnimationFrame(this.raf);
        this.contentEl.empty();
    }

    private async submit() {
        const err = validatePlot(this.spec);
        if (err) { new Notice(err); return; }
        const png = await plotToPng(this.spec, 2);
        if (!png) { new Notice('Could not render the plot.'); return; }
        await this.onSubmit(structuredCloneSafe(this.spec), png);
        this.close();
    }

    private schedulePreview() {
        cancelAnimationFrame(this.raf);
        this.raf = requestAnimationFrame(() => {
            const err = validatePlot(this.spec);
            this.errEl.setText(err ?? '');
            if (err) return;
            try { renderPlot(this.preview, this.spec, 1, true); } catch (e) { this.errEl.setText(e instanceof Error ? e.message : String(e)); }
        });
    }

    private refreshForm() {
        for (const k of Object.keys(this.tabs)) this.tabs[k].toggleClass('is-active', k === this.kind);
        this.body.empty();
        if (this.kind === '2d') this.form2D(); else this.form3D();
        this.schedulePreview();
    }

    /** Number field; also accepts expressions ("2pi", "π/2", "1/50"). */
    private num(parent: HTMLElement, label: string, get: () => number, set: (v: number) => void, disabled = false, usePi = false) {
        const row = parent.createDiv({ cls: 'hw-plot-num' });
        row.createSpan({ text: label });
        const inp = row.createEl('input', { type: 'text' });
        const show = () => { const v = get(); inp.value = (usePi && piText(v)) || String(parseFloat(v.toPrecision(6))); };
        show();
        inp.disabled = disabled;
        inp.oninput = () => {
            let v = NaN;
            try { v = compile(inp.value.replace(/(\d),(\d)/g, '$1.$2'))({}); } catch { /* still typing */ }
            if (isFinite(v)) { set(v); inp.removeClass('is-invalid'); this.schedulePreview(); } else inp.addClass('is-invalid');
        };
        (inp as HTMLInputElement & { refresh?: () => void }).refresh = show;
        return inp as HTMLInputElement & { refresh?: () => void };
    }

    private section(title: string): HTMLElement {
        const sec = this.body.createDiv({ cls: 'hw-plot-sec' });
        sec.createDiv({ cls: 'hw-plot-sectitle', text: title });
        return sec;
    }

    private check(parent: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void, after?: () => void) {
        const l = parent.createEl('label');
        const cb = l.createEl('input', { type: 'checkbox' });
        cb.checked = get();
        l.createSpan({ text: ' ' + label });
        cb.onchange = () => { set(cb.checked); after?.(); this.schedulePreview(); };
        return cb;
    }

    private form2D() {
        const p = this.p2;
        const list = this.section('Functions').createDiv({ cls: 'hw-plot-curves' });
        const exprInput = (row: HTMLElement, label: string, value: string, placeholder: string, set: (v: string) => void) => {
            row.createSpan({ text: label, cls: 'hw-plot-lbl' });
            const inp = row.createEl('input', { type: 'text', cls: 'hw-plot-expr' });
            inp.value = value;
            inp.placeholder = placeholder;
            inp.oninput = () => { set(inp.value); this.schedulePreview(); };
            return inp;
        };
        const draw = () => {
            list.empty();
            p.curves.forEach((c, i) => {
                const box = list.createDiv({ cls: 'hw-plot-curvebox' });
                const row = box.createDiv({ cls: 'hw-plot-curve' });
                const col = row.createEl('input', { type: 'color' });
                col.value = c.color;
                col.oninput = () => { c.color = col.value; this.schedulePreview(); };
                const type = row.createEl('select', { cls: 'hw-plot-type' });
                for (const [v, t] of [['fx', 'y = f(x)'], ['param', 'Parametric'], ['polar', 'Polar r(θ)'], ['points', 'Data points']] as const) type.createEl('option', { value: v, text: t });
                type.value = c.type ?? 'fx';
                type.onchange = () => {
                    c.type = type.value as CurveType;
                    if (c.type === 'param' && !c.expr2) { c.expr = c.expr || 'cos(t)'; c.expr2 = 'sin(t)'; }
                    if ((c.type === 'param' || c.type === 'polar') && c.tmin === undefined) { c.tmin = 0; c.tmax = 2 * Math.PI; }
                    if (c.type === 'points' && !c.data) { c.data = '0, 0\n1, 1.1\n2, 3.9\n3, 9.2'; c.fit = c.fit ?? 'none'; }
                    draw(); this.schedulePreview();
                };
                if (p.curves.length > 1) {
                    const del = row.createEl('button', { text: '×', cls: 'hw-plot-del' });
                    del.setAttribute('aria-label', 'Remove');
                    del.onclick = () => { p.curves.splice(i, 1); draw(); this.schedulePreview(); };
                }
                const t = c.type ?? 'fx';
                if (t === 'fx') {
                    exprInput(box.createDiv({ cls: 'hw-plot-curve' }), 'y =', c.expr, 'x^2 - 3x + 1   or   10 sin(100π t)', v => c.expr = v);
                } else if (t === 'param' || t === 'polar') {
                    if (t === 'param') {
                        exprInput(box.createDiv({ cls: 'hw-plot-curve' }), 'x(t) =', c.expr, 'cos(t)', v => c.expr = v);
                        exprInput(box.createDiv({ cls: 'hw-plot-curve' }), 'y(t) =', c.expr2 ?? '', 'sin(t)', v => c.expr2 = v);
                    } else {
                        exprInput(box.createDiv({ cls: 'hw-plot-curve' }), 'r(θ) =', c.expr, '1 + cos(θ)', v => c.expr = v);
                    }
                    const r = box.createDiv({ cls: 'hw-plot-range' });
                    const v = t === 'param' ? 't' : 'θ';
                    this.num(r, `${v} from`, () => c.tmin ?? 0, x => c.tmin = x, false, true);
                    this.num(r, 'to', () => c.tmax ?? 2 * Math.PI, x => c.tmax = x, false, true);
                } else {
                    const ta = box.createEl('textarea', { cls: 'hw-plot-data' });
                    ta.value = c.data ?? '';
                    ta.placeholder = 'x, y – one point per line (you can paste two columns from a spreadsheet)';
                    ta.rows = 4;
                    ta.oninput = () => { c.data = ta.value; this.schedulePreview(); };
                    const fr = box.createDiv({ cls: 'hw-plot-curve' });
                    fr.createSpan({ text: 'Fit', cls: 'hw-plot-lbl' });
                    const fit = fr.createEl('select');
                    for (const [v, tx] of [['none', 'None'], ['linear', 'Linear  a·x + b'], ['quad', 'Quadratic'], ['exp', 'Exponential  a·e^(bx)'], ['log', 'Logarithmic'], ['power', 'Power  a·x^b']] as const) fit.createEl('option', { value: v, text: tx });
                    fit.value = c.fit ?? 'none';
                    fit.onchange = () => { c.fit = fit.value as FitType; this.schedulePreview(); };
                }
            });
            if (p.curves.length < PLOT_COLORS.length) {
                const add = list.createEl('button', { text: '+ Add function' });
                add.onclick = () => { p.curves.push({ expr: '', color: PLOT_COLORS[p.curves.length % PLOT_COLORS.length], type: 'fx' }); draw(); };
            }
        };
        draw();

        const rs = this.section('Range');
        const range = rs.createDiv({ cls: 'hw-plot-range' });
        const xminI = this.num(range, 'x min', () => p.xmin, v => p.xmin = v, false, true);
        const xmaxI = this.num(range, 'x max', () => p.xmax, v => p.xmax = v, false, true);
        const ymin = this.num(range, 'y min', () => p.ymin, v => p.ymin = v, p.autoY);
        const ymax = this.num(range, 'y max', () => p.ymax, v => p.ymax = v, p.autoY);
        const per = rs.createDiv({ cls: 'hw-plot-opts' });
        const perBtn = per.createEl('button', { text: 'One period', cls: 'hw-plot-period' });
        perBtn.setAttribute('title', 'Set the x range to exactly one period of the first function (more with the number next to it)');
        const perN = per.createEl('input', { type: 'number', cls: 'hw-plot-pern' });
        perN.min = '1'; perN.max = '20'; perN.value = '1';
        perN.setAttribute('aria-label', 'Number of periods');
        perN.oninput = () => { perBtn.setText(Number(perN.value) > 1 ? `${perN.value} periods` : 'One period'); };
        const piCb = this.check(per, 'x axis in π', () => !!p.piX, v => p.piX = v, () => { xminI.refresh?.(); xmaxI.refresh?.(); });
        const auto = this.check(per, 'Auto y range', () => p.autoY, v => p.autoY = v, () => {
            if (!p.autoY) { const [a, b] = autoYRange(p); p.ymin = a; p.ymax = b; ymin.refresh?.(); ymax.refresh?.(); }
            ymin.disabled = ymax.disabled = p.autoY;
        });
        perBtn.onclick = () => {
            const f = p.curves.find(c => (c.type ?? 'fx') === 'fx' && c.expr.trim());
            if (!f) { new Notice('Add a function y = f(x) first.'); return; }
            const T = findPeriod(f.expr, Math.max(20, p.xmax - p.xmin));
            if (!T) { new Notice('This function does not seem to be periodic.'); return; }
            const k = Math.max(1, Math.min(20, Math.round(Number(perN.value) || 1)));
            p.xmin = 0; p.xmax = T * k;
            p.autoY = true; auto.checked = true; ymin.disabled = ymax.disabled = true;
            p.piX = !!piText(T) && T >= 0.5; piCb.checked = p.piX;
            xminI.refresh?.(); xmaxI.refresh?.();
            this.schedulePreview();
        };

        const look = this.section('Look');
        const lr = look.createDiv({ cls: 'hw-plot-opts' });
        const size = lr.createEl('select');
        for (const [v, t] of [['standard', 'Standard 4:3'], ['wide', 'Wide 5:2'], ['square', 'Square'], ['strip', 'Strip 4:1']] as const) size.createEl('option', { value: v, text: t });
        size.value = p.size ?? 'standard';
        size.setAttribute('aria-label', 'Image proportions');
        size.onchange = () => { p.size = size.value as PlotSize; this.schedulePreview(); };
        const lw = lr.createEl('select');
        for (const [v, t] of [['1.4', 'Thin line'], ['2.2', 'Normal line'], ['3.4', 'Thick line']] as const) lw.createEl('option', { value: v, text: t });
        lw.value = String(p.lineWidth ?? 2.2);
        if (!lw.value) lw.value = '2.2';
        lw.onchange = () => { p.lineWidth = parseFloat(lw.value); this.schedulePreview(); };
        const lc = look.createDiv({ cls: 'hw-plot-opts' });
        this.check(lc, 'Clean style for notes', () => !!p.clean, v => p.clean = v).parentElement?.setAttribute('title', 'Axes with arrows through zero, no frame and no grid, transparent background');
        this.check(lc, 'Grid', () => p.grid, v => p.grid = v);
        this.check(lc, 'Legend', () => p.legend !== false, v => p.legend = v);
        this.check(lc, 'Equal scale', () => !!p.equal, v => p.equal = v).parentElement?.setAttribute('title', 'The same scale on both axes (circles look round)');
        const labels = look.createDiv({ cls: 'hw-plot-range' });
        const txt = (label: string, get: () => string, set: (v: string) => void, ph: string) => {
            const row = labels.createDiv({ cls: 'hw-plot-num' });
            row.createSpan({ text: label });
            const inp = row.createEl('input', { type: 'text' });
            inp.value = get(); inp.placeholder = ph;
            inp.oninput = () => { set(inp.value); this.schedulePreview(); };
        };
        txt('x label', () => p.xLabel ?? '', v => p.xLabel = v, 'x, t, ω…');
        txt('y label', () => p.yLabel ?? '', v => p.yLabel = v, 'y, u(t)…');
        this.body.createDiv({ cls: 'hw-plot-help', text: 'Functions: sin cos tan asin acos atan sinh cosh tanh sqrt cbrt abs exp ln log log2 floor ceil round sign min max · constants: pi (π), e · ^ for powers, 2x means 2·x · you can use t instead of x. Ranges accept expressions like 2pi or 1/50.' });
    }

    private form3D() {
        const p = this.p3;
        const row = this.body.createDiv({ cls: 'hw-plot-curve' });
        row.createSpan({ text: 'z =' });
        const inp = row.createEl('input', { type: 'text', cls: 'hw-plot-expr' });
        inp.value = p.expr;
        inp.placeholder = 'sin(x) * cos(y)';
        inp.oninput = () => { p.expr = inp.value; this.schedulePreview(); };

        const range = this.body.createDiv({ cls: 'hw-plot-range' });
        this.num(range, 'x min', () => p.xmin, v => p.xmin = v);
        this.num(range, 'x max', () => p.xmax, v => p.xmax = v);
        this.num(range, 'y min', () => p.ymin, v => p.ymin = v);
        this.num(range, 'y max', () => p.ymax, v => p.ymax = v);

        const slider = (label: string, min: number, max: number, get: () => number, set: (v: number) => void) => {
            const r = this.body.createDiv({ cls: 'hw-plot-slider' });
            r.createSpan({ text: label });
            const s = r.createEl('input', { type: 'range' });
            s.min = String(min); s.max = String(max); s.value = String(get());
            const val = r.createSpan({ text: String(Math.round(get())) + '°', cls: 'hw-plot-slider-val' });
            s.oninput = () => { set(parseFloat(s.value)); val.setText(Math.round(get()) + '°'); this.schedulePreview(); };
        };
        slider('Rotate', -180, 180, () => p.yaw, v => p.yaw = v);
        slider('Tilt', 0, 90, () => p.pitch, v => p.pitch = v);

        const opts = this.body.createDiv({ cls: 'hw-plot-opts' });
        const sel = opts.createEl('select');
        for (const k of ['rainbow', 'heat', 'ocean', 'mono'] as const) sel.createEl('option', { value: k, text: k });
        sel.value = p.palette;
        sel.onchange = () => { p.palette = sel.value as Plot3D['palette']; this.schedulePreview(); };
        const w = opts.createEl('label');
        const wc = w.createEl('input', { type: 'checkbox' });
        wc.checked = p.wire;
        w.createSpan({ text: ' Mesh lines' });
        wc.onchange = () => { p.wire = wc.checked; this.schedulePreview(); };
        this.body.createDiv({ cls: 'hw-plot-help', text: 'Uses variables x and y, for example x^2 - y^2, sin(x)*cos(y), exp(-(x^2+y^2)).' });
    }
}

function structuredCloneSafe<T>(o: T): T { return JSON.parse(JSON.stringify(o)) as T; }
