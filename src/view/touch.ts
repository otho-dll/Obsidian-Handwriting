import { defineMixin } from './mixin';

/**
 * Finger gestures (rewritten from scratch in v3.18).
 *
 * Rules:
 * 1. One finger – scrolling (with inertia); holding it still – page menu.
 * 2. Two fingers – zoom together with panning. The gesture is always computed relative to the state at the moment
 *    both fingers touched (no summing of small steps – nothing drifts): the note point under the centre of the
 *    fingers stays under it, and zoom = start zoom × (distance / start distance).
 * 3. Palm protection:
 *    – three or more contacts at once = a palm: nothing happens until the whole hand is lifted,
 *    – two contacts moving together (a sliding hand) only scroll – zooming needs a clear change of the
 *      distance between the fingers (larger than the movement of their centre),
 *    – touches while writing / with the pen at the screen, and very large contacts, are ignored (the
 *      "Palm rejection" setting), and touching the screen with the pen cancels any finger gesture.
 * 4. The "Pinch to zoom" setting turns finger zoom off completely (two fingers then only scroll).
 */

interface Contact { id: number; x: number; y: number; t: number; }

const DECIDE_PX = 22;          // movement after which we decide whether two fingers zoom or pan
const LATE_ZOOM_PX = 70;       // a clear spread of the fingers later in the gesture switches panning to zooming
const PEN_HOVER_MS = 350;      // pen reported this recently = it is at the screen

