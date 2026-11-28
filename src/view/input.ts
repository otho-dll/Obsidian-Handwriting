import { defineMixin } from './mixin';
import { SIMPLIFY_EPSILON, ROTATE_STEP, LIGHT_FILL_ALPHA } from '../constants';
import { Point, Stroke, Bounds, BBox } from '../types';
import { newId } from '../utils';
import type { StretchSnap } from './shapeOps';
import { buzz } from '../haptics';

/** Writing with the pen / mouse: pen, highlighter, eraser, shapes and lasso on the page canvas. */
export const inputMixin = defineMixin({
    setupDrawingCanvas(topCanvas: HTMLCanvasElement, bottomCanvas: HTMLCanvasElement, highCanvas: HTMLCanvasElement, pageIndex: number) {
        const topCtx = topCanvas.getContext('2d');
        const bottomCtx = bottomCanvas.getContext('2d');
        const highCtx = highCanvas.getContext('2d');
        if (!topCtx || !bottomCtx || !highCtx) return;

        this.pageContexts[pageIndex] = { highCtx, bottomCtx, topCtx };

        let currentStroke: Stroke | null = null;
        let isDrawing = false;
        // The pen stroke is drawn on the view's wet-ink layer (inkLayer.ts) instead of topCanvas, when available.
        let inkOn = false;
        let inkVersion = -1;
        /** One live segment of the pen stroke (page coordinates; the context has the page transform). */
        const drawSeg = (ctx: CanvasRenderingContext2D, st: Stroke, p1: Point, p2: Point) => {
            const usePressure = p2.pressure !== 0.5 || p1.pressure !== 0.5;
            ctx.globalCompositeOperation = 'source-over';
            ctx.strokeStyle = st.color;
            ctx.lineWidth = usePressure ? st.width * this.pressureFactor((p1.pressure + p2.pressure) / 2) : st.width;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
        };
        /** Draws the whole stroke written so far on the ink layer (after the layer was cleared or moved). */
        const redrawInk = () => {
            const st = currentStroke, ctx = this.inkCtx;
            if (!inkOn || !st || !ctx) return;
            const pts = st.points;
            if (pts.length === 1) drawSeg(ctx, st, pts[0], pts[0]);
            for (let i = 1; i < pts.length; i++) drawSeg(ctx, st, pts[i - 1], pts[i]);
        };
        const stopInk = () => {
            if (!inkOn) return;
            inkOn = false;
            if (this.inkRedrawActive === redrawInk) this.inkRedrawActive = null;
            this.endInk();
        };
        // Area covered by the shape / highlighter preview (cleared instead of the whole canvas).
        let liveBox: BBox | null = null;
        let liveRaf = false;
        const clearLive = (nb: BBox) => {
            const b = liveBox ? { x0: Math.min(nb.x0, liveBox.x0), y0: Math.min(nb.y0, liveBox.y0), x1: Math.max(nb.x1, liveBox.x1), y1: Math.max(nb.y1, liveBox.y1) } : nb;
            topCtx.clearRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
            liveBox = nb;
        };
        let lassoPath: Point[] | null = null;
        let lassoStart: Point | null = null;
        let lassoRect = false;
        let lassoRaf = false;
        // The lasso loop preview is an SVG layer above the page (the browser only composites it), not a drawing on
        // the large canvas – every canvas redraw costs as much as it has pixels, so the lasso stuttered at high zoom.
        let lassoSvg: SVGSVGElement | null = null;
        let lassoEl: SVGPathElement | null = null;
        const ensureLassoSvg = () => {
            if (lassoSvg && lassoEl) return lassoEl;
            const NS = 'http://www.w3.org/2000/svg';
            lassoSvg = activeDocument.createElementNS(NS, 'svg');
            lassoSvg.setAttribute('class', 'hw-lasso-svg');
            lassoSvg.setAttribute('viewBox', `0 0 ${this.pageW(pageIndex)} ${this.pageH(pageIndex)}`);
            lassoSvg.setAttribute('preserveAspectRatio', 'none');
            lassoEl = activeDocument.createElementNS(NS, 'path');
            lassoSvg.appendChild(lassoEl);
            this.pageViews[pageIndex].container.appendChild(lassoSvg);
            return lassoEl;
        };
        const hideLasso = () => { if (lassoEl) lassoEl.setAttribute('d', ''); if (lassoSvg) lassoSvg.classList.add('is-hidden'); };
        const drawLassoPreview = () => {
            lassoRaf = false;
            if (!lassoPath || lassoPath.length === 0) return;
            const el = ensureLassoSvg();
            lassoSvg!.classList.remove('is-hidden');
            el.classList.toggle('is-rect', lassoRect);
            // For a very long loop take every k-th point (the preview doesn't need to be exact).
            const step = Math.max(1, Math.floor(lassoPath.length / 400));
            let d = '';
            for (let i = 0; i < lassoPath.length; i += step) {
                const p = lassoPath[i];
                d += (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
            }
            const lastP = lassoPath[lassoPath.length - 1];
            el.setAttribute('d', d + 'L' + lastP.x.toFixed(1) + ' ' + lastP.y.toFixed(1) + 'Z');
        };
        let lassoDrag: { last: Point; dx: number; dy: number } | null = null;
        // Selection moves are collected and applied once per frame (the pen reports ~4 events per frame).
        let dragPending: (() => void) | null = null;
        let dragRaf = 0;
        const runDragFrame = () => {
            dragRaf = 0;
            const f = dragPending;
            dragPending = null;
            if (f) f();
        };
        const scheduleDrag = (f: () => void) => {
            dragPending = f;
            if (!dragRaf) dragRaf = window.requestAnimationFrame(runDragFrame);
        };
        const flushDrag = () => {
            if (dragRaf) { window.cancelAnimationFrame(dragRaf); dragRaf = 0; }
            runDragFrame();
        };
        // Corner handle: proportional scaling around the opposite corner (ax, ay); sx / sy = the dragged corner's side.
        let scaleDrag: { sb: Bounds; ax: number; ay: number; sx: number; sy: number; total: number } | null = null;
        // Edge handle: stretching in one direction only, around the opposite edge (ax, ay); sign = the dragged edge's side.
        let stretchDrag: { sb: Bounds; axis: 'x' | 'y'; ax: number; ay: number; sign: number; total: number; snap: StretchSnap } | null = null;
        // "Split along a line…": the line being drawn over the selection.
        let splitLine: { a: Point; b: Point } | null = null;
        // Right-angle path (line tool, like wires in KiCad): one drag draws an "L" – two perpendicular segments meeting
        // at a corner, both following the pen. orthoDown: where the pen went down (a tap without moving ends the path).
        let orthoDown: { x: number; y: number } | null = null;
        let orthoPref: 'h' | 'v' | null = null;    // preferred first direction (continuing path: perpendicular to the last segment)
        let snapStep: number | null = null;   // Shift + line: the 45° step the line is snapped to (a tick when it changes)
        let orthoFirst: 'h' | 'v' | null = null;   // direction of the first segment of this L (decided after a few pixels)
        let orthoSeg2: Stroke | null = null;       // second segment of the L (preview)
        let rotateDrag: { cx: number; cy: number; start: number; total: number } | null = null;

        // Vector eraser (it grows when you rub quickly)
        // `pending`: eraser positions (with their radius) not erased yet – they are processed once per frame.
        let eraseGesture: { before: Stroke[]; last: Point; lastT: number; mult: number; done: Point; pending: { p: Point; r: number }[] } | null = null;
        let eraseDirty = false;
        const freshRegion = (): BBox => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
        let eraseRegion: BBox = freshRegion();   // area to redraw after the eraser moves
        let rafPending = false;
        let cursorShown = false;

        // The page position is cached (getBoundingClientRect forces a layout).
        let rectCache: DOMRect | null = null;
        let rectVersion = -1;
        const getRect = () => {
            if (!rectCache || rectVersion !== this.layoutVersion) {
                rectCache = this.pageViews[pageIndex].container.getBoundingClientRect();
                rectVersion = this.layoutVersion;
            }
            return rectCache;
        };

        const getPointerPos = (e: PointerEvent) => {
            const rect = getRect();
            const scaleX = this.pageW(pageIndex) / rect.width;
            const scaleY = this.pageH(pageIndex) / rect.height;
            return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY, pressure: e.pointerType === 'pen' ? e.pressure : 0.5 };
        };

        const getEffectiveTool = (e: PointerEvent) => {
            if (e.pointerType === 'eraser') return 'eraser';
            if (e.pointerType === 'pen') {
                if (e.type === 'pointerdown' && e.button === 5) return 'eraser';
                if (e.type === 'pointermove' && (e.buttons & 32) !== 0) return 'eraser';
                if (this.tempTool) return this.tempTool;   // side button held (Settings: pen side button = hold)
            }
            return this.currentTool;
        };

        const getActiveWidth = (tool: string) => {
            if (tool === 'pen') return this.penSizes[this.sizeMem.pen];
            if (tool === 'shape') return this.shapeSizes[this.sizeMem.shape];
            if (tool === 'highlighter') return this.highSizes[this.sizeMem.highlighter];
            if (tool === 'eraser') return this.eraserSizes[this.sizeMem.eraser] / Math.max(0.25, this.currentZoom);
            return 3;
        }

        // Circle showing the current eraser size.
        let hoverPos: Point | null = null;
        let hoverRaf = false;
        // Mouse position for the selection-handle cursor (checked once per frame).
        let handleHover: Point | null = null;
        let handleRaf = false;
        type HandleCursor = '' | 'rotate' | 'move' | 'nwse' | 'nesw' | 'ew' | 'ns';
        let handleCursor: HandleCursor = '';
        const setHandleCursor = (c: HandleCursor) => {
            if (c === handleCursor) return;
            if (handleCursor) topCanvas.removeClass(`hw-cur-${handleCursor}`);
            if (c) topCanvas.addClass(`hw-cur-${c}`);
            handleCursor = c;
        };
        // The eraser circle is a DOM element (moved with a transform), not a drawing on the canvas: every change of a
        // large canvas costs as much as it has pixels, so moving the cursor over the canvas slowed erasing down.
        const cursorEl = this.pageViews[pageIndex].container.createDiv({ cls: 'hw-eraser-cursor' });
        cursorEl.hide();
        let curR = -1, curZ = -1;
        const drawEraserCursor = (pos: Point, _clear = true, radius?: number) => {
            const r = radius ?? getActiveWidth('eraser') / 2;
            const z = Math.max(0.1, this.currentZoom);
            if (r !== curR || z !== curZ) {
                curR = r; curZ = z;
                cursorEl.style.width = `${2 * r}px`;
                cursorEl.style.height = `${2 * r}px`;
                cursorEl.style.borderWidth = `${1.2 / z}px`;
                cursorEl.style.boxShadow = `0 0 0 ${1.6 / z}px rgba(255, 255, 255, 0.9)`;
            }
            cursorEl.style.transform = `translate(${pos.x - r}px, ${pos.y - r}px)`;
            cursorEl.show();
            cursorShown = true;
        };
        const hideEraserCursor = () => { cursorEl.hide(); };

        /**
         * Erases along the positions collected since the last frame. Positions closer together than a fraction of the
         * eraser radius are merged into one segment (each erase pass walks the strokes of the page, and the pen reports
         * several positions per frame) – the erased area stays the same.
         */
        const flushErase = () => {
            const g = eraseGesture;
            if (!g || g.pending.length === 0) return;
            const list = g.pending;
            g.pending = [];
            let from = g.done;
            let maxR = 0;
            const skipped: Point[] = [];
            for (let i = 0; i < list.length; i++) {
                const { p, r } = list[i];
                maxR = Math.max(maxR, r);
                const next = list[i + 1];
                // Merge while all skipped points lie close to the straight segment from `from` to the next point.
                if (next) {
                    const tol = maxR * 0.25;
                    if (this.distPointSeg(p, from, next.p) < tol && skipped.every(q => this.distPointSeg(q, from, next.p) < tol)) {
                        skipped.push(p);
                        continue;
                    }
                }
                if (this.eraseAt(pageIndex, from, p, maxR, eraseRegion)) eraseDirty = true;
                from = p;
                maxR = 0;
                skipped.length = 0;
            }
            g.done = from;
        };
        const scheduleEraseRedraw = () => {
            if (rafPending) return;
            rafPending = true;
            window.requestAnimationFrame(() => {
                rafPending = false;
                if (!eraseGesture) return;
                flushErase();
                // Redraw only the area the eraser changed (not the whole page).
                const reg = eraseRegion;
                eraseRegion = freshRegion();
                if (reg.x1 >= reg.x0 && reg.y1 >= reg.y0) {
                    this.repaintRegion(pageIndex, { x: reg.x0 - 1, y: reg.y0 - 1, w: reg.x1 - reg.x0 + 2, h: reg.y1 - reg.y0 + 2 });
                    this.markThumbDirty(pageIndex);
                }
                drawEraserCursor(eraseGesture.last, true, (getActiveWidth('eraser') / 2) * eraseGesture.mult);
            });
        };

        topCanvas.addEventListener('pointerdown', (e) => {
            this.posLog('pointerdown', e.pointerType, 'button', e.button, 'tool', this.currentTool, 'page', pageIndex, 'active', this.pageViews[pageIndex]?.active);
            if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;   // the right button opens the menu, it doesn't draw
            const view = this.pageViews[pageIndex];
            if (!view || !view.active) return;
            e.preventDefault();
            e.stopPropagation();
            if (!this.canEdit()) return;
            rectCache = null;

            const effectiveTool = getEffectiveTool(e);
            if (effectiveTool === 'hand') return;   // the Hand tool moves the view (navigation.ts setupMousePan)
            if (effectiveTool === 'lasso') {
                const lpos = getPointerPos(e);
                const bounds = this.selection && this.selection.page === pageIndex ? this.getSelectionBounds() : null;
                topCanvas.removeClass('hw-live-highlighter');
                if (this.splitMode && bounds) {
                    // The line that splits the selection (drawn like the lasso preview, as an SVG line).
                    splitLine = { a: lpos, b: lpos };
                    topCanvas.setPointerCapture(e.pointerId);
                    return;
                }
                if (this.splitMode) this.cancelSplitMode();   // the selection is on another page
                if (bounds) {
                    const h = this.getHandles(bounds);
                    const rotD = Math.hypot(lpos.x - h.rotate.x, lpos.y - h.rotate.y);
                    const rh = this.handleAt(bounds, lpos);
                    // The anchor is the opposite corner / edge – it stays in place.
                    const ax = rh ? (rh.sx > 0 ? bounds.x : rh.sx < 0 ? bounds.x + bounds.w : bounds.x) : 0;
                    const ay = rh ? (rh.sy > 0 ? bounds.y : rh.sy < 0 ? bounds.y + bounds.h : bounds.y) : 0;
                    if (rotD <= h.hitRadius && (!rh || rotD <= Math.hypot(lpos.x - rh.x, lpos.y - rh.y))) {
                        // Rotation handle
                        const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
                        rotateDrag = { cx, cy, start: Math.atan2(lpos.y - cy, lpos.x - cx), total: 0 };
                    } else if (rh && rh.corner) {
                        // Corner handle: resize keeping the proportions
                        scaleDrag = { sb: bounds, ax, ay, sx: rh.sx, sy: rh.sy, total: 1 };
                    } else if (rh && this.selection) {
                        // Handle in the middle of an edge: stretch only the width / height
                        const axis = rh.sx !== 0 ? 'x' : 'y';
                        stretchDrag = { sb: bounds, axis, ax, ay, sign: axis === 'x' ? rh.sx : rh.sy, total: 1, snap: this.stretchSnapshot(this.selection.strokes, this.selection.images) };
                    } else if (lpos.x >= bounds.x && lpos.x <= bounds.x + bounds.w && lpos.y >= bounds.y && lpos.y <= bounds.y + bounds.h) {
                        // Grabbing the selection: move
                        lassoDrag = { last: lpos, dx: 0, dy: 0 };
                    }
                }
                if (rotateDrag || scaleDrag || stretchDrag || lassoDrag) this.beginDragLayer(pageIndex);
                if (!rotateDrag && !scaleDrag && !stretchDrag && !lassoDrag) {
                    if (this.selection) this.clearSelection();
                    lassoPath = [lpos];
                    lassoStart = lpos;
                    lassoRect = this.plugin.settings.selectMode === 'rect';
                }
                topCanvas.setPointerCapture(e.pointerId);
                return;
            }

            if (effectiveTool === 'eraser') {
                const epos = getPointerPos(e);
                topCanvas.removeClass('hw-live-highlighter');
                eraseGesture = { before: [...this.noteData.pages[pageIndex].strokes], last: epos, lastT: e.timeStamp, mult: 1, done: epos, pending: [] };
                eraseDirty = false;
                eraseRegion = freshRegion();
                if (this.eraseAt(pageIndex, epos, epos, getActiveWidth('eraser') / 2, eraseRegion)) eraseDirty = true;
                scheduleEraseRedraw();
                topCanvas.setPointerCapture(e.pointerId);
                return;
            }

            if (effectiveTool === 'highlighter') {
                topCanvas.addClass('hw-live-highlighter');
            } else {
                topCanvas.removeClass('hw-live-highlighter');
            }

            isDrawing = true;
            const pos = getPointerPos(e);

            currentStroke = {
                points: [pos],
                color: effectiveTool === 'highlighter' ? this.highlighterColor : effectiveTool === 'shape' ? this.shapeColor : this.penColor,
                width: getActiveWidth(effectiveTool),
                isHighlighter: effectiveTool === 'highlighter'
            };
            if (effectiveTool === 'highlighter' && this.highlighterRound) currentStroke.round = true;

            // Plain pen (not semi-transparent): live stroke on the low-latency ink layer.
            if (effectiveTool === 'pen' && currentStroke.alpha === undefined && this.inkCtx && this.beginInk(pageIndex, getRect())) {
                inkOn = true;
                inkVersion = this.layoutVersion;
                this.inkRedrawActive = redrawInk;
                drawSeg(this.inkCtx, currentStroke, pos, pos);   // the dot under the pen tip right away
            }
            if (effectiveTool === 'shape') {
                currentStroke.shape = this.shapeType;
                currentStroke.dash = this.shapeDash;
                const closed = this.shapeType !== 'line';
                currentStroke.fill = this.shapeFill !== 'none' && closed;
                if (currentStroke.fill && this.shapeFill === 'light') currentStroke.fillAlpha = LIGHT_FILL_ALPHA;
                if (currentStroke.fill && this.shapeFillColor) currentStroke.fillColor = this.shapeFillColor;
                if (currentStroke.fill && this.shapeFill === 'light' && !this.shapeLineOn) currentStroke.noLine = true;
                currentStroke.arrow = this.shapeArrow && this.shapeType === 'line';
                if (this.shapeType === 'triangle' && this.shapeTriRight) currentStroke.right = true;
                orthoDown = null;
                orthoPref = null;
                orthoFirst = null;
                orthoSeg2 = null;
                if (this.shapeType === 'line' && this.shapeOrtho) {
                    // Right-angle path: the arrow goes on the last segment when the path ends.
                    currentStroke.arrow = false;
                    orthoDown = { x: e.clientX, y: e.clientY };
                    const path = this.orthoPath;
                    if (path && path.page !== pageIndex) this.endOrthoPath();
                    if (this.orthoPath) {
                        // The next L starts at the end of the previous one, by default perpendicular to its last segment.
                        currentStroke.points = [{ ...this.orthoPath.end }];
                        orthoPref = this.orthoPath.dir === 'h' ? 'v' : 'h';
                    }
                }
            }

            topCanvas.setPointerCapture(e.pointerId);
        });

        topCanvas.addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;

            // Hover (no button pressed): show or hide the eraser circle.
            if (!isDrawing && !eraseGesture && !lassoPath && !lassoDrag && !scaleDrag && !stretchDrag && !rotateDrag && !splitLine) {
                const view = this.pageViews[pageIndex];
                if (view && view.active && getEffectiveTool(e) === 'eraser') {
                    topCanvas.addClass('hw-no-cursor');
                    setHandleCursor('');   // no selection-handle cursor over the eraser circle
                    hoverPos = getPointerPos(e);
                    if (!hoverRaf) {
                        hoverRaf = true;
                        window.requestAnimationFrame(() => {
                            hoverRaf = false;
                            if (hoverPos && !eraseGesture && !isDrawing) drawEraserCursor(hoverPos);
                        });
                    }
                    return;
                }
                if (cursorShown) {
                    hoverPos = null;
                    cursorShown = false;
                    hideEraserCursor();
                    topCanvas.removeClass('hw-no-cursor');
                }
                // Mouse over a selection handle: a resize / rotate cursor (once per frame).
                if (e.pointerType === 'mouse') {
                    handleHover = getPointerPos(e);
                    if (!handleRaf) {
                        handleRaf = true;
                        window.requestAnimationFrame(() => {
                            handleRaf = false;
                            const p = handleHover;
                            let cur: HandleCursor = '';
                            const b = p && this.currentTool === 'lasso' && this.selection?.page === pageIndex ? this.getSelectionBounds() : null;
                            if (p && b) {
                                const h = this.getHandles(b);
                                const rh = this.handleAt(b, p);
                                if (Math.hypot(p.x - h.rotate.x, p.y - h.rotate.y) <= h.hitRadius && (!rh || Math.hypot(p.x - h.rotate.x, p.y - h.rotate.y) <= Math.hypot(p.x - rh.x, p.y - rh.y))) cur = 'rotate';
                                else if (rh) cur = rh.corner ? (rh.sx * rh.sy > 0 ? 'nwse' : 'nesw') : (rh.sx !== 0 ? 'ew' : 'ns');
                                else if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) cur = 'move';
                            }
                            setHandleCursor(cur);
                        });
                    }
                }
            }

            if (e.pointerType === 'pen' && e.pressure === 0) return;

            if (eraseGesture) {
                e.preventDefault();
                e.stopPropagation();
                const g = eraseGesture;
                // All positions since the last event (the pen reports them more often than events) – the erased
                // path follows a quick curve exactly; the erasing itself happens once per frame (flushErase).
                const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
                const baseR = getActiveWidth('eraser') / 2;
                for (const ev of evs.length > 0 ? evs : [e]) {
                    const epos = getPointerPos(ev);
                    // The faster you rub, the bigger the eraser (up to 4×); it returns to normal size when you slow down.
                    const dt = ev.timeStamp - g.lastT;
                    if (dt > 0) {
                        const speed = (Math.hypot(epos.x - g.last.x, epos.y - g.last.y) * this.currentZoom) / dt;   // screen pixels per ms
                        const target = 1 + Math.min(1, Math.max(0, (speed - 0.5) / 1.5)) * 3;
                        g.mult += (target - g.mult) * (target > g.mult ? 0.35 : 0.06);
                        g.lastT = ev.timeStamp;
                    }
                    g.pending.push({ p: epos, r: baseR * g.mult });
                    g.last = epos;
                }
                scheduleEraseRedraw();
                return;
            }

            if (lassoPath || lassoDrag || scaleDrag || stretchDrag || rotateDrag || splitLine) {
                e.preventDefault();
                e.stopPropagation();
                const lpos = getPointerPos(e);
                if (splitLine) {
                    const a0 = splitLine.a;
                    splitLine.b = e.shiftKey ? this.constrainShape({ points: [a0], color: '', width: 1, isHighlighter: false, shape: 'line' }, lpos) : lpos;
                    const el = ensureLassoSvg();
                    lassoSvg!.classList.remove('is-hidden');
                    el.classList.add('is-rect');
                    el.setAttribute('d', `M${a0.x.toFixed(1)} ${a0.y.toFixed(1)}L${splitLine.b.x.toFixed(1)} ${splitLine.b.y.toFixed(1)}`);
                    return;
                }
                if (lassoPath) {
                    if (lassoRect && lassoStart) {
                        const st0 = lassoStart;
                        lassoPath = [this.mkPoint(st0.x, st0.y), this.mkPoint(lpos.x, st0.y), this.mkPoint(lpos.x, lpos.y), this.mkPoint(st0.x, lpos.y)];
                    } else {
                        // Skip points too close to the previous one (the pen reports a lot of them).
                        const lp = lassoPath[lassoPath.length - 1];
                        if (Math.hypot(lpos.x - lp.x, lpos.y - lp.y) < 1.5 / Math.max(0.5, this.currentZoom)) return;
                        lassoPath.push(lpos);
                    }
                    if (!lassoRaf) { lassoRaf = true; window.requestAnimationFrame(drawLassoPreview); }
                } else if (lassoDrag && this.selection) {
                    const ld = lassoDrag;
                    scheduleDrag(() => {
                        const sel = this.selection;
                        if (!sel) return;
                        const dx = lpos.x - ld.last.x;
                        const dy = lpos.y - ld.last.y;
                        if (dx === 0 && dy === 0) return;
                        this.translateItems(sel.strokes, sel.images, dx, dy);
                        this.dragTransform(new DOMMatrix().translate(dx, dy));
                        ld.dx += dx;
                        ld.dy += dy;
                        ld.last = lpos;
                        this.redrawDragFrame(pageIndex);
                        this.showDropGhost(pageIndex);
                    });
                } else if (scaleDrag && this.selection) {
                    const sd = scaleDrag;
                    scheduleDrag(() => {
                        const sel = this.selection;
                        if (!sel) return;
                        const sb = sd.sb;
                        const target = Math.max(0.1, Math.min(10, Math.max(sd.sx * (lpos.x - sd.ax) / sb.w, sd.sy * (lpos.y - sd.ay) / sb.h)));
                        const inc = target / sd.total;
                        if (inc === 1) return;
                        this.scaleItems(sel.strokes, sel.images, sd.ax, sd.ay, inc);
                        this.dragTransform(new DOMMatrix().translate(sd.ax, sd.ay).scale(inc).translate(-sd.ax, -sd.ay));
                        sd.total = target;
                        this.redrawDragFrame(pageIndex);
                    });
                } else if (stretchDrag && this.selection) {
                    const sd = stretchDrag;
                    scheduleDrag(() => {
                        const sel = this.selection;
                        if (!sel) return;
                        const sb = sd.sb;
                        const target = sd.axis === 'x'
                            ? Math.max(0.05, Math.min(20, sd.sign * (lpos.x - sd.ax) / sb.w))
                            : Math.max(0.05, Math.min(20, sd.sign * (lpos.y - sd.ay) / sb.h));
                        const inc = target / sd.total;
                        if (inc === 1) return;
                        const kx = sd.axis === 'x' ? inc : 1, ky = sd.axis === 'y' ? inc : 1;
                        this.stretchItems(sel.strokes, sel.images, sd.ax, sd.ay, kx, ky);
                        this.dragTransform(new DOMMatrix().translate(sd.ax, sd.ay).scale(kx, ky).translate(-sd.ax, -sd.ay));
                        sd.total = target;
                        this.redrawDragFrame(pageIndex);
                    });
                } else if (rotateDrag && this.selection) {
                    const rd = rotateDrag;
                    const shift = e.shiftKey;
                    scheduleDrag(() => {
                        const sel = this.selection;
                        if (!sel) return;
                        let target = Math.atan2(lpos.y - rd.cy, lpos.x - rd.cx) - rd.start;
                        if (shift) {
                            target = Math.round(target / ROTATE_STEP) * ROTATE_STEP;   // Shift = 15° step
                            if (target !== rd.total) buzz('tick');
                        }
                        const inc = target - rd.total;
                        if (inc === 0) return;
                        this.rotateItems(sel.strokes, sel.images, rd.cx, rd.cy, inc);
                        this.dragTransform(new DOMMatrix().translate(rd.cx, rd.cy).rotate(inc * 180 / Math.PI).translate(-rd.cx, -rd.cy));
                        rd.total = target;
                        this.redrawDragFrame(pageIndex);
                    });
                }
                return;
            }

            if (!isDrawing || !currentStroke) return;
            e.preventDefault();
            e.stopPropagation();

            // Shape: only the start and end point, with a live preview. Shift = proportions / 45° angles.
            if (currentStroke.shape) {
                const pos = getPointerPos(e);
                if (orthoDown) {
                    // Right-angle path: an L from the start to the pen – the first segment horizontal or vertical, the
                    // second one perpendicular to it; moving the pen changes the length of both.
                    const p0 = currentStroke.points[0];
                    const dx = Math.abs(pos.x - p0.x), dy = Math.abs(pos.y - p0.y);
                    // The direction of the first segment follows the first movement; back near the start it can be
                    // chosen again. A continuing path prefers a turn, unless the pen clearly goes the other way.
                    if (Math.hypot(dx, dy) * this.currentZoom < 6) orthoFirst = null;
                    else if (!orthoFirst) {
                        const along = (d: 'h' | 'v') => d === 'h' ? dx : dy;
                        orthoFirst = orthoPref && along(orthoPref) * 2 >= along(orthoPref === 'h' ? 'v' : 'h') ? orthoPref : (dx >= dy ? 'h' : 'v');
                        buzz('tick');
                    }
                    const first = orthoFirst ?? orthoPref ?? (dx >= dy ? 'h' : 'v');
                    const corner = first === 'h' ? this.mkPoint(pos.x, p0.y) : this.mkPoint(p0.x, pos.y);
                    currentStroke.points = [p0, corner];
                    const seg2: Stroke = orthoSeg2 ?? { ...currentStroke };
                    seg2.points = [corner, this.mkPoint(pos.x, pos.y)];
                    orthoSeg2 = seg2;
                    const pad = currentStroke.width + 2;
                    clearLive({ x0: Math.min(p0.x, pos.x) - pad, y0: Math.min(p0.y, pos.y) - pad, x1: Math.max(p0.x, pos.x) + pad, y1: Math.max(p0.y, pos.y) + pad });
                    this.drawShape(topCtx, currentStroke);
                    this.drawShape(topCtx, seg2);
                    return;
                }
                const end = e.shiftKey ? this.constrainShape(currentStroke, pos) : pos;
                if (e.shiftKey && currentStroke.shape === 'line') {
                    const p0s = currentStroke.points[0];
                    const step = Math.round(Math.atan2(end.y - p0s.y, end.x - p0s.x) / (Math.PI / 4));
                    if (step !== snapStep) { if (snapStep !== null) buzz('tick'); snapStep = step; }
                } else snapStep = null;
                currentStroke.points = [currentStroke.points[0], end];
                // Clear only the area of the previous and the new preview (not the whole canvas).
                const p0 = currentStroke.points[0];
                const pad = currentStroke.width + (currentStroke.arrow ? Math.max(12, currentStroke.width * 5) : 2);
                const dx = currentStroke.rot ? Math.hypot(end.x - p0.x, end.y - p0.y) : 0;
                const nb: BBox = { x0: Math.min(p0.x, end.x) - pad - dx, y0: Math.min(p0.y, end.y) - pad - dx, x1: Math.max(p0.x, end.x) + pad + dx, y1: Math.max(p0.y, end.y) + pad + dx };
                clearLive(nb);
                this.drawShape(topCtx, currentStroke);
                return;
            }

            // The view moved during the stroke (e.g. a finger gesture): the ink layer follows the page.
            if (inkOn && inkVersion !== this.layoutVersion) {
                inkVersion = this.layoutVersion;
                this.clearInkNow();
                if (this.beginInk(pageIndex, getRect())) redrawInk(); else stopInk();
            }
            const liveCtx = inkOn && this.inkCtx ? this.inkCtx : topCtx;

            // All events collected between frames (the pen reports them more often than frames).
            const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
            const list: PointerEvent[] = events.length > 0 ? events : [e];
            for (const ev of list) {
                const pos = getPointerPos(ev);
                const pts = currentStroke.points;
                const p1 = pts[pts.length - 1];
                // Pen pressure (smoothed). The highlighter has a constant width.
                const usePressure = ev.pointerType === 'pen' && !currentStroke.isHighlighter;
                if (usePressure) pos.pressure = Math.max(0.02, p1.pressure * 0.6 + pos.pressure * 0.4);
                pts.push(pos);

                // Highlighter and semi-transparent pen are drawn whole once per frame (segments would overlap and darken).
                if (currentStroke.isHighlighter || currentStroke.alpha !== undefined) continue;
                drawSeg(liveCtx, currentStroke, p1, pos);
            }
            if ((currentStroke.isHighlighter || currentStroke.alpha !== undefined) && !liveRaf) {
                // Highlighter: one redraw per frame, clearing only its area.
                liveRaf = true;
                window.requestAnimationFrame(() => {
                    liveRaf = false;
                    const st = currentStroke;
                    if (!st || (!st.isHighlighter && st.alpha === undefined)) return;
                    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
                    for (const p of st.points) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
                    const pad = st.width;
                    clearLive({ x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad });
                    this.drawSmoothStroke(topCtx, st);
                });
            }
        });

        const endPointer = (e: PointerEvent) => {
            if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;
            liveBox = null;

            if (eraseGesture) {
                const g = eraseGesture;
                // The last positions (not erased yet) and their redraw – the page is up to date without a full redraw
                // (a full redraw of a large canvas at high zoom made the end of every eraser stroke stutter).
                flushErase();
                eraseGesture = null;
                const reg = eraseRegion;
                eraseRegion = freshRegion();
                if (reg.x1 >= reg.x0 && reg.y1 >= reg.y0) this.repaintRegion(pageIndex, { x: reg.x0 - 1, y: reg.y0 - 1, w: reg.x1 - reg.x0 + 2, h: reg.y1 - reg.y0 + 2 });
                if (eraseDirty) {
                    eraseDirty = false;
                    this.pushHistoryAction({
                        type: 'replace',
                        page: pageIndex,
                        before: g.before,
                        after: [...this.noteData.pages[pageIndex].strokes]
                    });
                    this.requestSave();
                    this.markThumbDirty(pageIndex);
                    // The selection frame (top layer) may include erased strokes.
                    if (this.selection?.page === pageIndex) this.redrawOverlay(pageIndex);
                }
                drawEraserCursor(g.last, false);
                if (topCanvas.hasPointerCapture(e.pointerId)) topCanvas.releasePointerCapture(e.pointerId);
                return;
            }

            if (splitLine) {
                const ln = splitLine;
                splitLine = null;
                hideLasso();
                if (lassoEl) lassoEl.classList.remove('is-rect');
                this.cancelSplitMode();
                if (Math.hypot(ln.b.x - ln.a.x, ln.b.y - ln.a.y) * this.currentZoom > 6) this.splitSelection(ln.a, ln.b);
                else this.redrawOverlay(pageIndex);
                if (topCanvas.hasPointerCapture(e.pointerId)) topCanvas.releasePointerCapture(e.pointerId);
                return;
            }
            if (lassoPath) {
                const path = lassoPath;
                lassoPath = null;
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const p of path) {
                    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
                }
                hideLasso();
                if (path.length >= 3 && Math.max(maxX - minX, maxY - minY) > 6) this.selectInPolygon(pageIndex, this.simplifyPoints(path, 0.8));
                else this.selectAt(pageIndex, path[0]);   // a plain tap: a stroke or an image (with its whole group)
                if (this.selection) buzz('confirm');
                this.redrawOverlay(pageIndex);   // the strokes didn't change – only the selection frame
                if (topCanvas.hasPointerCapture(e.pointerId)) topCanvas.releasePointerCapture(e.pointerId);
                return;
            }
            if (lassoDrag || scaleDrag || stretchDrag || rotateDrag) flushDrag();   // last move before finishing
            if (lassoDrag) {
                const drag = lassoDrag;
                lassoDrag = null;
                this.endDragLayer(pageIndex);
                if (this.selection && (drag.dx !== 0 || drag.dy !== 0)) {
                    this.clearGhost();
                    // Dropped on another page: one undo step (move + transfer together); otherwise a plain move.
                    if (!this.transferSelectionIfNeeded(pageIndex, { dx: drag.dx, dy: drag.dy })) {
                        this.pushHistoryAction({ type: 'move', page: pageIndex, strokes: [...this.selection.strokes], images: [...this.selection.images], dx: drag.dx, dy: drag.dy });
                    }
                    this.requestSave();
                }
                this.clearGhost();
                if (topCanvas.hasPointerCapture(e.pointerId)) topCanvas.releasePointerCapture(e.pointerId);
                return;
            }
            if (scaleDrag) {
                const drag = scaleDrag;
                scaleDrag = null;
                this.endDragLayer(pageIndex);
                if (this.selection && Math.abs(drag.total - 1) > 0.001) {
                    this.pushHistoryAction({ type: 'scale', page: pageIndex, strokes: [...this.selection.strokes], images: [...this.selection.images], ax: drag.ax, ay: drag.ay, k: drag.total });
                    this.requestSave();
                }
                if (topCanvas.hasPointerCapture(e.pointerId)) topCanvas.releasePointerCapture(e.pointerId);
                return;
            }
            if (stretchDrag) {
                const drag = stretchDrag;
                stretchDrag = null;
                this.endDragLayer(pageIndex);
                if (this.selection && Math.abs(drag.total - 1) > 0.001) this.commitStretch(pageIndex, drag.snap);
                if (topCanvas.hasPointerCapture(e.pointerId)) topCanvas.releasePointerCapture(e.pointerId);
                return;
            }
            if (rotateDrag) {
                const drag = rotateDrag;
                rotateDrag = null;
                this.endDragLayer(pageIndex);
                if (this.selection && Math.abs(drag.total) > 0.0005) {
                    this.pushHistoryAction({ type: 'rotate', page: pageIndex, strokes: [...this.selection.strokes], images: [...this.selection.images], cx: drag.cx, cy: drag.cy, angle: drag.total });
                    this.requestSave();
                }
                if (topCanvas.hasPointerCapture(e.pointerId)) topCanvas.releasePointerCapture(e.pointerId);
                return;
            }

            if (!isDrawing || !currentStroke) { stopInk(); return; }
            isDrawing = false;

            if (currentStroke.shape) this.posLog('shape end', e.type, 'points', currentStroke.points.length);
            // Right-angle path: a tap (no real movement) ends the path; otherwise the L (one or two segments) joins it.
            if (orthoDown && currentStroke.shape === 'line') {
                const moved = Math.hypot(e.clientX - orthoDown.x, e.clientY - orthoDown.y);
                const segs = [currentStroke, orthoSeg2].filter((s): s is Stroke => {
                    if (!s || s.points.length < 2) return false;
                    const a = s.points[0], b = s.points[s.points.length - 1];
                    return Math.hypot(b.x - a.x, b.y - a.y) * this.currentZoom >= 4;   // a segment of ~zero length is dropped
                });
                orthoDown = null;
                orthoSeg2 = null;
                orthoFirst = null;
                topCtx.clearRect(0, 0, this.pageW(pageIndex), this.pageH(pageIndex));
                currentStroke = null;
                if (moved < 6 || segs.length === 0) {
                    this.redrawOverlay(pageIndex);
                    this.endOrthoPath();
                    if (topCanvas.hasPointerCapture(e.pointerId)) topCanvas.releasePointerCapture(e.pointerId);
                    return;
                }
                const g = this.orthoPath?.g ?? newId();
                const page = this.noteData.pages[pageIndex];
                for (const s of segs) {
                    s.g = g;
                    page.strokes.push(s);
                    this.drawSmoothStroke(bottomCtx, s);
                }
                // One undo step for the whole L.
                if (segs.length === 1) this.pushHistory(pageIndex, segs[0]);
                else this.pushHistoryAction({ type: 'paste', page: pageIndex, strokes: [...segs], images: [] });
                const last = segs[segs.length - 1];
                const a = last.points[0], b = last.points[last.points.length - 1];
                const dir: 'h' | 'v' = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 'h' : 'v';
                this.orthoPath = { page: pageIndex, g, end: { ...b }, dir, last, arrow: this.shapeArrow };
                this.placeOrthoMarker();
                this.redrawOverlay(pageIndex);
                this.markThumbDirty(pageIndex);
                this.requestSave();
                if (topCanvas.hasPointerCapture(e.pointerId)) topCanvas.releasePointerCapture(e.pointerId);
                return;
            }
            orthoDown = null;
            // A shape without dragging (just a tap) is skipped.
            if (currentStroke.shape && currentStroke.points.length < 2) {
                topCtx.clearRect(0, 0, this.pageW(pageIndex), this.pageH(pageIndex));
                currentStroke = null;
                if (topCanvas.hasPointerCapture(e.pointerId)) topCanvas.releasePointerCapture(e.pointerId);
                return;
            }

            // Handwritten strokes are simplified: smaller files and faster redraws.
            // Area of the live preview (raw points) – after finishing only this area is cleared, not the whole canvas.
            let rx0 = Infinity, ry0 = Infinity, rx1 = -Infinity, ry1 = -Infinity;
            for (const p of currentStroke.points) { if (p.x < rx0) rx0 = p.x; if (p.x > rx1) rx1 = p.x; if (p.y < ry0) ry0 = p.y; if (p.y > ry1) ry1 = p.y; }
            const rpad = currentStroke.width * 2 + 2 + (currentStroke.arrow ? Math.max(12, currentStroke.width * 5) : 0);
            // Highlighter: hook trimming and smoothing; pen: removing pen jitter. Then simplification (smaller file).
            if (currentStroke.isHighlighter) currentStroke.points = this.cleanHighlighter(currentStroke.points, currentStroke.width);
            else if (!currentStroke.shape) currentStroke.points = this.simplifyPoints(this.smoothInkPoints(currentStroke.points, this.currentZoom), SIMPLIFY_EPSILON / Math.max(1, this.currentZoom));

            this.noteData.pages[pageIndex].strokes.push(currentStroke);
            this.pushHistory(pageIndex, currentStroke);

            topCtx.clearRect(rx0 - rpad, ry0 - rpad, rx1 - rx0 + 2 * rpad, ry1 - ry0 + 2 * rpad);
            topCanvas.removeClass('hw-live-highlighter');

            const view = this.pageViews[pageIndex];
            if (currentStroke.isHighlighter && view && !view.highAllocated) {
                // First highlighter on the page: the layer gets its full size and the page is redrawn.
                this.sizeCanvases(pageIndex);
                this.redrawPage(pageIndex);
            } else if (currentStroke.isHighlighter) {
                this.drawSmoothStroke(highCtx, currentStroke);
            } else {
                this.drawSmoothStroke(bottomCtx, currentStroke);
            }

            currentStroke = null;
            stopInk();   // the stroke is on the page canvas now – the ink layer is cleared shortly
            this.markThumbDirty(pageIndex);
            this.requestSave();

            if (topCanvas.hasPointerCapture(e.pointerId)) topCanvas.releasePointerCapture(e.pointerId);
        };

        topCanvas.addEventListener('pointerup', endPointer);
        topCanvas.addEventListener('pointercancel', endPointer);
        topCanvas.addEventListener('pointerout', endPointer);
        topCanvas.addEventListener('pointerleave', endPointer);
        topCanvas.addEventListener('pointerleave', () => {
            hoverPos = null;
            if (cursorShown && !eraseGesture) {
                cursorShown = false;
                hideEraserCursor();
                topCanvas.removeClass('hw-no-cursor');
            }
        });
    },
});
export type InputMethods = typeof inputMixin;
