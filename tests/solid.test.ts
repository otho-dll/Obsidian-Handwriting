import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSolid } from '../src/solid/shapes';
import { drawSolid } from '../src/solid/hiddenLines';
import { orthoView, VIEW_ANGLES } from '../src/solid/projection';
import { linesBox, renderSolid } from '../src/solid/render';
import { newSolidSpec, SOLIDS, type SolidSpec } from '../src/solid/types';
import type { Polyline } from '../src/circuit/font';

const len = (l: Polyline) => { let L = 0; for (let i = 1; i < l.length; i++) L += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); return L; };
const total = (ls: Polyline[]) => ls.reduce((s, l) => s + len(l), 0);
const spec = (over: Partial<SolidSpec>): SolidSpec => ({ ...newSolidSpec(), ...over });

test('cube in isometric view: 9 visible and 3 hidden edges', () => {
    const r = renderSolid(spec({ kind: 'cube', params: { cube: { a: 60 } }, projection: 'iso', hidden: 'dashed', axes: false }));
    assert.equal(r.visible.length, 9);
    assert.equal(r.hidden.length, 3);
    // every edge is 60 · √(2/3) ≈ 48.99 long in an isometric view
    for (const l of [...r.visible, ...r.hidden]) assert.ok(Math.abs(len(l) - 60 * Math.sqrt(2 / 3)) < 1, `edge length ${len(l)}`);
});

test('sphere seen from the front: the outline is a circle of radius r, nothing hidden', () => {
    const r = renderSolid(spec({ kind: 'sphere', params: { sphere: { r: 40 } }, projection: 'views', hidden: 'hide', axes: false }));
    // the three views of a sphere are three circles; check the front one (around the origin)
    const front = r.visible.filter(l => l.every(([x, y]) => Math.hypot(x, y) < 45));
    assert.ok(front.length >= 1);
    for (const l of front) for (const [x, y] of l) assert.ok(Math.abs(Math.hypot(x, y) - 40) < 0.4, `radius ${Math.hypot(x, y)}`);
    assert.ok(Math.abs(total(front) - 2 * Math.PI * 40) < 2 * Math.PI * 40 * 0.01);
    assert.equal(r.hidden.length, 0);
});

test('cylinder from the side, a little from above: both outlines visible, back of the bottom circle hidden', () => {
    const g = buildSolid('cylinder', { r: 30, h: 80 });
    const r = drawSolid(g, orthoView(0, 20), { hidden: 'dashed', axes: false });
    // two vertical outlines at x = ±30
    const sides = r.visible.filter(l => l.every(([x]) => Math.abs(Math.abs(x) - 30) < 0.5) && len(l) > 50);
    assert.equal(sides.length, 2);
    // hidden: the back half of the bottom circle – on the screen half an ellipse with semi-axes 30 and 30·sin 20°
    assert.ok(r.hidden.length >= 1);
    const hb = linesBox(r.hidden);
    assert.ok(hb.x1 - hb.x0 > 58, 'the hidden arc spans the whole width');
    const a = 30, b = 30 * Math.sin(20 * Math.PI / 180);
    const half = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b))) / 2;   // Ramanujan
    assert.ok(Math.abs(total(r.hidden) - half) / half < 0.05, `hidden length ${total(r.hidden)} vs ${half}`);
});

test('torus from above: two circles R ± r', () => {
    const g = buildSolid('torus', { R: 40, r: 14 });
    const r = drawSolid(g, orthoView(VIEW_ANGLES.top.yaw, VIEW_ANGLES.top.pitch), { hidden: 'dashed', axes: false });
    const radii = r.visible.flatMap(l => l.map(([x, y]) => Math.hypot(x, y)));
    assert.ok(radii.every(q => Math.abs(q - 54) < 0.6 || Math.abs(q - 26) < 0.6), 'all points on R + r or R − r');
    assert.ok(radii.some(q => Math.abs(q - 54) < 0.6) && radii.some(q => Math.abs(q - 26) < 0.6));
    assert.equal(r.hidden.length, 0);
});

test('three views do not overlap', () => {
    for (const layout of ['E', 'A'] as const) {
        const r = renderSolid(spec({ kind: 'box', params: { box: { a: 80, b: 50, c: 40 } }, projection: 'views', layout, axes: false }));
        // group the polylines by their centre: the front view is around the origin (80 × 40), the side view on the right
        const cs = r.visible.map(l => { const b = linesBox([l]); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; });
        const isSide = (i: number) => cs[i][0] > 50, isFront = (i: number) => !isSide(i) && Math.abs(cs[i][1]) <= 21;
        const front = r.visible.filter((_, i) => isFront(i));
        const top = r.visible.filter((_, i) => !isSide(i) && !isFront(i));
        const sideV = r.visible.filter((_, i) => isSide(i));
        // a box in a front view: 4 lines (the back edges lie on the front ones and are not drawn twice)
        assert.equal(front.length, 4);
        const boxes = [front, top, sideV].map(ls => linesBox(ls));
        for (const b of boxes) assert.ok(isFinite(b.x0), 'every view has lines');
        const overlap = (a: typeof boxes[0], b: typeof boxes[0]) => a.x0 < b.x1 - 1e-6 && b.x0 < a.x1 - 1e-6 && a.y0 < b.y1 - 1e-6 && b.y0 < a.y1 - 1e-6;
        assert.ok(!overlap(boxes[0], boxes[1]) && !overlap(boxes[0], boxes[2]) && !overlap(boxes[1], boxes[2]));
        // first angle: the top view is below the front view (y down); third angle: above
        if (layout === 'E') assert.ok(boxes[1].y0 > boxes[0].y1); else assert.ok(boxes[1].y1 < boxes[0].y0);
        // front view of the box: 80 × 40
        assert.ok(Math.abs(boxes[0].x1 - boxes[0].x0 - 80) < 0.5 && Math.abs(boxes[0].y1 - boxes[0].y0 - 40) < 0.5);
    }
});

test('every solid and view draws something', () => {
    for (const s of SOLIDS) for (const projection of ['iso', 'dimetric', 'cavalier', 'cabinet', 'perspective', 'views', 'free'] as const) {
        const r = renderSolid(spec({ kind: s.kind, projection }), 256);
        assert.ok(r.visible.length > 0, `${s.kind} ${projection}`);
        for (const l of [...r.visible, ...r.hidden, ...r.axes]) for (const [x, y] of l) assert.ok(Number.isFinite(x) && Number.isFinite(y), `${s.kind} ${projection}: finite`);
    }
});
