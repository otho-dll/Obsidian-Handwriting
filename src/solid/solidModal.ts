import { App, Menu, Modal, setIcon } from 'obsidian';
import type { Polyline } from '../circuit/font';
import { renderSolid, solidBox, type SolidLines } from './render';
import { VIEW_ANGLES } from './projection';
import { newSolidSpec, SOLIDS, solidDef, solidParams, type HiddenMode, type ProjectionKind, type SolidKind, type SolidSpec } from './types';

const NS = 'http://www.w3.org/2000/svg';
const INK = '#1f2328';

/** Editor state kept for the whole Obsidian session (survives Cancel / ×). `size`: scale in the note. */
export interface SolidSession { spec: SolidSpec; size: number }
export function newSolidSession(): SolidSession { return { spec: newSolidSpec(), size: 1 }; }

const PROJECTIONS: [ProjectionKind, string, string][] = [
    ['iso', 'Iso', 'Isometric view (30° axes, true lengths)'],
    ['dimetric', 'Dimetric', 'Dimetric view (ISO 5456-3: 7° / 42°, depth halved)'],
    ['cavalier', 'Cavalier', 'Oblique view: front in true shape, depth at 45° in full length'],
    ['cabinet', 'Cabinet', 'Oblique view: front in true shape, depth at 45° at half length'],
    ['perspective', 'Perspective', 'Perspective – drag the preview to turn the solid'],
    ['views', '3 views', 'Front, top and side view'],
    ['free', 'Free', 'Any angle – drag the preview to turn the solid'],
];
const HIDDEN: [HiddenMode, string][] = [['hide', 'Hidden'], ['dashed', 'Dashed'], ['solid', 'Solid']];

const f1 = (v: number) => Math.round(v * 10) / 10;
const pathD = (ls: Polyline[]) => ls.map(l => 'M' + l.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L')).join('');

function svgEl<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
    const e = activeDocument.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    parent.appendChild(e);
    return e;
}

