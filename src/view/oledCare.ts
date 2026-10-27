import { defineMixin } from './mixin';

/**
 * OLED screen protection (Settings → OLED care). Four independent options:
 * 1. Dark paper – pages shown in a dark version (dark background, light ink). Screen only:
 *    the file, thumbnails in dialogs and PDF export are unchanged.
 * 2. Dimming the toolbar and minimap while writing – they come back when the cursor / pen gets close.
 * 3. Pixel shift – every few minutes the whole view moves by 1–2 px (edges don't stay in one place).
 * 4. Dim when idle – after the chosen time without activity the view fades almost to black.
 */

/** Colour after the CSS filter invert(1) hue-rotate(180deg) – the same one we use for ink (the hue stays). */
export function darkPaperColor(hex: string): string {
    const r = 255 - parseInt(hex.slice(1, 3), 16), g = 255 - parseInt(hex.slice(3, 5), 16), b = 255 - parseInt(hex.slice(5, 7), 16);
    // hue-rotate(180deg): matrix from the Filter Effects specification (cos = -1, sin = 0)
    const R = (0.213 - 0.787) * r + (0.715 + 0.715) * g + (0.072 + 0.072) * b;
    const G = (0.213 + 0.213) * r + (0.715 - 0.285) * g + (0.072 + 0.072) * b;
    const B = (0.213 + 0.213) * r + (0.715 + 0.715) * g + (0.072 - 0.928) * b;
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${c(R)}${c(G)}${c(B)}`;
}

/** Whether the paper is light (only light pages are darkened – dark paper is already dark). */
export function isLightPaper(hex: string): boolean {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 >= 0.45;
}

const SHIFT_STEPS: [number, number][] = [[0, 0], [1, 0], [2, 1], [1, 2], [0, 2], [-1, 1], [-2, 0], [-1, -1], [0, -2], [1, -1]];
const SHIFT_EVERY_MS = 3 * 60e3;
const DIM_UI_AFTER_MS = 1500;      // the toolbar fades after 1.5 s of writing
const UI_WAKE_DISTANCE = 70;       // px from the toolbar / minimap at which they come back

export const oledCareMixin = defineMixin({
    /** Paper colour to display (dark when dark paper is on). */
    displayPaper(paper: string): string {
        return this.plugin.settings.oledDarkPaper && isLightPaper(paper) ? darkPaperColor(paper) : paper;
    },

    /** Run once when the view opens: activity listeners and timers. */
    setupOledCare() {
        const root = this.contentEl;
        // Dim when idle – an overlay on the note view; the first touch only wakes the screen.
        const veil = root.createDiv({ cls: 'hw-oled-veil' });
        this.oledVeil = veil;
        const wakeVeil = (e: Event) => {
            if (!veil.hasClass('hw-on')) return;
            veil.removeClass('hw-on');
            if (e.type === 'pointerdown') { e.preventDefault(); e.stopPropagation(); }
        };
        veil.addEventListener('pointerdown', wakeVeil);

        const activity = (e: Event) => {
            this.oledLastInput = Date.now();
            if (this.oledVeil?.hasClass('hw-on') && e.type !== 'pointerdown') this.oledVeil.removeClass('hw-on');
        };
        for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const) {
            this.registerDomEvent(window, ev, activity, { capture: true, passive: true } as AddEventListenerOptions);
        }

        // Dimming the toolbar and minimap while writing.
        this.registerDomEvent(this.scrollArea, 'pointerdown', (e: PointerEvent) => {
            if (!this.plugin.settings.oledDimToolbar) return;
            if (this.minimapEl && this.minimapEl.contains(e.target as Node)) return;
            if (this.oledDimTimer !== null) window.clearTimeout(this.oledDimTimer);
            this.oledDimTimer = window.setTimeout(() => { this.oledDimTimer = null; this.setUiDimmed(true); }, DIM_UI_AFTER_MS);
        }, { capture: true });
        this.registerDomEvent(root, 'pointermove', (e: PointerEvent) => {
            if (!this.oledUiDimmed) return;
            if (e.buttons !== 0 && e.pointerType !== 'mouse') return;   // writing in progress
            if (this.nearUi(e.clientX, e.clientY)) this.setUiDimmed(false);
        });
        this.registerDomEvent(root, 'pointerdown', (e: PointerEvent) => {
            // touching the toolbar / minimap brightens them immediately (and works normally)
            if (this.oledUiDimmed && !this.scrollArea.contains(e.target as Node)) this.setUiDimmed(false);
            if (this.oledUiDimmed && this.minimapEl?.contains(e.target as Node)) this.setUiDimmed(false);
        }, { capture: true });

        this.oledLastInput = Date.now();
        // One timer every 10 s: pixel shift and idle.
        this.registerInterval(window.setInterval(() => this.oledTick(), 10e3));
        this.applyOledCare();
    },

    /** Whether a point is near the toolbar or the minimap. */
    nearUi(x: number, y: number): boolean {
        const tb = this.contentEl.querySelector('.hw-toolbar') as HTMLElement | null;
        const near = (el: HTMLElement | null) => {
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return x > r.left - UI_WAKE_DISTANCE && x < r.right + UI_WAKE_DISTANCE && y > r.top - UI_WAKE_DISTANCE && y < r.bottom + UI_WAKE_DISTANCE;
        };
        return near(tb) || near(this.minimapEl);
    },

    setUiDimmed(on: boolean) {
        on = on && this.plugin.settings.oledDimToolbar;
        this.oledUiDimmed = on;
        this.contentEl.toggleClass('hw-oled-ui-dim', on);
    },

    oledTick() {
        const st = this.plugin.settings;
        const now = Date.now();
        const visible = this.contentEl.offsetParent !== null || this.contentEl.getClientRects().length > 0;
        // Pixel shift
        if (st.oledPixelShift && now - this.oledShiftAt >= SHIFT_EVERY_MS) {
            this.oledShiftAt = now;
            this.oledShiftStep = (this.oledShiftStep + 1) % SHIFT_STEPS.length;
            this.applyPixelShift();
        }
        // Idle
        if (st.oledIdleDim && visible && this.oledVeil && !this.oledVeil.hasClass('hw-on')
            && now - this.oledLastInput >= st.oledIdleMinutes * 60e3) {
            this.oledVeil.addClass('hw-on');
        }
    },

    applyPixelShift() {
        const [dx, dy] = this.plugin.settings.oledPixelShift ? SHIFT_STEPS[this.oledShiftStep] : [0, 0];
        this.contentEl.style.setProperty('--hw-shift-x', `${dx}px`);
        this.contentEl.style.setProperty('--hw-shift-y', `${dy}px`);
        this.contentEl.toggleClass('hw-oled-shift', this.plugin.settings.oledPixelShift);
        this.layoutVersion++;   // page positions on screen changed (pen coordinates must be recomputed)
    },

    /** Applies the current settings (after opening the view and after a settings change). */
    applyOledCare() {
        const st = this.plugin.settings;
        this.contentEl.toggleClass('hw-oled-dark', st.oledDarkPaper);
        if (!st.oledDimToolbar) this.setUiDimmed(false);
        if (!st.oledIdleDim) this.oledVeil?.removeClass('hw-on');
        this.applyPixelShift();
    },
});
export type OledCareMethods = typeof oledCareMixin;
