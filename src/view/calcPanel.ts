import { defineMixin } from './mixin';
import { CalculatorCore } from '../math/calculator';

/** Floating calculator: a panel on the note that can be dragged anywhere. */
export const calcPanelMixin = defineMixin({
    toggleCalculator() {
        if (this.calcPanelEl) { this.closeCalculator(); return; }
        const st = this.plugin.calcState;
        const host = this.contentEl;
        const panel = host.createDiv({ cls: 'hw-calc-float' });
        this.calcPanelEl = panel;
        panel.addEventListener('pointerdown', (e) => e.stopPropagation());
        panel.addEventListener('wheel', (e) => e.stopPropagation());

        const head = panel.createDiv({ cls: 'hw-calc-float-head' });
        head.createSpan({ text: 'Calculator', cls: 'hw-calc-float-title' });
        const close = head.createEl('button', { text: '×', cls: 'hw-calc-float-close' });
        close.setAttribute('aria-label', 'Close calculator');
        close.addEventListener('pointerdown', (e) => e.stopPropagation());
        close.onclick = () => this.closeCalculator();
        const body = panel.createDiv({ cls: 'hw-calc-float-body' });
        const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
        // Opening / closing the history (on the left): the calculator stays in place and the panel grows to the left.
        let lastW = 0;
        const core = new CalculatorCore(body, st, coarse, () => {
            const w = panel.offsetWidth;
            if (st.pos) place(st.pos.x - (w - lastW), st.pos.y);
            lastW = panel.offsetWidth;
        });
        core.build();

        // Position: remembered, or the top-right corner of the view (below the toolbar).
        const place = (x: number, y: number) => {
            const hw = host.clientWidth, hh = host.clientHeight;
            const px = Math.max(0, Math.min(hw - panel.offsetWidth, x));
            const py = Math.max(0, Math.min(hh - 40, y));
            panel.style.left = px + 'px';
            panel.style.top = py + 'px';
            st.pos = { x: px, y: py };
        };
        if (st.pos) place(st.pos.x, st.pos.y);
        else place(host.clientWidth - panel.offsetWidth - 16, 60);
        lastW = panel.offsetWidth;

        // Dragging by the header.
        let drag: { dx: number; dy: number; id: number } | null = null;
        head.addEventListener('pointerdown', (e: PointerEvent) => {
            if ((e.target as HTMLElement).closest('button')) return;
            const r = panel.getBoundingClientRect();
            drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId };
            head.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        head.addEventListener('pointermove', (e: PointerEvent) => {
            if (!drag || e.pointerId !== drag.id) return;
            const hr = host.getBoundingClientRect();
            place(e.clientX - hr.left - drag.dx, e.clientY - hr.top - drag.dy);
        });
        const end = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) drag = null; };
        head.addEventListener('pointerup', end);
        head.addEventListener('pointercancel', end);
        if (!coarse) core.focus();
        this.updateCalcButton();
    },

    closeCalculator() {
        if (this.calcPanelEl) { this.calcPanelEl.remove(); this.calcPanelEl = null; }
        this.updateCalcButton();
    },

    updateCalcButton() {
        this.calcBtn?.toggleClass('active', !!this.calcPanelEl);
    },
});
export type CalcPanelMethods = typeof calcPanelMixin;
