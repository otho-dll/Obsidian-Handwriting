import { defineMixin } from './mixin';
import { rotatePointAbout } from '../utils';
import { Stroke, ImageItem, HistoryEntry, AttrChange } from '../types';

/** Maximum number of undo steps (older ones are forgotten – saves memory during long sessions). */
const MAX_UNDO = 300;

export const historyMixin = defineMixin({
    // --- UNDO / REDO ---
    clearHistory() {
        this.undoStack = [];
        this.redoStack = [];
        this.selection = null;
        this.updateUndoRedoUI();
        this.updateSelectionUI();
    },

    pushHistory(page: number, stroke: Stroke) {
        this.pushHistoryAction({ type: 'add', page, stroke });
    },

    pushHistoryAction(entry: HistoryEntry) {
        this.undoStack.push(entry);
        if (this.undoStack.length > MAX_UNDO) this.undoStack.splice(0, this.undoStack.length - MAX_UNDO);
        this.redoStack = [];
        this.updateUndoRedoUI();
    },

    translateItems(strokes: Stroke[], images: ImageItem[], dx: number, dy: number) {
        // Bounding boxes are moved together with the strokes (instead of recomputing them for the whole note).
        for (const s of strokes) {
            for (const p of s.points) { p.x += dx; p.y += dy; }
            const b = this.bboxCache.get(s);
            if (b) this.bboxCache.set(s, { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy });
        }
        for (const i of images) { i.x += dx; i.y += dy; }
    },

    scaleItems(strokes: Stroke[], images: ImageItem[], ax: number, ay: number, k: number) {
        for (const s of strokes) {
            for (const p of s.points) {
                p.x = ax + (p.x - ax) * k;
                p.y = ay + (p.y - ay) * k;
            }
        }
        for (const i of images) {
            i.x = ax + (i.x - ax) * k;
            i.y = ay + (i.y - ay) * k;
            i.w *= k;
            i.h *= k;
        }
        for (const s of strokes) this.bboxCache.delete(s);
    },

    // Rotation around point (cx, cy). Rectangles and ellipses rotate around their own centre (the rot field)
    // and their centre moves along a circle; lines and freehand strokes rotate their points.
    rotateItems(strokes: Stroke[], images: ImageItem[], cx: number, cy: number, a: number) {
        for (const s of strokes) {
            if (s.shape === 'rect' || s.shape === 'ellipse') {
                const p0 = s.points[0];
                const p1 = s.points[s.points.length - 1];
                if (!p0 || !p1) continue;
                const mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
                const c = rotatePointAbout({ x: mx, y: my }, cx, cy, a);
                const dx = c.x - mx, dy = c.y - my;
                p0.x += dx; p0.y += dy; p1.x += dx; p1.y += dy;
                s.rot = (s.rot ?? 0) + a;
            } else {
                for (const p of s.points) {
                    const q = rotatePointAbout(p, cx, cy, a);
                    p.x = q.x; p.y = q.y;
                }
            }
        }
        for (const i of images) {
            const c = rotatePointAbout({ x: i.x + i.w / 2, y: i.y + i.h / 2 }, cx, cy, a);
            i.x = c.x - i.w / 2;
            i.y = c.y - i.h / 2;
            i.rot = (i.rot ?? 0) + a;
        }
        for (const s of strokes) this.bboxCache.delete(s);
    },

    /** Sets the attributes (colour, width, group, lock) from the state before / after the change. */
    applyAttrChanges(changes: AttrChange[], which: 'before' | 'after') {
        for (const c of changes) {
            const state = c[which];
            const item = c.item as unknown as Record<string, unknown>;
            for (const k of Object.keys(state)) {
                if (state[k] === undefined) delete item[k]; else item[k] = state[k];
            }
            this.bboxCache.delete(c.item as Stroke);
        }
    },

    updateUndoRedoUI() {
        if (this.undoBtn) this.undoBtn.disabled = this.undoStack.length === 0;
        if (this.redoBtn) this.redoBtn.disabled = this.redoStack.length === 0;
    },

    undo() {
        const entry = this.undoStack.pop();
        if (!entry) return;
        this.selection = null;
        this.updateSelectionUI();
        const page = this.noteData.pages[entry.page];
        if (page) {
            const strokes = page.strokes;
            const images = page.images ?? (page.images = []);
            if (entry.type === 'add') {
                const i = strokes.lastIndexOf(entry.stroke);
                if (i >= 0) strokes.splice(i, 1);
            } else if (entry.type === 'move') {
                this.translateItems(entry.strokes, entry.images, -entry.dx, -entry.dy);
            } else if (entry.type === 'scale') {
                this.scaleItems(entry.strokes, entry.images, entry.ax, entry.ay, 1 / entry.k);
            } else if (entry.type === 'rotate') {
                this.rotateItems(entry.strokes, entry.images, entry.cx, entry.cy, -entry.angle);
            } else if (entry.type === 'delete') {
                // Indices are ascending, so inserting in order restores the original order.
                for (const item of entry.items) strokes.splice(item.index, 0, item.stroke);
                for (const item of entry.imgItems) images.splice(item.index, 0, item.image);
            } else if (entry.type === 'replace') {
                page.strokes = [...entry.before];
            } else if (entry.type === 'addImage') {
                const i = images.indexOf(entry.image);
                if (i >= 0) images.splice(i, 1);
            } else if (entry.type === 'paste') {
                page.strokes = page.strokes.filter(st => !entry.strokes.includes(st));
                page.images = images.filter(im => !entry.images.includes(im));
            } else if (entry.type === 'cropImage') {
                this.applyImageSnap(entry.image, entry.before);
            } else if (entry.type === 'attrs') {
                this.applyAttrChanges(entry.changes, 'before');
            } else if (entry.type === 'order') {
                page.strokes = [...entry.before.strokes];
                page.images = [...entry.before.images];
            } else if (entry.type === 'multiMove') {
                for (const m of entry.moves) this.translateItems(m.strokes, m.images, -m.dx, -m.dy);
            } else if (entry.type === 'transfer') {
                const to = this.noteData.pages[entry.to];
                if (to) {
                    this.translateItems(entry.strokes, entry.images, 0, -entry.dy);
                    to.strokes = to.strokes.filter(st => !entry.strokes.includes(st));
                    if (to.images) to.images = to.images.filter(im => !entry.images.includes(im));
                    page.strokes.push(...entry.strokes);
                    (page.images ?? (page.images = [])).push(...entry.images);
                    this.redrawPage(entry.to);
                }
            }
        }
        this.redoStack.push(entry);
        this.redrawPage(entry.page);
        this.requestSave();
        this.updateUndoRedoUI();
    },

    redo() {
        const entry = this.redoStack.pop();
        if (!entry) return;
        this.selection = null;
        this.updateSelectionUI();
        const page = this.noteData.pages[entry.page];
        if (page) {
            const strokes = page.strokes;
            const images = page.images ?? (page.images = []);
            if (entry.type === 'add') {
                strokes.push(entry.stroke);
            } else if (entry.type === 'move') {
                this.translateItems(entry.strokes, entry.images, entry.dx, entry.dy);
            } else if (entry.type === 'scale') {
                this.scaleItems(entry.strokes, entry.images, entry.ax, entry.ay, entry.k);
            } else if (entry.type === 'rotate') {
                this.rotateItems(entry.strokes, entry.images, entry.cx, entry.cy, entry.angle);
            } else if (entry.type === 'delete') {
                for (const item of entry.items) {
                    const i = strokes.indexOf(item.stroke);
                    if (i >= 0) strokes.splice(i, 1);
                }
                for (const item of entry.imgItems) {
                    const i = images.indexOf(item.image);
                    if (i >= 0) images.splice(i, 1);
                }
            } else if (entry.type === 'replace') {
                page.strokes = [...entry.after];
            } else if (entry.type === 'addImage') {
                images.splice(Math.min(entry.index, images.length), 0, entry.image);
            } else if (entry.type === 'paste') {
                strokes.push(...entry.strokes);
                images.push(...entry.images);
            } else if (entry.type === 'cropImage') {
                this.applyImageSnap(entry.image, entry.after);
            } else if (entry.type === 'attrs') {
                this.applyAttrChanges(entry.changes, 'after');
            } else if (entry.type === 'order') {
                page.strokes = [...entry.after.strokes];
                page.images = [...entry.after.images];
            } else if (entry.type === 'multiMove') {
                for (const m of entry.moves) this.translateItems(m.strokes, m.images, m.dx, m.dy);
            } else if (entry.type === 'transfer') {
                const to = this.noteData.pages[entry.to];
                if (to) {
                    this.translateItems(entry.strokes, entry.images, 0, entry.dy);
                    page.strokes = page.strokes.filter(st => !entry.strokes.includes(st));
                    if (page.images) page.images = page.images.filter(im => !entry.images.includes(im));
                    to.strokes.push(...entry.strokes);
                    (to.images ?? (to.images = [])).push(...entry.images);
                    this.redrawPage(entry.to);
                }
            }
        }
        this.undoStack.push(entry);
        this.redrawPage(entry.page);
        this.requestSave();
        this.updateUndoRedoUI();
    },
});
export type HistoryMethods = typeof historyMixin;
