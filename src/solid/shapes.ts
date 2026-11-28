import type { SolidKind, V3 } from './types';

/** A curved surface (u, v) ∈ [0,1]² → point; its outline (contour) is found where the normal is perpendicular to the view. */
export interface Patch {
    f: (u: number, v: number) => V3;
    n: (u: number, v: number) => V3;
    /** Sampling of the contour search (u around, v along). */
    nu: number;
    nv: number;
    /** u = 0 and u = 1 are the same line (closed around); the same for v (a torus is closed both ways). */
    wrapU: boolean;
    wrapV?: boolean;
}

/** A solid for drawing: triangles (for hiding lines), sharp edges, curved surfaces (for outlines) and centre lines. */
export interface SolidGeom {
    tris: [V3, V3, V3][];
    sharp: V3[][];
    smooth: Patch[];
    axes: V3[][];
}

const TAU = Math.PI * 2;
/** Segments of circles (sharp edges) and of curved surfaces around (triangles). */
const CIRCLE_SEG = 96, SURF_U = 64, SURF_V = 24;

class Builder implements SolidGeom {
    tris: [V3, V3, V3][] = [];
    sharp: V3[][] = [];
    smooth: Patch[] = [];
    axes: V3[][] = [];

    /** Flat convex polygon (fan of triangles). */
    face(pts: V3[]) { for (let i = 1; i < pts.length - 1; i++) this.tris.push([pts[0], pts[i], pts[i + 1]]); }
    /** Sharp edges of a polygon (closed). */
    loop(pts: V3[]) { this.sharp.push([...pts, pts[0]]); }
    edge(a: V3, b: V3) { this.sharp.push([a, b]); }

    /** Curved surface: triangles from a grid; `contour`: it also gets an outline. */
    patch(p: Patch, nu = SURF_U, nv = SURF_V, contour = true) {
        const g: V3[][] = [];
        for (let i = 0; i <= nu; i++) { g.push([]); for (let j = 0; j <= nv; j++) g[i].push(p.f(i / nu, j / nv)); }
        for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
            this.tris.push([g[i][j], g[i + 1][j], g[i + 1][j + 1]]);
            this.tris.push([g[i][j], g[i + 1][j + 1], g[i][j + 1]]);
        }
        if (contour) this.smooth.push(p);
    }
    /** Flat disc / ring at height z (r0 = 0: a disc). */
    disc(z: number, r1: number, r0 = 0) {
        for (let i = 0; i < CIRCLE_SEG; i++) {
            const a0 = TAU * i / CIRCLE_SEG, a1 = TAU * (i + 1) / CIRCLE_SEG;
            const o0: V3 = [r1 * Math.cos(a0), r1 * Math.sin(a0), z], o1: V3 = [r1 * Math.cos(a1), r1 * Math.sin(a1), z];
            if (r0 <= 0) { this.tris.push([[0, 0, z], o0, o1]); continue; }
            const i0: V3 = [r0 * Math.cos(a0), r0 * Math.sin(a0), z], i1: V3 = [r0 * Math.cos(a1), r0 * Math.sin(a1), z];
            this.tris.push([i0, o0, o1], [i0, o1, i1]);
        }
    }
    circle(z: number, r: number) { this.sharp.push(circlePts([0, 0, z], r)); }
    /** The z axis through the solid (drawSolid makes it run past the outline on the screen). */
    axisZ(z0: number, z1: number) { this.axes.push([[0, 0, z0], [0, 0, z1]]); }
}

export function circlePts(c: V3, r: number, n = CIRCLE_SEG): V3[] {
    const out: V3[] = [];
    for (let i = 0; i <= n; i++) { const a = TAU * i / n; out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), c[2]]); }
    return out;
}

/** Surface of revolution around z: radius and height along v (side of a cylinder, cone, frustum). */
function revolve(rad: (v: number) => number, z: (v: number) => number, inward = false): Patch {
    return {
        f: (u, v) => { const a = TAU * u, r = rad(v); return [r * Math.cos(a), r * Math.sin(a), z(v)]; },
        n: (u, v) => {
            // normal of the side: perpendicular to (dr, dz) in the meridian plane
            const a = TAU * u, e = 1e-4, v0 = Math.max(0, v - e), v1 = Math.min(1, v + e);
            const dr = rad(v1) - rad(v0), dz = z(v1) - z(v0);
            let nr = dz, nz = -dr;
            if (inward) { nr = -nr; nz = -nz; }
            return [nr * Math.cos(a), nr * Math.sin(a), nz];
        },
        nu: 128, nv: 4, wrapU: true,
    };
}

/** Regular n-gon (circumradius R) at height z, one vertex towards -y (a flat side faces the viewer for even n). */
function ngon(n: number, R: number, z: number): V3[] {
    const out: V3[] = [];
    const a0 = -Math.PI / 2 + (n % 2 === 0 ? Math.PI / n : 0);
    for (let i = 0; i < n; i++) { const a = a0 + TAU * i / n; out.push([R * Math.cos(a), R * Math.sin(a), z]); }
    return out;
}

function box(B: Builder, a: number, b: number, c: number) {
    const x = a / 2, y = b / 2, z = c / 2;
    const v = (i: number): V3 => [i & 1 ? x : -x, i & 2 ? y : -y, i & 4 ? z : -z];
    const faces = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]];
    for (const f of faces) B.face(f.map(v));
    for (const [p, q] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]) B.edge(v(p), v(q));
}

