import type { Polyline } from './font';

/** Inserts points so that no segment is longer than `step` (the eraser cuts strokes point by point). */
export function resample(pl: Polyline, step = 3): Polyline {
    if (pl.length === 0) return [];
    const out: Polyline = [pl[0]];
    for (let i = 1; i < pl.length; i++) {
        const [x0, y0] = pl[i - 1], [x1, y1] = pl[i];
        const d = Math.hypot(x1 - x0, y1 - y0);
        if (d < 1e-6) continue;
        const n = Math.max(1, Math.ceil(d / step));
        for (let k = 1; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
    }
    return out;
}

/** Length of a polyline. */
export function polyLength(pl: Polyline): number {
    let L = 0;
    for (let i = 1; i < pl.length; i++) L += Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]);
    return L;
}

/** Drops polylines with fewer than 2 distinct points / (almost) zero length. */
export function dropDegenerate(pls: Polyline[], minLen = 0.05): Polyline[] {
    return pls.filter(pl => pl.length >= 2 && polyLength(pl) >= minLen);
}
