import { defineMixin } from './mixin';
import { INERTIA_TAU_MS } from '../constants';

/** Scrolling, zooming, finger gestures, mouse wheel and inertia. */
export const navigationMixin = defineMixin({
    // --- FIT TO WIDTH ---
    scheduleRedrawAfterZoom() {
        if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer);
        this.redrawTimer = window.setTimeout(() => {
            this.redrawTimer = null;
            this.resizeAndRedrawAll();
        }, 150);
    },

    // Page across the full view width (centred), keeping the page you're looking at.
    fitToWidth() {
        if (!this.scrollArea) return;
        this.stopInertia();
        const vw = this.scrollArea.clientWidth;
        const vh = this.scrollArea.clientHeight;
        const oldZ = this.currentZoom;
        // Page in the middle of the view (before the zoom change)
        const centerY = (vh / 2 - this.pagePositionY) / oldZ;
        let idx = 0;
        for (let i = 0; i < this.pageViews.length; i++) {
            if (centerY >= this.pageViews[i].outer.offsetTop - 8) idx = i;
        }
        const z = Math.max(0.4, Math.min(4, (vw - 24) / this.pageW(idx)));
        const top = this.pageViews[idx]?.outer.offsetTop ?? 0;
        this.currentZoom = z;
        this.pagePositionY = -(top - 10) * z;
        this.pagePositionX = (vw - this.wrapperW() * z) / 2;   // pages are centred in the column
        this.activePageIndex = idx;
        this.applyManualZoom();
        this.scheduleRedrawAfterZoom();
    },

    /** Changes the zoom so the centre of the view stays at the same place in the note. */
    zoomKeepingCenter(z: number) {
        if (!this.scrollArea) return;
        this.stopInertia();
        const vw = this.scrollArea.clientWidth, vh = this.scrollArea.clientHeight;
        const old = this.currentZoom;
        const cx = (vw / 2 - this.pagePositionX) / old, cy = (vh / 2 - this.pagePositionY) / old;
        z = Math.max(0.4, Math.min(4, z));
        this.currentZoom = z;
        this.pagePositionX = vw / 2 - cx * z;
        this.pagePositionY = vh / 2 - cy * z;
        this.applyManualZoom();
        this.scheduleRedrawAfterZoom();
    },

    // --- MOUSE WHEEL ---
    setupWheel(target: HTMLElement) {
        this.registerDomEvent(target, 'wheel', (e: WheelEvent) => {
            e.preventDefault();
            this.lastActivityAt = performance.now();
            this.stopInertia();
            const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? target.clientHeight : 1;
            const dx = e.deltaX * unit;
            const dy = e.deltaY * unit;

            if (e.ctrlKey || e.metaKey) {
                // Zoom around the cursor
                const newZoom = Math.max(0.4, Math.min(4.0, this.currentZoom * Math.exp(-dy * 0.002)));
                const factor = newZoom / this.currentZoom;
                const rect = target.getBoundingClientRect();
                const ox = e.clientX - rect.left;
                const oy = e.clientY - rect.top;
                this.pagePositionX = ox - (ox - this.pagePositionX) * factor;
                this.pagePositionY = oy - (oy - this.pagePositionY) * factor;
                this.currentZoom = newZoom;
                this.applyManualZoom();
                if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer);
                this.redrawTimer = window.setTimeout(() => {
                    this.redrawTimer = null;
                    this.resizeAndRedrawAll();
                }, 150);
            } else if (e.shiftKey) {
                this.pagePositionX -= dy || dx;
                this.applyManualZoom();
            } else {
                this.pagePositionX -= dx;
                this.pagePositionY -= dy;
                this.applyManualZoom();
            }
        }, { passive: false });
    },

    // --- SCROLL INERTIA ---
    stopInertia() {
        if (this.inertiaRaf !== null) {
            window.cancelAnimationFrame(this.inertiaRaf);
            this.inertiaRaf = null;
        }
    },

    // vx, vy in screen pixels per millisecond; speed decays exponentially and stops at the document edge.
    startInertia(vx: number, vy: number) {
        this.stopInertia();
        let last = performance.now();
        const step = (now: number) => {
            const dt = Math.min(48, Math.max(1, now - last));
            last = now;
            const wantX = this.pagePositionX + vx * dt;
            const wantY = this.pagePositionY + vy * dt;
            this.pagePositionX = wantX;
            this.pagePositionY = wantY;
            this.applyManualZoom();
            // If the view limits undid the shift (document edge), stop that axis.
            if (Math.abs(this.pagePositionX - wantX) > 0.5) vx = 0;
            if (Math.abs(this.pagePositionY - wantY) > 0.5) vy = 0;
            const k = Math.exp(-dt / INERTIA_TAU_MS);
            vx *= k;
            vy *= k;
            if (Math.hypot(vx, vy) < 0.02) {
                this.inertiaRaf = null;
                return;
            }
            this.inertiaRaf = window.requestAnimationFrame(step);
        };
        this.inertiaRaf = window.requestAnimationFrame(step);
    },

    applyManualZoom() {
        if (!this.pagesWrapper || !this.scrollArea) return;

        const viewportWidth = this.scrollArea.clientWidth;
        const viewportHeight = this.scrollArea.clientHeight;
        // Hidden view (background tab, switching notes): it has size 0 and pages have height 0. Recomputing the position
        // in this state "clamped" it to the start of the note – so we don't touch anything then.
        if (viewportWidth === 0 || viewportHeight === 0 || this.pagesWrapper.clientHeight === 0) return;

        const scaledWidth = this.wrapperW() * this.currentZoom;
        const scaledHeight = this.pagesWrapper.clientHeight * this.currentZoom;

        const marginX = 20;
        const marginY = 20;

        if (scaledWidth + marginX * 2 <= viewportWidth) {
            this.pagePositionX = (viewportWidth - scaledWidth) / 2;
        } else {
            const minX = viewportWidth - scaledWidth - marginX;
            const maxX = marginX;
            this.pagePositionX = Math.max(minX, Math.min(maxX, this.pagePositionX));
        }

        if (scaledHeight + marginY * 2 <= viewportHeight) {
            this.pagePositionY = (viewportHeight - scaledHeight) / 2;
        } else {
            const minY = viewportHeight - scaledHeight - marginY;
            const maxY = marginY;
            this.pagePositionY = Math.max(minY, Math.min(maxY, this.pagePositionY));
        }

        this.pagesWrapper.style.transform = `translate(${this.pagePositionX}px, ${this.pagePositionY}px) scale(${this.currentZoom})`;
        this.scrollArea.style.setProperty('--hw-zoom', String(this.currentZoom));
        // "Continues" hints: a shadow on the side where there is more content.
        const eps = 2;
        const more = {
            left: this.pagePositionX < -eps,
            right: this.pagePositionX + scaledWidth > viewportWidth + eps,
            top: this.pagePositionY < -eps,
            bottom: this.pagePositionY + scaledHeight > viewportHeight + eps,
        };
        for (const k of ['top', 'right', 'bottom', 'left'] as const) this.edgeEls[k]?.toggleClass('hw-edge-on', more[k]);
        this.layoutVersion++;
        this.refreshZoomButton();
        this.updateMinimap();
        this.scheduleVirtualization();
        this.posTrack();
    },

    // Should the touch be ignored (a palm resting on the screen)?
    /**
     * Whether the touch is a palm. `second` = the second finger of a gesture: the contact size isn't checked (the thumb
     * can be wide when zooming, and the palm is cut off anyway by the three-contact rule and gesture recognition in touch.ts).
     */
    shouldRejectTouch(e: PointerEvent, second = false): boolean {
        const st = this.plugin.settings;
        if (st.palmRejection === 'off') return false;
        if (st.palmRejection === 'strict') return true;
        if (performance.now() - this.lastPenAt < st.palmPenTimeout) return true;
        if (!second && st.palmContactSize > 0 && Math.max(e.width || 0, e.height || 0) > st.palmContactSize) return true;
        return false;
    },

    getDistance(p1: PointerEvent, p2: PointerEvent) {
        const dx = p1.clientX - p2.clientX;
        const dy = p1.clientY - p2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    },
});
export type NavigationMethods = typeof navigationMixin;