/** The lines of a solid into an SVG (the viewBox fits them). `lw`: line width in screen pixels. */
function drawLines(svg: SVGSVGElement, r: SolidLines, hidden: HiddenMode, lw: number, pad = 0.08, color = INK) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const b = solidBox(r);
    if (!isFinite(b.x0)) return;
    const w = Math.max(1, b.x1 - b.x0), h = Math.max(1, b.y1 - b.y0), p = pad * Math.max(w, h);
    svg.setAttribute('viewBox', `${f1(b.x0 - p)} ${f1(b.y0 - p)} ${f1(w + 2 * p)} ${f1(h + 2 * p)}`);
    const line = (ls: Polyline[], extra: Record<string, string | number>) => {
        if (!ls.length) return;
        svgEl(svg, 'path', { d: pathD(ls), fill: 'none', stroke: color, 'stroke-width': lw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', ...extra });
    };
    line(r.axes, { 'stroke-width': lw * 0.7, 'stroke-dasharray': '14 4 2 4', opacity: 0.8 });
    line(r.hidden, hidden === 'dashed' ? { 'stroke-dasharray': '7 5', 'stroke-width': lw * 0.85 } : {});
    line(r.visible, {});
}

/** "Insert solid": a 3D solid with a chosen view, inserted into the note as ordinary pen strokes. */
export class SolidModal extends Modal {
    private svg!: SVGSVGElement;
    private dims!: HTMLElement;
    private viewOpts!: HTMLElement;
    private kindBtns = new Map<SolidKind, HTMLElement>();
    private projBtns = new Map<ProjectionKind, HTMLElement>();
    private hiddenBtns = new Map<HiddenMode, HTMLElement>();
    private axesCb!: HTMLInputElement;
    private raf = 0;
    private drag: { x: number; y: number; yaw: number; pitch: number } | null = null;
    private ro: ResizeObserver | null = null;

    constructor(app: App, private session: SolidSession, private onInsert: (lines: SolidLines, spec: SolidSpec, size: number) => void) {
        super(app);
    }
    private get spec() { return this.session.spec; }

    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        contentEl.addClass('hw-plot-modal', 'hw-circuit-modal', 'hw-solid-modal');
        modalEl.addClass('mod-plot', 'mod-circuit', 'mod-solid');
        this.titleEl.setText('Insert solid');

        const wrap = contentEl.createDiv({ cls: 'hw-plot-wrap hw-circuit-wrap' });
        const side = wrap.createDiv({ cls: 'hw-circuit-side' });
        const form = side.createDiv({ cls: 'hw-plot-form hw-circuit-form' });
        const right = wrap.createDiv({ cls: 'hw-plot-right hw-circuit-right' });
        const sheet = right.createDiv({ cls: 'hw-circuit-sheet hw-solid-sheet' });
        this.svg = svgEl(sheet, 'svg', { role: 'img', 'aria-label': 'Preview of the solid – drag to turn it' });
        this.svg.addClass('hw-circuit-board', 'hw-solid-board');
        sheet.createDiv({ cls: 'hw-solid-hint', text: 'Drag to turn' });
        this.bindDrag();

        const sec = (title: string) => { const s = form.createDiv({ cls: 'hw-plot-sec' }); s.createDiv({ cls: 'hw-plot-sectitle', text: title }); return s; };

        // SOLID: buttons with small drawings (each drawn by the same pipeline, isometric)
        const pal = sec('Solid').createDiv({ cls: 'hw-circuit-palette hw-solid-palette' });
        for (const s of SOLIDS) {
            const b = pal.createEl('button', { cls: 'hw-circuit-pal', attr: { title: s.name } });
            const ic = svgEl(b, 'svg', { 'aria-hidden': 'true' });
            drawLines(ic, renderSolid({ ...newSolidSpec(), kind: s.kind, projection: 'iso', hidden: 'hide', axes: false }, 160), 'hide', 1.3, 0.04, 'currentColor');
            b.createSpan({ text: s.name });
            b.onclick = () => { this.spec.kind = s.kind; this.refreshForm(); this.schedule(); };
            this.kindBtns.set(s.kind, b);
        }

        this.dims = sec('Dimensions').createDiv({ cls: 'hw-solid-dims' });

        const view = sec('View');
        const seg = view.createDiv({ cls: 'hw-solid-seg hw-solid-proj' });
        for (const [k, label, tip] of PROJECTIONS) {
            const b = seg.createEl('button', { text: label, attr: { title: tip, 'aria-label': tip } });
            b.onclick = () => this.setProjection(k);
            this.projBtns.set(k, b);
        }
        this.viewOpts = view.createDiv({ cls: 'hw-solid-viewopts' });

        const lines = sec('Hidden edges');
        const hs = lines.createDiv({ cls: 'hw-solid-seg' });
        for (const [k, label] of HIDDEN) {
            const b = hs.createEl('button', { text: label });
            b.onclick = () => { this.spec.hidden = k; this.refreshForm(); this.schedule(); };
            this.hiddenBtns.set(k, b);
        }
        const ax = lines.createEl('label', { cls: 'hw-solid-check' });
        this.axesCb = ax.createEl('input', { type: 'checkbox' });
        ax.appendText(' Centre lines (axes of symmetry)');
        this.axesCb.onchange = () => { this.spec.axes = this.axesCb.checked; this.schedule(); };

        // bar: reset view, size in the note … Cancel, Insert solid
        const bar = side.createDiv({ cls: 'hw-circuit-bar' });
        const tool = (icon: string, label: string, fn: (ev: MouseEvent) => void) => {
            const b = bar.createEl('button', { cls: 'hw-circuit-icon', attr: { 'aria-label': label, title: label } });
            setIcon(b, icon);
            b.onclick = fn;
            return b;
        };
        tool('rotate-ccw', 'Reset the view (isometric)', () => {
            const d = newSolidSpec();
            this.spec.projection = 'iso'; this.spec.yaw = d.yaw; this.spec.pitch = d.pitch;
            this.refreshForm(); this.schedule();
        });
        tool('settings', 'Size in the note', (ev) => {
            const menu = new Menu();
            for (const [v, l] of [[0.7, 'Small in the note'], [1, 'Standard size in the note'], [1.4, 'Large in the note']] as const)
                menu.addItem(i => i.setTitle(l).setChecked(this.session.size === v).onClick(() => { this.session.size = v; }));
            menu.showAtMouseEvent(ev);
        });
        bar.createDiv({ cls: 'hw-circuit-spacer' });
        bar.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
        const ok = bar.createEl('button', { text: 'Insert solid', cls: 'mod-cta' });
        ok.onclick = () => {
            this.onInsert(renderSolid(this.spec, 1024), { ...this.spec }, this.session.size);
            this.close();
        };

        this.refreshForm();
        this.ro = new ResizeObserver(() => this.schedule());
        this.ro.observe(this.svg);
        this.render(true);
    }

    onClose() {
        this.ro?.disconnect();
        window.cancelAnimationFrame(this.raf);
        this.contentEl.empty();
    }

    /** Switching to a fixed view and back: dragging starts from the angles of the view you were looking at. */
    private setProjection(k: ProjectionKind) {
        const s = this.spec;
        if ((k === 'free' || k === 'perspective') && (s.projection === 'iso' || s.projection === 'dimetric')) {
            const a = VIEW_ANGLES[s.projection];
            s.yaw = a.yaw; s.pitch = a.pitch;
        }
        s.projection = k;
        this.refreshForm();
        this.schedule();
    }

    /** Buttons and fields that follow the state (the active solid, its dimensions, the view options). */
    private refreshForm() {
        const s = this.spec;
        for (const [k, b] of this.kindBtns) b.toggleClass('is-active', k === s.kind);
        for (const [k, b] of this.projBtns) b.toggleClass('is-active', k === s.projection);
        for (const [k, b] of this.hiddenBtns) b.toggleClass('is-active', k === s.hidden);
        this.axesCb.checked = s.axes;

        // dimensions of the chosen solid: a slider and a number field each
        this.dims.empty();
        const vals = solidParams(s);
        for (const p of solidDef(s.kind).params) {
            const row = this.dims.createDiv({ cls: 'hw-solid-dim' });
            row.createSpan({ cls: 'hw-solid-dim-label', text: p.label });
            const range = row.createEl('input', { type: 'range', attr: { min: p.min, max: p.max, step: p.step, 'aria-label': p.label } });
            const num = row.createEl('input', { type: 'number', attr: { min: p.min, max: p.max, step: p.step, 'aria-label': p.label } });
            range.value = num.value = String(vals[p.key]);
            const set = (v: number, from: HTMLInputElement) => {
                if (!isFinite(v)) return;
                const pr = (s.params[s.kind] ??= {});
                pr[p.key] = v;
                const clean = solidParams(s)[p.key];
                if (from !== range) range.value = String(clean);
                if (from !== num) num.value = String(clean);
                this.schedule();
            };
            range.oninput = () => set(Number(range.value), range);
            num.oninput = () => set(Number(num.value), num);
            num.onblur = () => { num.value = String(solidParams(s)[p.key]); };
        }

        // options of the view
        this.viewOpts.empty();
        if (s.projection === 'perspective') {
            const row = this.viewOpts.createDiv({ cls: 'hw-solid-dim' });
            row.createSpan({ cls: 'hw-solid-dim-label', text: 'Strength' });
            const r = row.createEl('input', { type: 'range', attr: { min: 0.1, max: 1, step: 0.05, 'aria-label': 'Perspective strength' } });
            r.value = String(s.persp);
            r.oninput = () => { s.persp = Number(r.value); this.schedule(); };
        } else if (s.projection === 'views') {
            const seg = this.viewOpts.createDiv({ cls: 'hw-solid-seg' });
            for (const [k, l, tip] of [['E', 'First angle (E)', 'Europe: top view below, view from the left on the right'], ['A', 'Third angle (A)', 'America: top view above, view from the right on the right']] as const) {
                const b = seg.createEl('button', { text: l, attr: { title: tip } });
                b.toggleClass('is-active', s.layout === k);
                b.onclick = () => { s.layout = k; this.refreshForm(); this.schedule(); };
            }
        } else if (s.projection === 'free') {
            this.viewOpts.createDiv({ cls: 'hw-plot-help', text: `Turned ${Math.round(s.yaw)}°, tilted ${Math.round(s.pitch)}° – drag the preview.` });
        }
    }

    /** One render per frame; a coarser depth buffer while dragging. */
    private schedule() {
        if (this.raf) return;
        this.raf = window.requestAnimationFrame(() => { this.raf = 0; this.render(!this.drag); });
    }
    private render(fine: boolean) {
        if (!this.svg) return;
        drawLines(this.svg, renderSolid(this.spec, fine ? 768 : 320), this.spec.hidden, 1.8);
    }

    /** Dragging the preview turns the solid (switches a fixed view to Free; Perspective stays perspective). */
    private bindDrag() {
        const svg = this.svg;
        svg.addEventListener('pointerdown', ev => {
            if (ev.button > 0) return;
            const s = this.spec;
            if (s.projection !== 'free' && s.projection !== 'perspective') {
                const a = s.projection === 'iso' || s.projection === 'dimetric' ? VIEW_ANGLES[s.projection] : { yaw: s.yaw, pitch: s.pitch };
                s.yaw = a.yaw; s.pitch = a.pitch; s.projection = 'free';
                this.refreshForm();
            }
            this.drag = { x: ev.clientX, y: ev.clientY, yaw: s.yaw, pitch: s.pitch };
            svg.setPointerCapture(ev.pointerId);
        });
        svg.addEventListener('pointermove', ev => {
            const d = this.drag;
            if (!d) return;
            const s = this.spec;
            s.yaw = ((d.yaw - (ev.clientX - d.x) * 0.5) % 360 + 540) % 360 - 180;
            s.pitch = Math.max(-89, Math.min(89, d.pitch + (ev.clientY - d.y) * 0.5));
            this.schedule();
        });
        const end = () => { if (!this.drag) return; this.drag = null; this.refreshForm(); this.schedule(); };
        svg.addEventListener('pointerup', end);
        svg.addEventListener('pointercancel', end);
    }
}
