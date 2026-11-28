import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutText, displayLabel } from '../src/circuit/font';
import { circuitToPolylines, edgeById, edgeGeom, nodeById } from '../src/circuit/geometry';
import {
    addEdge, addNode, addWire, arrowDir, changeType, deleteEdges, deleteElement, emptyCircuit, findEl, groupOrigin, insertElement,
    lassoEdges, moveGroup, parallel, rayHitEdge, resolveEnd, settleGroup, splitEdge, startSquare,
} from '../src/circuit/ops';
import { dropDegenerate, polyLength, resample } from '../src/circuit/resample';
import type { Circuit } from '../src/circuit/types';

const edgeBetween = (c: Circuit, a: string, b: string) => c.edges.find(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));

test('split moves elements to the correct halves', () => {
    const c = emptyCircuit();
    const a = addNode(c, 0, 0), b = addNode(c, 400, 0);
    const e = addEdge(c, a, b);
    const r1 = insertElement(c, e.id, 0, 'R', true)!;          // centre at 133
    const r2 = insertElement(c, e.id, 1, 'C', true)!;          // centre at 267
    const m = splitEdge(c, e.id, 200, 0);
    const left = edgeBetween(c, a, m)!, right = edgeBetween(c, m, b)!;
    assert.deepEqual(left.els.map(x => x.id), [r1.id]);
    assert.deepEqual(right.els.map(x => x.id), [r2.id]);
    assert.equal(c.edges.length, 2);
});

test('parallel branch in a ladder splits the rails without new connectors', () => {
    const c = emptyCircuit();
    const a = addNode(c, 100, 500), b = addNode(c, 100, 100), d = addNode(c, 500, 500), f = addNode(c, 500, 100);
    const left = addEdge(c, a, b);
    addEdge(c, a, d); addEdge(c, b, f); addEdge(c, d, f);     // rails a→d (bottom), b→f (top)
    const nodesBefore = c.nodes.length, edgesBefore = c.edges.length;
    const ne = parallel(c, left.id)!;
    assert.ok(ne);
    // 2 split nodes, rails split (+2 branches) and the new branch (+1)
    assert.equal(c.nodes.length, nodesBefore + 2);
    assert.equal(c.edges.length, edgesBefore + 3);
    const A = nodeById(c, ne.a)!, B = nodeById(c, ne.b)!;
    assert.equal(A.x, B.x);                       // vertical, like the original
    assert.ok(A.x > 100 && A.x < 500);
    assert.equal(A.x % 20, 0);
});

test('parallel branch of a diagonal is exactly parallel', () => {
    const c = emptyCircuit();
    const a = addNode(c, 300, 200), b = addNode(c, 660, 480);
    const e = addEdge(c, a, b);
    const ne = parallel(c, e.id)!;
    assert.ok(ne);
    const g0 = edgeGeom(c, e), g1 = edgeGeom(c, ne);
    const cross = g0.d.x * g1.d.y - g0.d.y * g1.d.x;
    assert.ok(Math.abs(cross) < 1e-9, 'directions are parallel');
    // connectors are perpendicular to the branch
    for (const conn of c.edges.filter(x => x !== e && x !== ne)) {
        const g = edgeGeom(c, conn);
        assert.ok(Math.abs(g.d.x * g0.d.x + g.d.y * g0.d.y) < 1e-9);
    }
});

test('parallel branch stays inside the visible sheet bounds', () => {
    // a lone vertical branch at the right edge of the default sheet: the new branch goes to the left
    const c1 = emptyCircuit();
    const e1 = addEdge(c1, addNode(c1, 870, 200), addNode(c1, 870, 400));
    const n1 = parallel(c1, e1.id)!;
    assert.ok(n1 && nodeById(c1, n1.a)!.x < 870);
    // a view barely wider than the branch: no room on either side
    const c2 = emptyCircuit();
    const e2 = addEdge(c2, addNode(c2, 300, 200), addNode(c2, 300, 400));
    assert.equal(parallel(c2, e2.id, { x0: 280, y0: 180, x1: 320, y1: 420 }), null);
});

test('resample gives segments no longer than the step', () => {
    const pl = resample([[0, 0], [100, 0], [100, 37.5], [3, 3]], 3);
    for (let i = 1; i < pl.length; i++) assert.ok(Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]) <= 3 + 1e-9);
    assert.deepEqual(pl[0], [0, 0]);
    assert.deepEqual(pl[pl.length - 1], [3, 3]);
});

test('no zero-length polylines in a full circuit', () => {
    const c = startSquare();
    for (const [i, t] of (['R', 'L', 'C', 'E', 'J', 'U', 'I', 'A', 'V'] as const).entries()) insertElement(c, c.edges[i % 4].id, 0, t, true);
    const pls = dropDegenerate(circuitToPolylines(c, { dots: true }));
    assert.ok(pls.length > 20);
    for (const p of pls) assert.ok(p.length >= 2 && polyLength(p) > 0);
    assert.equal(dropDegenerate([[[1, 1], [1, 1]], [[0, 0]]]).length, 0);
});

