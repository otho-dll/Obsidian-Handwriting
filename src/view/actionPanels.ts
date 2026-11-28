import { defineMixin } from './mixin';
import { Platform, setIcon } from 'obsidian';
import { MENU_LAYOUT, quickAction } from '../quickActions';
import { ICON_ERASER, ICON_HIGHLIGHTER, ICON_LASSO_LOOP, ICON_REDO, ICON_SHAPES, ICON_UNDO } from '../icons';
import { setSvg } from '../svg';

/**
 * One tile of an action panel. `svg`: icon paths (24-unit box) or `lucide`: an Obsidian icon name.
 * `toggle`: a switch – the tile is highlighted while it is on, and the panel stays open.
 */
export interface ActionItem {
    /** The quick action behind it (for its Obsidian menu icon). */
    id?: string;
    title: string;
    svg?: string;
    lucide?: string;
    checked?: boolean;
    toggle?: boolean;
    disabled?: boolean;
    run: () => void;
}

/** Window narrower than this: the panels open as a sheet at the bottom of the window. */
const SHEET_BELOW = 600;

/**
 * Menu style "Insert button and panels" (Settings → Toolbar → Menu style): a "+" panel with everything that inserts
 * something, and ⋯ as a panel of tiles in sections. Like the classic menu, nothing on the toolbar appears twice.
 */
