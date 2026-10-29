import { defineMixin } from './mixin';
import { Menu, Notice, Platform } from 'obsidian';
import { QUICK_ACTIONS } from '../quickActions';

export const menusMixin = defineMixin({
    /** Shows a menu right below the toolbar (not over it), aligned to the button. */
    showMenuBelow(menu: Menu, anchor: HTMLElement) {
        const tb = this.contentEl.querySelector('.hw-toolbar') as HTMLElement | null;
        const r = anchor.getBoundingClientRect();
        const y = (tb ? tb.getBoundingClientRect().bottom : r.bottom) + 2;
        // Button in the right half of the window: menu aligned to its right edge (opens to the left),
        // in the left half – to the left edge. Previously a wide menu was pushed far away from the button.
        if (r.left + r.width / 2 > window.innerWidth / 2) menu.showAtPosition({ x: r.right, y, left: true } as any);
        else menu.showAtPosition({ x: Math.max(8, r.left), y });
    },

    /** "More" menu: flat, no submenus. */
    showMoreMenu(anchorEl: HTMLElement) {
        const st = this.plugin.settings;
        const change = (apply: () => void) => { apply(); void this.plugin.saveSettings(); this.plugin.refreshViews(); };
        const menu = new Menu();

        // Buttons moved from the toolbar to this menu (Settings → Toolbar).
        const hidden = new Set(st.toolbarHidden);
        const tool = (id: string, title: string, icon: string, t: 'eraser' | 'highlighter' | 'lasso' | 'shape') => {
            if (!hidden.has(id)) return false;
            menu.addItem(i => i.setTitle(title).setIcon(icon).setChecked(this.currentTool === t).onClick(() => {
                this.setTool?.(t);
                if (t === 'shape') window.setTimeout(() => this.openShapeOptions?.(anchorEl), 30);
            }));
            return true;
        };
        let any = false;
        any = tool('eraser', 'Eraser', 'eraser', 'eraser') || any;
        any = tool('highlighter', 'Highlighter', 'highlighter', 'highlighter') || any;
        any = tool('lasso', 'Select', 'lasso', 'lasso') || any;
        any = tool('shapes', 'Shapes…', 'shapes', 'shape') || any;
        if (hidden.has('undo')) {
            menu.addItem(i => i.setTitle('Undo').setIcon('undo-2').setDisabled(this.undoStack.length === 0).onClick(() => this.undo()));
            menu.addItem(i => i.setTitle('Redo').setIcon('redo-2').setDisabled(this.redoStack.length === 0).onClick(() => this.redo()));
            any = true;
        }

        // Extra actions: the menu only has what is NOT on the toolbar as a shortcut (Settings → Toolbar).
        const onBar = new Set(st.quickActions);
        type Item = { id: string; title: string; icon: string; run: () => void; checked?: boolean; show?: boolean };
        const groups: Item[][] = [
            [
                { id: 'image', title: 'Insert image…', icon: 'image-plus', run: () => this.importImages() },
                { id: 'screenshot', title: 'Screenshot (Snipping Tool)', icon: 'scissors', run: () => { void this.startSnip(); }, show: Platform.isWin },
                { id: 'plot', title: 'Function plot…', icon: 'line-chart', run: () => this.insertPlot() },
                { id: 'calculator', title: 'Calculator', icon: 'calculator', run: () => this.toggleCalculator(), checked: !!this.calcPanelEl },
            ],
            [
                { id: 'zoom', title: `Zoom (${Math.round(this.currentZoom * 100)}%)…`, icon: 'zoom-in', run: () => window.setTimeout(() => this.toggleZoomPanel(anchorEl), 30) },
                { id: 'contents', title: 'Contents…', icon: 'list', run: () => window.setTimeout(() => this.toggleContentsPanel(anchorEl), 30) },
                { id: 'pages', title: 'Pages and style…', icon: 'files', run: () => { this.activePageIndex = this.pageIndexAtViewCenter(); this.openPagesDialog('pages'); } },
            ],
            [
                { id: 'importpdf', title: 'Import PDF…', icon: 'file-input', run: () => this.importPDF() },
                { id: 'exportpdf', title: 'Export to PDF', icon: 'file-output', run: () => { void this.exportToPDF(); } },
                { id: 'print', title: 'Print…', icon: 'printer', run: () => { void this.printNote(); } },
                { id: 'history', title: 'Version history…', icon: 'history', run: () => this.openVersionHistory() },
            ],
        ];
        for (const g of groups) {
            const items = g.filter(it => it.show !== false && !onBar.has(it.id));
            if (items.length === 0) continue;
            if (any) menu.addSeparator();
            any = true;
            for (const it of items) menu.addItem(i => { i.setTitle(it.title).setIcon(it.icon).onClick(it.run); if (it.checked) i.setChecked(true); });
        }
        if (any) menu.addSeparator();
        menu.addItem(i => i.setTitle('Minimap').setIcon('map').setChecked(st.minimap !== 'off').onClick(() => change(() => { st.minimap = st.minimap === 'off' ? 'always' : 'off'; })));
        menu.addItem(i => i.setTitle('Pen pressure').setIcon('pen-tool').setChecked(st.pressureEnabled).onClick(() => change(() => { st.pressureEnabled = !st.pressureEnabled; })));
        menu.addItem(i => i.setTitle('Palm rejection').setIcon('hand').setChecked(st.palmRejection !== 'off').onClick(() => change(() => { st.palmRejection = st.palmRejection === 'off' ? 'auto' : 'off'; })));
        menu.addItem(i => i.setTitle('Settings').setIcon('settings').onClick(() => this.openPluginSettings()));
        menu.onHide(() => this.moreMenuHidden?.());
        this.showMenuBelow(menu, anchorEl);
    },

    /** Opens the plugin settings (Toolbar section: what's on the toolbar and what's in the ⋯ menu). */
    openPluginSettings() {
        const setting = (this.app as any).setting;
        if (!setting?.open) { new Notice('Open Settings → Community plugins → Handwriting → Toolbar.'); return; }
        setting.open();
        setting.openTabById?.(this.plugin.manifest.id);
    },

    /** Toolbar shortcuts (chosen in the settings). */
    renderQuickSlots() {
        const host = this.quickHost;
        if (!host) return;
        const key = this.plugin.settings.quickActions.join('|');
        if (host.dataset.key === key && host.childElementCount > 0) return;   // unchanged: don't rebuild the buttons
        host.dataset.key = key;
        host.empty();
        this.calcBtn = null;
        this.zoomBtn = null;
        const ids = this.plugin.settings.quickActions;
        for (const id of ids) {
            const a = QUICK_ACTIONS.find(x => x.id === id);
            if (!a) continue;
            if (id === 'zoom') {
                // Zoom button: the current zoom instead of an icon; clicking opens the zoom panel.
                const zb = host.createEl('button', { cls: 'hw-tool-btn hw-zoom-btn', text: `${Math.round(this.currentZoom * 100)}%` });
                zb.setAttribute('aria-label', 'Zoom');
                zb.setAttribute('title', 'Zoom – fit width, 100%, favourite zoom levels');
                zb.onclick = () => this.runQuickAction(id, zb);
                this.zoomBtn = zb;
                continue;
            }
            const btn = this.createToolBtn(host, a.icon);
            btn.setAttribute('aria-label', a.label);
            btn.setAttribute('title', a.label);
            btn.onclick = () => this.runQuickAction(id, btn);
            if (id === 'calculator') { this.calcBtn = btn; this.updateCalcButton(); }
        }
    },

    runQuickAction(id: string, anchor?: HTMLElement) {
        switch (id) {
            case 'zoom': if (anchor) this.toggleZoomPanel(anchor); else this.cycleZoomPreset(); break;
            case 'contents': if (anchor) this.toggleContentsPanel(anchor); else this.openGoToPage(); break;
            case 'calculator': this.toggleCalculator(); break;
            case 'fit': this.fitToWidth(); break;
            case 'plot': this.insertPlot(); break;
            case 'image': this.importImages(); break;
            case 'pages': this.activePageIndex = this.pageIndexAtViewCenter(); this.openPagesDialog('pages'); break;
            case 'screenshot':
                if (Platform.isWin) void this.startSnip();
                else new Notice('Snipping Tool is available on Windows only.');
                break;
            case 'importpdf': this.importPDF(); break;
            case 'exportpdf': void this.exportToPDF(); break;
            case 'print': void this.printNote(); break;
            case 'history': this.openVersionHistory(); break;
        }
    },
});
export type MenusMethods = typeof menusMixin;