test('auto numbering', () => {
    const c = startSquare();
    const e = c.edges[0].id;
    const r1 = insertElement(c, e, 0, 'R', true)!, r2 = insertElement(c, e, 1, 'R', true)!, r3 = insertElement(c, e, 2, 'R', true)!;
    assert.deepEqual([r1.label, r2.label, r3.label], ['R1', 'R2', 'R3']);
    assert.equal(insertElement(c, e, 0, 'J', true)!.label, 'I1');
    assert.equal(insertElement(c, e, 0, 'U', true)!.label, '');
    assert.equal(insertElement(c, e, 0, 'A', true)!.label, '');
    deleteElement(c, r2.id);
    assert.equal(insertElement(c, e, 0, 'R', true)!.label, 'R4');   // numbers don't shift / aren't reused
    r1.label = 'R_{7}';
    assert.equal(insertElement(c, e, 0, 'R', true)!.label, 'R8');
    changeType(c, r3, 'C', true);
    assert.equal(r3.label, 'C1');
    r1.label = '10ohm';
    changeType(c, r1, 'L', true);
    assert.equal(r1.label, '10ohm');
    assert.equal(insertElement(c, e, 0, 'R', false)!.label, '');
});

test('new sources point up on vertical and right on horizontal branches', () => {
    const c = emptyCircuit();
    const a = addNode(c, 100, 100), b = addNode(c, 100, 400), d = addNode(c, 400, 100);
    const down = addEdge(c, a, b), left = addEdge(c, d, a);
    const s1 = insertElement(c, down.id, 0, 'E', true)!, s2 = insertElement(c, left.id, 0, 'J', true)!;
    assert.equal(arrowDir(c, down, s1), 'up');
    assert.equal(arrowDir(c, left, s2), 'right');
});

test('ray hits a branch exactly at the intersection', () => {
    const c = emptyCircuit();
    const e = addEdge(c, addNode(c, 0, 0), addNode(c, 300, 300));
    const q = rayHitEdge(c, { x: 200, y: 0 }, { x: 0, y: 1 }, e)!;
    assert.ok(Math.abs(q.x - 200) < 1e-9 && Math.abs(q.y - 200) < 1e-9);
});

test('wire from a diagonal snaps perpendicular and lands on the other branch', () => {
    const c = emptyCircuit();
    const e1 = addEdge(c, addNode(c, 100, 100), addNode(c, 460, 380));
    addEdge(c, addNode(c, 300, 40), addNode(c, 660, 320));
    const st = resolveEnd(c, { x: 280, y: 240 }, null, 1);
    assert.equal(st.kind, 'split');
    const g = edgeGeom(c, e1);
    // aim roughly along the normal, ~3° off
    const ang = Math.atan2(-g.d.x, g.d.y) + 0.05 + Math.PI;
    const en = resolveEnd(c, { x: st.x + 150 * Math.cos(ang), y: st.y + 150 * Math.sin(ang) }, st, 1);
    if (en.kind === 'split') {
        const v = { x: en.x - st.x, y: en.y - st.y }, L = Math.hypot(v.x, v.y);
        assert.ok(Math.abs((v.x * g.d.x + v.y * g.d.y) / L) < 0.01, 'perpendicular');
    } else assert.equal(en.snap, true);
    const w = addWire(c, st, en, 1);
    assert.ok(w);
});

test('deleting branches removes orphan nodes', () => {
    const c = startSquare();
    deleteEdges(c, [c.edges[0].id]);
    assert.equal(c.nodes.length, 4);
    deleteEdges(c, [c.edges[0].id]);
    assert.equal(c.nodes.length, 3);
});

test('group move merges nodes and drops zero-length branches', () => {
    const c = emptyCircuit();
    const a = addNode(c, 100, 100), b = addNode(c, 200, 100), d = addNode(c, 300, 100);
    const e1 = addEdge(c, a, b); addEdge(c, b, d);
    const orig = groupOrigin(c, [e1.id]);
    moveGroup(c, orig, 198, 3);          // rounds to +200, 0 → a lands on d
    settleGroup(c, orig);
    assert.ok(!nodeById(c, a));
    assert.ok(c.edges.every(e => e.a !== e.b));
});

test('lasso selects branches with both ends inside', () => {
    const c = startSquare();
    const loop: [number, number][] = [[200, 120], [700, 120], [700, 160], [200, 160]];
    const ids = lassoEdges(c, loop);
    assert.equal(ids.length, 1);
    assert.equal(edgeById(c, ids[0])!.a, c.nodes[0].id);
});

