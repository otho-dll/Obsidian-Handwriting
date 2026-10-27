import { defineMixin } from './mixin';

/**
 * Remembering the place in a note – rewritten from scratch, in one place.
 *
 * Rules:
 * 1. The key is the path of the note whose content IS in the view (`posKey`). It's set after the file loads
 *    (onLoadFile) and cleared when the view is closed / cleared.
 * 2. We save only when the view is visible and "ready" (`posReady` – after the place is restored).
 *    A hidden view (background tab) doesn't change or save the position.
 * 3. Restoring waits until the view is visible and the pages laid out – only then sets the position.
 *
 * Earlier bug: when a tab went to the background its view got size 0, and recomputing the position
 * "clamped" it to the start of the note (page heights read as 0). Back in the tab you were on page 1
 * and that position got saved. Now a hidden view doesn't touch the position at all (applyManualZoom).
 */
export interface SavedPos { page: number; off: number; zoom: number; }

export const positionMixin = defineMixin({
    /** Whether the view has a size and laid-out pages (visible tab). */
    posVisible(): boolean {
        return !!this.scrollArea && !!this.pagesWrapper && this.scrollArea.clientHeight > 0 && this.scrollArea.clientWidth > 0
            && this.pageViews.length > 0 && this.pagesWrapper.clientHeight > 400;
    },

    /** Current position (page, offset from its top edge, zoom). */
    posCurrent(): SavedPos | null {
        if (!this.posVisible()) return null;
        const top = -this.pagePositionY / this.currentZoom;   // top edge of the view in page-container coordinates
        const page = this.pageIndexAtViewCenter();
        return { page, off: top - this.pageViews[page].outer.offsetTop, zoom: this.currentZoom };
    },

    posLog(...args: unknown[]) {
        if (this.plugin.settings.debugLog) console.log('[Handwriting]', ...args);
    },

    /** Called after every view change (applyManualZoom): remembers the position (saved with a delay). */
    posTrack() {
        if (!this.posReady || !this.posKey) return;
        const pos = this.posCurrent();
        if (!pos) return;
        this.posLast = pos;
        if (this.posTimer !== null) window.clearTimeout(this.posTimer);
        const key = this.posKey;
        this.posTimer = window.setTimeout(() => {
            this.posTimer = null;
            if (this.posKey === key && this.posLast) this.posWrite(key, this.posLast);
        }, 500);
    },

    posWrite(key: string, pos: SavedPos) {
        this.posLog('save', key, pos);
        this.plugin.setLastPosition(key, { ...pos, t: Date.now() });
    },

    /** Saves immediately (note change, close) and stops tracking the current note. */
    posEnd() {
        if (this.posTimer !== null) { window.clearTimeout(this.posTimer); this.posTimer = null; }
        this.posStopWaiting();
        if (this.posReady && this.posKey) {
            const pos = this.posCurrent() ?? this.posLast;
            if (pos) this.posWrite(this.posKey, pos);
            this.plugin.flushLastPositions();
        }
        this.posLog('end', this.posKey);
        this.posReady = false;
        this.posKey = null;
        this.posLast = null;
    },

    /** Start tracking note `key`: restores the saved place (or the start of the note). */
    posBegin(key: string) {
        this.posStopWaiting();
        this.posKey = key;
        this.posReady = false;
        this.posLast = null;
        const saved = this.plugin.settings.lastPositions[key];
        const target: SavedPos = saved ? { page: saved.page, off: saved.off, zoom: saved.zoom } : { page: 0, off: -10, zoom: this.currentZoom };
        // Favourite writing zoom: the note opens at the remembered place, but always with this zoom.
        const oz = this.plugin.settings.openZoom;
        if (oz) target.zoom = oz;
        this.posLog('begin', key, 'target', target, 'visible', this.posVisible());
        this.posApplyWhenVisible(target);
    },

    /** Sets the position as soon as the view is visible (checked every 100 ms, no limit – a tab may stay in the background for long). */
    posApplyWhenVisible(target: SavedPos) {
        const key = this.posKey;
        const tick = () => {
            this.posWait = null;
            if (this.posKey !== key) return;
            if (!this.posVisible()) { this.posWait = window.setTimeout(tick, 100); return; }
            this.posApply(target);
            this.posLast = target;
            this.posReady = true;
            this.posLog('restored', key, target);
        };
        tick();
    },

    posStopWaiting() {
        if (this.posWait !== null) { window.clearTimeout(this.posWait); this.posWait = null; }
    },

    posApply(r: SavedPos) {
        const page = Math.max(0, Math.min(this.pageViews.length - 1, Math.round(r.page)));
        this.stopInertia();
        this.currentZoom = Math.max(0.4, Math.min(4, r.zoom || 1));
        this.pagePositionY = -(this.pageViews[page].outer.offsetTop + r.off) * this.currentZoom;
        this.activePageIndex = page;
        this.applyManualZoom();
        this.scheduleRedrawAfterZoom();
    },
});
export type PositionMethods = typeof positionMixin;
