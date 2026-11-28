import { defineMixin } from './mixin';
import { Stroke } from '../types';
import { newId } from '../utils';
import { dropDegenerate, resample } from '../circuit/resample';
import { solidBox, type SolidLines } from '../solid/render';
import { SolidModal, newSolidSession } from '../solid/solidModal';
import type { SolidSpec } from '../solid/types';
import type { Polyline } from '../circuit/font';

/** Distance between points of an inserted stroke (page units) – the eraser cuts strokes point by point. */
const RESAMPLE_STEP = 3;
/** Largest dimension of the drawing at "Standard size" (page units; an A4 page is 800 wide). */
const STANDARD = 240;

/** "Insert solid…": a 3D solid drawn as ordinary pen strokes – edges, dashed hidden edges, dash-dot centre lines. */
export const solidInsertMixin = defineMixin({
    insertSolid() {
        if (!this.canEdit()) return;
        const plugin = this.plugin;
        if (!plugin.solidSession) plugin.solidSession = newSolidSession();
        new SolidModal(this.app, plugin.solidSession, (lines, spec, size) => this.placeSolid(lines, spec, size)).open();
    },

    /** Puts the drawing in the middle of the view as one group (one undo step) and selects it. */
    placeSolid(lines: SolidLines, spec: SolidSpec, size: number) {
        const pageIndex = this.pageIndexAtViewCenter();
        const page = this.noteData.pages[pageIndex];
        if (!page) return;
        const b = solidBox(lines);
        if (!isFinite(b.x0)) return;
        const pw = this.pageW(pageIndex), ph = this.pageH(pageIndex), margin = 20;
        const w0 = Math.max(1, b.x1 - b.x0), h0 = Math.max(1, b.y1 - b.y0);
        const k = Math.min(STANDARD * size / Math.max(w0, h0), (pw - 2 * margin) / w0, (ph - 2 * margin) / h0);
        const center = this.getVisibleCenter(pageIndex);
        const w = w0 * k, h = h0 * k;
        const left = Math.max(margin, Math.min(pw - margin - w, center.x - w / 2));
        const top = Math.max(margin, Math.min(ph - margin - h, center.y - h / 2));

        const penW = this.penSizes[this.sizeMem.pen] ?? 2;
        const g = newId();
        const strokes: Stroke[] = [];
        const add = (pls: Polyline[], width: number, dash?: Stroke['dash']) => {
            for (const pl of dropDegenerate(pls)) {
                const pts = resample(pl.map(([x, y]) => [left + (x - b.x0) * k, top + (y - b.y0) * k] as [number, number]), RESAMPLE_STEP);
                if (pts.length < 2) continue;
                const s: Stroke = { points: pts.map(([x, y]) => this.mkPoint(x, y)), color: this.penColor, width, isHighlighter: false, g };
                if (dash) s.dash = dash;
                strokes.push(s);
            }
        };
        add(lines.axes, Math.max(0.8, penW * 0.6), 'dashdot');
        add(lines.hidden, Math.max(0.8, penW * 0.8), spec.hidden === 'dashed' ? 'dashed' : undefined);
        add(lines.visible, penW);
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
export type SolidInsertMethods = typeof solidInsertMixin;
