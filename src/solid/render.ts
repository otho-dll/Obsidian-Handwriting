import type { Polyline } from '../circuit/font';
import { buildSolid, type SolidGeom } from './shapes';
import { drawSolid, geomSize, type SolidLines } from './hiddenLines';
import { orthoView, projector, VIEW_ANGLES } from './projection';
import { solidParams, type SolidSpec } from './types';

export type { SolidLines } from './hiddenLines';

/** Bounding box of polylines. */
export function linesBox(ls: Polyline[]): { x0: number; y0: number; x1: number; y1: number } {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of ls) for (const [x, y] of l) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x0, y0, x1, y1 };
}
const shift = (ls: Polyline[], dx: number, dy: number): Polyline[] => ls.map(l => l.map(([x, y]) => [x + dx, y + dy] as [number, number]));
const allLines = (s: SolidLines) => [...s.visible, ...s.hidden, ...s.axes];

/**
 * Three views (front, top, side) side by side. First angle (E): the top view below the front view and the view from
 * the left on its right. Third angle (A): the top view above, the view from the right on the right.
 */
function threeViews(g: SolidGeom, spec: SolidSpec, res: number): SolidLines {
    const opts = { hidden: spec.hidden, axes: spec.axes, res };
    const side = spec.layout === 'E' ? VIEW_ANGLES.left : VIEW_ANGLES.right;
    const views = [VIEW_ANGLES.front, VIEW_ANGLES.top, side].map(a => drawSolid(g, orthoView(a.yaw, a.pitch), opts));
    // the solid's own outline (without the centre lines) places the views; the centre lines may stick out
    const box = views.map(v => linesBox([...v.visible, ...v.hidden]));
    const gap = 0.3 * Math.max(...box.map(b => Math.max(b.x1 - b.x0, b.y1 - b.y0)));
    const [F, T, S] = box;
    // all three views share the centre of the solid: x of front = x of top, y of front = y of side
    const offs: [number, number][] = [
        [0, 0],
        [0, spec.layout === 'E' ? (F.y1 - T.y0) + gap : (F.y0 - T.y1) - gap],
        [(F.x1 - S.x0) + gap, 0],
    ];
    const out: SolidLines = { visible: [], hidden: [], axes: [] };
    views.forEach((v, i) => {
        const [dx, dy] = offs[i];
        out.visible.push(...shift(v.visible, dx, dy));
        out.hidden.push(...shift(v.hidden, dx, dy));
        out.axes.push(...shift(v.axes, dx, dy));
    });
    return out;
}

/** The drawing of the solid described by `spec`, in model units (y down). */
export function renderSolid(spec: SolidSpec, res = 1024): SolidLines {
    const g = buildSolid(spec.kind, solidParams(spec));
    if (spec.projection === 'views') return threeViews(g, spec, res);
    const proj = projector(spec.projection, spec.yaw, spec.pitch, spec.persp, geomSize(g));
    return drawSolid(g, proj, { hidden: spec.hidden, axes: spec.axes, res });
}

/** Everything drawn, for the size and placing. */
export function solidBox(s: SolidLines) { return linesBox(allLines(s)); }
