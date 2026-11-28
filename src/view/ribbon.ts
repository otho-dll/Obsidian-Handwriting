import { defineMixin } from './mixin';
import { MENU_LAYOUT } from '../quickActions';
import type { ActionItem } from './actionPanels';

export type RibbonTab = 'draw' | 'insert' | 'view' | 'file' | 'pen';
const TABS: [RibbonTab, string][] = [['draw', 'Draw'], ['insert', 'Insert'], ['view', 'View'], ['file', 'File'], ['pen', 'Pen']];

/**
 * Menu style 'ribbon' (Settings → Toolbar → Menu style): tabs above the toolbar, like an office ribbon.
 * Draw shows the toolbar as it is; the other tabs replace it with one row of labelled buttons, and there is no ⋯.
 * After an action (not a switch) the ribbon goes back to Draw, so you can write right away.
 */
export const ribbonMixin = defineMixin({
    buildRibbon(container: HTMLElement, toolbar: HTMLElement) {
        const tabs = createDiv({ cls: 'hw-ribbon-tabs' });
        tabs.setAttribute('role', 'tablist');
        container.insertBefore(tabs, toolbar);
        const row = toolbar.createDiv({ cls: 'hw-ribbon-row' });
        this.ribbonTabsEl = tabs;
        this.ribbonRowEl = row;
        this.ribbonToolbarEl = toolbar;
        for (const [id, text] of TABS) {
            const b = tabs.createEl('button', { cls: 'hw-ribbon-tab', text });
            b.setAttribute('role', 'tab');
            b.dataset.tab = id;
            b.onclick = () => this.setRibbonTab(this.ribbonTab === id && id !== 'draw' ? 'draw' : id);
        }
        this.register(() => tabs.remove());
    },

    setRibbonTab(tab: RibbonTab) {
        this.ribbonTab = tab;
        const tabs = this.ribbonTabsEl, toolbar = this.ribbonToolbarEl;
        if (!tabs || !toolbar) return;
        tabs.querySelectorAll<HTMLElement>('.hw-ribbon-tab').forEach(b => {
            const on = b.dataset.tab === tab;
            b.toggleClass('is-active', on);
            b.setAttribute('aria-selected', String(on));
        });
        const alt = tab !== 'draw';
        toolbar.toggleClass('hw-ribbon-alt', alt);
        if (alt) { this.closeToolDockPop?.(); this.fillRibbonRow(); }
        else this.ribbonRowEl?.empty();
        // the toolbar moved / changed width: its scroll arrows and fade follow (they listen to 'scroll')
        toolbar.dispatchEvent(new Event('scroll'));
    },

    /** The buttons of the open tab. */
    fillRibbonRow() {
        const row = this.ribbonRowEl, toolbar = this.ribbonToolbarEl;
        if (!row || !toolbar) return;
        row.empty();
        const back = () => this.setRibbonTab('draw');
        const anchor = () => toolbar;
        let items: ActionItem[] = [];
        switch (this.ribbonTab) {
            case 'insert': items = this.actionItems(MENU_LAYOUT.insert, anchor, back); break;
            case 'view': items = [...this.hiddenToolItems(back), ...this.actionItems(MENU_LAYOUT.view, anchor, back), ...this.toggleItems('view')]; break;
            case 'file': items = [...this.actionItems(MENU_LAYOUT.file, anchor, back), { title: 'Settings', lucide: 'settings', run: () => { back(); this.openPluginSettings(); } }]; break;
            case 'pen': items = this.toggleItems('pen'); break;
            default: return;
        }
        this.buildActionGrid(row, items, 'row');
    },

    /** Shows the parts of the chosen menu style: ⋯ (classic, panels), "+ Insert" (panels), the ribbon tabs (ribbon). */
    applyMenuStyle() {
        const style = this.plugin.settings.menuStyle;
        // (a switch in a panel refreshes the views too – the panel stays open unless the style itself changed)
        if (style !== this.menuStyleShown) this.closeActionPop();
        this.menuStyleShown = style;
        this.moreBtn?.toggleClass('hw-hidden-item', style === 'ribbon');
        this.insertBtn?.toggleClass('hw-hidden-item', style !== 'panels');
        this.ribbonTabsEl?.toggleClass('hw-hidden-item', style !== 'ribbon');
        if (style !== 'ribbon') this.setRibbonTab('draw');
        else if (this.ribbonTab !== 'draw') this.fillRibbonRow();   // switches show their new state
        else this.setRibbonTab('draw');
    },
});
export type RibbonMethods = typeof ribbonMixin;
