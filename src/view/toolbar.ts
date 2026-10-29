import { defineMixin } from './mixin';
import { Menu, setIcon } from 'obsidian';
import { ICON_PEN, ICON_ERASER, ICON_HIGHLIGHTER, ICON_LASSO, ICON_UNDO, ICON_REDO, ICON_TRASH, ICON_SELECT_RECT, ICON_MORE, ICON_SHAPE_LINE, ICON_SHAPE_RECT, ICON_SHAPE_ELLIPSE, ICON_FILL, ICON_ARROW, ICON_DASH_SOLID, ICON_DASH_DASHED, ICON_DASH_DOTTED, ICON_DASH_DASHDOT } from '../icons';
import { Stroke } from '../types';
import { setSvg } from '../svg';

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
        return ICON_SHAPE_RECT;
    },

    // Colour palette: round swatches with a clear selection ring; custom colours are remembered next to the presets.
    renderPalette(container: HTMLElement, presets: string[], activeColor: string, kind: 'pen' | 'highlighter' | 'shape', onChange: (c: string) => void) {
        container.empty();
        const wrapper = container.createEl("div", { cls: "hw-color-palette" });
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
                m.showAtMouseEvent(e as MouseEvent);
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
        };

        refresh();
    },

    renderToolbar(container: HTMLElement) {
        const toolbar = container.createEl("div", { cls: "hw-toolbar" });
        const label = (el: HTMLElement, text: string) => { el.setAttribute('aria-label', text); el.setAttribute('title', text); };

        let markHiddenTool = () => { };
        // --- TOOLS ---
        const secTools = toolbar.createEl("div", { cls: "hw-tool-section" });
        const penBtn = this.createToolBtn(secTools, ICON_PEN, true);
        label(penBtn, 'Pen');
        const eraserBtn = this.createToolBtn(secTools, ICON_ERASER);
        label(eraserBtn, 'Eraser');
        const highBtn = this.createToolBtn(secTools, ICON_HIGHLIGHTER);
        label(highBtn, 'Highlighter');
        const selIcon = () => this.plugin.settings.selectMode === 'rect' ? ICON_SELECT_RECT : ICON_LASSO;
        const selLabel = () => this.plugin.settings.selectMode === 'rect' ? 'Rectangle selection (click again to change mode)' : 'Lasso selection (click again to change mode)';
        const lassoBtn = this.createToolBtn(secTools, selIcon());
        label(lassoBtn, selLabel());

        // Shapes menu (next to the other tools)
        const secShapes = secTools.createEl("div", { cls: "hw-shapes-section" });
        const shapeBtn = this.createToolBtn(secShapes, this.shapeIcon());
        label(shapeBtn, 'Shapes');

        toolbar.createEl("div", { cls: "hw-toolbar-divider" });

        // --- HISTORY ---
        const secHistory = toolbar.createEl("div", { cls: "hw-tool-section" });
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

        const styleDivider = toolbar.createEl("div", { cls: "hw-toolbar-divider" });

        // --- STYLE: thickness and colour ---
        // Tools are always on the toolbar; on a narrow screen thickness and colours move into a menu under one button.
        const styleInline = toolbar.createEl("div", { cls: "hw-tool-section hw-style-inline" });
        // Thickness and opacity: one button (a dot in the current thickness, colour and opacity),
        // with the choice in a small menu – the toolbar stays readable.
        const secThickness = styleInline.createEl("div", { cls: "hw-tool-section" });
        const sizeBtn = secThickness.createEl("button", { cls: "hw-tool-btn hw-size-btn" });
        const sizeDot = sizeBtn.createSpan({ cls: "hw-size-dot" });
        label(sizeBtn, 'Thickness and opacity');
        const sizePop = document.body.createEl("div", { cls: "hw-menu hw-size-pop" });
        sizePop.style.display = 'none';
        this.register(() => sizePop.remove());
        const thGroup = sizePop.createDiv({ cls: "hw-menu-group" });
        thGroup.createDiv({ cls: "hw-menu-title", text: "Thickness" });
        const thicknessWrapper = thGroup.createDiv({ cls: "hw-menu-row hw-thickness-presets" });
        const btnSm = thicknessWrapper.createEl("button", { cls: "hw-thickness-btn" });
        btnSm.createEl("div", { cls: "hw-dot hw-dot-sm" });
        const btnMd = thicknessWrapper.createEl("button", { cls: "hw-thickness-btn active" });
        btnMd.createEl("div", { cls: "hw-dot hw-dot-md" });
        const btnLg = thicknessWrapper.createEl("button", { cls: "hw-thickness-btn" });
        btnLg.createEl("div", { cls: "hw-dot hw-dot-lg" });
        const alphaGroup = sizePop.createDiv({ cls: "hw-menu-group" });
        alphaGroup.createDiv({ cls: "hw-menu-title", text: "Opacity" });
        const secAlpha = alphaGroup.createDiv({ cls: "hw-menu-row hw-alpha-row" });
        const secColor = styleInline.createEl("div", { cls: "hw-tool-section" });
        const ALPHAS = [1, 0.75, 0.5, 0.25];
        let alphaNow: number | null = 1;
        /** Opacity in the thickness menu (null = a tool without opacity – the group is hidden). */
        const renderAlpha = (current: number | null, color: string, onPick: ((a: number) => void) | null) => {
            secAlpha.empty();
            alphaGroup.style.display = onPick ? '' : 'none';
            alphaNow = onPick ? current : 1;
            if (!onPick) return;
            for (const a of ALPHAS) {
                const opt = secAlpha.createEl('button', { cls: 'hw-alpha-opt' });
                const sw = opt.createSpan({ cls: 'hw-alpha-btn' });
                sw.style.setProperty('--sw', color || 'var(--text-normal)');
                sw.style.setProperty('--sa', String(a));
                opt.createSpan({ text: `${Math.round(a * 100)}%` });
                opt.toggleClass('active', current !== null && Math.abs(current - a) < 0.01);
                opt.onclick = () => {
                    alphaNow = a;
                    onPick(a);
                    secAlpha.querySelectorAll<HTMLElement>('.hw-alpha-opt').forEach((x, i) => x.toggleClass('active', ALPHAS[i] === a));
                    updateSizeBtn();
                };
            }
        };
        const closeSizePop = () => { sizePop.style.display = 'none'; };

        const styleBtn = toolbar.createEl("button", { cls: "hw-tool-btn hw-style-btn" });
        styleBtn.createEl("span", { cls: "hw-style-dot" });
        label(styleBtn, 'Color and thickness');
        styleBtn.style.display = 'none';

        toolbar.createEl("div", { cls: "hw-toolbar-spacer" });

        // --- VIEW / MORE ---
        const secView = toolbar.createEl("div", { cls: "hw-tool-section" });
        this.quickHost = secView.createEl('div', { cls: 'hw-quick-slots' });
        this.renderQuickSlots();
        const moreBtn = this.createToolBtn(secView, ICON_MORE);
        label(moreBtn, 'More');

        // --- Popup panels (attached to <body> so the scrolling toolbar doesn't clip them) ---
        const placeBelow = (menu: HTMLElement, anchor: HTMLElement) => {
            menu.style.display = 'flex';
            const r = anchor.getBoundingClientRect();
            const mw = menu.offsetWidth, mh = menu.offsetHeight;
            let left = r.left;
            if (left + mw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - mw - 8);
            let top = r.bottom + 8;
            if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 8);
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
        };

        const shapeMenu = document.body.createEl("div", { cls: "hw-menu" });
        shapeMenu.style.display = 'none';
        this.register(() => shapeMenu.remove());
        const stylePop = document.body.createEl("div", { cls: "hw-menu hw-style-pop" });
        stylePop.style.display = 'none';
        this.register(() => stylePop.remove());

        const addGroup = (title: string) => {
            const g = shapeMenu.createEl("div", { cls: "hw-menu-group" });
            g.createEl("div", { cls: "hw-menu-title", text: title });
            return g.createEl("div", { cls: "hw-menu-row" });
        };
        const addOpt = (row: HTMLElement, icon: string, text: string, onClick: () => void) => {
            const b = this.createToolBtn(row, icon);
            b.addClass("hw-menu-btn");
            label(b, text);
            b.onclick = onClick;
            return b;
        };

        const shapeRow = addGroup("Shape");
        const shapeOpts: [NonNullable<Stroke['shape']>, HTMLElement][] = [
            ['line', addOpt(shapeRow, ICON_SHAPE_LINE, 'Line', () => { this.shapeType = 'line'; refreshShapeMenu(); })],
            ['rect', addOpt(shapeRow, ICON_SHAPE_RECT, 'Rectangle', () => { this.shapeType = 'rect'; refreshShapeMenu(); })],
            ['ellipse', addOpt(shapeRow, ICON_SHAPE_ELLIPSE, 'Circle / ellipse', () => { this.shapeType = 'ellipse'; refreshShapeMenu(); })],
        ];

        const dashRow = addGroup("Line style");
        const dashOpts: [NonNullable<Stroke['dash']>, HTMLElement][] = [
            ['solid', addOpt(dashRow, ICON_DASH_SOLID, 'Solid', () => { this.shapeDash = 'solid'; refreshShapeMenu(); })],
            ['dashed', addOpt(dashRow, ICON_DASH_DASHED, 'Dashed', () => { this.shapeDash = 'dashed'; refreshShapeMenu(); })],
            ['dotted', addOpt(dashRow, ICON_DASH_DOTTED, 'Dotted', () => { this.shapeDash = 'dotted'; refreshShapeMenu(); })],
            ['dashdot', addOpt(dashRow, ICON_DASH_DASHDOT, 'Dash-dot', () => { this.shapeDash = 'dashdot'; refreshShapeMenu(); })],
        ];

        const extraRow = addGroup("Options");
        const fillBtn = addOpt(extraRow, ICON_FILL, 'Fill with color', () => { this.shapeFill = !this.shapeFill; refreshShapeMenu(); });
        const arrowBtn = addOpt(extraRow, ICON_ARROW, 'Arrow at the end', () => { this.shapeArrow = !this.shapeArrow; refreshShapeMenu(); });

        const refreshShapeMenu = () => {
            shapeOpts.forEach(([t, b]) => b.toggleClass('active', this.shapeType === t));
            dashOpts.forEach(([d, b]) => b.toggleClass('active', this.shapeDash === d));
            fillBtn.toggleClass('active', this.shapeFill);
            arrowBtn.toggleClass('active', this.shapeArrow);
            fillBtn.style.display = this.shapeType === 'line' ? 'none' : '';
            arrowBtn.style.display = this.shapeType === 'line' ? '' : 'none';
            setSvg(shapeBtn, this.iconSvg(this.shapeIcon()));
            this.persistMemory();
            if (this.refreshToolbarUI) this.refreshToolbarUI();
        };

        const openShapeMenu = () => { closeStylePop(); placeBelow(shapeMenu, shapeBtn); };
        const closeShapeMenu = () => { shapeMenu.style.display = 'none'; };
        const openStylePop = () => { closeShapeMenu(); placeBelow(stylePop, styleBtn); };
        const closeStylePop = () => { stylePop.style.display = 'none'; };

        // Close panels when clicking outside them (capture, because the canvas stops propagation).
        this.registerDomEvent(document, 'pointerdown', (e: PointerEvent) => {
            const t = e.target as Node;
            if (!secShapes.contains(t) && !shapeMenu.contains(t)) closeShapeMenu();
            const inSize = sizePop.contains(t);
            if (!styleBtn.contains(t) && !stylePop.contains(t) && !inSize) closeStylePop();
            if (!inSize && !sizeBtn.contains(t)) closeSizePop();
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
            if (c) {
                // Narrow screen: colours, thickness and opacity together in one panel (no menu in a menu).
                stylePop.appendChild(styleInline);
                stylePop.appendChild(thGroup);
                stylePop.appendChild(alphaGroup);
                sizeBtn.style.display = 'none';
                styleBtn.style.display = '';
            } else {
                toolbar.insertBefore(styleInline, styleBtn);
                sizePop.appendChild(thGroup);
                sizePop.appendChild(alphaGroup);
                sizeBtn.style.display = '';
                styleBtn.style.display = 'none';
                closeStylePop();
            }
        };

        // --- "More" menu ---
        let moreOpen = false, moreWasOpen = false, moreHiddenAt = 0;
        moreBtn.addEventListener('pointerdown', () => { moreWasOpen = moreOpen; }, true);
        moreBtn.onclick = () => {
            // Tapping the button again while the menu is open only closes it (the menu closes itself on pointerdown).
            if (moreWasOpen || Date.now() - moreHiddenAt < 350) { moreWasOpen = false; return; }
            closeShapeMenu();
            closeStylePop();
            moreOpen = true;
            this.showMoreMenu(moreBtn);
            this.moreMenuHidden = () => { moreOpen = false; moreHiddenAt = Date.now(); };
        };

        const updateStyleBtn = () => {
            const dot = styleBtn.querySelector('.hw-style-dot') as HTMLElement | null;
            if (!dot) return;
            const t = this.currentTool;
            const color = t === 'pen' ? this.penColor : t === 'shape' ? this.shapeColor : t === 'highlighter' ? this.highlighterColor : t === 'lasso' ? (this.selectionColor() ?? '') : '';
            dot.style.setProperty('--sw', color || 'var(--text-faint)');
            styleBtn.disabled = t === 'lasso' && !this.selectionStyleKind();
            updateSizeBtn();
        };

        const currentColor = () => {
            const t = this.currentTool;
            return t === 'pen' ? this.penColor : t === 'shape' ? this.shapeColor : t === 'highlighter' ? this.highlighterColor : t === 'lasso' ? (this.selectionColor() ?? '') : '';
        };
        const updateSizeBtn = () => {
            const idx = this.currentTool === 'lasso' ? this.selectionSizeIndex() : this.activeSizeIndex;
            const px = [5, 9, 14][idx < 0 ? 1 : idx];
            sizeDot.style.width = sizeDot.style.height = `${px}px`;
            sizeDot.style.setProperty('--sw', currentColor() || 'var(--text-normal)');
            sizeDot.style.opacity = String(alphaNow ?? 1);
            sizeBtn.disabled = btnSm.disabled;
        };
        const updateThicknessUI = () => {
            [btnSm, btnMd, btnLg].forEach(b => b.removeClass("active"));
            const idx = this.currentTool === 'lasso' ? this.selectionSizeIndex() : this.activeSizeIndex;
            if (idx === 0) btnSm.addClass("active");
            if (idx === 1) btnMd.addClass("active");
            if (idx === 2) btnLg.addClass("active");
            updateSizeBtn();
        };

        const updateSharedUI = () => {
            const allSizeBtns = [btnSm, btnMd, btnLg];
            const st = this.plugin.settings;
            renderAlpha(null, '', null);
            if (this.currentTool === 'pen') {
                allSizeBtns.forEach(b => b.disabled = false);
                const alphaUI = () => { renderAlpha(this.penAlpha, this.penColor, (a) => { this.penAlpha = a; this.persistMemory(); }); updateSizeBtn(); };
                this.renderPalette(secColor, st.penPalette, this.penColor, 'pen', (c) => { this.penColor = c; this.persistMemory(); updateStyleBtn(); alphaUI(); });
                alphaUI();
            } else if (this.currentTool === 'shape') {
                allSizeBtns.forEach(b => b.disabled = false);
                this.renderPalette(secColor, st.penPalette, this.shapeColor, 'shape', (c) => { this.shapeColor = c; this.persistMemory(); updateStyleBtn(); });
            } else if (this.currentTool === 'highlighter') {
                allSizeBtns.forEach(b => b.disabled = false);
                this.renderPalette(secColor, st.highlighterPalette, this.highlighterColor, 'highlighter', (c) => { this.highlighterColor = c; this.persistMemory(); updateStyleBtn(); });
            } else if (this.currentTool === 'eraser') {
                allSizeBtns.forEach(b => b.disabled = false);
                secColor.empty();
            } else if (this.currentTool === 'lasso') {
                // Selected strokes: colour and thickness change the selection.
                const kind = this.selectionStyleKind();
                allSizeBtns.forEach(b => b.disabled = !kind);
                if (kind) {
                    const pal = kind === 'highlighter' ? st.highlighterPalette : st.penPalette;
                    this.renderPalette(secColor, pal, this.selectionColor() ?? '', kind, (c) => { this.setSelectionColor(c); updateStyleBtn(); });
                    if (kind === 'pen') renderAlpha(this.selectionAlpha(), this.selectionColor() ?? '', (a) => this.setSelectionAlpha(a));
                    else renderAlpha(null, '', null);
                } else {
                    secColor.empty();
                }
            }
            updateThicknessUI();
            updateStyleBtn();
        };
        this.refreshToolbarUI = () => {
            setSvg(lassoBtn, this.iconSvg(selIcon()));
            label(lassoBtn, selLabel());
            updateSharedUI();
        };

        const updateActiveTool = (btn: HTMLElement) => {
            markHiddenTool();
            closeShapeMenu();
            closeSizePop();
            closeStylePop();
            [penBtn, eraserBtn, highBtn, lassoBtn, shapeBtn].forEach(b => b.removeClass("active"));
            btn.addClass("active");
            if (this.currentTool !== 'lasso') this.clearSelection();
            updateSharedUI();
        };

        penBtn.onclick = () => { this.currentTool = 'pen'; updateActiveTool(penBtn); };
        eraserBtn.onclick = () => { this.currentTool = 'eraser'; updateActiveTool(eraserBtn); };
        highBtn.onclick = () => { this.currentTool = 'highlighter'; updateActiveTool(highBtn); };
        lassoBtn.onclick = (ev: MouseEvent) => {
            if (this.currentTool !== 'lasso') {
                this.currentTool = 'lasso';
                updateActiveTool(lassoBtn);
                return;
            }
            // Clicking the active tool again: choose the selection mode.
            const menu = new Menu();
            const setMode = (mode: 'lasso' | 'rect') => {
                this.plugin.settings.selectMode = mode;
                void this.plugin.saveSettings();
                setSvg(lassoBtn, this.iconSvg(selIcon()));
                label(lassoBtn, selLabel());
            };
            menu.addItem(i => i.setTitle('Lasso (freehand)').setIcon('lasso').setChecked(this.plugin.settings.selectMode === 'lasso').onClick(() => setMode('lasso')));
            menu.addItem(i => i.setTitle('Rectangle').setIcon('square-dashed').setChecked(this.plugin.settings.selectMode === 'rect').onClick(() => setMode('rect')));
            menu.showAtMouseEvent(ev);
        };
        this.activateLasso = () => { this.currentTool = 'lasso'; updateActiveTool(lassoBtn); };
        this.setTool = (t) => {
            const btn = { pen: penBtn, eraser: eraserBtn, highlighter: highBtn, lasso: lassoBtn, shape: shapeBtn }[t];
            this.currentTool = t;
            updateActiveTool(btn);
        };

        const pickSize = (i: number) => {
            if (this.currentTool === 'lasso') this.setSelectionSize(i);
            else this.activeSizeIndex = i;
            updateThicknessUI();
            closeSizePop();
        };
        sizeBtn.onclick = () => {
            if (sizePop.style.display !== 'none') { closeSizePop(); return; }
            closeShapeMenu();
            placeBelow(sizePop, sizeBtn);
        };
        btnSm.onclick = () => pickSize(0);
        btnMd.onclick = () => pickSize(1);
        btnLg.onclick = () => pickSize(2);

        shapeBtn.onclick = () => {
            if (this.currentTool !== 'shape') {
                this.currentTool = 'shape';
                updateActiveTool(shapeBtn);
                openShapeMenu();
            } else if (shapeMenu.style.display === 'none') {
                openShapeMenu();
            } else {
                closeShapeMenu();
            }
        };

        // --- Custom toolbar layout: buttons turned off in the settings are in the "More" menu ---
        this.openShapeOptions = (anchor: HTMLElement) => { closeStylePop(); closeSizePop(); placeBelow(shapeMenu, anchor); };
        const itemEls: Record<string, HTMLElement[]> = {
            eraser: [eraserBtn], highlighter: [highBtn], lasso: [lassoBtn], shapes: [secShapes],
            undo: [this.undoBtn, this.redoBtn].filter((b): b is HTMLButtonElement => !!b),
        };
        const toolItem: Record<string, string> = { eraser: 'eraser', highlighter: 'highlighter', lasso: 'lasso', shape: 'shapes' };
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
        };
        this.registerDomEvent(toolbar, 'scroll', syncArrows);
        const ro2 = new ResizeObserver(() => { updateFade(); syncArrows(); });
        ro2.observe(this.contentEl);
        this.register(() => ro2.disconnect());
        window.setTimeout(() => { updateFade(); syncArrows(); }, 50);

        void styleDivider;
        updateSharedUI();
        this.layoutToolbar();
    },
});
export type ToolbarMethods = typeof toolbarMixin;
