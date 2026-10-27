import { defineMixin } from './mixin';
import { Menu, setIcon } from 'obsidian';
import { newId } from '../utils';
import { Point, Stroke, ImageItem, BBox, AttrChange, HistoryEntry } from '../types';

type Item = Stroke | ImageItem;
interface Unit { strokes: Stroke[]; images: ImageItem[]; b: BBox; }
export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'distH' | 'distV';

/** Selection editing: colour and thickness, groups, layer order, duplicating, locking and aligning. */
export const selectionEditMixin = defineMixin({
    // --- HIT TESTING AND GROUPS ---

    /** Topmost stroke under a point (tolerance depends on zoom). */
    strokeAtPoint(page: number, pos: Point, includeLocked = false): Stroke | null {
        const list = this.noteData.pages[page]?.strokes ?? [];
        const tol = 6 / Math.max(0.5, this.currentZoom);
        for (let k = list.length - 1; k >= 0; k--) {
            const s = list[k];
            if (s.isEraser || (s.lock && !includeLocked)) continue;
            const bb = this.getStrokeBBox(s);
            if (pos.x < bb.x0 - tol || pos.x > bb.x1 + tol || pos.y < bb.y0 - tol || pos.y > bb.y1 + tol) continue;
            if (s.shape) { if (this.shapeHit(s, pos, pos, tol)) return s; continue; }
            const r = tol + s.width * 0.75;
            const pts = s.points;
            if (pts.length === 1) { if (Math.hypot(pts[0].x - pos.x, pts[0].y - pos.y) <= r) return s; continue; }
            for (let i = 1; i < pts.length; i++) if (this.distPointSeg(pos, pts[i - 1], pts[i]) <= r) return s;
        }
        return null;
    },

    /** Item under a point: strokes lie above images, so they are checked first. */
    itemAtPoint(page: number, pos: Point, includeLocked = false): { stroke?: Stroke; image?: ImageItem } | null {
        const s = this.strokeAtPoint(page, pos, includeLocked);
        if (s) return { stroke: s };
        const i = this.imageAtPoint(page, pos, includeLocked);
        return i ? { image: i } : null;
    },

    /** Adds the remaining (unlocked) items of the same groups to the list – in page order. */
    expandGroups(page: number, strokes: Stroke[], images: ImageItem[]): { strokes: Stroke[]; images: ImageItem[] } {
        const data = this.noteData.pages[page];
        const gs = new Set<string>();
        for (const it of [...strokes, ...images]) if (it.g) gs.add(it.g);
        if (!data || gs.size === 0) return { strokes, images };
        const sSet = new Set(strokes), iSet = new Set(images);
        return {
            strokes: data.strokes.filter(s => sSet.has(s) || (!!s.g && gs.has(s.g) && !s.lock && !s.isEraser)),
            images: (data.images ?? []).filter(i => iSet.has(i) || (!!i.g && gs.has(i.g) && !i.lock)),
        };
    },

    /** Tap selection (no loop): the stroke or image under the point, together with its whole group. */
    selectAt(page: number, pos: Point) {
        const hit = this.itemAtPoint(page, pos);
        if (!hit) { this.selection = null; this.updateSelectionUI(); return; }
        const g = this.expandGroups(page, hit.stroke ? [hit.stroke] : [], hit.image ? [hit.image] : []);
        this.selection = { page, strokes: g.strokes, images: g.images };
        this.updateSelectionUI();
    },

    selectionItems(): Item[] {
        const sel = this.selection;
        return sel ? [...sel.strokes, ...sel.images] : [];
    },

    unitBBox(strokes: Stroke[], images: ImageItem[]): BBox {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const s of strokes) {
            const b = this.getStrokeBBox(s);
            x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
        }
        for (const i of images) for (const p of this.imageCorners(i)) {
            x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
        }
        return { x0, y0, x1, y1 };
    },

    /** Selection split into "units": each group is one unit, each ungrouped item is a separate one. */
    selectionUnits(): Unit[] {
        const sel = this.selection;
        if (!sel) return [];
        const byGroup = new Map<string, { strokes: Stroke[]; images: ImageItem[] }>();
        const units: { strokes: Stroke[]; images: ImageItem[] }[] = [];
        const put = (it: Item, isImg: boolean) => {
            let u: { strokes: Stroke[]; images: ImageItem[] } | undefined;
            if (it.g) {
                u = byGroup.get(it.g);
                if (!u) { u = { strokes: [], images: [] }; byGroup.set(it.g, u); units.push(u); }
            } else {
                u = { strokes: [], images: [] };
                units.push(u);
            }
            if (isImg) u.images.push(it as ImageItem); else u.strokes.push(it as Stroke);
        };
        for (const s of sel.strokes) put(s, false);
        for (const i of sel.images) put(i, true);
        return units.map(u => ({ ...u, b: this.unitBBox(u.strokes, u.images) }));
    },

    // --- ATTRIBUTE CHANGES (undoable) ---

    /** Changes item attributes and records it in history. `mergeKey` merges quick consecutive changes into one step. */
    commitAttrs(page: number, items: Item[], patch: (it: Item) => Record<string, unknown> | null, mergeKey?: string) {
        const changes: AttrChange[] = [];
        for (const it of items) {
            const after = patch(it);
            if (!after) continue;
            const rec = it as unknown as Record<string, unknown>;
            const before: Record<string, unknown> = {};
            let differs = false;
            for (const k of Object.keys(after)) {
                before[k] = rec[k];
                if (rec[k] !== after[k]) differs = true;
            }
            if (differs) changes.push({ item: it, before, after });
        }
        if (changes.length === 0) return false;
        this.applyAttrChanges(changes, 'after');
        const last = this.undoStack[this.undoStack.length - 1];
        const now = Date.now();
        if (mergeKey && last && last === this.lastAttrEntry?.entry && this.lastAttrEntry.key === mergeKey && now - this.lastAttrEntry.at < 2500 && last.type === 'attrs') {
            // Consecutive colour slider moves: one undo step (the "before" state stays from the first change).
            for (const c of changes) {
                const prev = last.changes.find(x => x.item === c.item);
                if (prev) prev.after = { ...prev.after, ...c.after }; else last.changes.push(c);
            }
            this.lastAttrEntry.at = now;
        } else {
            const entry: HistoryEntry = { type: 'attrs', page, changes };
            this.pushHistoryAction(entry);
            this.lastAttrEntry = mergeKey ? { entry, key: mergeKey, at: now } : null;
        }
        this.requestSave();
        this.redrawPage(page);
        return true;
    },

    /** Palette kind for the selection: highlighter (when only highlighters are selected), pen, or no strokes. */
    selectionStyleKind(): 'pen' | 'highlighter' | null {
        const s = this.selection?.strokes ?? [];
        if (s.length === 0) return null;
        return s.every(x => x.isHighlighter) ? 'highlighter' : 'pen';
    },

    selectionColor(): string | null {
        const kind = this.selectionStyleKind();
        const s = (this.selection?.strokes ?? []).filter(x => kind === 'highlighter' || !x.isHighlighter);
        if (s.length === 0) return null;
        const c = s[0].color.toLowerCase();
        return s.every(x => x.color.toLowerCase() === c) ? c : null;
    },

    sizesFor(s: Stroke): number[] {
        return s.isHighlighter ? this.highSizes : s.shape ? this.shapeSizes : this.penSizes;
    },

    /** Thickness index (0–2) shared by the selected strokes, or -1. */
    selectionSizeIndex(): number {
        const s = this.selection?.strokes ?? [];
        if (s.length === 0) return -1;
        const idx = (x: Stroke) => this.sizesFor(x).findIndex(w => Math.abs(w - x.width) < 0.01);
        const first = idx(s[0]);
        return s.every(x => idx(x) === first) ? first : -1;
    },

    setSelectionColor(color: string) {
        const sel = this.selection;
        const kind = this.selectionStyleKind();
        if (!sel || !kind) return;
        const c = color.toLowerCase();
        const items = sel.strokes.filter(s => kind === 'highlighter' || !s.isHighlighter);
        this.commitAttrs(sel.page, items, () => ({ color: c }), 'color');
    },

    /** Shared opacity of the selected pen strokes (null = mixed / none). */
    selectionAlpha(): number | null {
        const s = (this.selection?.strokes ?? []).filter(x => !x.isHighlighter);
        if (s.length === 0) return null;
        const a = s[0].alpha ?? 1;
        return s.every(x => Math.abs((x.alpha ?? 1) - a) < 0.001) ? a : null;
    },

    setSelectionAlpha(alpha: number) {
        const sel = this.selection;
        if (!sel) return;
        const items = sel.strokes.filter(s => !s.isHighlighter);
        this.commitAttrs(sel.page, items, () => ({ alpha: alpha >= 1 ? undefined : alpha }));
        this.refreshToolbarUI?.();
    },

    setSelectionSize(index: number) {
        const sel = this.selection;
        if (!sel || sel.strokes.length === 0) return;
        this.commitAttrs(sel.page, sel.strokes, (it) => {
            const s = it as Stroke;
            const w = this.sizesFor(s)[index];
            return w === undefined ? null : { width: w };
        });
        this.refreshToolbarUI?.();
    },

    // --- GROUPS ---
    canGroupSelection(): boolean { return this.selectionUnits().length >= 2; },
    canUngroupSelection(): boolean { return this.selectionItems().some(i => !!i.g); },

    groupSelection() {
        const sel = this.selection;
        if (!sel || !this.canGroupSelection()) return;
        const g = newId();
        this.commitAttrs(sel.page, this.selectionItems(), () => ({ g }));
        this.updateSelectionUI();
    },

    ungroupSelection() {
        const sel = this.selection;
        if (!sel) return;
        this.commitAttrs(sel.page, this.selectionItems(), (it) => it.g ? { g: undefined } : null);
        this.updateSelectionUI();
    },

    // --- LOCKING ---
    lockSelection() {
        const sel = this.selection;
        if (!sel) return;
        const items = this.selectionItems();
        this.selection = null;
        this.commitAttrs(sel.page, items, () => ({ lock: true }));
        this.updateSelectionUI();
    },

    /** Unlocks an item together with its group and selects them. */
    unlockItem(page: number, item: Item) {
        const data = this.noteData.pages[page];
        if (!data) return;
        const g = item.g;
        const strokes = data.strokes.filter(s => s === item || (!!g && s.g === g));
        const images = (data.images ?? []).filter(i => i === item || (!!g && i.g === g));
        this.commitAttrs(page, [...strokes, ...images], (it) => it.lock ? { lock: undefined } : null);
        this.activateLassoForInsert();
        this.selection = { page, strokes, images };
        this.updateSelectionUI();
        this.redrawPage(page);
    },

    pageHasLocked(page: number): boolean {
        const d = this.noteData.pages[page];
        return !!d && (d.strokes.some(s => s.lock) || (d.images ?? []).some(i => i.lock));
    },

    unlockAllOnPage(page: number) {
        const d = this.noteData.pages[page];
        if (!d) return;
        this.commitAttrs(page, [...d.strokes, ...(d.images ?? [])], (it) => it.lock ? { lock: undefined } : null);
    },

    // --- LAYER ORDER ---
    /** Bring to front / send to back (strokes relative to strokes, images relative to images – strokes always lie above images). */
    arrangeSelection(where: 'front' | 'back') {
        const sel = this.selection;
        const page = sel ? this.noteData.pages[sel.page] : null;
        if (!sel || !page) return;
        const images = page.images ?? [];
        const before = { strokes: [...page.strokes], images: [...images] };
        const sS = new Set(sel.strokes), sI = new Set(sel.images);
        const move = <T,>(list: T[], set: Set<T>) => {
            const a = list.filter(x => set.has(x)), rest = list.filter(x => !set.has(x));
            return where === 'front' ? [...rest, ...a] : [...a, ...rest];
        };
        page.strokes = move(page.strokes, sS);
        page.images = move(images, sI);
        this.pushHistoryAction({ type: 'order', page: sel.page, before, after: { strokes: [...page.strokes], images: [...page.images] } });
        this.requestSave();
        this.redrawPage(sel.page);
    },

    // --- DUPLICATING ---
    /** Copies of items: new image ids and new groups (a copy of a group is a separate group), unlocked. */
    cloneItems(strokes: Stroke[], images: ImageItem[]): { strokes: Stroke[]; images: ImageItem[] } {
        const remap = new Map<string, string>();
        const g = (old?: string) => {
            if (!old) return undefined;
            let n = remap.get(old);
            if (!n) { n = newId(); remap.set(old, n); }
            return n;
        };
        const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
        const fix = <T extends Item>(it: T): T => {
            const c = clone(it);
            const ng = g(it.g);
            if (ng) c.g = ng; else delete c.g;
            delete c.lock;
            return c;
        };
        return {
            strokes: strokes.map(s => fix(s)),
            images: images.map(i => ({ ...fix(i), id: newId() })),
        };
    },

    duplicateSelection() {
        const sel = this.selection;
        const page = sel ? this.noteData.pages[sel.page] : null;
        if (!sel || !page) return;
        const c = this.cloneItems(sel.strokes, sel.images);
        const b = this.unitBBox(c.strokes, c.images);
        if (!isFinite(b.x0)) return;
        // The copy is slightly offset (within the page) so it's visible that it was created.
        const off = 20;
        const dx = Math.max(-b.x0, Math.min(this.pageW(sel.page) - b.x1, off));
        const dy = Math.max(-b.y0, Math.min(this.pageH(sel.page) - b.y1, off));
        this.translateItems(c.strokes, c.images, dx, dy);
        page.strokes.push(...c.strokes);
        (page.images ?? (page.images = [])).push(...c.images);
        this.pushHistoryAction({ type: 'paste', page: sel.page, strokes: c.strokes, images: c.images });
        this.selection = { page: sel.page, strokes: c.strokes, images: c.images };
        this.updateSelectionUI();
        this.requestSave();
        this.redrawPage(sel.page);
    },

    // --- ALIGNING ---
    alignSelection(mode: AlignMode) {
        const sel = this.selection;
        if (!sel) return;
        const units = this.selectionUnits().filter(u => isFinite(u.b.x0));
        if (units.length < 2 || ((mode === 'distH' || mode === 'distV') && units.length < 3)) return;
        const X0 = Math.min(...units.map(u => u.b.x0)), X1 = Math.max(...units.map(u => u.b.x1));
        const Y0 = Math.min(...units.map(u => u.b.y0)), Y1 = Math.max(...units.map(u => u.b.y1));
        const moves: { strokes: Stroke[]; images: ImageItem[]; dx: number; dy: number }[] = [];
        const add = (u: Unit, dx: number, dy: number) => {
            if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
            moves.push({ strokes: u.strokes, images: u.images, dx, dy });
        };
        if (mode === 'distH' || mode === 'distV') {
            const h = mode === 'distH';
            const sorted = [...units].sort((a, b) => h ? (a.b.x0 + a.b.x1) - (b.b.x0 + b.b.x1) : (a.b.y0 + a.b.y1) - (b.b.y0 + b.b.y1));
            const size = (u: Unit) => h ? u.b.x1 - u.b.x0 : u.b.y1 - u.b.y0;
            const total = sorted.reduce((s, u) => s + size(u), 0);
            const gap = ((h ? X1 - X0 : Y1 - Y0) - total) / (sorted.length - 1);
            let pos = h ? X0 : Y0;
            for (const u of sorted) {
                const d = pos - (h ? u.b.x0 : u.b.y0);
                add(u, h ? d : 0, h ? 0 : d);
                pos += size(u) + gap;
            }
        } else {
            for (const u of units) {
                const b = u.b;
                switch (mode) {
                    case 'left': add(u, X0 - b.x0, 0); break;
                    case 'right': add(u, X1 - b.x1, 0); break;
                    case 'hcenter': add(u, (X0 + X1) / 2 - (b.x0 + b.x1) / 2, 0); break;
                    case 'top': add(u, 0, Y0 - b.y0); break;
                    case 'bottom': add(u, 0, Y1 - b.y1); break;
                    case 'vcenter': add(u, 0, (Y0 + Y1) / 2 - (b.y0 + b.y1) / 2); break;
                }
            }
        }
        if (moves.length === 0) return;
        for (const m of moves) this.translateItems(m.strokes, m.images, m.dx, m.dy);
        this.pushHistoryAction({ type: 'multiMove', page: sel.page, moves });
        this.requestSave();
        this.redrawPage(sel.page);
    },

    /** Small panel with alignment buttons (stays open until you click elsewhere). */
    openAlignPanel(clientX: number, clientY: number) {
        document.querySelectorAll('.hw-align-pop').forEach(el => el.remove());
        const pop = document.body.createDiv({ cls: 'hw-menu hw-align-pop' });
        const row = (title: string, items: [AlignMode, string, string][]) => {
            const g = pop.createDiv({ cls: 'hw-menu-group' });
            g.createDiv({ cls: 'hw-menu-title', text: title });
            const r = g.createDiv({ cls: 'hw-menu-row' });
            for (const [mode, icon, label] of items) {
                const b = r.createEl('button', { cls: 'hw-tool-btn hw-menu-btn' });
                setIcon(b, icon);
                b.setAttribute('aria-label', label);
                b.setAttribute('title', label);
                b.onclick = () => this.alignSelection(mode);
            }
        };
        row('Align', [
            ['left', 'align-start-vertical', 'Align left'],
            ['hcenter', 'align-center-vertical', 'Align centers horizontally'],
            ['right', 'align-end-vertical', 'Align right'],
            ['top', 'align-start-horizontal', 'Align top'],
            ['vcenter', 'align-center-horizontal', 'Align centers vertically'],
            ['bottom', 'align-end-horizontal', 'Align bottom'],
        ]);
        if (this.selectionUnits().length >= 3) row('Distribute evenly', [
            ['distH', 'align-horizontal-distribute-center', 'Distribute horizontally'],
            ['distV', 'align-vertical-distribute-center', 'Distribute vertically'],
        ]);
        pop.style.display = 'flex';
        const w = pop.offsetWidth, h = pop.offsetHeight;
        pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, clientX))}px`;
        pop.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, clientY))}px`;
        const close = (e: PointerEvent) => {
            if (pop.contains(e.target as Node)) return;
            pop.remove();
            document.removeEventListener('pointerdown', close, true);
        };
        window.setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
        this.register(() => pop.remove());
    },

    // --- MENU ZAZNACZENIA ---
    /** Menu items for the selection (right click / long press on the selection, toolbar button). No submenus. */
    addSelectionMenuItems(menu: Menu, at: { x: number; y: number }) {
        const sel = this.selection;
        if (!sel) return;
        if (sel.strokes.length === 0 && sel.images.length === 1) {
            const target = sel.images[0], pg = sel.page;
            if (target.plot) menu.addItem(i => i.setTitle('Edit plot…').setIcon('line-chart').onClick(() => this.editPlot(pg, target)));
            menu.addItem(i => i.setTitle('Crop image…').setIcon('crop').onClick(() => this.startImageCrop(pg, target)));
        }
        menu.addItem(i => i.setTitle('Cut').setIcon('scissors').onClick(() => this.copySelection(true)));
        menu.addItem(i => i.setTitle('Copy').setIcon('copy').onClick(() => this.copySelection(false)));
        menu.addItem(i => i.setTitle('Duplicate').setIcon('copy-plus').onClick(() => this.duplicateSelection()));
        menu.addSeparator();
        if (this.canGroupSelection()) menu.addItem(i => i.setTitle('Group').setIcon('group').onClick(() => this.groupSelection()));
        if (this.canUngroupSelection()) menu.addItem(i => i.setTitle('Ungroup').setIcon('ungroup').onClick(() => this.ungroupSelection()));
        menu.addItem(i => i.setTitle('Bring to front').setIcon('bring-to-front').onClick(() => this.arrangeSelection('front')));
        menu.addItem(i => i.setTitle('Send to back').setIcon('send-to-back').onClick(() => this.arrangeSelection('back')));
        if (this.selectionUnits().length >= 2) menu.addItem(i => i.setTitle('Align…').setIcon('align-center-horizontal').onClick(() => window.setTimeout(() => this.openAlignPanel(at.x, at.y), 30)));
        menu.addItem(i => i.setTitle('Lock').setIcon('lock').onClick(() => this.lockSelection()));
        menu.addSeparator();
        menu.addItem(i => i.setTitle('Rotate right 90°').setIcon('rotate-cw').onClick(() => this.rotateSelectionBy(Math.PI / 2)));
        menu.addItem(i => i.setTitle('Rotate left 90°').setIcon('rotate-ccw').onClick(() => this.rotateSelectionBy(-Math.PI / 2)));
        menu.addItem(i => i.setTitle('Delete').setIcon('trash-2').onClick(() => this.deleteSelection()));
    },

    /** Selection menu opened with the toolbar button (handy on a tablet). */
    showSelectionMenu(anchor: HTMLElement) {
        if (!this.selection) return;
        const menu = new Menu();
        const r = anchor.getBoundingClientRect();
        this.addSelectionMenuItems(menu, { x: r.left, y: r.bottom + 8 });
        this.showMenuBelow(menu, anchor);
    },
});
export type SelectionEditMethods = typeof selectionEditMixin;
