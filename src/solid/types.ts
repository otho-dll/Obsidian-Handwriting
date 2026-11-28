/** 3D solids drawn as line drawings (no DOM – testable in Node). Model units: millimetres, z up. */
export type V3 = [number, number, number];

export type SolidKind =
    | 'cube' | 'box' | 'cylinder' | 'tube' | 'cone' | 'frustum' | 'sphere' | 'hemisphere'
    | 'torus' | 'prism' | 'pyramid' | 'tetrahedron' | 'wedge';

/**
 * iso / dimetric: axonometric views; cavalier / cabinet: oblique views (front face true shape, depth at 45°,
 * full or half length); perspective: like free, seen from a finite distance; views: front, top and side view
 * (first angle E or third angle A); free: any angle (drag the preview).
 */
export type ProjectionKind = 'iso' | 'dimetric' | 'cavalier' | 'cabinet' | 'perspective' | 'views' | 'free';
export type HiddenMode = 'hide' | 'dashed' | 'solid';

export interface SolidSpec {
    kind: SolidKind;
    /** Dimensions of each solid, kept separately (switching solids keeps them). */
    params: Partial<Record<SolidKind, Record<string, number>>>;
    projection: ProjectionKind;
    /** Free and perspective views: turn around the vertical axis and tilt (degrees). */
    yaw: number;
    pitch: number;
    /** Perspective strength 0.1 (almost parallel) … 1 (close up). */
    persp: number;
    /** Three views: first angle (E, Europe) or third angle (A, America). */
    layout: 'E' | 'A';
    hidden: HiddenMode;
    /** Centre lines / axes of symmetry (dash-dot). */
    axes: boolean;
}

export interface ParamDef { key: string; label: string; min: number; max: number; step: number; def: number }

export const SOLIDS: { kind: SolidKind; name: string; params: ParamDef[] }[] = [
    { kind: 'cube', name: 'Cube', params: [{ key: 'a', label: 'Edge a', min: 10, max: 200, step: 1, def: 60 }] },
    { kind: 'box', name: 'Cuboid', params: [
        { key: 'a', label: 'Length a', min: 5, max: 200, step: 1, def: 80 },
        { key: 'b', label: 'Depth b', min: 5, max: 200, step: 1, def: 50 },
        { key: 'c', label: 'Height c', min: 5, max: 200, step: 1, def: 40 }] },
    { kind: 'cylinder', name: 'Cylinder', params: [
        { key: 'r', label: 'Radius r', min: 3, max: 100, step: 1, def: 30 },
        { key: 'h', label: 'Height h', min: 3, max: 200, step: 1, def: 80 }] },
    { kind: 'tube', name: 'Tube', params: [
        { key: 'R', label: 'Outer radius R', min: 4, max: 100, step: 1, def: 35 },
        { key: 'r', label: 'Inner radius r', min: 2, max: 99, step: 1, def: 22 },
        { key: 'h', label: 'Height h', min: 3, max: 200, step: 1, def: 70 }] },
    { kind: 'cone', name: 'Cone', params: [
        { key: 'r', label: 'Radius r', min: 3, max: 100, step: 1, def: 35 },
        { key: 'h', label: 'Height h', min: 3, max: 200, step: 1, def: 80 }] },
    { kind: 'frustum', name: 'Truncated cone', params: [
        { key: 'R', label: 'Bottom radius R', min: 3, max: 100, step: 1, def: 40 },
        { key: 'r', label: 'Top radius r', min: 1, max: 100, step: 1, def: 20 },
        { key: 'h', label: 'Height h', min: 3, max: 200, step: 1, def: 60 }] },
    { kind: 'sphere', name: 'Sphere', params: [{ key: 'r', label: 'Radius r', min: 5, max: 100, step: 1, def: 40 }] },
    { kind: 'hemisphere', name: 'Hemisphere', params: [{ key: 'r', label: 'Radius r', min: 5, max: 100, step: 1, def: 45 }] },
    { kind: 'torus', name: 'Torus (ring)', params: [
        { key: 'R', label: 'Ring radius R', min: 5, max: 100, step: 1, def: 40 },
        { key: 'r', label: 'Tube radius r', min: 2, max: 99, step: 1, def: 14 }] },
    { kind: 'prism', name: 'Prism', params: [
        { key: 'n', label: 'Sides n', min: 3, max: 8, step: 1, def: 6 },
        { key: 'a', label: 'Side a', min: 3, max: 120, step: 1, def: 30 },
        { key: 'h', label: 'Height h', min: 3, max: 200, step: 1, def: 70 }] },
    { kind: 'pyramid', name: 'Pyramid', params: [
        { key: 'n', label: 'Sides n', min: 3, max: 8, step: 1, def: 4 },
        { key: 'a', label: 'Side a', min: 3, max: 150, step: 1, def: 60 },
        { key: 'h', label: 'Height h', min: 3, max: 200, step: 1, def: 70 }] },
    { kind: 'tetrahedron', name: 'Tetrahedron', params: [{ key: 'a', label: 'Edge a', min: 10, max: 200, step: 1, def: 70 }] },
    { kind: 'wedge', name: 'Wedge', params: [
        { key: 'a', label: 'Length a', min: 5, max: 200, step: 1, def: 80 },
        { key: 'b', label: 'Depth b', min: 5, max: 200, step: 1, def: 50 },
        { key: 'h', label: 'Height h', min: 5, max: 200, step: 1, def: 45 }] },
];

export const solidDef = (k: SolidKind) => SOLIDS.find(s => s.kind === k) ?? SOLIDS[0];

/** The dimensions of a solid: saved values within limits, the defaults for the rest. */
export function solidParams(spec: SolidSpec, kind: SolidKind = spec.kind): Record<string, number> {
    const def = solidDef(kind), saved = spec.params[kind] ?? {};
    const out: Record<string, number> = {};
    for (const p of def.params) {
        const v = saved[p.key];
        out[p.key] = typeof v === 'number' && isFinite(v) ? Math.max(p.min, Math.min(p.max, v)) : p.def;
    }
    if (kind === 'prism' || kind === 'pyramid') out.n = Math.round(out.n);
    // an inner radius must stay inside the outer one
    if (kind === 'tube') out.r = Math.min(out.r, out.R - 1);
    if (kind === 'torus') out.r = Math.min(out.r, out.R - 1);
    return out;
}

export function newSolidSpec(): SolidSpec {
    return { kind: 'cylinder', params: {}, projection: 'iso', yaw: 30, pitch: 20, persp: 0.5, layout: 'E', hidden: 'dashed', axes: true };
}
