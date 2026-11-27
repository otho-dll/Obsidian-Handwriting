import { defineMixin } from './mixin';
import { Stroke } from '../types';
import { CircuitModal, newCircuitSession, type CircuitLook } from '../circuit/circuitModal';
import { circuitToPolylines } from '../circuit/geometry';
import { dropDegenerate, resample } from '../circuit/resample';
import type { Circuit } from '../circuit/types';

/** Distance between points of an inserted stroke (page units) – the eraser cuts strokes point by point. */
const RESAMPLE_STEP = 3;

/** "Insert circuit": a schematic editor whose result lands in the note as ordinary pen strokes. */
export const circuitInsertMixin = defineMixin({
    insertCircuit() {
        if (!this.canEdit()) return;
        const plugin = this.plugin;
        const penIdx = Math.max(0, Math.min(this.penSizes.length - 1, this.sizeMem.pen));
        if (!plugin.circuitSession) plugin.circuitSession = newCircuitSession(penIdx);
        plugin.circuitSession.look.line = penIdx;          // the circuit is drawn with the current pen
        new CircuitModal(this.app, plugin.circuitSession, (c, look) => this.placeCircuit(c, look)).open();
    },

    /** Converts the circuit to pen strokes, puts them in the middle of the view (one undo step) and selects them. */
    placeCircuit(c: Circuit, look: CircuitLook) {
        const pageIndex = this.pageIndexAtViewCenter();
        const page = this.noteData.pages[pageIndex];
        if (!page) return;
        const pls = dropDegenerate(circuitToPolylines(c, { dots: look.dots }));
        if (!pls.length) return;

        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const pl of pls) for (const [x, y] of pl) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        // 1 editor px = 1 page unit at "Standard size"; shrink to fit the page if needed.
        const pw = this.pageW(pageIndex), ph = this.pageH(pageIndex), margin = 20;
        const k = Math.min(look.size, (pw - 2 * margin) / Math.max(1, x1 - x0), (ph - 2 * margin) / Math.max(1, y1 - y0));
        const center = this.getVisibleCenter(pageIndex);
        const w = (x1 - x0) * k, h = (y1 - y0) * k;
        const left = Math.max(margin, Math.min(pw - margin - w, center.x - w / 2));
        const top = Math.max(margin, Math.min(ph - margin - h, center.y - h / 2));

        const width = this.penSizes[look.line] ?? this.penSizes[this.sizeMem.pen];
        const strokes: Stroke[] = [];
        for (const pl of pls) {
            const pts = resample(pl.map(([x, y]) => [left + (x - x0) * k, top + (y - y0) * k] as [number, number]), RESAMPLE_STEP);
            if (pts.length < 2) continue;
            strokes.push({ points: pts.map(([x, y]) => this.mkPoint(x, y)), color: this.penColor, width, isHighlighter: false });
        }
        if (!strokes.length) return;

        page.strokes.push(...strokes);
        this.pushHistoryAction({ type: 'paste', page: pageIndex, strokes, images: [] });
        this.requestSave();
        this.activateLassoForInsert();
        this.selection = { page: pageIndex, strokes: [...strokes], images: [] };
        this.updateSelectionUI();
        this.redrawPage(pageIndex);
    },
});
export type CircuitInsertMethods = typeof circuitInsertMixin;