export const actionPanelsMixin = defineMixin({
    /** Whether an action appears in the menus on this device. */
    actionVisible(id: string): boolean {
        const a = quickAction(id);
        return !!a && (!a.windowsOnly || Platform.isWin);
    },

    /**
     * Items for the actions `ids` that are not on the toolbar already; `anchor` is where panels opened by an action
     * (zoom, contents) attach.
     */
    actionItems(ids: string[], anchor: () => HTMLElement | undefined, after?: () => void): ActionItem[] {
        const onBar = new Set(this.plugin.settings.quickActions);
        const out: ActionItem[] = [];
        for (const id of ids) {
            const a = quickAction(id);
            if (!a || !this.actionVisible(id) || onBar.has(id)) continue;
            const title = id === 'zoom' ? `Zoom (${Math.round(this.currentZoom * 100)}%)…` : a.title;
            const checked = id === 'calculator' ? !!this.calcPanelEl : id === 'pages' ? !!this.pagesPanelEl : false;
            out.push({
                id, title, svg: a.icon, checked,
                run: () => {
                    after?.();
                    // panels that open next to a button wait until the menu has gone (its closing tap would close them)
                    if (id === 'zoom' || id === 'contents') window.setTimeout(() => this.runQuickAction(id, anchor()), 30);
                    else this.runQuickAction(id, anchor());
                },
            });
        }
        return out;
    },

    /** Switches of the view (two pages) and the pen (pressure, palm rejection). */
    toggleItems(which: 'pen' | 'view'): ActionItem[] {
        const st = this.plugin.settings;
        const change = (apply: () => void) => { apply(); void this.plugin.saveSettings(); this.plugin.refreshViews(); };
        if (which === 'view') {
            return [{ title: 'Two pages', lucide: 'book-open', toggle: true, checked: st.twoPageMode !== 'off',
                run: () => change(() => { st.twoPageMode = st.twoPageMode === 'off' ? 'always' : 'off'; }) }];
        }
        return [
            { title: 'Pen pressure', lucide: 'pen-tool', toggle: true, checked: st.pressureEnabled, run: () => change(() => { st.pressureEnabled = !st.pressureEnabled; }) },
            { title: 'Palm rejection', lucide: 'shield-check', toggle: true, checked: st.palmRejection !== 'off', run: () => change(() => { st.palmRejection = st.palmRejection === 'off' ? 'auto' : 'off'; }) },
        ];
    },

    /** Tools (and undo / redo) that Settings → Toolbar moved off the toolbar. */
    hiddenToolItems(after?: () => void): ActionItem[] {
        const hidden = new Set(this.plugin.settings.toolbarHidden);
        const out: ActionItem[] = [];
        const tool = (id: string, title: string, icon: { svg?: string; lucide?: string }, t: 'eraser' | 'highlighter' | 'lasso' | 'shape' | 'hand') => {
            if (!hidden.has(id)) return;
            out.push({ title, ...icon, checked: this.currentTool === t, run: () => { after?.(); this.setTool?.(t); } });
        };
        tool('hand', 'Hand', { lucide: 'hand' }, 'hand');
        tool('eraser', 'Eraser', { svg: ICON_ERASER }, 'eraser');
        tool('highlighter', 'Highlighter', { svg: ICON_HIGHLIGHTER }, 'highlighter');
        tool('lasso', 'Select', { svg: ICON_LASSO_LOOP }, 'lasso');
        tool('shapes', 'Shapes', { svg: ICON_SHAPES }, 'shape');
        if (hidden.has('undo')) {
            out.push({ title: 'Undo', svg: ICON_UNDO, disabled: this.undoStack.length === 0, run: () => this.undo() });
            out.push({ title: 'Redo', svg: ICON_REDO, disabled: this.redoStack.length === 0, run: () => this.redo() });
        }
        return out;
    },

    /** A grid of equal tiles (icon above the label). A switch that is on is highlighted and has a ✓. */
    buildActionGrid(host: HTMLElement, items: ActionItem[]) {
        const box = host.createDiv({ cls: 'hw-actions' });
        for (const it of items) {
            const b = box.createEl('button', { cls: 'hw-action' });
            b.setAttribute('aria-label', it.title);
            b.setAttribute('title', it.title);
            if (it.toggle) b.setAttribute('aria-pressed', String(!!it.checked));
            b.toggleClass('is-on', !!it.checked);
            if (it.disabled) b.disabled = true;
            const ic = b.createSpan({ cls: 'hw-action-icon' });
            if (it.svg) setSvg(ic, this.iconSvg(it.svg));
            else if (it.lucide) setIcon(ic, it.lucide);
            b.createSpan({ cls: 'hw-action-label', text: it.title.replace(/…$/, '') });
            if (it.toggle) setIcon(b.createSpan({ cls: 'hw-action-tick' }), 'check');
            b.onclick = () => {
                it.run();
                if (it.toggle) { it.checked = !it.checked; b.toggleClass('is-on', it.checked); b.setAttribute('aria-pressed', String(it.checked)); }
            };
        }
        return box;
    },

    closeActionPop() {
        const c = this.actionPopClose;
        this.actionPopClose = null;
        c?.();
    },

    /**
     * A popover under `anchor` (a bottom sheet in a narrow window). Tapping the same button again closes it.
     * `build` fills it and gets the function that closes it.
     */
    openActionPop(key: string, anchor: HTMLElement, build: (pop: HTMLElement, close: () => void) => void) {
        if (this.actionPopKey === key && this.actionPopClose) { this.closeActionPop(); return; }
        this.closeActionPop();
        const sheet = window.innerWidth < SHEET_BELOW;
        const pop = activeDocument.body.createDiv({ cls: `hw-menu hw-action-pop${sheet ? ' is-sheet' : ''}` });
        let open = true;
        const doc = this.contentEl.ownerDocument;
        const outside = (e: PointerEvent) => { if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(); };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
        const close = () => {
            if (!open) return;
            open = false;
            doc.removeEventListener('pointerdown', outside, true);
            doc.removeEventListener('keydown', onKey, true);
            pop.remove();
            anchor.removeClass('is-open');
            if (this.actionPopKey === key) { this.actionPopKey = null; this.actionPopClose = null; }
        };
        this.actionPopKey = key;
        this.actionPopClose = close;
        build(pop, close);
        anchor.addClass('is-open');
        if (!sheet) {
            const r = anchor.getBoundingClientRect();
            const w = pop.offsetWidth, h = pop.offsetHeight;
            pop.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
            pop.style.top = `${Math.max(8, Math.min(r.bottom + 8, window.innerHeight - h - 8))}px`;
        }
        doc.addEventListener('pointerdown', outside, true);
        doc.addEventListener('keydown', onKey, true);
    },

    /** Sections of tiles; empty sections are left out. */
    fillActionSections(pop: HTMLElement, sections: [string, ActionItem[]][]) {
        for (const [title, items] of sections) {
            if (items.length === 0) continue;
            pop.createDiv({ cls: 'hw-menu-title', text: title });
            this.buildActionGrid(pop, items);
        }
    },

    /** "+ Insert": everything that inserts something and is not on the toolbar already. */
    toggleInsertPanel(anchor: HTMLElement) {
        this.openActionPop('insert', anchor, (pop, close) => {
            this.fillActionSections(pop, [['Insert', this.actionItems(MENU_LAYOUT.insert, () => anchor, close)]]);
        });
    },

    /** ⋯ as a panel: Tools (moved off the toolbar), View, File, Pen (with Settings). */
    toggleMorePanel(anchor: HTMLElement) {
        this.openActionPop('more', anchor, (pop, close) => {
            const settings: ActionItem = { title: 'Settings', lucide: 'settings', run: () => { close(); this.openPluginSettings(); } };
            this.fillActionSections(pop, [
                ['Tools', this.hiddenToolItems(close)],
                ['View', [...this.actionItems(MENU_LAYOUT.view, () => anchor, close), ...this.toggleItems('view')]],
                ['File', this.actionItems(MENU_LAYOUT.file, () => anchor, close)],
                ['Pen', [...this.toggleItems('pen'), settings]],
            ]);
        });
    },

    /** Shows "+" in the panels style, when it has something to show (everything may be on the toolbar already). */
    applyMenuStyle() {
        const style = this.plugin.settings.menuStyle;
        if (style !== this.menuStyleShown) this.closeActionPop();
        this.menuStyleShown = style;
        const empty = this.actionItems(MENU_LAYOUT.insert, () => undefined).length === 0;
        this.insertBtn?.toggleClass('hw-hidden-item', style !== 'panels' || empty);
    },
});
export type ActionPanelsMethods = typeof actionPanelsMixin;
