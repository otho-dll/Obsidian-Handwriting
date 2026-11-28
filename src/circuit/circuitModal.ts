import { App, Menu, Modal, Notice, setIcon } from 'obsidian';
import { layoutText, type Polyline } from './font';
import { canonNormal, edgeById, edgeGeom, nodeById, projOnto, scene, symbolLocal, degrees, type Vec } from './geometry';
import {
    addWire, arrowDir, changeType, cloneCircuit, deleteEdges, deleteElement, deleteNode, findEl, groupOrigin, hitTest, insertElement,
    insertIndexAt, lassoEdges, moveElement, moveGroup, parallel, plusSlots, resolveEnd, segDist, settleGroup, settleNode, shiftElement,
    startSquare, type End, type Hit,
} from './ops';
import { DIRECTIONAL, GRID, ORDER, SHEET_H, SHEET_W, TYPES, type Circuit, type ElType } from './types';

const W = SHEET_W, H = SHEET_H, G = GRID;
/** Zoom limits of the sheet (pinch, wheel, Fit). */
const ZMIN = 0.5, ZMAX = 3;
const INK = '#1f2328', ACC = '#4f6fd8';
const NS = 'http://www.w3.org/2000/svg';

/** Options in the LOOK section. `line`: index into the pen sizes (thin / normal / bold). */
export interface CircuitLook { size: number; line: number; autoNum: boolean; dots: boolean; allPlus: boolean; askLabel: boolean }
/** Editor state kept for the whole Obsidian session (survives Cancel / ×). */
export interface CircuitSession { circuit: Circuit; hist: string[]; redo: string[]; look: CircuitLook }

export function newCircuitSession(lineIdx: number): CircuitSession {
    return { circuit: startSquare(), hist: [], redo: [], look: { size: 1, line: lineIdx, autoNum: true, dots: true, allPlus: false, askLabel: false } };
}

type Sel = { kind: 'el'; id: string } | { kind: 'edge'; id: string } | { kind: 'node'; id: string } | { kind: 'multi'; ids: string[] } | null;
type UiHit = Hit | { kind: 'handle' } | { kind: 'plus'; edge: string; k: number };
type Drag =
    | { type: 'wire'; start: End; end: End | null }
    | { type: 'move'; node: string }
    | { type: 'group'; p: Vec; orig: [string, number, number][] }
    | { type: 'lasso'; pts: [number, number][] }
    | { type: 'el'; el: string; p: Vec; target: { edge: string; x: number; y: number } | null };

const f1 = (v: number) => Math.round(v * 10) / 10;
const pathD = (lines: Polyline[]) => lines.map(l => 'M' + l.map(p => f1(p[0]) + ' ' + f1(p[1])).join('L')).join('');

function svgEl<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
    const e = activeDocument.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    parent.appendChild(e);
    return e;
}

