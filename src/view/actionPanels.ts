import { defineMixin } from './mixin';
import { Platform, setIcon } from 'obsidian';
import { MENU_LAYOUT, quickAction } from '../quickActions';
import { ICON_ERASER, ICON_HIGHLIGHTER, ICON_LASSO_LOOP, ICON_REDO, ICON_SHAPES, ICON_UNDO } from '../icons';
import { hapticsAvailable, setHapticsLevel } from '../haptics';
import { setSvg } from '../svg';

/**
 * One button of an action grid / row. `svg`: icon paths (24-unit box) or `lucide`: an Obsidian icon name.
 * `toggle`: a switch (shown with a check box, keeps the panel open).
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
 * Shared parts of the "panels" and "ribbon" menu styles (Settings → Toolbar → Menu style):
 * the items of each group, a grid / row of labelled buttons and the popover that holds them.
 */
export const actionPanelsMixin = defineMixin({
    /** Whether an action appears in the menus on this device. */
    actionVisible(id: string): boolean {
        const a = quickAction(id);
        return !!a && (!a.windowsOnly || Platform.isWin);
    },

    /** Items for the actions `ids`; `anchor` is where panels opened by an action (zoom, contents) attach. */
    actionItems(ids: string[], anchor: () => HTMLElement | undefined, after?: () => void): ActionItem[] {
        const out: ActionItem[] = [];
        for (const id of ids) {
            const a = quickAction(id);
            if (!a || !this.actionVisible(id)) continue;
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

    /** Switches of the pen and the view (pressure, palm rejection, vibration, two pages). */
    toggleItems(which: 'pen' | 'view'): ActionItem[] {
        const st = this.plugin.settings;
        const change = (apply: () => void) => { apply(); void this.plugin.saveSettings(); this.plugin.refreshViews(); };
        if (which === 'view') {
            return [{ title: 'Two pages side by side', lucide: 'book-open', toggle: true, checked: st.twoPageMode !== 'off',
                run: () => change(() => { st.twoPageMode = st.twoPageMode === 'off' ? 'always' : 'off'; }) }];
        }
        const items: ActionItem[] = [
            { title: 'Pen pressure', lucide: 'pen-tool', toggle: true, checked: st.pressureEnabled, run: () => change(() => { st.pressureEnabled = !st.pressureEnabled; }) },
            { title: 'Palm rejection', lucide: 'hand', toggle: true, checked: st.palmRejection !== 'off', run: () => change(() => { st.palmRejection = st.palmRejection === 'off' ? 'auto' : 'off'; }) },
        ];
        if (hapticsAvailable()) {
            items.push({ title: 'Vibration', lucide: 'vibrate', toggle: true, checked: st.haptics !== 'off',
                run: () => change(() => { st.haptics = st.haptics === 'off' ? 'light' : 'off'; setHapticsLevel(st.haptics); }) });
        }
        return items;
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

    /** Labelled buttons: 'tiles' = a grid of large tiles, 'row' = one row (ribbon), 'list' = rows with a check box. */
    buildActionGrid(host: HTMLElement, items: ActionItem[], variant: 'tiles' | 'row' | 'list' = 'tiles') {
        const box = host.createDiv({ cls: `hw-actions hw-actions-${variant}` });
        for (const it of items) {
            const b = box.createEl('button', { cls: 'hw-action' });
            b.setAttribute('aria-label', it.title);
            if (it.toggle) b.setAttribute('aria-pressed', String(!!it.checked));
            b.toggleClass('is-checked', !!it.checked);
            if (it.disabled) b.disabled = true;
            const ic = b.createSpan({ cls: 'hw-action-icon' });
            if (it.svg) setSvg(ic, this.iconSvg(it.svg));
            else if (it.lucide) setIcon(ic, it.lucide);
            b.createSpan({ cls: 'hw-action-label', text: it.title.replace(/…$/, '') });
            if (it.toggle) b.createSpan({ cls: 'hw-action-check' });
            b.onclick = () => {
                it.run();
                if (it.toggle) { it.checked = !it.checked; b.toggleClass('is-checked', it.checked); b.setAttribute('aria-pressed', String(it.checked)); }
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

    /** "+ Insert" (menu style 'panels'): a grid of everything that inserts something. */
    toggleInsertPanel(anchor: HTMLElement) {
        this.openActionPop('insert', anchor, (pop, close) => {
            pop.createDiv({ cls: 'hw-menu-title', text: 'Insert' });
            this.buildActionGrid(pop, this.actionItems(MENU_LAYOUT.insert, () => anchor, close), 'tiles');
        });
    },

    /** ⋯ in menu style 'panels': hidden tools, then View / File / Pen sections and Settings. */
    toggleMorePanel(anchor: HTMLElement) {
        this.openActionPop('more', anchor, (pop, close) => {
            pop.addClass('hw-more-pop');
            const tools = this.hiddenToolItems(close);
            if (tools.length > 0) this.buildActionGrid(pop, tools, 'row');
            const sec = (title: string, items: ActionItem[], variant: 'tiles' | 'list') => {
                if (items.length === 0) return;
                if (title) pop.createDiv({ cls: 'hw-menu-title', text: title });
                this.buildActionGrid(pop, items, variant);
            };
            sec('View', this.actionItems(MENU_LAYOUT.view, () => anchor, close), 'tiles');
            sec('', this.toggleItems('view'), 'list');
            sec('File', this.actionItems(MENU_LAYOUT.file, () => anchor, close), 'tiles');
            sec('Pen', this.toggleItems('pen'), 'list');
            const foot = pop.createDiv({ cls: 'hw-action-foot' });
            const set = foot.createEl('button', { cls: 'hw-action-settings' });
            setIcon(set.createSpan(), 'settings');
            set.createSpan({ text: 'Settings' });
            set.onclick = () => { close(); this.openPluginSettings(); };
        });
    },
});
export type ActionPanelsMethods = typeof actionPanelsMixin;
