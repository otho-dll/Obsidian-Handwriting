import { Platform } from 'obsidian';

/**
 * Short vibrations of the DEVICE (not the pen) at moments like snapping to an angle or finishing a selection.
 * Only Android has a working navigator.vibrate; the pen's own haptics (Surface Slim Pen 2, Apple Pencil Pro) need
 * native APIs a plugin can't reach, and desktop Chromium has vibrate() but it does nothing.
 */
export type HapticsLevel = 'off' | 'light' | 'strong';
export type HapticKind = 'tick' | 'snap' | 'confirm';

const MS: Record<HapticKind, number> = { tick: 8, snap: 15, confirm: 25 };
const MIN_GAP_MS = 60;

let level: HapticsLevel = 'off';
let lastAt = 0;

/** Whether this device can vibrate (Settings show the option only then). */
export function hapticsAvailable(): boolean {
    return Platform.isAndroidApp && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function setHapticsLevel(l: HapticsLevel) { level = l; }

/** One short vibration (at most one per 60 ms). */
export function buzz(kind: HapticKind) {
    if (level === 'off' || !hapticsAvailable()) return;
    const now = performance.now();
    if (now - lastAt < MIN_GAP_MS) return;
    lastAt = now;
    try { navigator.vibrate(MS[kind] * (level === 'strong' ? 2 : 1)); } catch { /* not allowed right now (no user gesture yet) */ }
}
