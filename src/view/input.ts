import { defineMixin } from './mixin';
import { SIMPLIFY_EPSILON, ROTATE_STEP } from '../constants';
import { Point, Stroke, Bounds, BBox } from '../types';

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
            lassoSvg = document.createElementNS(NS, 'svg');
            lassoSvg.setAttribute('class', 'hw-lasso-svg');
            lassoSvg.setAttribute('viewBox', `0 0 ${this.pageW(pageIndex)} ${this.pageH(pageIndex)}`);
            lassoSvg.setAttribute('preserveAspectRatio', 'none');
            lassoEl = document.createElementNS(NS, 'path');
            lassoSvg.appendChild(lassoEl);
            this.pageViews[pageIndex].container.appendChild(lassoSvg);
            return lassoEl;
        };
        const hideLasso = () => { if (lassoEl) lassoEl.setAttribute('d', ''); if (lassoSvg) lassoSvg.style.display = 'none'; };
        const drawLassoPreview = () => {
            lassoRaf = false;
            if (!lassoPath || lassoPath.length === 0) return;
            const el = ensureLassoSvg();
            lassoSvg!.style.display = '';
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
            if (!dragRaf) dragRaf = requestAnimationFrame(runDragFrame);
        };
        const flushDrag = () => {
            if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
            runDragFrame();
        };
        let scaleDrag: { sb: Bounds; total: number } | null = null;
        let rotateDrag: { cx: number; cy: number; start: number; total: number } | null = null;

        // Vector eraser (it grows when you rub quickly)
        let eraseGesture: { before: Stroke[]; last: Point; lastT: number; mult: number } | null = null;
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
        // The eraser circle is a DOM element (moved with a transform), not a drawing on the canvas: every change of a
        // large canvas costs as much as it has pixels, so moving the cursor over the canvas slowed erasing down.
        const cursorEl = this.pageViews[pageIndex].container.createEl('div', { cls: 'hw-eraser-cursor' });
        cursorEl.style.display = 'none';
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
            cursorEl.style.display = 'block';
            cursorShown = true;
        };
        const hideEraserCursor = () => { cursorEl.style.display = 'none'; };

        const scheduleEraseRedraw = () => {
            if (rafPending) return;
            rafPending = true;
            requestAnimationFrame(() => {
                rafPending = false;
                if (!eraseGesture) return;
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
            if (effectiveTool === 'lasso') {
                const lpos = getPointerPos(e);
                const bounds = this.selection && this.selection.page === pageIndex ? this.getSelectionBounds() : null;
                topCanvas.style.opacity = '1';
                if (bounds) {
                    const h = this.getHandles(bounds);
                    if (Math.hypot(lpos.x - h.rotate.x, lpos.y - h.rotate.y) <= h.hitRadius) {
                        // Rotation handle
                        const cx = bounds.x + bounds.w / 2, cy = bounds.y + bounds.h / 2;
                        rotateDrag = { cx, cy, start: Math.atan2(lpos.y - cy, lpos.x - cx), total: 0 };
                    } else if (Math.hypot(lpos.x - h.resize.x, lpos.y - h.resize.y) <= h.hitRadius) {
                        // Handle in the bottom-right corner: resize
                        scaleDrag = { sb: bounds, total: 1 };
                    } else if (lpos.x >= bounds.x && lpos.x <= bounds.x + bounds.w && lpos.y >= bounds.y && lpos.y <= bounds.y + bounds.h) {
                        // Grabbing the selection: move
                        lassoDrag = { last: lpos, dx: 0, dy: 0 };
                    }
                }
                if (rotateDrag || scaleDrag || lassoDrag) this.beginDragLayer(pageIndex);
                if (!rotateDrag && !scaleDrag && !lassoDrag) {
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
                topCanvas.style.opacity = '1';
                eraseGesture = { before: [...this.noteData.pages[pageIndex].strokes], last: epos, lastT: e.timeStamp, mult: 1 };
                eraseDirty = false;
                eraseRegion = freshRegion();
                if (this.eraseAt(pageIndex, epos, epos, getActiveWidth('eraser') / 2, eraseRegion)) eraseDirty = true;
                scheduleEraseRedraw();
                topCanvas.setPointerCapture(e.pointerId);
                return;
            }

            if (effectiveTool === 'highlighter') {
                topCanvas.style.opacity = '0.4';
            } else {
                topCanvas.style.opacity = '1';
            }

            isDrawing = true;
            const pos = getPointerPos(e);

            currentStroke = {
                points: [pos],
                color: effectiveTool === 'highlighter' ? this.highlighterColor : effectiveTool === 'shape' ? this.shapeColor : this.penColor,
                width: getActiveWidth(effectiveTool),
                isHighlighter: effectiveTool === 'highlighter'
            };

            if (effectiveTool === 'pen' && this.penAlpha < 1) currentStroke.alpha = this.penAlpha;
            if (effectiveTool === 'shape') {
                currentStroke.shape = this.shapeType;
                currentStroke.dash = this.shapeDash;
                currentStroke.fill = this.shapeFill && this.shapeType !== 'line';
                currentStroke.arrow = this.shapeArrow && this.shapeType === 'line';
            }

            topCanvas.setPointerCapture(e.pointerId);
        });

        topCanvas.addEventListener('pointermove', (e) => {
            if (e.pointerType !== 'pen' && e.pointerType !== 'mouse') return;

            // Hover (no button pressed): show or hide the eraser circle.
            if (!isDrawing && !eraseGesture && !lassoPath && !lassoDrag && !scaleDrag && !rotateDrag) {
                const view = this.pageViews[pageIndex];
                if (view && view.active && getEffectiveTool(e) === 'eraser') {
                    topCanvas.style.cursor = 'none';
                    hoverPos = getPointerPos(e);
                    if (!hoverRaf) {
                        hoverRaf = true;
                        requestAnimationFrame(() => {
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
                    topCanvas.style.cursor = '';
                }
            }

            if (e.pointerType === 'pen' && e.pressure === 0) return;

            if (eraseGesture) {
                e.preventDefault();
                e.stopPropagation();
                const g = eraseGesture;
                const epos = getPointerPos(e);
                // The faster you rub, the bigger the eraser (up to 4×); it returns to normal size when you slow down.
                const dt = e.timeStamp - g.lastT;
                if (dt > 0) {
                    const speed = (Math.hypot(epos.x - g.last.x, epos.y - g.last.y) * this.currentZoom) / dt;   // screen pixels per ms
                    const target = 1 + Math.min(1, Math.max(0, (speed - 0.5) / 1.5)) * 3;
                    g.mult += (target - g.mult) * (target > g.mult ? 0.35 : 0.06);
                }
                g.lastT = e.timeStamp;
                const radius = (getActiveWidth('eraser') / 2) * g.mult;
                if (this.eraseAt(pageIndex, g.last, epos, radius, eraseRegion)) eraseDirty = true;
                g.last = epos;
                scheduleEraseRedraw();
                return;
            }

            if (lassoPath || lassoDrag || scaleDrag || rotateDrag) {
                e.preventDefault();
                e.stopPropagation();
                const lpos = getPointerPos(e);
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
                    if (!lassoRaf) { lassoRaf = true; requestAnimationFrame(drawLassoPreview); }
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
                        const target = Math.max(0.1, Math.min(10, Math.max((lpos.x - sb.x) / sb.w, (lpos.y - sb.y) / sb.h)));
                        const inc = target / sd.total;
                        if (inc === 1) return;
                        this.scaleItems(sel.strokes, sel.images, sb.x, sb.y, inc);
                        this.dragTransform(new DOMMatrix().translate(sb.x, sb.y).scale(inc).translate(-sb.x, -sb.y));
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
                        if (shift) target = Math.round(target / ROTATE_STEP) * ROTATE_STEP;   // Shift = 15° step
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
                const end = e.shiftKey ? this.constrainShape(currentStroke, pos) : pos;
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
                topCtx.globalCompositeOperation = 'source-over';
                topCtx.strokeStyle = currentStroke.color;
                topCtx.lineWidth = usePressure ? currentStroke.width * this.pressureFactor((p1.pressure + pos.pressure) / 2) : currentStroke.width;
                topCtx.lineCap = 'round';
                topCtx.lineJoin = 'round';
                topCtx.beginPath();
                topCtx.moveTo(p1.x, p1.y);
                topCtx.lineTo(pos.x, pos.y);
                topCtx.stroke();
            }
            if ((currentStroke.isHighlighter || currentStroke.alpha !== undefined) && !liveRaf) {
                // Highlighter: one redraw per frame, clearing only its area.
                liveRaf = true;
                requestAnimationFrame(() => {
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
                eraseGesture = null;
                if (eraseDirty) {
                    eraseDirty = false;
                    this.pushHistoryAction({
                        type: 'replace',
                        page: pageIndex,
                        before: g.before,
                        after: [...this.noteData.pages[pageIndex].strokes]
                    });
                    this.requestSave();
                }
                this.redrawPage(pageIndex);
                drawEraserCursor(g.last, false);
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
                this.redrawOverlay(pageIndex);   // the strokes didn't change – only the selection frame
                if (topCanvas.hasPointerCapture(e.pointerId)) topCanvas.releasePointerCapture(e.pointerId);
                return;
            }
            if (lassoDrag || scaleDrag || rotateDrag) flushDrag();   // last move before finishing
            if (lassoDrag) {
                const drag = lassoDrag;
                lassoDrag = null;
                this.endDragLayer(pageIndex);
                if (this.selection && (drag.dx !== 0 || drag.dy !== 0)) {
                    this.pushHistoryAction({ type: 'move', page: pageIndex, strokes: [...this.selection.strokes], images: [...this.selection.images], dx: drag.dx, dy: drag.dy });
                    this.clearGhost();
                    this.transferSelectionIfNeeded(pageIndex);
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
                    this.pushHistoryAction({ type: 'scale', page: pageIndex, strokes: [...this.selection.strokes], images: [...this.selection.images], ax: drag.sb.x, ay: drag.sb.y, k: drag.total });
                    this.requestSave();
                }
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

            if (!isDrawing || !currentStroke) return;
            isDrawing = false;

            if (currentStroke.shape) this.posLog('shape end', e.type, 'points', currentStroke.points.length);
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
            topCanvas.style.opacity = '1';

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
                topCanvas.style.cursor = '';
            }
        });
    },
});
export type InputMethods = typeof inputMixin;