test('font: lowercase, subscripts, display replacements', () => {
    const a = layoutText('a', 21), A = layoutText('A', 21);
    const ys = (t: { lines: [number, number][][] }) => t.lines.flat().map(p => p[1]);
    assert.ok(Math.min(...ys(a)) > Math.min(...ys(A)) + 3, 'real lowercase is lower than capitals');
    const sub = layoutText('U_1', 13), plain = layoutText('U1', 13);
    assert.ok(sub.width < plain.width);
    assert.equal(displayLabel('10ohm'), '10Ω');
    assert.equal(displayLabel('4.7uF'), '4.7μF');
    assert.ok(layoutText('ąęłż', 13).lines.length >= 8);
    assert.ok(layoutText('ʬ', 13).lines.length > 0, 'unknown char falls back to ?');
});

test('findEl', () => {
    const c = startSquare();
    const el = insertElement(c, c.edges[1].id, 0, 'R', true)!;
    assert.equal(findEl(c, el.id)!.edge.id, c.edges[1].id);
});

test('snapping: 9° off snaps with pen tolerance, lands exactly on the other diagonal', () => {
    const c = emptyCircuit();
    const e1 = addEdge(c, addNode(c, 100, 100), addNode(c, 460, 380));
    const e2 = addEdge(c, addNode(c, 300, 40), addNode(c, 660, 320));
    const st = resolveEnd(c, { x: 280, y: 240 }, null, 1);
    const g = edgeGeom(c, e1);
    const nrm = { x: g.d.y, y: -g.d.x };                       // perpendicular towards e2
    const off = -9 * Math.PI / 180, L = 168;                 // (+9° would be near the 45° candidate)
    const u = { x: nrm.x * Math.cos(off) - nrm.y * Math.sin(off), y: nrm.x * Math.sin(off) + nrm.y * Math.cos(off) };
    const p = { x: st.x + u.x * L, y: st.y + u.y * L };
    assert.equal(resolveEnd(c, p, st, 1, { angTol: 6 }).snap, undefined, 'mouse tolerance: no snap at 9°');
    const en = resolveEnd(c, p, st, 1, { angTol: 10 });
    assert.equal(en.kind, 'split');
    assert.equal((en as { edge: string }).edge, e2.id);
    const v = { x: en.x - st.x, y: en.y - st.y }, vl = Math.hypot(v.x, v.y);
    assert.ok(Math.abs((v.x * g.d.x + v.y * g.d.y) / vl) < 1e-3, 'perpendicular');
});

test('snapping: free end near (not on) a branch lands on the intersection', () => {
    const c = emptyCircuit();
    addEdge(c, addNode(c, 100, 300), addNode(c, 700, 300));
    const st: ReturnType<typeof resolveEnd> = { kind: 'free', x: 400, y: 100 };
    const en = resolveEnd(c, { x: 401, y: 289 }, st, 1);      // 11 px above the branch, outside the hit tolerance
    assert.equal(en.kind, 'split');
    assert.equal(en.x, 400); assert.equal(en.y, 300);
});

test('snapping: hysteresis keeps the previous direction', () => {
    const c = emptyCircuit();
    const st: ReturnType<typeof resolveEnd> = { kind: 'free', x: 100, y: 100 };
    const a = 8 * Math.PI / 180;                                // 8° from horizontal: outside 6°, inside 1.6 × 6°
    const p = { x: 100 + 200 * Math.cos(a), y: 100 + 200 * Math.sin(a) };
    assert.notEqual(resolveEnd(c, p, st, 1, { angTol: 6 }).snap, true);
    const en = resolveEnd(c, p, st, 1, { angTol: 6, prevDir: { x: 1, y: 0 } });
    assert.equal(en.snap, true); assert.equal(en.y, 100);
});

test('snapping: the perpendicular of a slanted branch wins over a nearby 45°', () => {
    const c = emptyCircuit();
    const e1 = addEdge(c, addNode(c, 220, 520), addNode(c, 680, 140));    // ≈ 39.6°, its perpendicular ≈ 50.4°
    const st = resolveEnd(c, { x: 450, y: 330 }, null, 1);
    const a = 47 * Math.PI / 180;                                        // 2° from 45°, 3.4° from the perpendicular
    const en = resolveEnd(c, { x: st.x + 120 * Math.cos(a), y: st.y + 120 * Math.sin(a) }, st, 1, { angTol: 10 });
    const g = edgeGeom(c, e1), v = { x: en.x - st.x, y: en.y - st.y }, L = Math.hypot(v.x, v.y);
    assert.ok(Math.abs((v.x * g.d.x + v.y * g.d.y) / L) < 1e-3, 'perpendicular, not 45°');
});
