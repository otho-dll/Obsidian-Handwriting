import { defineMixin } from './mixin';
import { Notice } from 'obsidian';

/**
 * Zoom button on the toolbar: shows the current zoom (e.g. "135%"). Clicking opens a small panel:
 *  − / + (by 10%), "Fit width", "100%", favourite zoom levels (up to 4, saved with one tap)
 *  and an option to open notes at the first favourite zoom.
 */
export const MAX_ZOOM_PRESETS = 4;
const pct = (z: number) => `${Math.round(z * 100)}%`;
/** Same zoom as shown on the button (both rounded to whole percent). */
const sameZoom = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

export const zoomPanelMixin = defineMixin({
    /** Favourite zoom levels (sorted ascending). */
    zoomPresets(): number[] { return this.plugin.settings.zoomPresets; },

    saveZoomPreset() {
        const st = this.plugin.settings;
        const z = Math.round(this.currentZoom * 100) / 100;
        if (st.zoomPresets.some(p => sameZoom(p, z))) { new Notice(`${pct(z)} is already a favourite.`); return; }
        if (st.zoomPresets.length >= MAX_ZOOM_PRESETS) st.zoomPresets.shift();
        st.zoomPresets = [...st.zoomPresets, z].sort((a, b) => a - b);
        void this.plugin.saveSettings();
        this.refreshZoomPanel();
        new Notice(`Favourite zoom saved: ${pct(z)}`);
    },

    removeZoomPreset(z: number) {
        const st = this.plugin.settings;
        st.zoomPresets = st.zoomPresets.filter(p => p !== z);
        if (st.openZoom === z) st.openZoom = 0;
        void this.plugin.saveSettings();
        this.refreshZoomPanel();
    },

    /** Go to a favourite zoom (command: the first in the list, or the next one on repeated calls). */
    cycleZoomPreset() {
        const list = this.plugin.settings.zoomPresets;
        if (list.length === 0) { this.saveZoomPreset(); return; }
        const next = list.find(p => p > this.currentZoom + 0.005) ?? list[0];
        this.zoomKeepingCenter(next);
    },

    /** Zoom button label – updated after every zoom change (once per frame). */
    refreshZoomButton() {
        if (this.zoomBtnRaf) return;
        this.zoomBtnRaf = window.requestAnimationFrame(() => {
            this.zoomBtnRaf = 0;
            const b = this.zoomBtn;
            if (b) { const t = pct(this.currentZoom); if (b.textContent !== t) b.textContent = t; }
            if (this.zoomPanel) this.refreshZoomPanel(true);
        });
    },

    toggleZoomPanel(anchor: HTMLElement) {
        if (this.zoomPanel) { this.closeZoomPanel(); return; }
        const panel = document.body.createDiv({ cls: 'hw-menu hw-zoom-panel' });
        this.zoomPanel = panel;
        this.refreshZoomPanel();
        const r = anchor.getBoundingClientRect();
        panel.style.display = 'flex';
        const w = panel.offsetWidth;
        panel.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
        panel.style.top = `${r.bottom + 8}px`;
        const outside = (e: PointerEvent) => {
            const t = e.target as Node;
            if (panel.contains(t) || anchor.contains(t)) return;
            this.closeZoomPanel();
        };
        document.addEventListener('pointerdown', outside, true);
        this.zoomPanelCleanup = () => document.removeEventListener('pointerdown', outside, true);
    },

    closeZoomPanel() {
        this.zoomPanelCleanup?.();
        this.zoomPanelCleanup = null;
        this.zoomPanel?.remove();
        this.zoomPanel = null;
    },

    /** "+ Save x%" button: shows the current zoom and is hidden when that zoom is already a favourite. */
    updateZoomAddButton(add: HTMLElement) {
        const t = `+ Save ${pct(this.currentZoom)}`;
        if (add.textContent !== t) add.textContent = t;
        add.toggleClass('hw-hidden', this.plugin.settings.zoomPresets.some(p => sameZoom(p, this.currentZoom)));
    },

    /** Builds the panel content (onlyValue = only the current value, without rebuilding the buttons). */
    refreshZoomPanel(onlyValue = false) {
        const panel = this.zoomPanel;
        if (!panel) return;
        const cur = panel.querySelector('.hw-zoom-value');
        if (onlyValue && cur) {
            cur.textContent = pct(this.currentZoom);
            panel.querySelectorAll<HTMLElement>('.hw-zoom-chip').forEach(c => c.toggleClass('active', sameZoom(Number(c.dataset.z), this.currentZoom)));
            const addBtn = panel.querySelector<HTMLElement>('.hw-zoom-add');
            if (addBtn) this.updateZoomAddButton(addBtn);
            return;
        }
        panel.empty();
        const st = this.plugin.settings;
        const row = panel.createDiv({ cls: 'hw-zoom-row' });
        const minus = row.createEl('button', { cls: 'hw-zoom-step', text: '−' });
        row.createDiv({ cls: 'hw-zoom-value', text: pct(this.currentZoom) });
        const plus = row.createEl('button', { cls: 'hw-zoom-step', text: '+' });
        minus.setAttribute('aria-label', 'Zoom out');
        plus.setAttribute('aria-label', 'Zoom in');
        const step = (d: number) => this.zoomKeepingCenter(Math.round((this.currentZoom + d) * 10) / 10);
        minus.onclick = () => step(-0.1);
        plus.onclick = () => step(0.1);

        const quick = panel.createDiv({ cls: 'hw-zoom-row' });
        const fit = quick.createEl('button', { text: 'Fit width' });
        fit.onclick = () => this.fitToWidth();
        const hundred = quick.createEl('button', { text: '100%' });
        hundred.onclick = () => this.zoomKeepingCenter(1);

        panel.createDiv({ cls: 'hw-menu-title', text: 'Favourites' });
        const favs = panel.createDiv({ cls: 'hw-zoom-favs' });
        for (const z of st.zoomPresets) {
            const chip = favs.createDiv({ cls: 'hw-zoom-chip' });
            chip.dataset.z = String(z);
            chip.toggleClass('active', sameZoom(z, this.currentZoom));
            const go = chip.createEl('button', { cls: 'hw-zoom-chip-go', text: pct(z) });
            go.onclick = () => this.zoomKeepingCenter(z);
            const rm = chip.createEl('button', { cls: 'hw-zoom-chip-x', text: '×' });
            rm.setAttribute('aria-label', `Remove ${pct(z)}`);
            rm.onclick = () => this.removeZoomPreset(z);
        }
        const add = favs.createEl('button', { cls: 'hw-zoom-add' });
        add.setAttribute('aria-label', 'Save the current zoom as a favourite');
        add.onclick = () => this.saveZoomPreset();
        this.updateZoomAddButton(add);
        if (st.zoomPresets.length === 0) panel.createDiv({ cls: 'hw-zoom-hint', text: 'Save the zoom you like to write at – one tap brings it back.' });

        // Opening notes at the chosen zoom
        if (st.zoomPresets.length > 0) {
            const openRow = panel.createEl('label', { cls: 'hw-zoom-open' });
            const cb = openRow.createEl('input', { type: 'checkbox' });
            cb.checked = st.openZoom > 0;
            const sel = openRow.createEl('select');
            for (const z of st.zoomPresets) sel.createEl('option', { value: String(z), text: pct(z) });
            sel.value = String(st.openZoom > 0 ? st.openZoom : st.zoomPresets[0]);
            openRow.prepend(cb);
            openRow.insertBefore(document.createTextNode(' Open notes at '), sel);
            const apply = () => { st.openZoom = cb.checked ? Number(sel.value) : 0; void this.plugin.saveSettings(); };
            cb.onchange = apply;
            sel.onchange = () => { cb.checked = true; apply(); };
        }
    },
});
export type ZoomPanelMethods = typeof zoomPanelMixin;
