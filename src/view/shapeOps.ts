import { defineMixin } from './mixin';
import { Notice } from 'obsidian';
import { newId } from '../utils';
import { Point, Stroke, ImageItem, AttrChange } from '../types';

/** Stroke fields a stretch can change (rotated shapes become closed polygons). */
const STRETCH_STROKE_KEYS = ['points', 'shape', 'poly', 'closed', 'rot', 'right'] as const;
const STRETCH_IMAGE_KEYS = ['x', 'y', 'w', 'h'] as const;
/** After splitting, each side moves this far from the cut line (page units; both sides together ≈ 1.5 mm on A4). */
const SPLIT_GAP = 3;

/** Snapshot of items before a stretch (for one undo step). */
export interface StretchSnap { strokes: Map<Stroke, Record<string, unknown>>; images: Map<ImageItem, Record<string, unknown>>; }

/**
 * Shape operations on the selection:
 * - stretching (non-proportional scaling with the edge handles),
 * - splitting along a line into two independent parts,
 * - the right-angle path of the line tool (KiCad-like wires).
 */
export const shapeOpsMixin = defineMixin({
    // --- STRETCHING ---

    /** A rotated rectangle / ellipse / triangle turned into a closed polygon (same look, now free to stretch). */
    shapeToPolygon(s: Stroke) {
        if (!s.shape || s.shape === 'line') return;
        const outline = this.shapeOutline(s);
        if (outline.length < 3) return;
        s.points = outline.map(p => this.mkPoint(p.x, p.y));
        delete s.shape;
        delete s.rot;
        delete s.right;
        s.poly = true;
        s.closed = true;
        this.bboxCache.delete(s);
    },

    /** Non-proportional scaling around (ax, ay): x by kx, y by ky. Line widths stay the same. */
    stretchItems(strokes: Stroke[], images: ImageItem[], ax: number, ay: number, kx: number, ky: number) {
        const uneven = Math.abs(kx - ky) > 1e-9;
        for (const s of strokes) {
            // A rotated shape (other than by 180°) stays itself only when scaled evenly.
            if (uneven && s.shape && s.shape !== 'line' && s.rot && Math.abs(Math.sin(s.rot)) > 1e-6) this.shapeToPolygon(s);
            for (const p of s.points) {
                p.x = ax + (p.x - ax) * kx;
                p.y = ay + (p.y - ay) * ky;
            }
            this.bboxCache.delete(s);
        }
        for (const i of images) {
            const cx = ax + (i.x + i.w / 2 - ax) * kx;
            const cy = ay + (i.y + i.h / 2 - ay) * ky;
            const r = i.rot ?? 0;
            if (Math.abs(Math.sin(r)) < 1e-6) { i.w *= kx; i.h *= ky; }
            else if (Math.abs(Math.cos(r)) < 1e-6) { i.w *= ky; i.h *= kx; }   // turned by 90°: width runs along y
            else { const k = Math.sqrt(kx * ky); i.w *= k; i.h *= k; }       // any other angle: keeps its proportions
            i.x = cx - i.w / 2;
            i.y = cy - i.h / 2;
        }
    },

    stretchSnapshot(strokes: Stroke[], images: ImageItem[]): StretchSnap {
        const snap: StretchSnap = { strokes: new Map(), images: new Map() };
        for (const s of strokes) {
            const rec = s as unknown as Record<string, unknown>;
            const o: Record<string, unknown> = {};
            for (const k of STRETCH_STROKE_KEYS) o[k] = k === 'points' ? s.points.map(p => ({ ...p })) : rec[k];
            snap.strokes.set(s, o);
        }
        for (const i of images) {
            const rec = i as unknown as Record<string, unknown>;
            const o: Record<string, unknown> = {};
            for (const k of STRETCH_IMAGE_KEYS) o[k] = rec[k];
            snap.images.set(i, o);
        }
        return snap;
    },

    /** One undo step for a finished stretch (attribute changes: before = snapshot, after = now). */
    commitStretch(page: number, snap: StretchSnap) {
        const changes: AttrChange[] = [];
        snap.strokes.forEach((before, s) => {
            const rec = s as unknown as Record<string, unknown>;
            const after: Record<string, unknown> = {};
            for (const k of STRETCH_STROKE_KEYS) after[k] = rec[k];
            changes.push({ item: s, before, after });
        });
        snap.images.forEach((before, i) => {
            const rec = i as unknown as Record<string, unknown>;
            const after: Record<string, unknown> = {};
            for (const k of STRETCH_IMAGE_KEYS) after[k] = rec[k];
            changes.push({ item: i, before, after });
        });
        if (changes.length === 0) return;
        this.pushHistoryAction({ type: 'attrs', page, changes });
        this.lastAttrEntry = null;
        this.requestSave();
    },

    // --- SPLITTING ALONG A LINE ---

    /** Selection menu → "Split along a line…": the next line drawn over the page splits the selection. */
    startSplitMode() {
        if (!this.selection || this.readOnly) return;
        this.splitMode = true;
        this.contentEl.addClass('hw-split-mode');
        this.splitBtn?.addClass('active');
        new Notice('Draw a line across the selection to split it in two (Esc cancels).');
    },

    cancelSplitMode() {
        if (!this.splitMode) return;
        this.splitMode = false;
        this.contentEl.removeClass('hw-split-mode');
        this.splitBtn?.removeClass('active');
    },

    /**
     * Splits the selected items by the (infinite) line through a and b. Strokes and shape outlines are cut where they
     * cross the line, filled shapes are cut into two filled polygons. Everything on one side becomes one group and
     * everything on the other side another group – a tap then selects one half, ready to be recoloured.
     */
    splitSelection(a: Point, b: Point): boolean {
        const sel = this.selection;
        const page = sel ? this.noteData.pages[sel.page] : null;
        if (!sel || !page) return false;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1e-6) return false;
        const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        const side = (p: { x: number; y: number }) => (p.x - a.x) * nx + (p.y - a.y) * ny;
        const gA = newId(), gB = newId();
        const lerp = (p: Point, q: Point, t: number): Point => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, pressure: p.pressure + (q.pressure - p.pressure) * t });

        /** Cuts a polyline where it crosses the line: pieces with the side they lie on (true = A). */
        const cutPolyline = (pts: Point[]): { a: boolean; pts: Point[] }[] => {
            const out: { a: boolean; pts: Point[] }[] = [];
            if (pts.length === 0) return out;
            let curA = side(pts[0]) >= 0;
            let cur: Point[] = [{ ...pts[0] }];
            for (let i = 1; i < pts.length; i++) {
                const p = pts[i - 1], q = pts[i];
                const dp = side(p), dq = side(q);
                const qA = dq >= 0;
                if (qA !== curA && Math.abs(dp - dq) > 1e-12) {
                    const x = lerp(p, q, dp / (dp - dq));
                    cur.push(x);
                    out.push({ a: curA, pts: cur });
                    cur = [{ ...x }];
                    curA = qA;
                }
                cur.push({ ...q });
            }
            out.push({ a: curA, pts: cur });
            return out.filter(o => o.pts.length >= 2);
        };
        /** Part of a polygon on one side of the line (Sutherland–Hodgman against a half-plane). */
        const clipPolygon = (poly: Point[], keepA: boolean): Point[] => {
            const res: Point[] = [];
            const inside = (p: Point) => keepA ? side(p) >= 0 : side(p) <= 0;
            for (let i = 0; i < poly.length; i++) {
                const p = poly[i], q = poly[(i + 1) % poly.length];
                const pin = inside(p), qin = inside(q);
                if (pin) res.push({ ...p });
                if (pin !== qin) {
                    const dp = side(p), dq = side(q);
                    if (Math.abs(dp - dq) > 1e-12) res.push(lerp(p, q, dp / (dp - dq)));
                }
            }
            return res;
        };
        const copy = (s: Stroke, patch: Partial<Stroke>): Stroke => {
            const c: Stroke = { ...s, points: s.points.map(p => ({ ...p })), ...patch };
            delete c.lock;
            return c;
        };
        /** Outline piece of a cut shape: an open polyline that keeps the shape's look. */
        const piece = (s: Stroke, pts: Point[], g: string): Stroke => {
            const st: Stroke = { points: pts, color: s.color, width: s.width, isHighlighter: false, poly: true, g };
            if (s.dash && s.dash !== 'solid') st.dash = s.dash;
            if (s.alpha !== undefined) st.alpha = s.alpha;
            return st;
        };

        const after: Stroke[] = [];
        const selected = new Set(sel.strokes);
        let cutCount = 0;
        for (const s of page.strokes) {
            if (!selected.has(s)) { after.push(s); continue; }
            const isArea = (!!s.shape && s.shape !== 'line') || (!!s.poly && !!s.closed);
            if (isArea) {
                const outline = s.shape ? this.shapeOutline(s) : s.points;
                const sides = outline.map(p => side(p));
                if (sides.every(d => d >= 0) || sides.every(d => d <= 0)) {
                    after.push(copy(s, { g: sides.every(d => d >= 0) ? gA : gB }));
                    continue;
                }
                cutCount++;
                // fill first (below), then the outline pieces
                if (s.fill) {
                    for (const keepA of [true, false]) {
                        const poly = clipPolygon(outline, keepA);
                        if (poly.length < 3) continue;
                        const f: Stroke = { points: poly, color: s.color, width: s.width, isHighlighter: false, poly: true, closed: true, fill: true, noLine: true, g: keepA ? gA : gB };
                        if (s.fillColor) f.fillColor = s.fillColor;
                        if (s.fillAlpha !== undefined) f.fillAlpha = s.fillAlpha;
                        if (s.alpha !== undefined) f.alpha = s.alpha;
                        after.push(f);
                    }
                }
                if (!(s.fill && s.noLine)) {
                    const pieces = cutPolyline([...outline, outline[0]]);
                    // The ring started somewhere in the middle of one side: join its last piece with the first one.
                    if (pieces.length >= 3 && pieces[0].a === pieces[pieces.length - 1].a) {
                        const last = pieces.pop()!;
                        pieces[0].pts = [...last.pts, ...pieces[0].pts.slice(1)];
                    }
                    for (const pc of pieces) after.push(piece(s, pc.pts, pc.a ? gA : gB));
                }
                continue;
            }
            if (s.shape === 'line') {
                const p0 = s.points[0], p1 = s.points[s.points.length - 1];
                const d0 = side(p0), d1 = side(p1);
                if ((d0 >= 0) === (d1 >= 0) || Math.abs(d0 - d1) < 1e-12) { after.push(copy(s, { g: d0 >= 0 ? gA : gB })); continue; }
                cutCount++;
                const x = lerp(p0, p1, d0 / (d0 - d1));
                const first = copy(s, { points: [{ ...p0 }, { ...x }], g: d0 >= 0 ? gA : gB });
                delete first.arrow;   // the arrow stays at the real end of the line
                after.push(first, copy(s, { points: [{ ...x }, { ...p1 }], g: d1 >= 0 ? gA : gB }));
                continue;
            }
            // Freehand (pen, highlighter, pieces of shapes)
            const pieces = cutPolyline(s.points);
            if (pieces.length <= 1) { after.push(copy(s, { g: side(s.points[0]) >= 0 ? gA : gB })); continue; }
            cutCount++;
            for (const pc of pieces) after.push(copy(s, { points: pc.pts, g: pc.a ? gA : gB }));
        }

        // The two sides move slightly apart (perpendicular to the cut), so the split is visible. Only new objects are
        // moved (copies and pieces) – the originals stay untouched in `before` for undo.
        const gap = cutCount > 0 ? SPLIT_GAP : 0;
        const shift = (g: string | undefined) => (g === gA ? 1 : -1) * gap;
        if (gap > 0) {
            const old = new Set(page.strokes);
            for (const st of after) {
                if (old.has(st)) continue;
                const d = shift(st.g);
                for (const p of st.points) { p.x += nx * d; p.y += ny * d; }
            }
        }
        // Images are not cut: they join the side of their centre (and move with it).
        const imgAttrs: AttrChange[] = sel.images.map(i => {
            const g = side({ x: i.x + i.w / 2, y: i.y + i.h / 2 }) >= 0 ? gA : gB;
            const d = shift(g);
            return { item: i, before: { g: i.g, x: i.x, y: i.y }, after: { g, x: i.x + nx * d, y: i.y + ny * d } };
        });
        const before = [...page.strokes];
        page.strokes = after;
        this.applyAttrChanges(imgAttrs, 'after');
        this.pushHistoryAction({ type: 'replace', page: sel.page, before, after: [...after], imgAttrs });
        const pageIdx = sel.page;
        this.selection = null;
        this.updateSelectionUI();
        this.bboxCache = new WeakMap();
        this.requestSave();
        this.redrawPage(pageIdx);
        this.markThumbDirty(pageIdx);
        new Notice(cutCount > 0 ? 'Split into two parts – tap a part to select it.' : 'The line does not cross the selection – the two sides are now separate groups.');
        return true;
    },

    // --- RIGHT-ANGLE PATH (line tool) ---

    /** Ends the right-angle path being drawn: the arrow (when on) goes to its last segment (not when undoing). */
    endOrthoPath(addArrow = true) {
        const path = this.orthoPath;
        if (!path) return;
        this.orthoPath = null;
        this.orthoMarker?.remove();
        this.orthoMarker = null;
        const page = this.noteData.pages[path.page];
        if (addArrow && path.arrow && page && page.strokes.includes(path.last)) this.commitAttrs(path.page, [path.last], () => ({ arrow: true }));
    },

    /** Small dot at the end of the path: the next segment starts there. */
    placeOrthoMarker() {
        const path = this.orthoPath;
        const view = path ? this.pageViews[path.page] : null;
        if (!path || !view) { this.orthoMarker?.remove(); this.orthoMarker = null; return; }
        if (!this.orthoMarker || this.orthoMarker.parentElement !== view.container) {
            this.orthoMarker?.remove();
            this.orthoMarker = view.container.createDiv({ cls: 'hw-ortho-end' });
        }
        const z = Math.max(0.25, this.currentZoom);
        const r = 5 / z;
        const m = this.orthoMarker;
        m.style.width = `${2 * r}px`;
        m.style.height = `${2 * r}px`;
        m.style.borderWidth = `${1.5 / z}px`;
        m.style.transform = `translate(${path.end.x - r}px, ${path.end.y - r}px)`;
    },
});
export type ShapeOpsMethods = typeof shapeOpsMixin;