function prism(B: Builder, n: number, R: number, h: number) {
    const bot = ngon(n, R, -h / 2), top = ngon(n, R, h / 2);
    B.face([...bot].reverse()); B.face(top);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; B.face([bot[i], bot[j], top[j], top[i]]); B.edge(bot[i], top[i]); }
    B.loop(bot); B.loop(top);
    B.axisZ(-h / 2, h / 2);
}

function pyramid(B: Builder, n: number, R: number, h: number, axis = true) {
    const bot = ngon(n, R, -h / 2), apex: V3 = [0, 0, h / 2];
    B.face([...bot].reverse());
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; B.face([bot[i], bot[j], apex]); B.edge(bot[i], apex); }
    B.loop(bot);
    if (axis) B.axisZ(-h / 2, h / 2);
}

/** The solid of `kind` with dimensions `p`, centred on the origin. */
export function buildSolid(kind: SolidKind, p: Record<string, number>): SolidGeom {
    const B = new Builder();
    switch (kind) {
        case 'cube': box(B, p.a, p.a, p.a); break;
        case 'box': box(B, p.a, p.b, p.c); break;
        case 'cylinder': {
            const { r, h } = p;
            B.patch(revolve(() => r, v => -h / 2 + h * v), 128, 2);
            B.disc(-h / 2, r); B.disc(h / 2, r);
            B.circle(-h / 2, r); B.circle(h / 2, r);
            B.axisZ(-h / 2, h / 2);
            break;
        }
        case 'tube': {
            const { R, r, h } = p;
            B.patch(revolve(() => R, v => -h / 2 + h * v), 128, 2);
            B.patch(revolve(() => r, v => -h / 2 + h * v, true), 128, 2);
            B.disc(-h / 2, R, r); B.disc(h / 2, R, r);
            for (const z of [-h / 2, h / 2]) { B.circle(z, R); B.circle(z, r); }
            B.axisZ(-h / 2, h / 2);
            break;
        }
        case 'cone': case 'frustum': {
            const h = p.h, R = kind === 'cone' ? p.r : p.R, r = kind === 'cone' ? 0 : p.r;
            B.patch(revolve(v => R + (r - R) * v, v => -h / 2 + h * v), 128, 8);
            B.disc(-h / 2, R); B.circle(-h / 2, R);
            if (r > 0) { B.disc(h / 2, r); B.circle(h / 2, r); }
            B.axisZ(-h / 2, h / 2);
            break;
        }
        case 'sphere': case 'hemisphere': {
            const r = p.r, half = kind === 'hemisphere';
            // latitude from the south pole (or the equator) to the north pole; the hemisphere stands on its flat side
            const lat0 = half ? 0 : -Math.PI / 2, dz = half ? -r / 2 : 0;
            const sph: Patch = {
                f: (u, v) => { const a = TAU * u, t = lat0 + (Math.PI / 2 - lat0) * v; return [r * Math.cos(t) * Math.cos(a), r * Math.cos(t) * Math.sin(a), r * Math.sin(t) + dz]; },
                n: (u, v) => { const a = TAU * u, t = lat0 + (Math.PI / 2 - lat0) * v; return [Math.cos(t) * Math.cos(a), Math.cos(t) * Math.sin(a), Math.sin(t)]; },
                nu: 128, nv: half ? 32 : 64, wrapU: true,
            };
            B.patch(sph, SURF_U, half ? SURF_V / 2 : SURF_V);
            if (half) {
                B.disc(dz, r); B.circle(dz, r);
                B.axes.push([[0, 0, dz], [0, 0, r + dz]], [[-r, 0, dz], [r, 0, dz]], [[0, -r, dz], [0, r, dz]]);
            } else {
                B.axes.push([[-r, 0, 0], [r, 0, 0]], [[0, -r, 0], [0, r, 0]], [[0, 0, -r], [0, 0, r]]);
            }
            break;
        }
        case 'torus': {
            const { R, r } = p;
            B.patch({
                f: (u, v) => { const a = TAU * u, b = TAU * v, q = R + r * Math.cos(b); return [q * Math.cos(a), q * Math.sin(a), r * Math.sin(b)]; },
                n: (u, v) => { const a = TAU * u, b = TAU * v; return [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)]; },
                nu: 160, nv: 64, wrapU: true, wrapV: true,
            }, 96, 36);
            B.axisZ(-r, r);
            B.axes.push(circlePts([0, 0, 0], R));
            break;
        }
        case 'prism': prism(B, p.n, p.a / (2 * Math.sin(Math.PI / p.n)), p.h); break;
        case 'pyramid': pyramid(B, p.n, p.a / (2 * Math.sin(Math.PI / p.n)), p.h); break;
        case 'tetrahedron': pyramid(B, 3, p.a / Math.sqrt(3), p.a * Math.sqrt(2 / 3), false); break;
        case 'wedge': {
            // a ramp: full height at the back (+y), down to an edge at the front (-y)
            const x = p.a / 2, y = p.b / 2, z = p.h / 2;
            const A: V3 = [-x, -y, -z], Bv: V3 = [x, -y, -z], C: V3 = [x, y, -z], D: V3 = [-x, y, -z], E: V3 = [-x, y, z], F: V3 = [x, y, z];
            B.face([A, D, C, Bv]); B.face([A, Bv, F, E]); B.face([D, E, F, C]); B.face([A, E, D]); B.face([Bv, C, F]);
            B.loop([A, Bv, C, D]); B.edge(E, F); B.edge(A, E); B.edge(Bv, F); B.edge(D, E); B.edge(C, F);
            break;
        }
    }
    return B;
}
