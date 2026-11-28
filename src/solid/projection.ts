import type { ProjectionKind, V3 } from './types';

/**
 * A projection: screen point (x right, y DOWN – like SVG and the page) and a depth (larger = farther away).
 * `key` grows with the depth and is linear on the screen over a flat triangle (depth for parallel views,
 * −1/depth for the perspective), so it can be interpolated in the depth buffer; `keyDepth` turns it back.
 * `viewDir(p)`: direction from the eye through p (for outlines: where the surface normal is perpendicular to it).
 */
export interface Projector {
    project(p: V3): { x: number; y: number; key: number; depth: number };
    keyDepth(key: number): number;
    viewDir(p: V3): V3;
}

const D2R = Math.PI / 180;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Camera axes for a view from yaw ψ (around z; 0 = from the front, -y) and pitch θ (up from the horizon), degrees. */
export function cameraAxes(yawDeg: number, pitchDeg: number): { right: V3; up: V3; fwd: V3 } {
    const y = yawDeg * D2R, t = pitchDeg * D2R;
    const fwd: V3 = [-Math.sin(y) * Math.cos(t), Math.cos(y) * Math.cos(t), -Math.sin(t)];   // from the eye into the scene
    const right: V3 = [Math.cos(y), Math.sin(y), 0];
    const up: V3 = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
    return { right, up, fwd };
}

/** Parallel (orthographic) view. */
export function orthoView(yawDeg: number, pitchDeg: number): Projector {
    const { right, up, fwd } = cameraAxes(yawDeg, pitchDeg);
    return {
        project: (p) => { const d = dot(p, fwd); return { x: dot(p, right), y: -dot(p, up), key: d, depth: d }; },
        keyDepth: (k) => k,
        viewDir: () => fwd,
    };
}

/**
 * Oblique view: the front face (x, z) in true shape, depth (+y, away from the viewer) drawn at `angle` and shortened
 * by k (cavalier k = 1, cabinet k = 0.5).
 */
export function obliqueView(k: number, angleDeg = 45): Projector {
    const c = Math.cos(angleDeg * D2R) * k, s = Math.sin(angleDeg * D2R) * k;
    const d: V3 = [-c, 1, -s];   // points along d land on the same screen point
    return {
        project: (p) => ({ x: p[0] + c * p[1], y: -(p[2] + s * p[1]), key: p[1], depth: p[1] }),
        keyDepth: (key) => key,
        viewDir: () => d,
    };
}

/** Perspective from distance `dist` (from the centre of the solid); the scale at the centre is 1. */
export function perspectiveView(yawDeg: number, pitchDeg: number, dist: number): Projector {
    const { right, up, fwd } = cameraAxes(yawDeg, pitchDeg);
    const eye: V3 = [-fwd[0] * dist, -fwd[1] * dist, -fwd[2] * dist];
    return {
        project: (p) => {
            const z = dot(p, fwd) + dist, k = dist / Math.max(1e-6, z);
            return { x: dot(p, right) * k, y: -dot(p, up) * k, key: -1 / Math.max(1e-6, z), depth: z };
        },
        keyDepth: (key) => -1 / key,
        viewDir: (p) => [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]],
    };
}

/** Fixed angles of the standard views (yaw, pitch). */
export const VIEW_ANGLES = {
    iso: { yaw: 45, pitch: 35.264 },
    // ISO 5456-3 dimetric (7° / 42°, depth halved)
    dimetric: { yaw: 20.705, pitch: 19.471 },
    front: { yaw: 0, pitch: 0 },
    top: { yaw: 0, pitch: 90 },
    left: { yaw: -90, pitch: 0 },
    right: { yaw: 90, pitch: 0 },
};

/** The projector for a single view (not 'views', which is three projectors). `size`: largest dimension of the solid. */
export function projector(kind: Exclude<ProjectionKind, 'views'>, yaw: number, pitch: number, persp: number, size: number): Projector {
    switch (kind) {
        case 'iso': return orthoView(VIEW_ANGLES.iso.yaw, VIEW_ANGLES.iso.pitch);
        case 'dimetric': return orthoView(VIEW_ANGLES.dimetric.yaw, VIEW_ANGLES.dimetric.pitch);
        case 'cavalier': return obliqueView(1);
        case 'cabinet': return obliqueView(0.5);
        case 'perspective': return perspectiveView(yaw, pitch, size * (0.9 + 4 * (1 - Math.max(0.1, Math.min(1, persp)))));
        default: return orthoView(yaw, pitch);
    }
}