export const touchMixin = defineMixin({
    setupTouchPanZoom(target: HTMLElement) {
        const contacts = new Map<number, Contact>();   // fingers taking part in the gesture
        const raw = new Set<number>();                 // all touches (rejected ones too)
        let palm = false;                              // palm on the screen – ignore until the hand is lifted

        // One-finger gesture
        let one: { id: number; x: number; y: number; px: number; py: number } | null = null;
        let samples: { t: number; x: number; y: number }[] = [];
        let press: { timer: number; x: number; y: number; w: number; h: number } | null = null;

        // Two-finger gesture – state at the start
        let two: {
            a: number; b: number;
            mx: number; my: number; d: number;           // centre and distance of the fingers at the start
            z: number; px: number; py: number;           // zoom and page position at the start
            mode: 'undecided' | 'zoom' | 'pan';
        } | null = null;
        let hadTwo = false;                              // this touch had two fingers (no inertia at the end)

        const local = (x: number, y: number) => { const r = target.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; };

        const cancelPress = () => { if (press) { window.clearTimeout(press.timer); press = null; } };
        const endAll = () => {
            contacts.clear();
            cancelPress();
            one = null;
            two = null;
            samples = [];
        };
        // The pen touched the screen: whatever touches with fingers is a palm – cancel the gesture.
        this.cancelTouchGestures = () => { endAll(); hadTwo = true; this.stopInertia(); };

        const beginOne = (c: Contact) => {
            two = null;
            one = { id: c.id, x: c.x, y: c.y, px: c.x, py: c.y };
            samples = [{ t: c.t, x: c.x, y: c.y }];
        };

        const beginTwo = () => {
            const [a, b] = Array.from(contacts.values());
            cancelPress();
            one = null;
            samples = [];
            hadTwo = true;
            const m = local((a.x + b.x) / 2, (a.y + b.y) / 2);
            two = {
                a: a.id, b: b.id,
                mx: m.x, my: m.y, d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
                z: this.currentZoom, px: this.pagePositionX, py: this.pagePositionY,
                mode: 'undecided',
            };
        };

        const penNear = () => performance.now() - this.lastPenAt < PEN_HOVER_MS;

        const moveTwo = () => {
            if (!two) return;
            const a = contacts.get(two.a), b = contacts.get(two.b);
            if (!a || !b) return;
            const m = local((a.x + b.x) / 2, (a.y + b.y) / 2);
            const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
            const spread = Math.abs(d - two.d);                     // change of the distance between the fingers
            const shift = Math.hypot(m.x - two.mx, m.y - two.my);   // movement of the fingers' centre
            const canZoom = this.plugin.settings.pinchZoom && !penNear();
            if (two.mode === 'undecided') {
                if (spread >= DECIDE_PX || shift >= DECIDE_PX) {
                    // Zoom when the fingers clearly spread / pinch (even with one finger still – the centre then
                    // moves by half of the movement). Sliding hand: the centre moves, the distance stays almost the same.
                    two.mode = canZoom && spread >= shift * 0.8 ? 'zoom' : 'pan';
                }
            } else if (two.mode === 'pan' && canZoom && spread >= LATE_ZOOM_PX && spread >= shift) {
                two.mode = 'zoom';
            }
            if (two.mode === 'zoom') {
                const z = Math.max(0.4, Math.min(4, two.z * d / two.d));
                const k = z / two.z;
                // the note point that was under the fingers' centre stays under it
                this.pagePositionX = m.x - (two.mx - two.px) * k;
                this.pagePositionY = m.y - (two.my - two.py) * k;
                this.currentZoom = z;
            } else {
                // panning (also while undecided – the view reacts immediately)
                this.pagePositionX = two.px + (m.x - two.mx);
                this.pagePositionY = two.py + (m.y - two.my);
                if (two.mode === 'undecided' || this.currentZoom !== two.z) this.currentZoom = two.z;
            }
            this.applyManualZoom();
        };

        const accept = (e: PointerEvent) => !palm && !this.shouldRejectTouch(e, contacts.size === 1);

        target.addEventListener('pointerdown', (e: PointerEvent) => {
            if (e.pointerType !== 'touch') return;
            raw.add(e.pointerId);
            if (raw.size >= 3) {
                // palm: cancel the gesture and ignore touches until all fingers are lifted
                if (!palm) { palm = true; endAll(); hadTwo = true; }
                return;
            }
            if (!accept(e)) return;
            this.stopInertia();
            const c: Contact = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
            contacts.set(c.id, c);
            if (contacts.size === 1) {
                hadTwo = false;
                beginOne(c);
                // holding a finger still – page menu
                cancelPress();
                const st = this.plugin.settings;
                if (st.longPressMenu) {
                    const p = { x: e.clientX, y: e.clientY, w: e.width || 0, h: e.height || 0 };
                    press = {
                        ...p,
                        timer: window.setTimeout(() => {
                            press = null;
                            if (contacts.size !== 1) return;
                            if (st.palmRejection !== 'off' && performance.now() - this.lastPenAt < Math.max(2500, st.palmPenTimeout)) return;
                            if (st.palmRejection !== 'off' && st.palmContactSize > 0 && Math.max(p.w, p.h) > st.palmContactSize * 0.7) return;
                            this.requestPageMenu(p.x, p.y);
                        }, st.longPressMs),
                    };
                }
            } else if (contacts.size === 2) {
                beginTwo();
            }
            // a third accepted finger doesn't change the gesture (a palm is cut off earlier by raw.size >= 3)
        });

        target.addEventListener('pointermove', (e: PointerEvent) => {
            if (e.pointerType !== 'touch') return;
            const c = contacts.get(e.pointerId);
            if (!c || palm) return;
            c.x = e.clientX; c.y = e.clientY; c.t = e.timeStamp;
            if (two) { moveTwo(); return; }
            if (one && one.id === c.id) {
                if (press) {
                    if (Math.hypot(c.x - press.x, c.y - press.y) < 10) return;   // still a long press, not scrolling
                    cancelPress();
                }
                this.pagePositionX += c.x - one.px;
                this.pagePositionY += c.y - one.py;
                one.px = c.x; one.py = c.y;
                samples.push({ t: e.timeStamp, x: c.x, y: c.y });
                while (samples.length > 2 && e.timeStamp - samples[0].t > 100) samples.shift();
                this.applyManualZoom();
            }
        });

        const release = (e: PointerEvent) => {
            if (e.pointerType !== 'touch') return;
            raw.delete(e.pointerId);
            if (raw.size === 0) palm = false;
            const c = contacts.get(e.pointerId);
            if (!c) return;
            contacts.delete(e.pointerId);
            cancelPress();
            if (two) {
                // one of two fingers lifted: the other one keeps scrolling (no jump)
                two = null;
                const rest = Array.from(contacts.values())[0];
                if (rest) { beginOne(rest); one!.px = rest.x; one!.py = rest.y; samples = []; }
                this.resizeAndRedrawAll();
                return;
            }
            if (contacts.size === 0) {
                // inertia after a fast one-finger swipe
                if (!hadTwo && e.type === 'pointerup' && samples.length >= 2) {
                    const f = samples[0], l = samples[samples.length - 1];
                    const dt = l.t - f.t;
                    if (dt > 0 && e.timeStamp - l.t < 80) {
                        const vx = (l.x - f.x) / dt, vy = (l.y - f.y) / dt;
                        if (Math.hypot(vx, vy) > 0.15) this.startInertia(vx, vy);
                    }
                }
                one = null;
                samples = [];
                this.resizeAndRedrawAll();
            }
        };
        target.addEventListener('pointerup', release);
        target.addEventListener('pointercancel', release);
        // A finger lifted outside the note area also ends the touch.
        this.registerDomEvent(window, 'pointerup', (e: PointerEvent) => { if (e.pointerType === 'touch' && (contacts.has(e.pointerId) || raw.has(e.pointerId))) release(e); }, { capture: true });
        this.registerDomEvent(window, 'pointercancel', (e: PointerEvent) => { if (e.pointerType === 'touch' && (contacts.has(e.pointerId) || raw.has(e.pointerId))) release(e); }, { capture: true });
    },
});
export type TouchMethods = typeof touchMixin;
