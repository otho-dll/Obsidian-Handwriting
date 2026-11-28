import { defineMixin } from './mixin';
import { Menu, setIcon } from 'obsidian';
import { ICON_PEN, ICON_ERASER, ICON_HIGHLIGHTER, ICON_UNDO, ICON_REDO, ICON_TRASH, ICON_SELECT_RECT, ICON_MORE, ICON_INSERT, ICON_SHAPE_LINE, ICON_SHAPE_RECT, ICON_SHAPE_ELLIPSE, ICON_SHAPE_TRIANGLE, ICON_TRI_ISO, ICON_TRI_RIGHT, ICON_FILL, ICON_FILL_NONE, ICON_FILL_LIGHT, ICON_NO_OUTLINE, ICON_LASSO_LOOP, ICON_ARROW, ICON_DASH_SOLID, ICON_DASH_DASHED, ICON_DASH_DOTTED, ICON_DASH_DASHDOT, ICON_SHAPES, ICON_RIGHT_ANGLE_PATH, ICON_SPLIT, shapeFillIcons, thicknessWaveSvg } from '../icons';
import { Stroke } from '../types';
import { setSvg, appendSvg } from '../svg';

export const toolbarMixin = defineMixin({
    createToolBtn(parent: HTMLElement, svgPath: string, isActive = false) {
        const btn = parent.createEl("button", { cls: `hw-tool-btn ${isActive ? 'active' : ''}` });
        setSvg(btn, this.iconSvg(svgPath));
        return btn;
    },

    iconSvg(svgPath: string) {
        return `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none">${svgPath}</svg>`;
    },

    shapeIcon() {
        if (this.shapeType === 'line') return ICON_SHAPE_LINE;
        if (this.shapeType === 'ellipse') return ICON_SHAPE_ELLIPSE;
        if (this.shapeType === 'triangle') return this.shapeTriRight ? ICON_TRI_RIGHT : ICON_SHAPE_TRIANGLE;
        return ICON_SHAPE_RECT;
    },

    // Colour palette: round swatches with a clear selection ring; custom colours are remembered next to the presets.
    renderPalette(container: HTMLElement, presets: string[], activeColor: string, kind: 'pen' | 'highlighter' | 'shape', onChange: (c: string) => void) {
        container.empty();
        const wrapper = container.createDiv({ cls: "hw-color-palette" });
        const swatches: HTMLElement[] = [];
        let current = activeColor.toLowerCase();

        const refresh = () => swatches.forEach(b => b.toggleClass('active', b.dataset.color === current));
        const addSwatch = (c: string, extra: string) => {
            const b = wrapper.createEl("button", { cls: `hw-swatch ${extra}` });
            b.style.setProperty('--sw', c);
            b.dataset.color = c.toLowerCase();
            b.setAttribute('aria-label', c);
            b.setAttribute('title', c);
            b.onclick = () => { current = c.toLowerCase(); refresh(); onChange(c); };
            swatches.push(b);
        };
        presets.forEach(c => addSwatch(c, ''));
        const customs = () => kind === 'pen' ? this.customPen : kind === 'shape' ? this.customShape : this.customHigh;
        const setCustoms = (next: string[]) => {
            if (kind === 'pen') this.customPen = next; else if (kind === 'shape') this.customShape = next; else this.customHigh = next;
            this.persistMemory();
        };
        // Custom colours can be removed: the small × (mouse hover), right click or a long press (touch / pen).
        const removeCustom = (c: string) => {
            setCustoms(customs().filter(x => x !== c));
            this.renderPalette(container, presets, current, kind, onChange);
            this.refitToolDock?.();   // the palette got narrower
        };
        customs().forEach(c => {
            if (presets.includes(c)) return;
            addSwatch(c, 'custom');
            const b = swatches[swatches.length - 1];
            b.setAttribute('title', `${c} – right click or long press to remove`);
            const x = b.createSpan({ cls: 'hw-swatch-x', text: '×' });
            x.setAttribute('aria-label', `Remove ${c}`);
            x.onclick = (e) => { e.stopPropagation(); removeCustom(c); };
            const menu = (e: MouseEvent | PointerEvent) => {
                const m = new Menu();
                m.addItem(i => i.setTitle('Remove color').setIcon('trash-2').onClick(() => removeCustom(c)));
                m.showAtMouseEvent(e);
            };
            b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); menu(e); });
            let timer = 0, longPressed = false;
            b.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'mouse') return;
                longPressed = false;
                const sx = e.clientX, sy = e.clientY;
                const cancel = () => { window.clearTimeout(timer); b.removeEventListener('pointermove', move); };
                const move = (ev: PointerEvent) => { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 10) cancel(); };
                b.addEventListener('pointermove', move);
                b.addEventListener('pointerup', cancel, { once: true });
                b.addEventListener('pointercancel', cancel, { once: true });
                timer = window.setTimeout(() => { longPressed = true; cancel(); menu(e); }, 550);
            });
            // A long press must not also pick the colour when the finger is lifted.
            b.addEventListener('click', (e) => { if (longPressed) { longPressed = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
        });

        const addBtn = wrapper.createEl("button", { cls: "hw-swatch-add" });
        addBtn.setAttribute('aria-label', 'Custom color');
        addBtn.setAttribute('title', 'Custom color');
        const picker = wrapper.createEl("input", { type: "color", cls: "hw-color-input" });
        addBtn.onclick = () => { picker.value = current; picker.click(); };
        picker.oninput = () => { current = picker.value.toLowerCase(); refresh(); onChange(picker.value); };
        picker.onchange = () => {
            const c = picker.value.toLowerCase();
            if (!presets.includes(c) && !customs().includes(c)) setCustoms([c, ...customs()].slice(0, 3));
            this.renderPalette(container, presets, c, kind, onChange);
            this.refitToolDock?.();   // the palette got wider
        };

        refresh();
    },

    renderToolbar(container: HTMLElement) {
        const toolbar = container.createDiv({ cls: "hw-toolbar" });
        const label = (el: HTMLElement, text: string) => { el.setAttribute('aria-label', text); el.setAttribute('title', text); };

        let markHiddenTool = () => { };
        // Tool options in the dock (Settings → Toolbar → Tool options); assigned below, once all the groups exist.
        let placeOptions = () => { };
        let refreshChips = () => { };   // dock chips show the current colour / thickness (assigned below)
        const dockMode = () => this.plugin.settings.toolOptionsLayout === 'dock';
        // --- TOOLS ---
        const secTools = toolbar.createDiv({ cls: "hw-tool-section" });
        const penBtn = this.createToolBtn(secTools, ICON_PEN, true);
        label(penBtn, 'Pen');
        const eraserBtn = this.createToolBtn(secTools, ICON_ERASER);
        label(eraserBtn, 'Eraser');
        const highBtn = this.createToolBtn(secTools, ICON_HIGHLIGHTER);
        label(highBtn, 'Highlighter');
        const selIcon = () => this.plugin.settings.selectMode === 'rect' ? ICON_SELECT_RECT : ICON_LASSO_LOOP;
        const selLabel = () => this.plugin.settings.selectMode === 'rect' ? 'Rectangle selection (click again to change mode)' : 'Lasso selection (click again to change mode)';
        const lassoBtn = this.createToolBtn(secTools, selIcon());
        label(lassoBtn, selLabel());

        // Shapes menu (next to the other tools)
        const secShapes = secTools.createDiv({ cls: "hw-shapes-section" });
        const shapeBtn = this.createToolBtn(secShapes, ICON_SHAPES);
        label(shapeBtn, 'Shapes');
        // Hand: dragging with the mouse / pen moves the page (fingers scroll anyway). Off the toolbar by default.
        const handBtn = secTools.createEl('button', { cls: 'hw-tool-btn' });
        setIcon(handBtn, 'hand');
        label(handBtn, 'Hand (drag to move the page)');

        toolbar.createDiv({ cls: "hw-toolbar-divider" });

        // --- HISTORY ---
        const secHistory = toolbar.createDiv({ cls: "hw-tool-section" });
        this.undoBtn = this.createToolBtn(secHistory, ICON_UNDO);
        label(this.undoBtn, 'Undo (Ctrl+Z)');
        this.undoBtn.onclick = () => this.undo();
        this.redoBtn = this.createToolBtn(secHistory, ICON_REDO);
        label(this.redoBtn, 'Redo (Ctrl+Y)');
        this.redoBtn.onclick = () => this.redo();
        this.updateUndoRedoUI();
        // The trash button appears only when something is selected
        this.deleteSelBtn = this.createToolBtn(secHistory, ICON_TRASH);
        label(this.deleteSelBtn, 'Delete selection (Del)');
        this.deleteSelBtn.onclick = () => this.deleteSelection();
        // Selection options (grouping, order, alignment…) – same as right-clicking the selection.
        this.selMenuBtn = secHistory.createEl('button', { cls: 'hw-tool-btn' });
        setIcon(this.selMenuBtn, 'sliders-horizontal');
        label(this.selMenuBtn, 'Selection options');
        const smb = this.selMenuBtn;
        smb.onclick = () => this.showSelectionMenu(smb);
        // Split the selection along a line (shown while strokes are selected): tap, then draw a line across them.
        this.splitBtn = this.createToolBtn(secHistory, ICON_SPLIT);
        label(this.splitBtn, 'Split along a line (then draw a line across the selection)');
        const spb = this.splitBtn;
        spb.onclick = () => { if (this.splitMode) this.cancelSplitMode(); else this.startSplitMode(); };
        const delBtn = this.deleteSelBtn;
        // With the dock on, both selection buttons move from the toolbar into the dock (next to the selection's options).
        const selActions = createDiv({ cls: 'hw-sel-actions' });

        const styleDivider = toolbar.createDiv({ cls: "hw-toolbar-divider" });

        // --- STYLE: thickness and colour ---
        // Tools are always on the toolbar; on a narrow screen thickness and colours move into a menu under one button.
        const styleInline = toolbar.createDiv({ cls: "hw-tool-section hw-style-inline" });
        // Thickness and opacity: one button (a dot in the current thickness, colour and opacity),
        // with the choice in a small menu – the toolbar stays readable.
        // Thickness and opacity are not on the toolbar: tapping the active tool again opens them (sizePop).
        const sizePop = activeDocument.body.createDiv({ cls: "hw-menu hw-size-pop" });
        sizePop.hide();
        this.register(() => sizePop.remove());
        const thGroup = sizePop.createDiv({ cls: "hw-menu-group" });
        thGroup.createDiv({ cls: "hw-menu-title", text: "Thickness" });
        const thicknessWrapper = thGroup.createDiv({ cls: "hw-menu-row hw-thickness-presets" });
        // Each thickness is shown as a short wave of that width in the current colour (same as the folded dock chip).
        const btnSm = thicknessWrapper.createEl("button", { cls: "hw-thickness-btn" });
        appendSvg(btnSm, thicknessWaveSvg(0));
        label(btnSm, 'Thin');
        const btnMd = thicknessWrapper.createEl("button", { cls: "hw-thickness-btn active" });
        appendSvg(btnMd, thicknessWaveSvg(1));
        label(btnMd, 'Medium');
        const btnLg = thicknessWrapper.createEl("button", { cls: "hw-thickness-btn" });
        appendSvg(btnLg, thicknessWaveSvg(2));
        label(btnLg, 'Thick');
        const secColor = styleInline.createDiv({ cls: "hw-tool-section" });
        const closeSizePop = () => { sizePop.hide(); };

        // What the eraser erases (only shown for the eraser): shapes and highlighter – off / whole / partial each.
        const eraseGroup = sizePop.createDiv({ cls: "hw-menu-group hw-erase-opts" });
        eraseGroup.createDiv({ cls: "hw-menu-title", text: "Eraser erases" });
        type EraseMode = 'off' | 'whole' | 'partial';
        const eraseRow = (name: string, what: string, get: () => EraseMode, set: (v: EraseMode) => void) => {
            const row = eraseGroup.createDiv({ cls: 'hw-erase-row' });
            row.createSpan({ cls: 'hw-erase-name', text: name });
            const seg = row.createDiv({ cls: 'hw-erase-seg' });
            const opts: [EraseMode, string, string][] = [
                ['off', 'Off', `The eraser leaves ${what} alone`],
                ['whole', 'Whole', `Touching ${what} removes all of it`],
                ['partial', 'Part', 'The eraser cuts out only the part it passes over'],
            ];
            const btns = opts.map(([v, text, tip]) => {
                const b = seg.createEl('button', { text });
                b.setAttribute('title', tip);
                b.setAttribute('aria-label', `${name}: ${tip}`);
                b.onclick = () => { set(v); void this.plugin.saveSettings(); refreshEraseGroup(); };
                return [v, b] as const;
            });
            return () => btns.forEach(([v, b]) => b.toggleClass('active', get() === v));
        };
        const refreshShapes = eraseRow('Shapes', 'shapes', () => this.plugin.settings.shapeErase, (v) => { this.plugin.settings.shapeErase = v; });
        const refreshHl = eraseRow('Highlighter', 'the highlighter', () => this.plugin.settings.highlighterErase, (v) => { this.plugin.settings.highlighterErase = v; });
        // Highlighter ends (only shown for the highlighter): flat like a chisel highlighter, or round like a marker.
        const hlEndGroup = sizePop.createDiv({ cls: "hw-menu-group hw-erase-opts" });
        hlEndGroup.createDiv({ cls: "hw-menu-title", text: "Highlighter ends" });
        const hlEndSeg = hlEndGroup.createDiv({ cls: 'hw-erase-row' }).createDiv({ cls: 'hw-erase-seg' });
        const hlEndBtns = ([[false, 'Flat', 'Flat ends and sharp corners, like a chisel-tip highlighter'], [true, 'Round', 'Round ends and corners, like a felt-tip marker']] as [boolean, string, string][]).map(([v, text, tip]) => {
            const b = hlEndSeg.createEl('button', { text });
            b.setAttribute('title', tip);
            b.setAttribute('aria-label', `Highlighter ends: ${tip}`);
            b.onclick = () => { this.highlighterRound = v; this.persistMemory(); refreshEraseGroup(); };
            return [v, b] as const;
        });
        const refreshEraseGroup = () => {
            eraseGroup.toggle(this.currentTool === 'eraser');
            refreshShapes();
            refreshHl();
            hlEndGroup.toggle(this.currentTool === 'highlighter');
            hlEndBtns.forEach(([v, b]) => b.toggleClass('active', this.highlighterRound === v));
        };

        const styleBtn = toolbar.createEl("button", { cls: "hw-tool-btn hw-style-btn" });
        styleBtn.createSpan({ cls: "hw-style-dot" });
        label(styleBtn, 'Color');
        styleBtn.hide();

        toolbar.createDiv({ cls: "hw-toolbar-spacer" });

        // --- VIEW / MORE ---
        const secView = toolbar.createDiv({ cls: "hw-tool-section" });
        this.quickHost = secView.createDiv({ cls: 'hw-quick-slots' });
        this.renderQuickSlots();
        const insertBtn = this.createToolBtn(secView, ICON_INSERT);
        label(insertBtn, 'Insert (image, plot, circuit, PDF…)');
        insertBtn.onclick = () => this.toggleInsertPanel(insertBtn);
        this.insertBtn = insertBtn;
        const moreBtn = this.createToolBtn(secView, ICON_MORE);
        label(moreBtn, 'More');
        this.moreBtn = moreBtn;

        // --- Popup panels (attached to <body> so the scrolling toolbar doesn't clip them) ---
        const placeBelow = (menu: HTMLElement, anchor: HTMLElement) => {
            menu.show();
            const r = anchor.getBoundingClientRect();
            const mw = menu.offsetWidth, mh = menu.offsetHeight;
            let left = r.left;
            if (left + mw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - mw - 8);
            let top = r.bottom + 8;
            if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 8);
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
        };

        const shapeMenu = activeDocument.body.createDiv({ cls: "hw-menu" });
        shapeMenu.hide();
        this.register(() => shapeMenu.remove());
        const stylePop = activeDocument.body.createDiv({ cls: "hw-menu hw-style-pop" });
        stylePop.hide();
        this.register(() => stylePop.remove());

        const addGroup = (title: string) => {
            const g = shapeMenu.createDiv({ cls: "hw-menu-group" });
            g.createDiv({ cls: "hw-menu-title", text: title });
            return g.createDiv({ cls: "hw-menu-row" });
        };
        const addOpt = (row: HTMLElement, icon: string, text: string, onClick: () => void) => {
            const b = this.createToolBtn(row, icon);
            b.addClass("hw-menu-btn");
            label(b, text);
            b.onclick = onClick;
            return b;
        };

        const shapeThRow = addGroup("Thickness");
        const shapeThGroup = shapeThRow.parentElement!;
        shapeThRow.addClass('hw-thickness-presets');
        const shapeThBtns = [0, 1, 2].map((i) => {
            const b = shapeThRow.createEl('button', { cls: 'hw-thickness-btn' });
            appendSvg(b, thicknessWaveSvg(i));
            b.setAttribute('aria-label', ['Thin', 'Medium', 'Thick'][i]);
            b.onclick = () => pickSize(i);
            return b;
        });
        const shapeRow = addGroup("Shape");
        const shapeTypeGroup = shapeRow.parentElement!;
        const shapeOpts: [NonNullable<Stroke['shape']>, HTMLElement][] = [
            ['line', addOpt(shapeRow, ICON_SHAPE_LINE, 'Line', () => { this.shapeType = 'line'; refreshShapeMenu(); })],
            ['rect', addOpt(shapeRow, ICON_SHAPE_RECT, 'Rectangle', () => { this.shapeType = 'rect'; refreshShapeMenu(); })],
            ['ellipse', addOpt(shapeRow, ICON_SHAPE_ELLIPSE, 'Circle / ellipse', () => { this.shapeType = 'ellipse'; refreshShapeMenu(); })],
            ['triangle', addOpt(shapeRow, ICON_SHAPE_TRIANGLE, 'Triangle', () => { this.shapeType = 'triangle'; refreshShapeMenu(); })],
        ];

        const dashRow = addGroup("Line style");
        const dashGroup = dashRow.parentElement!;
        const dashOpts: [NonNullable<Stroke['dash']>, HTMLElement][] = [
            ['solid', addOpt(dashRow, ICON_DASH_SOLID, 'Solid', () => { this.shapeDash = 'solid'; refreshShapeMenu(); })],
            ['dashed', addOpt(dashRow, ICON_DASH_DASHED, 'Dashed', () => { this.shapeDash = 'dashed'; refreshShapeMenu(); })],
            ['dotted', addOpt(dashRow, ICON_DASH_DOTTED, 'Dotted', () => { this.shapeDash = 'dotted'; refreshShapeMenu(); })],
            ['dashdot', addOpt(dashRow, ICON_DASH_DASHDOT, 'Dash-dot', () => { this.shapeDash = 'dashdot'; refreshShapeMenu(); })],
        ];

        // Fill (rectangle / ellipse / triangle): outline only, solid, light fill with outline, light fill only.
        // (A solid fill without outline looks the same as with it, so that option doesn't exist.)
        const fillRow = addGroup("Fill");
        const fillGroup = fillRow.parentElement!;
        const setFill = (f: 'none' | 'solid' | 'light', line: boolean) => { this.shapeFill = f; this.shapeLineOn = line; refreshShapeMenu(); };
        const fillOpts: ['none' | 'solid' | 'light', boolean, HTMLElement][] = [
            ['none', true, addOpt(fillRow, ICON_FILL_NONE, 'Outline only', () => setFill('none', true))],
            ['solid', true, addOpt(fillRow, ICON_FILL, 'Solid fill', () => setFill('solid', true))],
            ['light', true, addOpt(fillRow, ICON_FILL_LIGHT, 'Light fill with outline', () => setFill('light', true))],
            ['light', false, addOpt(fillRow, ICON_NO_OUTLINE, 'Light fill only (no outline)', () => setFill('light', false))],
        ];
        const extraRow = addGroup("Options");
        const arrowGroup = extraRow.parentElement!;
        const arrowBtn = addOpt(extraRow, ICON_ARROW, 'Arrow at the end', () => { this.shapeArrow = !this.shapeArrow; refreshShapeMenu(); });
        // Right-angle path (like wires in KiCad): each drag draws an L (two perpendicular segments), the next one continues.
        const orthoBtn = addOpt(extraRow, ICON_RIGHT_ANGLE_PATH, 'Right-angle path: each drag draws an L that follows the pen, the next one continues from its end; tap to finish', () => {
            this.shapeOrtho = !this.shapeOrtho;
            this.endOrthoPath();
            refreshShapeMenu();
        });
        /** Fill icons follow the shape (rectangle, circle, triangle). */
        const paintFillIcons = () => {
            const ic = shapeFillIcons(this.shapeType, this.shapeTriRight);
            const icons = [ic.none, ic.solid, ic.light, ic.noLine];
            fillOpts.forEach(([, , b], i) => setSvg(b, this.iconSvg(icons[i])));
        };
        // Triangle kind (only for the triangle): isosceles or right.
        const triIsoBtn = addOpt(extraRow, ICON_TRI_ISO, 'Isosceles triangle', () => { this.shapeTriRight = false; refreshShapeMenu(); });
        const triRightBtn = addOpt(extraRow, ICON_TRI_RIGHT, 'Right triangle', () => { this.shapeTriRight = true; refreshShapeMenu(); });

        const refreshShapeMenu = () => {
            shapeOpts.forEach(([t, b]) => b.toggleClass('active', this.shapeType === t));
            dashOpts.forEach(([d, b]) => b.toggleClass('active', this.shapeDash === d));
            // solid + "no outline" from older settings counts as solid
            const line = this.shapeFill === 'light' ? this.shapeLineOn : true;
            fillOpts.forEach(([f, l, b]) => b.toggleClass('active', this.shapeFill === f && l === line));
            arrowBtn.toggleClass('active', this.shapeArrow);
            orthoBtn.toggleClass('active', this.shapeOrtho);
            triIsoBtn.toggleClass('active', !this.shapeTriRight);
            triRightBtn.toggleClass('active', this.shapeTriRight);
            fillGroup.toggle(!(this.shapeType === 'line'));
            const tri = this.shapeType === 'triangle';
            arrowGroup.toggle(this.shapeType === 'line' || tri);
            arrowBtn.toggle(this.shapeType === 'line');
            orthoBtn.toggle(this.shapeType === 'line');
            triIsoBtn.toggle(tri);
            triRightBtn.toggle(tri);
            paintFillIcons();
            if (this.shapeType !== 'line') this.endOrthoPath();
            this.persistMemory();
            if (this.refreshToolbarUI) this.refreshToolbarUI();
        };

        const openShapeMenu = () => { closeStylePop(); placeBelow(shapeMenu, shapeBtn); };
        const closeShapeMenu = () => { shapeMenu.hide(); };
        const openStylePop = () => { closeShapeMenu(); placeBelow(stylePop, styleBtn); };
        const closeStylePop = () => { stylePop.hide(); };

        // Close panels when clicking outside them (capture, because the canvas stops propagation).
        this.registerDomEvent(activeDocument, 'pointerdown', (e: PointerEvent) => {
            const t = e.target as Node;
            if (!secShapes.contains(t) && !shapeMenu.contains(t)) closeShapeMenu();
            const inSize = sizePop.contains(t);
            const onTool = toolBtnOf(this.currentTool)?.contains(t) ?? false;   // the active tool's button toggles its own options
            if (!styleBtn.contains(t) && !stylePop.contains(t)) closeStylePop();
            if (!inSize && !onTool) closeSizePop();
        }, { capture: true });

        refreshShapeMenu();

        styleBtn.onclick = () => { if (stylePop.style.display === 'none') openStylePop(); else closeStylePop(); };

        // --- Layout: wide (everything on the toolbar) / narrow (style in a panel) ---
        let compact: boolean | null = null;
        this.layoutToolbar = () => {
            const w = this.contentEl.clientWidth;
            if (w === 0) return;
            const c = w < 880;
            if (c === compact) return;
            compact = c;
            toolbar.toggleClass('hw-compact', c);
            closeSizePop();
            if (dockMode()) {
                // The colours live in the dock (it scrolls sideways on a narrow screen) – no colour button.
                closeStylePop();
                updateStyleBtn();
                return;
            }
            if (c) {
                // Narrow screen: the colours go into a panel under one button.
                stylePop.appendChild(styleInline);
            } else {
                toolbar.insertBefore(styleInline, styleBtn);
                closeStylePop();
            }
            updateStyleBtn();
        };

        // --- "More" menu ---
        let moreOpen = false, moreWasOpen = false, moreHiddenAt = 0;
        moreBtn.addEventListener('pointerdown', () => { moreWasOpen = moreOpen; }, true);
        moreBtn.onclick = () => {
            if (this.plugin.settings.menuStyle === 'panels') { closeShapeMenu(); closeStylePop(); this.toggleMorePanel(moreBtn); return; }
            // Tapping the button again while the menu is open only closes it (the menu closes itself on pointerdown).
            if (moreWasOpen || Date.now() - moreHiddenAt < 350) { moreWasOpen = false; return; }
            closeShapeMenu();
            closeStylePop();
            moreOpen = true;
            this.showMoreMenu(moreBtn);
            this.moreMenuHidden = () => { moreOpen = false; moreHiddenAt = Date.now(); };
        };

        const updateStyleBtn = () => {
            const dot = styleBtn.querySelector<HTMLElement>('.hw-style-dot');
            if (!dot) return;
            const t = this.currentTool;
            const color = t === 'pen' ? this.penColor : t === 'shape' ? this.shapeColor : t === 'highlighter' ? this.highlighterColor : t === 'lasso' ? (this.selectionColor() ?? '') : '';
            dot.style.setProperty('--sw', color || 'var(--text-faint)');
            // narrow screen only, and only for tools with colours
            styleBtn.toggle(!!compact && !dockMode() && !styleInline.hasClass('hw-no-colors'));
            refreshChips();
        };

        const currentColor = () => {
            const t = this.currentTool;
            // a shape with a light fill and no outline shows its fill colour
            const shapeCol = this.shapeFill === 'light' && !this.shapeLineOn && this.shapeType !== 'line' ? (this.shapeFillColor || this.shapeColor) : this.shapeColor;
            return t === 'pen' ? this.penColor : t === 'shape' ? shapeCol :t === 'highlighter' ? this.highlighterColor : t === 'lasso' ? (this.selectionColor() ?? '') : '';
        };
        const updateSizeBtn = () => {
            // the thickness dots show the current colour
            const col = currentColor() || 'var(--text-normal)';
            for (const b of [btnSm, btnMd, btnLg, ...shapeThBtns]) b.style.setProperty('--dot', col);
            refreshChips();
        };
        const updateThicknessUI = () => {
            const idx = this.currentTool === 'lasso' ? this.selectionSizeIndex() : this.activeSizeIndex;
            [btnSm, btnMd, btnLg].forEach((b, i) => b.toggleClass("active", i === idx));
            shapeThBtns.forEach((b, i) => b.toggleClass("active", i === idx));
            updateSizeBtn();
        };

        /**
         * Shape colours: with a fill, two small fields "Outline" / "Fill" before the palette – the palette changes the
         * colour of the active one. Right click / long press on "Fill" = the same colour as the outline again.
         * `fill` = null: no fill (only the outline colour, as before). `noLine` = fill without an outline: only the fill
         * colour is offered (the palette changes the fill).
         */
        const renderShapeColors = (line: string, fill: string | null, fillAuto: boolean, setLine: (c: string) => void, setFill: (c: string | null) => void, noLine = false) => {
            const st = this.plugin.settings;
            secColor.empty();
            if (fill !== null && noLine) {
                this.renderPalette(secColor, st.penPalette, fill, 'shape', (c) => { setFill(c); updateStyleBtn(); updateSizeBtn(); });
                return;
            }
            if (fill === null) {
                this.shapeColorTarget = 'line';
                this.renderPalette(secColor, st.penPalette, line, 'shape', (c) => { setLine(c); updateStyleBtn(); updateSizeBtn(); });
                return;
            }
            const seg = secColor.createDiv({ cls: 'hw-color-targets' });
            const mk = (t: 'line' | 'fill', text: string) => {
                const b = seg.createEl('button', { cls: `hw-color-target hw-ct-${t}` });
                b.createSpan({ cls: 'hw-ct-chip' });
                label(b, text);
                b.toggleClass('active', this.shapeColorTarget === t);
                b.onclick = () => { if (this.shapeColorTarget !== t) { this.shapeColorTarget = t; updateSharedUI(); } };
                return b;
            };
            const lineBtn = mk('line', 'Outline colour');
            const fillBtn = mk('fill', fillAuto ? 'Fill colour (same as outline) – the palette now changes the fill' : 'Fill colour – right click or long press: same as outline');
            const paint = (l: string, f: string, auto: boolean) => {
                lineBtn.style.setProperty('--c', l || 'transparent');
                fillBtn.style.setProperty('--c', f || 'transparent');
                fillBtn.toggleClass('is-auto', auto);
            };
            paint(line, fill, fillAuto);
            const resetFill = () => { setFill(null); updateSharedUI(); };
            fillBtn.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); resetFill(); });
            let lpTimer = 0, longPressed = false;
            fillBtn.addEventListener('pointerdown', (e) => {
                if (e.pointerType === 'mouse') return;
                longPressed = false;
                window.clearTimeout(lpTimer);
                lpTimer = window.setTimeout(() => { longPressed = true; resetFill(); }, 550);
            });
            for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) fillBtn.addEventListener(ev, () => window.clearTimeout(lpTimer));
            fillBtn.addEventListener('click', (e) => { if (longPressed) { longPressed = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
            const host = secColor.createDiv({ cls: 'hw-color-palette-host' });
            let curLine = line, curFill = fill, auto = fillAuto;
            const target = this.shapeColorTarget;
            this.renderPalette(host, st.penPalette, target === 'fill' ? fill : line, 'shape', (c) => {
                if (target === 'fill') { setFill(c); curFill = c; auto = false; }
                else { setLine(c); curLine = c; if (auto) curFill = c; }
                paint(curLine, curFill, auto);
                updateStyleBtn();
                updateSizeBtn();
            });
        };

        const updateSharedUI = () => {
            const allSizeBtns = [btnSm, btnMd, btnLg];
            const st = this.plugin.settings;
            if (this.currentTool === 'pen') {
                allSizeBtns.forEach(b => b.disabled = false);
                this.renderPalette(secColor, st.penPalette, this.penColor, 'pen', (c) => { this.penColor = c; this.noteRecentPenColor(c); this.persistMemory(); updateStyleBtn(); updateSizeBtn(); });
            } else if (this.currentTool === 'shape') {
                allSizeBtns.forEach(b => b.disabled = false);
                const filled = this.shapeFill !== 'none' && this.shapeType !== 'line';
                renderShapeColors(this.shapeColor, filled ? (this.shapeFillColor || this.shapeColor) : null, !this.shapeFillColor,
                    (c) => { this.shapeColor = c; this.persistMemory(); },
                    (c) => { this.shapeFillColor = c ? c.toLowerCase() : ''; this.persistMemory(); },
                    filled && this.shapeFill === 'light' && !this.shapeLineOn);
            } else if (this.currentTool === 'highlighter') {
                allSizeBtns.forEach(b => b.disabled = false);
                this.renderPalette(secColor, st.highlighterPalette, this.highlighterColor, 'highlighter', (c) => { this.highlighterColor = c; this.persistMemory(); updateStyleBtn(); updateSizeBtn(); });
            } else if (this.currentTool === 'eraser') {
                allSizeBtns.forEach(b => b.disabled = false);
                secColor.empty();
            } else if (this.currentTool === 'lasso') {
                // Selected strokes: colour and thickness change the selection.
                const kind = this.selectionStyleKind();
                allSizeBtns.forEach(b => b.disabled = !kind);
                const filledSel = kind === 'pen' ? this.selectionFilledShapes() : [];
                if (kind && filledSel.length > 0) {
                    // filled shapes in the selection: outline / fill colour fields like for the shape tool
                    renderShapeColors(this.selectionColor() ?? '', this.selectionFillColor() ?? '', filledSel.every(x => !x.fillColor),
                        (c) => this.setSelectionColor(c), (c) => this.setSelectionFillColor(c),
                        (this.selection?.strokes ?? []).every(x => this.isFilledArea(x) && x.noLine));
                } else if (kind) {
                    const pal = kind === 'highlighter' ? st.highlighterPalette : st.penPalette;
                    this.renderPalette(secColor, pal, this.selectionColor() ?? '', kind, (c) => { this.setSelectionColor(c); updateStyleBtn(); updateSizeBtn(); });
                } else {
                    secColor.empty();
                }
            } else {
                // Hand: no options
                secColor.empty();
            }
            updateThicknessUI();
            refreshEraseGroup();
            // No colours (eraser, lasso without strokes): no colour row and, on a narrow screen, no colour button.
            styleInline.toggleClass('hw-no-colors', secColor.childElementCount === 0);
            updateStyleBtn();
            placeOptions();
        };
        this.refreshToolbarUI = () => {
            setSvg(lassoBtn, this.iconSvg(selIcon()));
            label(lassoBtn, selLabel());
            updateSharedUI();
        };

        const updateActiveTool = (btn: HTMLElement) => {
            if (this.currentTool !== this.toolSeen) { this.prevTool = this.toolSeen; this.toolSeen = this.currentTool; }
            this.closeToolDockPop?.();
            this.endOrthoPath();
            this.cancelSplitMode();
            markHiddenTool();
            closeShapeMenu();
            closeSizePop();
            closeStylePop();
            closeSelModePop();
            [penBtn, eraserBtn, highBtn, lassoBtn, shapeBtn, handBtn].forEach(b => b.removeClass("active"));
            btn.addClass("active");
            if (this.currentTool !== 'lasso') this.clearSelection();
            updateSharedUI();
            this.syncPanCursor?.();
        };

        // Tapping the active tool again opens its options: thickness (+ opacity for the pen, + what the eraser erases).
        // With the dock the options are always shown, so a second tap changes nothing.
        const toolTap = (tool: 'pen' | 'eraser' | 'highlighter', btn: HTMLElement) => {
            if (this.currentTool === tool) {
                // Dock: the options are already on screen – a second tap keeps them (only popups toggle).
                if (dockMode()) showDock(); else openToolOptions(btn);
                return;
            }
            this.currentTool = tool;
            updateActiveTool(btn);
        };
        penBtn.onclick = () => toolTap('pen', penBtn);
        eraserBtn.onclick = () => toolTap('eraser', eraserBtn);
        highBtn.onclick = () => toolTap('highlighter', highBtn);
        handBtn.onclick = () => {
            if (this.currentTool === 'hand') return;
            this.currentTool = 'hand';
            updateActiveTool(handBtn);
        };
        label(penBtn, 'Pen (tap again: thickness)');
        label(eraserBtn, 'Eraser (tap again: size and what it erases)');
        label(highBtn, 'Highlighter (tap again: thickness and ends)');
        const toolBtnOf = (t: string): HTMLElement | null => ({ pen: penBtn, eraser: eraserBtn, highlighter: highBtn, lasso: lassoBtn, shape: shapeBtn, hand: handBtn } as Record<string, HTMLElement>)[t] ?? null;
        const openToolOptions = (anchor: HTMLElement) => {
            if (dockMode()) { showDock(); return; }
            if (sizePop.style.display !== 'none') { closeSizePop(); return; }
            closeShapeMenu();
            closeStylePop();
            sizePop.appendChild(thGroup);
            sizePop.appendChild(eraseGroup);
            sizePop.appendChild(hlEndGroup);
            updateSharedUI();
            placeBelow(sizePop, anchor);
        };
        lassoBtn.onclick = (ev: MouseEvent) => {
            if (this.currentTool !== 'lasso') {
                this.currentTool = 'lasso';
                updateActiveTool(lassoBtn);
                return;
            }
            // Clicking the active tool again: choose the selection mode (and the thickness of selected strokes).
            void ev;
            if (dockMode()) { showDock(); return; }
            if (selModePop.style.display !== 'none') { closeSelModePop(); return; }
            closeSizePop();
            refreshSelModePop();
            if (this.selectionStyleKind()) { selModePop.appendChild(thGroup); updateSharedUI(); }
            else sizePop.appendChild(thGroup);
            placeBelow(selModePop, lassoBtn);
        };
        // Selection mode: just two icons (lasso / rectangle).
        const selModePop = activeDocument.body.createDiv({ cls: 'hw-menu hw-selmode-pop' });
        selModePop.hide();
        this.register(() => selModePop.remove());
        const selGroup = selModePop.createDiv({ cls: 'hw-menu-group' });
        selGroup.createDiv({ cls: 'hw-menu-title', text: 'Selection' });
        const selRow = selGroup.createDiv({ cls: 'hw-menu-row' });
        const selModes: ['lasso' | 'rect', string, string][] = [
            ['lasso', ICON_LASSO_LOOP, 'Lasso (freehand)'],
            ['rect', ICON_SELECT_RECT, 'Rectangle'],
        ];
        const selModeBtns = selModes.map(([mode, icon, name]) => {
            const b = this.createToolBtn(selRow, icon);
            b.addClass('hw-menu-btn');
            label(b, name);
            b.onclick = () => {
                this.plugin.settings.selectMode = mode;
                void this.plugin.saveSettings();
                setSvg(lassoBtn, this.iconSvg(selIcon()));
                label(lassoBtn, selLabel());
                refreshSelModePop();
                if (!this.selectionStyleKind()) window.setTimeout(closeSelModePop, 120);
            };
            return [mode, b] as const;
        });
        const refreshSelModePop = () => selModeBtns.forEach(([m, b]) => b.toggleClass('active', this.plugin.settings.selectMode === m));
        const closeSelModePop = () => { selModePop.hide(); };
        this.registerDomEvent(activeDocument, 'pointerdown', (e: PointerEvent) => {
            const t = e.target as Node;
            if (!selModePop.contains(t) && !lassoBtn.contains(t)) { closeSelModePop(); }
        }, { capture: true });

        // --- Dock: options of the active tool in a floating pill under the toolbar (instead of the popups) ---
        // The same option groups as in the popups are moved into it, so everything works the same in both layouts.
        const dock = container.createDiv({ cls: 'hw-tool-dock is-hidden' });
        let inDock = false;
        // Groups that don't fit in the dock (narrow window) collapse one by one into small buttons ("chips") showing the
        // current value; each chip opens its own submenu with just that group. Some groups always fold together into
        // one chip and stay folded even when there is room (line style + fill).
        type GroupMeta = { name: string; autoClose: boolean; icon?: string };
        const meta = new Map<HTMLElement, GroupMeta>([
            [thGroup, { name: 'Thickness', autoClose: true }],
            [eraseGroup, { name: 'Eraser erases', autoClose: false, icon: 'eraser' }],
            [hlEndGroup, { name: 'Highlighter ends', autoClose: true }],
            [shapeThGroup, { name: 'Thickness', autoClose: true }],
            [shapeTypeGroup, { name: 'Shape', autoClose: true }],
            [dashGroup, { name: 'Line style', autoClose: true }],
            [fillGroup, { name: 'Fill', autoClose: true }],
            [arrowGroup, { name: 'Options', autoClose: false, icon: 'sliders-horizontal' }],
            [selGroup, { name: 'Selection', autoClose: true }],
            [selActions, { name: 'Selection actions', autoClose: true, icon: 'trash-2' }],
            [styleInline, { name: 'Colours', autoClose: false }],
        ]);
        type Chip = { groups: HTMLElement[]; chip: HTMLElement };
        let chips: Chip[] = [];
        let popGroups: HTMLElement[] | null = null;   // the groups shown in the submenu now
        const groupPop = activeDocument.body.createDiv({ cls: 'hw-menu hw-dock-group-pop' });
        groupPop.hide();
        this.register(() => groupPop.remove());
        const chipOf = (g: HTMLElement) => chips.find(c => c.groups.includes(g))?.chip ?? null;
        const closeGroupPop = () => {
            groupPop.hide();
            if (popGroups) { chipOf(popGroups[0])?.removeClass('active'); popGroups.forEach(g => g.detach()); }
            popGroups = null;
        };
        /** Summary of one group in a chip: the active option of the group (or the colour / an icon). */
        const groupSummary = (box: HTMLElement, g: HTMLElement) => {
            const m = meta.get(g);
            if (g === styleInline) {
                const d = box.createSpan({ cls: 'hw-style-dot' });
                d.style.setProperty('--sw', currentColor() || 'var(--text-faint)');
                return;
            }
            if (g === thGroup || g === shapeThGroup) {
                // thickness: the same wave as on the thickness buttons, in the current colour (faded when mixed)
                const btns = g === thGroup ? [btnSm, btnMd, btnLg] : shapeThBtns;
                const i = btns.findIndex(b => b.hasClass('active'));
                const span = box.createSpan({ cls: 'hw-chip-wave' });
                span.style.setProperty('--dot', currentColor() || 'var(--text-normal)');
                if (i < 0) span.addClass('is-mixed');
                appendSvg(span, thicknessWaveSvg(i < 0 ? 1 : i));
                return;
            }
            // the eraser options have two rows of choices – an icon says more than one of them
            const act = g === eraseGroup ? null : Array.from(g.querySelectorAll<HTMLElement>('button.active')).find(x => x.style.display !== 'none') ?? null;
            if (act) {
                const span = box.createSpan({ cls: 'hw-chip-part' });
                const dot = act.style.getPropertyValue('--dot');
                if (dot) span.style.setProperty('--dot', dot);
                act.childNodes.forEach(n => { span.appendChild(n.cloneNode(true)); });
            } else if (m?.icon) {
                setIcon(box.createSpan({ cls: 'hw-chip-part' }), m.icon);
            }
        };
        const fillSummary = (c: Chip) => {
            const box = c.chip.querySelector<HTMLElement>('.hw-chip-sum');
            if (!box) return;
            box.empty();
            for (const g of c.groups) groupSummary(box, g);
        };
        const refreshChipsNow = () => { for (const c of chips) fillSummary(c); };
        refreshChips = () => { if (chips.length > 0) refreshChipsNow(); };
        const openGroupPop = (groups: HTMLElement[], chip: HTMLElement) => {
            closeGroupPop();
            closeSizePop(); closeShapeMenu(); closeStylePop(); closeSelModePop();
            for (const g of groups) groupPop.appendChild(g);
            popGroups = groups;
            chip.addClass('active');
            placeBelow(groupPop, chip);
        };
        /** Replaces groups in the dock with one chip. */
        const collapseGroups = (groups: HTMLElement[]) => {
            const chip = createEl('button', { cls: 'hw-tool-btn hw-dock-chip' });
            label(chip, groups.map(g => meta.get(g)?.name ?? 'Options').join(' and '));
            chip.createSpan({ cls: 'hw-chip-sum' });
            chip.createSpan({ cls: 'hw-chip-caret' });
            dock.insertBefore(chip, groups[0]);
            groups.forEach(g => g.detach());
            const c: Chip = { groups, chip };
            chips.push(c);
            fillSummary(c);
            chip.onclick = () => { if (popGroups && popGroups[0] === groups[0]) closeGroupPop(); else openGroupPop(groups, chip); };
        };
        // After a pick in the submenu: update the chips; single-choice groups close the submenu.
        groupPop.addEventListener('click', (e: MouseEvent) => {
            const gs = popGroups;
            const onButton = !!(e.target as HTMLElement | null)?.closest('button');
            window.setTimeout(() => {
                refreshChipsNow();
                if (gs && popGroups === gs && onButton && gs.length === 1 && meta.get(gs[0])?.autoClose) closeGroupPop();
            }, 120);
        }, true);
        /** The dock's height (plus gaps) is kept free at the top of the note, so it doesn't cover the first page. */
        const updateInset = () => {
            const on = inDock && !dock.hasClass('is-hidden');
            this.setTopInset(on ? dock.offsetHeight + 8 : 0);   // + the usual 20 px margin below it
        };
        const positionDock = () => {
            if (dock.hasClass('is-hidden')) { updateInset(); return; }
            const c = this.contentEl.getBoundingClientRect();
            const below = this.scrollArea ? this.scrollArea.getBoundingClientRect().top : toolbar.getBoundingClientRect().bottom;
            dock.style.top = `${Math.max(0, below - c.top) + 8}px`;
            updateInset();
        };
        const restorePopups = () => {
            // back to the popups, in their original order
            sizePop.append(thGroup, eraseGroup, hlEndGroup);
            shapeMenu.append(shapeThGroup, shapeTypeGroup, dashGroup, fillGroup, arrowGroup);
            selModePop.insertBefore(selGroup, selModePop.firstChild);
            secHistory.append(delBtn, spb, smb);   // the selection buttons back on the toolbar
            toolbar.insertBefore(styleInline, styleBtn);
            closeGroupPop();
            chips = [];
            dock.empty();
            dock.addClass('is-hidden');
            this.posLog('dock hidden: back to popups');
            updateInset();
        };
        /** Groups of one drop step that are really shown in the dock now. */
        const shown = (gs: HTMLElement[]) => gs.filter(g => g.style.display !== 'none' && !g.hasClass('hw-no-colors') && g.parentElement === dock);
        /**
         * Collapses groups into chips until the dock fits in the window. `drop` = the order in which groups collapse
         * (least important first; an array = groups that collapse together into one chip). `always` = chips that are
         * folded even when there is room. If even all chips don't fit, the dock scrolls sideways.
         */
        const fitDock = (drop: HTMLElement[][], always: HTMLElement[][]) => {
            const wasOpen = popGroups;
            groupPop.hide();
            popGroups = null;
            chips = [];
            if (dock.hasClass('is-hidden')) return;
            for (const step of always) { const gs = shown(step); if (gs.length > 0) collapseGroups(gs); }
            const overflows = () => dock.scrollWidth > dock.clientWidth + 1;
            for (const step of drop) {
                if (!overflows()) break;
                const gs = shown(step);
                if (gs.length > 0) collapseGroups(gs);
            }
            // The submenu was open and its groups are still collapsed: keep it open.
            const c = wasOpen ? chips.find(x => x.groups[0] === wasOpen[0]) : null;
            if (c) openGroupPop(c.groups, c.chip);
        };
        let dockWidth = -1;
        placeOptions = () => {
            if (!dockMode()) {
                if (inDock) { inDock = false; restorePopups(); }
                return;
            }
            inDock = true;
            if (delBtn.parentElement !== selActions) selActions.append(delBtn, spb, smb);
            const t = this.currentTool;
            let parts: HTMLElement[] = [];
            let drop: HTMLElement[][] = [];
            if (t === 'pen') { parts = [thGroup, styleInline]; drop = [[thGroup], [styleInline]]; }
            else if (t === 'highlighter') { parts = [thGroup, hlEndGroup, styleInline]; drop = [[hlEndGroup], [thGroup], [styleInline]]; }
            else if (t === 'eraser') { parts = [thGroup, eraseGroup]; drop = [[eraseGroup], [thGroup]]; }
            else if (t === 'shape') {
                parts = [shapeTypeGroup, shapeThGroup, dashGroup, fillGroup, arrowGroup, styleInline];
                drop = [[arrowGroup], [shapeThGroup], [shapeTypeGroup], [styleInline]];
            } else if (t === 'lasso') {
                parts = this.selectionStyleKind() ? [selGroup, thGroup, styleInline] : [selGroup];
                // delete / selection options: in the dock while something is selected (they collapse last)
                if (this.selection) parts.push(selActions);
                drop = [[thGroup], [selGroup], [styleInline], [selActions]];
            }
            dock.empty();
            for (const p of parts) dock.appendChild(p);
            // The dock is hidden only for a tool without options (hand) – never by tapping the active tool again.
            const hide = parts.length === 0;
            if (hide !== dock.hasClass('is-hidden')) this.posLog('dock', hide ? 'hidden' : 'shown', 'tool', t);
            dock.toggleClass('is-hidden', hide);
            dockWidth = this.contentEl.clientWidth;
            // line style + fill: always one folded chip (changed less often than the shape and its colour)
            fitDock(drop.map(gs => gs.filter(g => parts.includes(g))), [[dashGroup, fillGroup].filter(g => parts.includes(g))]);
            positionDock();
        };
        /** The window got wider / narrower: fit the dock again. */
        const refitDock = () => { if (inDock && this.contentEl.clientWidth !== dockWidth) placeOptions(); };
        this.refitToolDock = () => { if (inDock) placeOptions(); };
        this.closeToolDockPop = closeGroupPop;
        const showDock = () => { placeOptions(); };
        this.registerDomEvent(activeDocument, 'pointerdown', (e: PointerEvent) => {
            const t = e.target as Node;
            if (popGroups && !groupPop.contains(t) && !(chipOf(popGroups[0])?.contains(t) ?? false)) closeGroupPop();
        }, { capture: true });
        // The dock is not part of the note: wheel scrolls it sideways (when it overflows), nothing reaches the page.
        this.registerDomEvent(dock, 'wheel', (e: WheelEvent) => {
            e.stopPropagation();
            if (dock.scrollWidth <= dock.clientWidth + 2) return;
            const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (!d) return;
            e.preventDefault();
            dock.scrollLeft += d * (e.deltaMode === 1 ? 16 : 1);
        }, { passive: false });
        this.registerDomEvent(dock, 'contextmenu', (e: MouseEvent) => e.stopPropagation());
        /** Settings → Toolbar → Tool options changed: move the groups live. */
        this.applyToolOptionsLayout = () => {
            closeSizePop(); closeShapeMenu(); closeStylePop(); closeSelModePop(); closeGroupPop();
            compact = null;
            updateSharedUI();
            this.layoutToolbar?.();
        };

        this.activateLasso = () => { this.currentTool = 'lasso'; updateActiveTool(lassoBtn); };
        this.setTool = (t) => {
            const btn = { pen: penBtn, eraser: eraserBtn, highlighter: highBtn, lasso: lassoBtn, shape: shapeBtn, hand: handBtn }[t];
            this.currentTool = t;
            updateActiveTool(btn);
        };

        const pickSize = (i: number) => {
            if (this.currentTool === 'lasso') this.setSelectionSize(i);
            else this.activeSizeIndex = i;
            updateThicknessUI();
        };
        btnSm.onclick = () => pickSize(0);
        btnMd.onclick = () => pickSize(1);
        btnLg.onclick = () => pickSize(2);

        // Like the other tools: the first tap picks the shape tool, tapping it again opens its options.
        label(shapeBtn, 'Shapes (tap again: shape, thickness, line style, fill)');
        shapeBtn.onclick = () => {
            if (this.currentTool !== 'shape') {
                this.currentTool = 'shape';
                updateActiveTool(shapeBtn);
            } else if (dockMode()) {
                showDock();
            } else if (shapeMenu.style.display === 'none') {
                openShapeMenu();
            } else {
                closeShapeMenu();
            }
        };

        // --- Custom toolbar layout: buttons turned off in the settings are in the "More" menu ---
        this.openShapeOptions = (anchor: HTMLElement) => {
            if (dockMode()) { showDock(); return; }
            closeStylePop(); closeSizePop(); placeBelow(shapeMenu, anchor);
        };
        this.openEraserOptions = (anchor: HTMLElement) => openToolOptions(anchor);
        const itemEls: Record<string, HTMLElement[]> = {
            hand: [handBtn], eraser: [eraserBtn], highlighter: [highBtn], lasso: [lassoBtn], shapes: [secShapes],
            undo: [this.undoBtn, this.redoBtn].filter((b): b is HTMLButtonElement => !!b),
        };
        const toolItem: Record<string, string> = { hand: 'hand', eraser: 'eraser', highlighter: 'highlighter', lasso: 'lasso', shape: 'shapes' };
        markHiddenTool = () => {
            const id = toolItem[this.currentTool];
            moreBtn.toggleClass('hw-more-active', !!id && this.plugin.settings.toolbarHidden.includes(id));
        };
        this.applyToolbarItems = () => {
            const hidden = new Set(this.plugin.settings.toolbarHidden);
            for (const [id, els] of Object.entries(itemEls)) for (const el of els) el.toggleClass('hw-hidden-item', hidden.has(id));
            markHiddenTool();
        };
        this.applyToolbarItems();

        // --- Very narrow screen: the toolbar scrolls horizontally ---
        // The mouse wheel scrolls the toolbar sideways, edges with hidden buttons fade out (showing there is more),
        // and the arrows at the edges move the toolbar by a step.
        const updateFade = () => {
            const max = toolbar.scrollWidth - toolbar.clientWidth;
            toolbar.toggleClass('hw-tb-scroll', max > 2);
            toolbar.toggleClass('hw-tb-more-left', toolbar.scrollLeft > 2);
            toolbar.toggleClass('hw-tb-more-right', toolbar.scrollLeft < max - 2);
        };
        this.registerDomEvent(toolbar, 'wheel', (e: WheelEvent) => {
            if (toolbar.scrollWidth <= toolbar.clientWidth + 2) return;
            const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            if (!d) return;
            e.preventDefault();
            toolbar.scrollLeft += d * (e.deltaMode === 1 ? 16 : 1);
        }, { passive: false });
        this.registerDomEvent(toolbar, 'scroll', updateFade);
        const ro = new ResizeObserver(updateFade);
        ro.observe(toolbar);
        this.register(() => ro.disconnect());
        const arrow = (side: 'left' | 'right') => {
            const a = this.contentEl.createDiv({ cls: `hw-tb-arrow hw-tb-arrow-${side}` });
            setIcon(a, side === 'left' ? 'chevron-left' : 'chevron-right');
            a.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toolbar.scrollBy({ left: (side === 'left' ? -1 : 1) * Math.max(120, toolbar.clientWidth * 0.6), behavior: 'smooth' });
            });
            return a;
        };
        const arrL = arrow('left'), arrR = arrow('right');
        const syncArrows = () => {
            arrL.toggleClass('hw-on', toolbar.hasClass('hw-tb-more-left'));
            arrR.toggleClass('hw-on', toolbar.hasClass('hw-tb-more-right'));
            const r = toolbar.getBoundingClientRect(), c = this.contentEl.getBoundingClientRect();
            for (const a of [arrL, arrR]) { a.style.top = `${r.top - c.top}px`; a.style.height = `${r.height}px`; }
            refitDock();
            positionDock();
        };
        this.registerDomEvent(toolbar, 'scroll', syncArrows);
        const ro2 = new ResizeObserver(() => { updateFade(); syncArrows(); });
        ro2.observe(this.contentEl);
        this.register(() => ro2.disconnect());
        window.setTimeout(() => { updateFade(); syncArrows(); }, 50);

        void styleDivider;
        this.buildRibbon(container, toolbar);
        this.applyMenuStyle();
        updateSharedUI();
        this.layoutToolbar();
    },
});
export type ToolbarMethods = typeof toolbarMixin;