/** Small icon of an element symbol (palette buttons). */
function iconSvg(parent: HTMLElement, t: ElType) {
    const T = TYPES[t], sym = symbolLocal(t);
    const ls: Polyline[] = [[[-32, 0], [-T.h, 0]], [[T.h, 0], [32, 0]], ...sym.lines, ...(sym.arrow ?? [])];
    if (sym.letter) { const tx = layoutText(sym.letter, 12); ls.push(...tx.lines.map(l => l.map(([x, y]) => [x - tx.width / 2, y + 6] as [number, number]))); }
    const svg = svgEl(parent, 'svg', { viewBox: '-33 -19 66 38', 'aria-hidden': 'true' });
    svgEl(svg, 'path', { d: pathD(ls), fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
}

/** "Insert circuit" – a quick schematic editor. The result is inserted into the note as ordinary pen strokes. */
export class CircuitModal extends Modal {
    private S: Circuit;
    private sel: Sel = null;
    private hoverEdge: string | null = null;
    private drag: Drag | null = null;
    private down: { p: Vec; h: UiHit; add: boolean } | null = null;
    private picker: { eid: string; k: number } | null = null;
    private stamp: ElType | null = null;
    private addMode = false;
    private coarse = false;
    private tolk = 1;
    private holdT = 0;
    private selKey = '';
    private labelPre: string | null = null;
    private mouse: Vec = { x: 0, y: 0 };
    /** ⚙ menu: open state, so a second tap on the button closes it instead of opening it again. */
    private optOpen = false;
    private optWasOpen = false;
    private optHiddenAt = 0;
    /** Visible part of the sheet (editor px). Its aspect follows the board, so a tall board shows a tall sheet. */
    private vb = { x: 0, y: 0, w: W, h: H };
    private zoom = 1;
    private fitted = false;
    /** Touch pointers on the board; two of them pinch / pan instead of editing. */
    private touches = new Map<number, Vec>();
    private gesture: { d0: number; m0: Vec; vb0: { x: number; y: number; w: number; h: number }; z0: number } | null = null;

    private sheet!: HTMLElement;
    private svg!: SVGSVGElement;
    private pickerEl!: HTMLElement;
    private palette!: HTMLElement;
    private stampTip!: HTMLElement;
    private selBox!: HTMLElement;
    private helpEl!: HTMLElement;
    private undoBtn!: HTMLButtonElement;
    private redoBtn!: HTMLButtonElement;
    private ro: ResizeObserver | null = null;

    constructor(app: App, private session: CircuitSession, private onInsert: (c: Circuit, look: CircuitLook) => void) {
        super(app);
        this.S = session.circuit;
    }
    private get look() { return this.session.look; }

    // ---------- undo ----------
    private snapshot() { return JSON.stringify(this.S); }
    private setCircuit(c: Circuit) { this.S = c; this.session.circuit = c; }
    private commit() { this.session.hist.push(this.snapshot()); if (this.session.hist.length > 300) this.session.hist.shift(); this.session.redo.length = 0; }
    private undo() {
        const h = this.session.hist; if (!h.length) return;
        this.session.redo.push(this.snapshot()); this.setCircuit(JSON.parse(h.pop()!) as Circuit);
        this.sel = null; this.hidePicker(); this.render();
    }
    private redoAct() {
        const r = this.session.redo; if (!r.length) return;
        this.session.hist.push(this.snapshot()); this.setCircuit(JSON.parse(r.pop()!) as Circuit);
        this.sel = null; this.hidePicker(); this.render();
    }
    private toast(msg: string) { new Notice(msg, 1800); }

    // ---------- layout ----------
    onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();
        contentEl.addClass('hw-plot-modal', 'hw-circuit-modal');
        modalEl.addClass('mod-plot', 'mod-circuit');
        this.titleEl.setText('Insert circuit');

        const wrap = contentEl.createDiv({ cls: 'hw-plot-wrap hw-circuit-wrap' });
        // Right column: the panels (scroll) and below them one bar with the tools and Cancel / Insert.
        const side = wrap.createDiv({ cls: 'hw-circuit-side' });
        const form = side.createDiv({ cls: 'hw-plot-form hw-circuit-form' });
        const right = wrap.createDiv({ cls: 'hw-plot-right hw-circuit-right' });
        this.sheet = right.createDiv({ cls: 'hw-circuit-sheet' });
        this.svg = svgEl(this.sheet, 'svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Circuit editor sheet' });
        this.svg.addClass('hw-circuit-board');
        this.pickerEl = this.sheet.createDiv({ cls: 'hw-circuit-picker' });
        this.pickerEl.addEventListener('pointerdown', e => e.stopPropagation());
        for (const t of ORDER) this.palBtn(this.pickerEl, t, () => this.pickType(t));

        const sec = (title: string) => { const s = form.createDiv({ cls: 'hw-plot-sec' }); s.createDiv({ cls: 'hw-plot-sectitle', text: title }); return s; };
        const els = sec('Elements');
        this.palette = els.createDiv({ cls: 'hw-circuit-palette' });
        for (const t of ORDER) this.palBtn(this.palette, t, () => this.setStamp(this.stamp === t ? null : t)).dataset.t = t;
        this.stampTip = els.createDiv({ cls: 'hw-plot-help hw-circuit-tip' });
        this.setStamp(null);

        this.selBox = sec('Selection').createDiv({ cls: 'hw-circuit-sel' });

        // Bar under the panels: undo / redo / start over, help, options … Cancel, Insert circuit.
        const strip = side.createDiv({ cls: 'hw-circuit-bar' });
        const tool = (icon: string, label: string, fn: (ev: MouseEvent) => void) => {
            const b = strip.createEl('button', { cls: 'hw-circuit-icon', attr: { 'aria-label': label } });
            setIcon(b, icon);
            b.onclick = fn;
            return b;
        };
        this.undoBtn = tool('undo-2', 'Undo', () => this.undo());
        this.redoBtn = tool('redo-2', 'Redo', () => this.redoAct());
        tool('rotate-ccw', 'Start over (back to one square)', () => {
            this.commit(); this.setCircuit(startSquare()); this.sel = null; this.hidePicker(); this.render();
            this.toast('Started over – Undo brings it back');
        });
        strip.createDiv({ cls: 'hw-circuit-strip-sep' });
        tool('scan', 'Fit the circuit in view', () => { this.fitView(true); this.render(); });
        tool('circle-help', 'How it works', () => this.helpEl.toggleClass('is-open', !this.helpEl.hasClass('is-open')));
        const optBtn = tool('settings', 'Options', (ev) => {
            // The menu closes itself on pointerdown outside it – a tap on the button while it was open only closes it.
            if (this.optWasOpen || Date.now() - this.optHiddenAt < 350) { this.optWasOpen = false; return; }
            this.showOptions(ev);
        });
        optBtn.addEventListener('pointerdown', () => { this.optWasOpen = this.optOpen; }, true);

        this.helpEl = this.sheet.createDiv({ cls: 'hw-circuit-help' });
        const ul = this.helpEl.createEl('ul');
        for (const t of [
            'Tap a branch to get + buttons and pick an element – or pick one under Elements and tap branches to place it.',
            'Drag from a node or a wire to draw a new branch. It snaps to the grid, and square or parallel to slanted branches (dashed guide).',
            'Right-click, or press and hold with the pen / finger, on a branch, element or node for a menu (e.g. Delete branch).',
            'Move branches: select one (or draw a lasso from empty space, or use Select more) and drag the blue ✥ handle.',
            'Tap a node, then drag it to move it. Drag an element to move it along the branch or to another one.',
            'Labels: U_1 or I_{x} for subscripts, ohm → Ω, uF → μF – or use the symbol buttons under the label.',
        ]) ul.createEl('li', { text: t });
        this.helpEl.addEventListener('pointerdown', () => this.helpEl.removeClass('is-open'));

        strip.createDiv({ cls: 'hw-circuit-spacer' });
        const btns = strip;
        const cancel = btns.createEl('button', { text: 'Cancel' });
        cancel.onclick = () => this.close();
        const ok = btns.createEl('button', { text: 'Insert circuit', cls: 'mod-cta' });
        ok.onclick = () => {
            if (!this.S.edges.length) { this.toast('The circuit is empty.'); return; }
            this.onInsert(cloneCircuit(this.S), { ...this.look });
            this.close();
        };

        this.bindPointer();
        modalEl.addEventListener('keydown', ev => this.onKey(ev));
        this.ro = new ResizeObserver(() => { this.syncViewBox(); this.render(); });
        this.ro.observe(this.svg);
        this.render();
    }

    onClose() {
        this.ro?.disconnect();
        window.clearTimeout(this.holdT);
        this.contentEl.empty();
    }

    // ---------- view: visible part of the sheet ----------
    /** Matches the viewBox to the board's size (keeps the centre); the first time centres the circuit. */
    private syncViewBox() {
        const r = this.svg.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        const cx = this.vb.x + this.vb.w / 2, cy = this.vb.y + this.vb.h / 2;
        this.vb.w = W / this.zoom;
        this.vb.h = this.vb.w * r.height / r.width;
        this.vb.x = cx - this.vb.w / 2; this.vb.y = cy - this.vb.h / 2;
        if (!this.fitted) { this.fitted = true; this.fitView(false); }
        this.applyViewBox();
    }
    private applyViewBox() {
        const v = this.vb;
        this.svg.setAttribute('viewBox', `${f1(v.x)} ${f1(v.y)} ${f1(v.w)} ${f1(v.h)}`);
    }
    /** Centres the view on the circuit. `zoomToo`: also zooms so it fills the view (otherwise only zooms out if it doesn't fit). */
    private fitView(zoomToo: boolean) {
        const r = this.svg.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const n of this.S.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
        if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = W; y1 = H; }
        const pad = 70, bw = x1 - x0 + 2 * pad, bh = y1 - y0 + 2 * pad, asp = r.height / r.width;
        // zoom at which the box fits: the view is W/z wide and W/z*asp tall
        const fit = Math.min(W / bw, W * asp / bh);
        this.zoom = Math.max(ZMIN, Math.min(zoomToo ? Math.min(ZMAX, fit) : 1, fit));
        this.vb.w = W / this.zoom; this.vb.h = this.vb.w * asp;
        this.vb.x = (x0 + x1) / 2 - this.vb.w / 2; this.vb.y = (y0 + y1) / 2 - this.vb.h / 2;
        this.applyViewBox();
    }
    /** Zooms by factor k around the client point (cx, cy). */
    private zoomAt(k: number, cx: number, cy: number) {
        const r = this.svg.getBoundingClientRect(); if (r.width < 1) return;
        const z = Math.max(ZMIN, Math.min(ZMAX, this.zoom * k));
        const px = this.vb.x + (cx - r.left) * this.vb.w / r.width, py = this.vb.y + (cy - r.top) * this.vb.h / r.height;
        this.zoom = z; this.vb.w = W / z; this.vb.h = this.vb.w * r.height / r.width;
        this.vb.x = px - (cx - r.left) * this.vb.w / r.width; this.vb.y = py - (cy - r.top) * this.vb.h / r.height;
        this.applyViewBox();
    }
    private bounds() { const v = this.vb; return { x0: v.x, y0: v.y, x1: v.x + v.w, y1: v.y + v.h }; }

    /** ⚙ menu: size in the note and editor options (checkable items). */
    private showOptions(ev: MouseEvent) {
        const menu = new Menu();
        for (const [v, l] of [[0.75, 'Small in the note'], [1, 'Standard size in the note'], [1.3, 'Large in the note']] as const)
            menu.addItem(i => i.setTitle(l).setChecked(this.look.size === v).onClick(() => { this.look.size = v; }));
        menu.addSeparator();
        const opt = (label: string, key: 'autoNum' | 'dots' | 'allPlus' | 'askLabel') =>
            menu.addItem(i => i.setTitle(label).setChecked(this.look[key]).onClick(() => { this.look[key] = !this.look[key]; this.render(); }));
        opt('Auto-number (R1, C1, L1, E1, I1)', 'autoNum');
        opt('Junction dots', 'dots');
        opt('Show + on all branches', 'allPlus');
        opt('Ask for label after insert', 'askLabel');
        menu.onHide(() => { this.optOpen = false; this.optHiddenAt = Date.now(); });
        this.optOpen = true;
        menu.showAtMouseEvent(ev);
    }

    private palBtn(parent: HTMLElement, t: ElType, onClick: () => void): HTMLButtonElement {
        const b = parent.createEl('button', { cls: 'hw-circuit-pal', attr: { title: TYPES[t].name } });
        iconSvg(b, t);
        b.createSpan({ text: TYPES[t].name });
        b.onclick = onClick;
        return b;
    }

    private setStamp(t: ElType | null) {
        this.stamp = t; this.hidePicker();
        this.palette.querySelectorAll<HTMLElement>('.hw-circuit-pal').forEach(b => b.toggleClass('is-active', b.dataset.t === t));
        this.stampTip.empty();
        if (t) { this.stampTip.createEl('b', { text: TYPES[t].name }); this.stampTip.appendText(': tap branches to place it. Tap the button again to stop.'); }
        else this.stampTip.setText('Tap a branch to get +, or pick an element here and tap branches to place it.');
    }

    // ---------- picker ----------
    private openPicker(eid: string, k: number, p: Vec) {
        this.picker = { eid, k };
        this.pickerEl.addClass('is-open');
        const r = this.sheet.getBoundingClientRect(), s = r.width / this.vb.w, pw = this.pickerEl.offsetWidth, ph = this.pickerEl.offsetHeight;
        const sx = (p.x - this.vb.x) * s, sy = (p.y - this.vb.y) * s;
        let x = sx + 16, y = sy + 16;
        if (x + pw > r.width - 6) x = Math.max(6, sx - pw - 16);
        if (y + ph > r.height - 6) y = Math.max(6, sy - ph - 16);
        this.pickerEl.style.left = x + 'px'; this.pickerEl.style.top = y + 'px';
        this.render();
    }
    private hidePicker() { if (!this.picker && !this.pickerEl?.hasClass('is-open')) return; this.picker = null; this.pickerEl.removeClass('is-open'); }
    private pickType(t: ElType) { const pk = this.picker; this.hidePicker(); if (pk) this.insert(pk.eid, pk.k, t); }

    private insert(eid: string, k: number, t: ElType) {
        if (!edgeById(this.S, eid)) return;
        this.commit();
        const el = insertElement(this.S, eid, k, t, this.look.autoNum);
        if (el) this.sel = { kind: 'el', id: el.id };
        this.render();
        if (this.look.askLabel) this.focusLabel();
    }

    // ---------- selection helpers ----------
    private selEdges(): string[] {
        const s = this.sel;
        if (s?.kind === 'edge') return edgeById(this.S, s.id) ? [s.id] : [];
        if (s?.kind === 'multi') return s.ids.filter(id => edgeById(this.S, id));
        return [];
    }
    private toggleEdgeSel(eid: string) {
        let ids = this.selEdges();
        ids = ids.includes(eid) ? ids.filter(x => x !== eid) : [...ids, eid];
        this.sel = ids.length === 0 ? null : ids.length === 1 && !this.addMode ? { kind: 'edge', id: ids[0] } : { kind: 'multi', ids };
    }
    private viewK() { const r = this.svg.getBoundingClientRect(); return (r.width ? this.vb.w / r.width : 1) * (this.coarse ? 1.35 : 1); }
    private handlePos(): Vec | null {
        const ids = this.selEdges();
        if (!ids.length || (this.drag && this.drag.type !== 'group')) return null;
        if (ids.length === 1) {
            const g = edgeGeom(this.S, edgeById(this.S, ids[0])!), nn = canonNormal(g.d), m = { x: (g.A.x + g.B.x) / 2, y: (g.A.y + g.B.y) / 2 }, vk = this.viewK();
            return { x: m.x - nn.x * 34 * vk, y: m.y - nn.y * 34 * vk };
        }
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const id of ids) {
            const e = edgeById(this.S, id)!;
            for (const n of [nodeById(this.S, e.a)!, nodeById(this.S, e.b)!]) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
        }
        return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    }
    private plusEdges(): string[] {
        if (this.drag) return [];
        if (this.look.allPlus) return this.S.edges.map(e => e.id);
        const set = new Set<string>();
        if (this.hoverEdge) set.add(this.hoverEdge);
        if (this.sel?.kind === 'edge') set.add(this.sel.id);
        if (this.sel?.kind === 'el') { const f = findEl(this.S, this.sel.id); if (f) set.add(f.edge.id); }
        if (this.picker) set.add(this.picker.eid);
        return [...set].filter(id => edgeById(this.S, id));
    }
    private uiHit(p: Vec, noPlus = false): UiHit {
        if (!noPlus) {
            const hp = this.handlePos();
            if (hp && Math.hypot(p.x - hp.x, p.y - hp.y) < 16 * this.tolk) return { kind: 'handle' };
            for (const eid of this.plusEdges()) {
                const g = edgeGeom(this.S, edgeById(this.S, eid)!);
                for (const sl of plusSlots(g)) if (Math.hypot(p.x - sl.x, p.y - sl.y) < 13 * this.tolk) return { kind: 'plus', edge: eid, k: sl.k };
            }
        }
        return hitTest(this.S, p, this.tolk);
    }
    private hitEdgeId(h: UiHit): string | null { return h.kind === 'edge' || h.kind === 'el' || h.kind === 'plus' ? h.edge : null; }

    // ---------- rendering ----------
    private render() {
        if (!this.svg) return;
        const S = this.S, sc = scene(S, { dots: this.look.dots }), vk = this.viewK(), lw = [1.5, 2, 3][this.look.line] ?? 2;
        const svg = this.svg;
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        const defs = svgEl(svg, 'defs', {});
        const pat = svgEl(defs, 'pattern', { id: 'hwc-dots', x: -G / 2, y: -G / 2, width: G, height: G, patternUnits: 'userSpaceOnUse' });
        svgEl(pat, 'circle', { cx: G / 2, cy: G / 2, r: 1.1, fill: '#d3d8de' });
        svgEl(svg, 'rect', { x: f1(this.vb.x), y: f1(this.vb.y), width: f1(this.vb.w), height: f1(this.vb.h), fill: 'url(#hwc-dots)' });

        const pe = this.plusEdges(), selEdge = this.sel?.kind === 'edge' ? this.sel.id : null;
        const band = (eid: string, op: number) => { const g = sc.geoms.get(eid); if (g) svgEl(svg, 'line', { x1: g.A.x, y1: g.A.y, x2: g.B.x, y2: g.B.y, stroke: ACC, 'stroke-opacity': op, 'stroke-width': 12 * vk, 'stroke-linecap': 'round' }); };
        for (const eid of pe) band(eid, eid === selEdge ? 0.22 : 0.1);
        if (this.sel?.kind === 'multi') for (const eid of this.selEdges()) band(eid, 0.25);

        const selId = this.sel?.kind === 'el' ? this.sel.id : null, dragId = this.drag?.type === 'el' ? this.drag.el : null;
        const ink: Polyline[] = [...sc.wires], hi: Polyline[] = [];
        for (const [id, l] of sc.elLines) { if (id === selId || id === dragId) hi.push(...l); else ink.push(...l); }
        svgEl(svg, 'path', { d: pathD(ink), fill: 'none', stroke: INK, 'stroke-width': lw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        if (hi.length) svgEl(svg, 'path', { d: pathD(hi), fill: 'none', stroke: ACC, 'stroke-width': lw + 0.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: dragId ? 0.35 : 1 });
        for (const n of sc.dots) svgEl(svg, 'circle', { cx: n.x, cy: n.y, r: 1.5 + lw, fill: INK });
        const deg = degrees(S);
        for (const n of S.nodes) {
            const isSel = this.sel?.kind === 'node' && this.sel.id === n.id;
            if (isSel) svgEl(svg, 'circle', { cx: n.x, cy: n.y, r: 8 * vk, fill: ACC, 'fill-opacity': 0.15, stroke: ACC, 'stroke-width': 2 });
            else if ((deg.get(n.id) ?? 0) < 3 || !this.look.dots) svgEl(svg, 'circle', { cx: n.x, cy: n.y, r: 3.4 * vk, fill: '#fff', stroke: '#9aa3ad', 'stroke-width': 1.3 * vk });
        }
        const pr = 10 * vk;
        for (const eid of pe) {
            const g = sc.geoms.get(eid); if (!g) continue;
            for (const sl of plusSlots(g)) {
                const on = !!this.picker && this.picker.eid === eid && this.picker.k === sl.k, a = pr * 0.48;
                svgEl(svg, 'circle', { cx: f1(sl.x), cy: f1(sl.y), r: f1(pr), fill: on ? ACC : '#fff', stroke: ACC, 'stroke-width': 1.6 * vk });
                svgEl(svg, 'path', { d: `M${f1(sl.x - a)} ${f1(sl.y)}h${f1(2 * a)}M${f1(sl.x)} ${f1(sl.y - a)}v${f1(2 * a)}`, stroke: on ? '#fff' : ACC, 'stroke-width': 1.8 * vk, 'stroke-linecap': 'round' });
            }
        }
        const hp = this.handlePos();
        if (hp) {
            const r = 14 * vk, a = r * 0.62, t = r * 0.22, X = hp.x, Y = hp.y;
            svgEl(svg, 'circle', { cx: f1(X), cy: f1(Y), r: f1(r), fill: ACC });
            const d = `M${X - a} ${Y}H${X + a}M${X} ${Y - a}V${Y + a}M${X - a + t} ${Y - t}L${X - a} ${Y}L${X - a + t} ${Y + t}M${X + a - t} ${Y - t}L${X + a} ${Y}L${X + a - t} ${Y + t}M${X - t} ${Y - a + t}L${X} ${Y - a}L${X + t} ${Y - a + t}M${X - t} ${Y + a - t}L${X} ${Y + a}L${X + t} ${Y + a - t}`;
            svgEl(svg, 'path', { d, fill: 'none', stroke: '#fff', 'stroke-width': 1.6 * vk, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
        }
        const dr = this.drag;
        if (dr?.type === 'lasso' && dr.pts.length > 1) svgEl(svg, 'path', { d: pathD([dr.pts]) + 'Z', fill: ACC, 'fill-opacity': 0.07, stroke: ACC, 'stroke-width': 1.4 * vk, 'stroke-dasharray': '6 4', 'stroke-linejoin': 'round' });
        if (dr?.type === 'wire' && dr.end) {
            const a = dr.start, b = dr.end;
            svgEl(svg, 'line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: ACC, 'stroke-width': 2, 'stroke-dasharray': '6 5', 'stroke-linecap': 'round' });
            for (const q of [a, b]) svgEl(svg, 'circle', { cx: q.x, cy: q.y, r: (q.kind === 'free' ? 4 : 6) * vk, fill: '#fff', stroke: ACC, 'stroke-width': 2 });
            if (b.dir) {
                const k = 2000;
                svgEl(svg, 'line', { x1: a.x - b.dir.x * k, y1: a.y - b.dir.y * k, x2: a.x + b.dir.x * k, y2: a.y + b.dir.y * k, stroke: ACC, 'stroke-opacity': 0.35, 'stroke-width': 1, 'stroke-dasharray': '3 4' });
            }
            if (b.snap) {
                const tx = svgEl(svg, 'text', { x: b.x + 10 * vk, y: b.y - 10 * vk, fill: ACC, 'font-size': 14 * vk, 'font-weight': 700 });
                tx.textContent = '⟂∥';
            }
        }
        if (dr?.type === 'el') {
            const f = findEl(S, dr.el);
            if (f) {
                const sym = symbolLocal(f.el.type);
                const ls = [...sym.lines, ...(sym.arrow ?? [])].map(l => l.map(([x, y]) => [x + dr.p.x, y + dr.p.y - 30 * vk] as [number, number]));
                svgEl(svg, 'path', { d: pathD(ls), fill: 'none', stroke: ACC, 'stroke-width': 2, opacity: 0.85 });
            }
            if (dr.target) svgEl(svg, 'circle', { cx: f1(dr.target.x), cy: f1(dr.target.y), r: 6 * vk, fill: ACC });
        }
        this.updateSel(false);
        this.undoBtn.disabled = !this.session.hist.length;
        this.redoBtn.disabled = !this.session.redo.length;
    }

    // ---------- SELECTION panel ----------
    private focusLabel() { this.selBox.querySelector<HTMLInputElement>('.hw-circuit-label')?.focus(); }
    private iconBtn(row: HTMLElement, icon: string, label: string, fn: () => void, cls = ''): HTMLButtonElement {
        const b = row.createEl('button', { cls: 'hw-circuit-icon ' + cls, attr: { 'aria-label': label } });
        setIcon(b, icon);
        b.onclick = fn;
        return b;
    }
    private updateSel(force: boolean) {
        const s = this.sel, S = this.S;
        let key = 'none';
        if (s?.kind === 'el') { const f = findEl(S, s.id); key = f ? `el:${s.id}:${f.el.type}:${f.el.flip}:${f.edge.id}` : 'none'; }
        else if (s?.kind === 'edge' && edgeById(S, s.id)) key = 'edge:' + s.id;
        else if (s?.kind === 'node' && nodeById(S, s.id)) key = 'node:' + s.id;
        else if (s?.kind === 'multi' && this.selEdges().length) key = 'multi:' + this.selEdges().join(',') + ':' + this.addMode;
        if (key === 'none') { this.sel = null; this.addMode = false; }
        if (key === this.selKey && !force) return;
        this.selKey = key;
        const box = this.selBox;
        box.empty();
        const card = () => box.createDiv({ cls: 'hw-circuit-card' });
        const row = (c: HTMLElement) => c.createDiv({ cls: 'hw-circuit-row' });
        const spacer = (r: HTMLElement) => r.createDiv({ cls: 'hw-circuit-spacer' });
        if (key.startsWith('el:') && s?.kind === 'el') {
            const fe = findEl(S, s.id)!, el = fe.el, dir = DIRECTIONAL.includes(el.type) ? arrowDir(S, fe.edge, el) : null;
            const c = card();
            const top = row(c);
            top.addClass('hw-circuit-nowrap');
            const typeSel = top.createEl('select', { attr: { 'aria-label': 'Element type' } });
            for (const t of ORDER) typeSel.createEl('option', { text: TYPES[t].name, value: t });
            typeSel.value = el.type;
            typeSel.onchange = () => { this.commit(); const f = findEl(this.S, s.id); if (f) changeType(this.S, f.el, typeSel.value as ElType, this.look.autoNum); this.render(); this.updateSel(true); };
            const lf = top.createEl('input', { type: 'text', cls: 'hw-circuit-label', attr: { placeholder: 'Label, e.g. 10 ohm', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Label' } });
            lf.value = el.label || '';
            lf.addEventListener('focus', () => { this.labelPre = this.snapshot(); });
            lf.addEventListener('blur', () => {
                if (this.labelPre && this.labelPre !== this.snapshot()) { this.session.hist.push(this.labelPre); this.session.redo.length = 0; this.render(); }
                this.labelPre = null;
            });
            lf.addEventListener('input', () => { const f = findEl(this.S, s.id); if (f) { f.el.label = lf.value; this.render(); } });
            lf.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); lf.blur(); } });
            // Symbols that are hard to type on a tablet keyboard: inserted at the caret, the keyboard stays open.
            const chips = c.createDiv({ cls: 'hw-circuit-chips' });
            for (const [sym, tip] of [['Ω', 'ohm'], ['μ', 'micro'], ['k', 'kilo'], ['M', 'mega'], ['m', 'milli'], ['_', 'subscript (U_1, I_{x})'], ['²', 'squared'], ['°', 'degree'], ['·', 'dot']]) {
                const b = chips.createEl('button', { text: sym, cls: 'hw-circuit-chip', attr: { 'aria-label': `Insert ${tip}` } });
                b.addEventListener('pointerdown', e => e.preventDefault());
                b.onclick = () => {
                    const focused = activeDocument.activeElement === lf;
                    if (!focused) this.commit();               // focused: the label's undo step is saved on blur
                    const a0 = lf.selectionStart ?? lf.value.length, a1 = lf.selectionEnd ?? a0;
                    lf.setRangeText(sym, focused ? a0 : lf.value.length, focused ? a1 : lf.value.length, 'end');
                    const f = findEl(this.S, s.id); if (f) { f.el.label = lf.value; this.render(); }
                };
            }
            const r = row(c);
            if (DIRECTIONAL.includes(el.type)) {
                const dirBtn = (v: string, tip: string) => this.iconBtn(r, 'arrow-' + v, tip, () => this.act('dir', v), dir === v ? 'is-active' : '');
                if (dir === 'up' || dir === 'down') { dirBtn('up', 'Arrow up'); dirBtn('down', 'Arrow down'); }
                else if (dir) { dirBtn('left', 'Arrow left'); dirBtn('right', 'Arrow right'); }
                else this.iconBtn(r, 'arrow-left-right', 'Flip arrow (or tap the source again)', () => this.act('flip'));
                r.createDiv({ cls: 'hw-circuit-sep' });
            }
            this.iconBtn(r, 'flip-vertical', 'Label side', () => this.act('side'));
            this.iconBtn(r, 'chevron-left', 'Move back along the branch', () => this.act('left'));
            this.iconBtn(r, 'chevron-right', 'Move forward along the branch', () => this.act('right'));
            spacer(r);
            this.iconBtn(r, 'trash-2', 'Delete element', () => this.act('del'), 'mod-warning');
        } else if (key.startsWith('edge:')) {
            const c = card();
            c.createDiv({ cls: 'hw-circuit-what', text: 'Branch' });
            c.createDiv({ cls: 'hw-circuit-muted', text: 'Drag the blue ✥ handle to move it.' });
            const r = row(c);
            this.iconBtn(r, 'plus', 'Add element', () => this.act('addEl'));
            this.iconBtn(r, 'equal', 'Parallel branch', () => this.act('par'));
            this.iconBtn(r, 'list-checks', 'Select more branches', () => this.act('more'));
            spacer(r);
            this.iconBtn(r, 'trash-2', 'Delete branch', () => this.act('del'), 'mod-warning');
        } else if (key.startsWith('multi:')) {
            const n = this.selEdges().length, c = card();
            c.createDiv({ cls: 'hw-circuit-what', text: `${n} branch${n > 1 ? 'es' : ''} selected` });
            c.createDiv({ cls: 'hw-circuit-muted', text: (this.addMode ? 'Tap branches to add or remove them. ' : '') + 'Drag the blue ✥ handle to move them together.' });
            const r = row(c);
            this.iconBtn(r, 'list-checks', this.addMode ? 'Done selecting' : 'Select more branches', () => this.act('more'), this.addMode ? 'is-active' : '');
            spacer(r);
            this.iconBtn(r, 'trash-2', 'Delete selected branches', () => this.act('del'), 'mod-warning');
        } else if (key.startsWith('node:')) {
            const c = card();
            c.createDiv({ cls: 'hw-circuit-what', text: 'Node' });
            c.createDiv({ cls: 'hw-circuit-muted', text: 'Drag it on the sheet to move it. Drop it on another node to join them.' });
            const r = row(c); spacer(r);
            this.iconBtn(r, 'trash-2', 'Delete node and its branches', () => this.act('del'), 'mod-warning');
        } else {
            box.createDiv({ cls: 'hw-circuit-empty', text: 'Tap an element or a branch to edit it. Draw a lasso (start on empty space) around several branches to select them.' });
        }
    }

    private deleteSel() {
        const s = this.sel; if (!s) return;
        this.commit();
        if (s.kind === 'el') deleteElement(this.S, s.id);
        else if (s.kind === 'edge' || s.kind === 'multi') deleteEdges(this.S, this.selEdges());
        else if (s.kind === 'node') deleteNode(this.S, s.id);
        this.sel = null; this.render();
    }

    private act(a: string, val?: string) {
        const s = this.sel, S = this.S; if (!s) return;
        if (s.kind === 'el') {
            const f = findEl(S, s.id); if (!f) return;
            const el = f.el;
            if (a === 'flip') { this.commit(); el.flip = !el.flip; }
            else if (a === 'dir') { if (arrowDir(S, f.edge, el) === val) return; this.commit(); el.flip = !el.flip; }
            else if (a === 'side') { this.commit(); el.side = el.side === -1 ? 1 : -1; }
            else if (a === 'label') { this.focusLabel(); return; }
            else if (a === 'left' || a === 'right') {
                const j = f.idx + (a === 'left' ? -1 : 1); if (j < 0 || j >= f.edge.els.length) return;
                this.commit(); shiftElement(S, el.id, a === 'left' ? -1 : 1);
            }
            else if (a === 'del') { this.deleteSel(); return; }
            else if (a === 'delEdge') { this.sel = { kind: 'edge', id: f.edge.id }; this.deleteSel(); return; }
        } else if ((s.kind === 'edge' || s.kind === 'multi') && a === 'more') {
            this.addMode = !this.addMode;
            if (this.addMode && s.kind === 'edge') this.sel = { kind: 'multi', ids: [s.id] };
            if (!this.addMode) { const ids = this.selEdges(); if (ids.length === 1) this.sel = { kind: 'edge', id: ids[0] }; }
            this.render(); this.updateSel(true); return;
        } else if (s.kind === 'multi' && a === 'del') { this.deleteSel(); return; }
        else if (s.kind === 'edge') {
            if (a === 'addEl') {
                const g = edgeGeom(S, edgeById(S, s.id)!), sl = plusSlots(g); if (!sl.length) return;
                const m = sl[Math.floor(sl.length / 2)]; this.openPicker(s.id, m.k, m); return;
            }
            if (a === 'par') {
                const before = this.snapshot();
                const ne = parallel(S, s.id, this.bounds());
                if (!ne) { this.toast('No room here – draw the branch by dragging from a node'); return; }
                this.session.hist.push(before); this.session.redo.length = 0;
                this.sel = { kind: 'edge', id: ne.id }; this.render(); return;
            }
            if (a === 'del') { this.deleteSel(); return; }
        } else if (s.kind === 'node' && a === 'del') { this.deleteSel(); return; }
        this.render();
    }

    // ---------- pointer: mouse, pen and touch all go through here ----------
    private pos(ev: { clientX: number; clientY: number }): Vec {
        const r = this.svg.getBoundingClientRect();
        return { x: this.vb.x + (ev.clientX - r.left) * this.vb.w / r.width, y: this.vb.y + (ev.clientY - r.top) * this.vb.h / r.height };
    }
    private setPointer(ev: PointerEvent) {
        this.coarse = ev.pointerType !== 'mouse';
        const r = this.svg.getBoundingClientRect();
        this.tolk = (r.width ? this.vb.w / r.width : 1) * (this.coarse ? 1.5 : 1);
    }
    private bindPointer() {
        const svg = this.svg;
        svg.addEventListener('pointerdown', ev => {
            if (ev.button > 0) return;
            if (ev.pointerType === 'touch') {
                this.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
                if (this.touches.size >= 2) { svg.setPointerCapture(ev.pointerId); this.startGesture(); return; }
            }
            if (this.gesture) return;
            this.setPointer(ev);
            const lf = this.selBox.querySelector('.hw-circuit-label');
            if (lf && activeDocument.activeElement === lf) (lf as HTMLInputElement).blur();
            this.helpEl.removeClass('is-open');
            const p = this.pos(ev);
            this.down = { p, h: this.uiHit(p), add: ev.shiftKey || ev.ctrlKey || ev.metaKey };
            svg.setPointerCapture(ev.pointerId);
            window.clearTimeout(this.holdT);
            if (ev.pointerType !== 'mouse') {
                const cx = ev.clientX, cy = ev.clientY;
                this.holdT = window.setTimeout(() => {
                    if (this.down && !this.drag) { const h = this.down.h; this.down = null; this.openMenu(h, cx, cy); }
                }, 550);
            }
        });
        svg.addEventListener('pointermove', ev => {
            if (this.touches.has(ev.pointerId)) this.touches.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
            if (this.gesture) { this.moveGesture(); return; }
            const p = this.pos(ev);
            this.mouse = p;
            if (this.down) {
                if (!this.drag && Math.hypot(p.x - this.down.p.x, p.y - this.down.p.y) > 7 * this.tolk) { window.clearTimeout(this.holdT); this.startDrag(); }
                if (this.drag) { this.updateDrag(p); this.render(); }
                return;
            }
            if (ev.pointerType !== 'touch') { this.setPointer(ev); this.updateHover(p); }
        });
        const lift = (ev: PointerEvent) => {
            this.touches.delete(ev.pointerId);
            if (this.gesture) { if (this.touches.size < 2) this.gesture = null; if (this.touches.size === 0) this.render(); return true; }
            return false;
        };
        svg.addEventListener('pointerup', ev => {
            window.clearTimeout(this.holdT);
            if (lift(ev)) return;
            if (!this.down) return;
            const p = this.pos(ev), d = this.down; this.down = null;
            if (this.drag) { const dr = this.drag; this.drag = null; this.finishDrag(dr, p); } else this.click(d.h, p, d.add);
            if (ev.pointerType === 'touch') this.hoverEdge = null; else this.updateHover(p);
            this.render();
        });
        svg.addEventListener('pointercancel', ev => { lift(ev); window.clearTimeout(this.holdT); this.cancelEdit(); this.render(); });
        // Mouse wheel: scroll the sheet; Ctrl + wheel (or a trackpad pinch): zoom.
        svg.addEventListener('wheel', ev => {
            ev.preventDefault();
            if (ev.ctrlKey || ev.metaKey) this.zoomAt(Math.exp(-ev.deltaY * 0.01), ev.clientX, ev.clientY);
            else {
                const r = svg.getBoundingClientRect(), k = r.width ? this.vb.w / r.width : 1;
                const dx = ev.shiftKey ? ev.deltaY : ev.deltaX, dy = ev.shiftKey ? 0 : ev.deltaY;
                this.vb.x += dx * k; this.vb.y += dy * k; this.applyViewBox();
            }
            this.render();
        }, { passive: false });
        svg.addEventListener('pointerleave', () => { if (!this.down && this.hoverEdge) { this.hoverEdge = null; this.render(); } });
        svg.addEventListener('contextmenu', ev => {
            ev.preventDefault();
            if (this.drag) return;
            window.clearTimeout(this.holdT); this.down = null;
            this.openMenu(this.uiHit(this.pos(ev)), ev.clientX, ev.clientY);
        });
    }

    /** Drops an unfinished press / drag (e.g. a second finger came down). A node or group drag already moved things: put them back. */
    private cancelEdit() {
        const d = this.drag;
        if (d && (d.type === 'move' || d.type === 'group') && this.session.hist.length) this.setCircuit(JSON.parse(this.session.hist.pop()!) as Circuit);
        this.down = null; this.drag = null;
    }
    private twoTouches(): [Vec, Vec] | null { const t = [...this.touches.values()]; return t.length >= 2 ? [t[0], t[1]] : null; }
    private startGesture() {
        window.clearTimeout(this.holdT);
        this.cancelEdit(); this.hidePicker();
        const t = this.twoTouches(); if (!t) return;
        this.gesture = { d0: Math.max(1, Math.hypot(t[1].x - t[0].x, t[1].y - t[0].y)), m0: { x: (t[0].x + t[1].x) / 2, y: (t[0].y + t[1].y) / 2 }, vb0: { ...this.vb }, z0: this.zoom };
        this.render();
    }
    private moveGesture() {
        const g = this.gesture, t = this.twoTouches(); if (!g || !t) return;
        const r = this.svg.getBoundingClientRect(); if (r.width < 1) return;
        const d = Math.max(1, Math.hypot(t[1].x - t[0].x, t[1].y - t[0].y)), m = { x: (t[0].x + t[1].x) / 2, y: (t[0].y + t[1].y) / 2 };
        const z = Math.max(ZMIN, Math.min(ZMAX, g.z0 * d / g.d0));
        // the sheet point under the first midpoint stays under the fingers
        const px = g.vb0.x + (g.m0.x - r.left) * g.vb0.w / r.width, py = g.vb0.y + (g.m0.y - r.top) * g.vb0.h / r.height;
        this.zoom = z; this.vb.w = W / z; this.vb.h = this.vb.w * r.height / r.width;
        this.vb.x = px - (m.x - r.left) * this.vb.w / r.width; this.vb.y = py - (m.y - r.top) * this.vb.h / r.height;
        this.applyViewBox();
        this.render();
    }

    private updateHover(p: Vec) {
        const h = this.uiHit(p);
        let he = this.hitEdgeId(h);
        if (!he && this.hoverEdge) {
            const e = edgeById(this.S, this.hoverEdge);
            if (e && segDist(p, nodeById(this.S, e.a)!, nodeById(this.S, e.b)!) < 22 * this.tolk) he = this.hoverEdge;
        }
        this.svg.style.cursor = h.kind === 'handle' ? 'move' : h.kind === 'plus' ? 'pointer' : (this.stamp && he) ? 'copy' : h.kind === 'el' ? 'grab' : (h.kind === 'node' || h.kind === 'edge') ? 'crosshair' : 'default';
        if (he !== this.hoverEdge) { this.hoverEdge = he; this.render(); }
    }

    private click(h: UiHit, p: Vec, add: boolean) {
        if (h.kind === 'handle') return;
        const eid = this.hitEdgeId(h);
        if ((add || this.addMode) && eid) { this.hidePicker(); this.toggleEdgeSel(eid); return; }
        if (h.kind === 'plus') { if (this.stamp) { this.insert(h.edge, h.k, this.stamp); return; } this.openPicker(h.edge, h.k, p); return; }
        this.hidePicker();
        if (this.stamp && eid) { const e = edgeById(this.S, eid)!; this.insert(eid, insertIndexAt(this.S, e, p), this.stamp); return; }
        if (h.kind === 'el') {
            const f = findEl(this.S, h.el);
            if (f && this.sel?.kind === 'el' && this.sel.id === h.el && DIRECTIONAL.includes(f.el.type)) { this.commit(); f.el.flip = !f.el.flip; return; }
            this.sel = { kind: 'el', id: h.el };
        } else if (h.kind === 'node') this.sel = { kind: 'node', id: h.id };
        else if (h.kind === 'edge') this.sel = { kind: 'edge', id: h.edge };
        else { this.sel = null; this.addMode = false; }
    }

    private startDrag() {
        const { h, p } = this.down!; this.hidePicker();
        if (h.kind === 'node' && this.sel?.kind === 'node' && this.sel.id === h.id) { this.commit(); this.drag = { type: 'move', node: h.id }; return; }
        if (h.kind === 'handle') { this.commit(); this.drag = { type: 'group', p, orig: groupOrigin(this.S, this.selEdges()) }; return; }
        if (h.kind === 'el') { this.drag = { type: 'el', el: h.el, p, target: null }; this.sel = { kind: 'el', id: h.el }; return; }
        if (h.kind === 'none') { this.drag = { type: 'lasso', pts: [[p.x, p.y]] }; return; }
        this.drag = { type: 'wire', start: resolveEnd(this.S, p, null, this.tolk), end: null };
    }
    private updateDrag(p: Vec) {
        const d = this.drag!;
        if (d.type === 'wire') d.end = resolveEnd(this.S, p, d.start, this.tolk, { angTol: this.coarse ? 10 : 6, prevDir: d.end?.dir ?? null });
        else if (d.type === 'move') { const n = nodeById(this.S, d.node); if (n) { n.x = Math.round(p.x / G) * G; n.y = Math.round(p.y / G) * G; } }
        else if (d.type === 'group') moveGroup(this.S, d.orig, p.x - d.p.x, p.y - d.p.y);
        else if (d.type === 'lasso') { const l = d.pts[d.pts.length - 1]; if (Math.hypot(p.x - l[0], p.y - l[1]) > 4) d.pts.push([p.x, p.y]); }
        else if (d.type === 'el') {
            d.p = p; d.target = null;
            const h = hitTest(this.S, p, this.tolk);
            const eid = h.kind === 'edge' || h.kind === 'el' ? h.edge : null;
            if (eid) { const q = projOnto(p, edgeGeom(this.S, edgeById(this.S, eid)!)); d.target = { edge: eid, x: q.x, y: q.y }; }
        }
    }
    private finishDrag(d: Drag, p: Vec) {
        const S = this.S;
        if (d.type === 'wire') {
            // The end shown in the preview (a pen lift can move the last point a little and lose the snap).
            const en = d.end ?? resolveEnd(S, p, d.start, this.tolk, { angTol: this.coarse ? 10 : 6 });
            if (Math.hypot(en.x - d.start.x, en.y - d.start.y) < 10) return;
            const before = this.snapshot();
            const e = addWire(S, d.start, en, this.tolk);
            if (this.snapshot() !== before) { this.session.hist.push(before); this.session.redo.length = 0; }
            if (e) this.sel = { kind: 'edge', id: e.id };
        } else if (d.type === 'move') {
            if (settleNode(S, d.node)) this.sel = null;
        } else if (d.type === 'group') {
            settleGroup(S, d.orig);
            if (this.sel?.kind === 'multi') this.sel = { kind: 'multi', ids: this.sel.ids.filter(id => edgeById(S, id)) };
            else if (this.sel?.kind === 'edge' && !edgeById(S, this.sel.id)) this.sel = null;
        } else if (d.type === 'lasso') {
            const ids = lassoEdges(S, d.pts);
            this.addMode = false;
            this.sel = ids.length > 1 ? { kind: 'multi', ids } : ids.length === 1 ? { kind: 'edge', id: ids[0] } : null;
            if (!ids.length && d.pts.length >= 3) this.toast('Circle whole branches (both ends) to select them');
        } else if (d.type === 'el') {
            if (!d.target) return;
            this.commit(); moveElement(S, d.el, d.target.edge, p);
        }
    }

    // ---------- context menu: right click, or press and hold ----------
    private openMenu(h0: UiHit, x: number, y: number) {
        this.hidePicker();
        let h = h0;
        if (h.kind === 'plus') h = { kind: 'edge', edge: h.edge, s: 0 };
        const menu = new Menu();
        const item = (title: string, icon: string, fn: () => void, warn = false) => menu.addItem(i => { i.setTitle(title).setIcon(icon).onClick(fn); if (warn) i.setWarning(true); });
        if (h.kind === 'el') {
            const f = findEl(this.S, h.el); if (!f) return;
            this.sel = { kind: 'el', id: h.el };
            item('Edit label', 'pencil', () => this.act('label'));
            if (DIRECTIONAL.includes(f.el.type)) item('Reverse arrow', 'arrow-left-right', () => this.act('flip'));
            item('Label side', 'flip-vertical', () => this.act('side'));
            menu.addSeparator();
            item('Delete element', 'trash-2', () => this.act('del'), true);
            item('Delete whole branch', 'trash-2', () => this.act('delEdge'), true);
        } else if (h.kind === 'edge' && this.sel?.kind === 'multi' && this.selEdges().includes(h.edge)) {
            item(this.addMode ? 'Done selecting' : 'Select more', 'list-checks', () => this.act('more'));
            menu.addSeparator();
            item('Delete selected branches', 'trash-2', () => this.act('del'), true);
        } else if (h.kind === 'edge') {
            this.sel = { kind: 'edge', id: h.edge };
            item('Add element', 'plus', () => this.act('addEl'));
            item('Parallel branch', 'copy', () => this.act('par'));
            item('Select more branches', 'list-checks', () => this.act('more'));
            menu.addSeparator();
            item('Delete branch', 'trash-2', () => this.act('del'), true);
        } else if (h.kind === 'node') {
            this.sel = { kind: 'node', id: h.id };
            item('Delete node and its branches', 'trash-2', () => this.act('del'), true);
        } else { this.render(); return; }
        this.render();
        menu.showAtPosition({ x, y });
    }

    // ---------- optional keyboard shortcuts (nothing depends on them) ----------
    private onKey(ev: KeyboardEvent) {
        const tg = (ev.target as HTMLElement | null)?.tagName;
        if (tg === 'INPUT' || tg === 'SELECT' || tg === 'TEXTAREA') return;
        const k = ev.key, mod = ev.ctrlKey || ev.metaKey, up = k.length === 1 ? k.toUpperCase() : k;
        if (mod && up === 'Z') { ev.preventDefault(); if (ev.shiftKey) this.redoAct(); else this.undo(); return; }
        if (mod && up === 'Y') { ev.preventDefault(); this.redoAct(); return; }
        if (mod || ev.altKey) return;
        if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); this.deleteSel(); return; }
        const t = up as ElType;
        if (this.picker && TYPES[t]) { ev.preventDefault(); this.pickType(t); return; }
        if (this.sel?.kind === 'el') { if (up === 'F') { this.act('flip'); return; } if (up === 'S') { this.act('side'); return; } }
        if (up === 'P') {
            const eid = this.hoverEdge ?? (this.sel?.kind === 'edge' ? this.sel.id : this.sel?.kind === 'el' ? findEl(this.S, this.sel.id)?.edge.id : null);
            if (eid) { this.sel = { kind: 'edge', id: eid }; this.act('par'); }
            return;
        }
        if (TYPES[t]) {
            let eid: string | null = null, kk = 0;
            if (this.hoverEdge && edgeById(this.S, this.hoverEdge)) {
                eid = this.hoverEdge;
                kk = insertIndexAt(this.S, edgeById(this.S, eid)!, this.mouse);
            } else if (this.sel?.kind === 'el') { const f = findEl(this.S, this.sel.id); if (f) { eid = f.edge.id; kk = f.idx + 1; } }
            else if (this.sel?.kind === 'edge') { eid = this.sel.id; kk = Math.ceil(edgeById(this.S, eid)!.els.length / 2); }
            if (eid) { ev.preventDefault(); this.insert(eid, kk, t); }
        }
    }
}
