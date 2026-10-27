import { defineMixin } from './mixin';
import { Menu, Notice, Platform } from 'obsidian';
import { Stroke, ImageItem } from '../types';

/** Page context menu (right click, long press, pen button). */
export const contextMenuMixin = defineMixin({
    // Opens the page menu after all pointers are released (with a short delay so the closing events don't close it).
    requestPageMenu(clientX: number, clientY: number) {
        if (this.menuPending) return;
        this.menuPending = true;
        let done = false;
        const open = () => {
            if (done) return;
            done = true;
            window.removeEventListener('pointerup', onUp, true);
            window.removeEventListener('pointercancel', onUp, true);
            window.setTimeout(() => { this.menuPending = false; this.showPageMenu(clientX, clientY); }, 80);
        };
        const onUp = () => { if (this.pointersDown.size <= 1) open(); };
        if (this.pointersDown.size === 0) { open(); return; }
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('pointercancel', onUp, true);
        window.setTimeout(open, 4000);   // safety net in case the release event gets lost
    },

    // Pen side button action (set in the plugin settings).
    runPenButton(clientX: number, clientY: number) {
        const now = Date.now();
        if (now - this.lastPenButtonAt < 500) return;   // one press is sometimes reported several times
        this.lastPenButtonAt = now;
        const act = this.plugin.settings.penButtonAction;
        if (act === 'snip') {
            if (Platform.isWin) void this.startSnip();
            else new Notice('Snipping Tool is available on Windows only. Change the pen button action in the plugin settings.');
        } else if (act === 'menu') this.requestPageMenu(clientX, clientY);
        else if (act === 'undo') this.undo();
        else if (act === 'redo') this.redo();
    },

    // Menu after a right click or a long finger press.
    showPageMenu(clientX: number, clientY: number) {
        const now = Date.now();
        if (now - this.lastMenuAt < 700) return;   // a long touch is sometimes reported twice (timer + contextmenu)
        this.lastMenuAt = now;

        const idx = this.pageIndexAt(clientX, clientY);
        if (idx >= 0) this.activePageIndex = idx;
        const at = { clientX, clientY };
        const menu = new Menu();

        // Right click on an item (stroke or image) selects it together with its group.
        let onItem = false;
        let locked: { page: number; item: Stroke | ImageItem } | null = null;
        if (idx >= 0) {
            const pos = this.clientToPage(idx, clientX, clientY);
            const sb = this.selection && this.selection.page === idx ? this.getSelectionBounds() : null;
            if (sb && pos.x >= sb.x && pos.x <= sb.x + sb.w && pos.y >= sb.y && pos.y <= sb.y + sb.h) {
                onItem = true;
            } else if (!this.readOnly) {
                // Strokes under the finger / cursor are selected only with the selection tool (otherwise a long press on
                // a written page would always give the selection menu instead of the page menu); images – always.
                const lasso = this.currentTool === 'lasso';
                const pick = (incl: boolean) => {
                    if (lasso) return this.itemAtPoint(idx, pos, incl);
                    const im = this.imageAtPoint(idx, pos, incl);
                    return im ? { image: im } : null;
                };
                const hit = pick(false);
                if (hit) {
                    onItem = true;
                    const g = this.expandGroups(idx, hit.stroke ? [hit.stroke] : [], hit.image ? [hit.image] : []);
                    this.selection = { page: idx, strokes: g.strokes, images: g.images };
                    this.updateSelectionUI();
                    this.redrawPage(idx);
                } else {
                    const lk = pick(true);
                    const it = lk?.stroke ?? lk?.image;
                    if (it && it.lock) locked = { page: idx, item: it };
                }
            }
        }
        if (onItem && this.selection) {
            this.addSelectionMenuItems(menu, { x: clientX, y: clientY });
            if (this.plugin.clip) { menu.addSeparator(); }
        }
        if (this.plugin.clip) menu.addItem(i => i.setTitle('Paste here').setIcon('clipboard-paste').onClick(() => this.pasteClip(at)));
        if (!onItem) {
            if (locked) {
                const lk = locked;
                menu.addItem(i => i.setTitle('Unlock').setIcon('unlock').onClick(() => this.unlockItem(lk.page, lk.item)));
            }
            if (idx >= 0 && this.pageHasLocked(idx)) menu.addItem(i => i.setTitle('Unlock all on this page').setIcon('unlock').onClick(() => this.unlockAllOnPage(idx)));
            menu.addItem(i => i.setTitle('Paste image').setIcon('clipboard-paste').onClick(() => { void this.pasteImageFromClipboard(at); }));
            if (idx >= 0 && this.canEdit()) {
                const has = !!this.noteData.pages[idx]?.title;
                menu.addItem(i => i.setTitle(has ? 'Rename page title…' : 'Page title…').setIcon('heading').onClick(() => this.editPageTitle(idx)));
            }
            menu.addItem(i => i.setTitle('Page style…').setIcon('layout-grid').onClick(() => this.openPageStylePanel({ left: clientX, top: clientY, bottom: clientY })));
            menu.addSeparator();
            this.addPageQuickItems(menu);
        }
        menu.showAtPosition({ x: clientX, y: clientY });
    },
});
export type ContextMenuMethods = typeof contextMenuMixin;
