import { ICON_PAGES } from './icons';
import { Menu, Notice, Plugin, TAbstractFile, TFile, TFolder, TextFileView, WorkspaceLeaf, addIcon } from 'obsidian';

const ICON_NEW_NOTE = 'hw-handwritten-note';
import { CalculatorModal, CalcState, newCalcState } from './math/calculator';
import { VIEW_TYPE_HANDWRITING } from './constants';
import { isTemplate, isHexColor } from './templates';
import { Point, Stroke, ImageItem, PageData, NoteData, BBox, PageView, HistoryEntry, Selection } from './types';
import { r2, newId, shrinkCanvas } from './utils';
import { DEFAULT_QUICK_ACTIONS, QUICK_ACTIONS, TOOLBAR_ITEMS } from './quickActions';
import { migrateNote, NOTE_FORMAT_VERSION } from './format';
import { usesV4, isFormat, ENDLESS_MAX, pageWidth, pageHeight } from './pageFormat';
import { VaultAdapter, writeDataMeta, moveDataFolder, trashDataFolder, isSafeRef, isSafeDataUrl } from './dataFolder';
import { HandwritingSettings, LastPosition, ToolMemory, defaultMemory, DEFAULT_PEN_PALETTE, DEFAULT_HIGHLIGHTER_PALETTE, DEFAULT_SETTINGS, DEFAULT_PEN_SIZES, DEFAULT_HIGH_SIZES, DEFAULT_SHAPE_SIZES, SIZE_LIMITS, cleanSizes } from './settings';
import { HandwritingSettingTab } from './settingTab';
import { DebugLogModal } from './debugLog';
import { saveConverterScript, copyConverterCommand } from './converter';
import { detectSeries, schemeMatcher, seriesName } from './noteNaming';
import { buzz, setHapticsLevel } from './haptics';
import { historyMixin, HistoryMethods } from './view/history';
import { geometryMixin, GeometryMethods } from './view/geometry';
import { imagesMixin, ImagesMethods } from './view/images';
import { canvasWindowMixin, CanvasWindowMethods } from './view/canvasWindow';
import { imageInsertMixin, ImageInsertMethods } from './view/imageInsert';
import { circuitInsertMixin, CircuitInsertMethods } from './view/circuitInsert';
import type { CircuitSession } from './circuit/circuitModal';
import { pageToolsMixin, PageToolsMethods } from './view/pageTools';
import { thumbsMixin, ThumbsMethods } from './view/thumbs';
import { currentPageMixin, CurrentPageMethods } from './view/currentPage';
import { pagesPanelMixin, PagesPanelMethods } from './view/pagesPanel';
import { toolbarMixin, ToolbarMethods } from './view/toolbar';
import { pdfIOMixin, PdfIOMethods } from './view/pdfIO';
import { printMixin, PrintMethods } from './view/print';
import { strokeDrawMixin, StrokeDrawMethods } from './view/strokeDraw';
import { calcPanelMixin, CalcPanelMethods } from './view/calcPanel';
import { clipboardMixin, ClipboardMethods } from './view/clipboard';
import { menusMixin, MenusMethods } from './view/menus';
import { selectionEditMixin, SelectionEditMethods } from './view/selectionEdit';
import { shapeOpsMixin, ShapeOpsMethods } from './view/shapeOps';
import { versionsMixin, VersionsMethods } from './view/versions';
import { positionMixin, PositionMethods } from './view/position';
import { assetsMixin, AssetsMethods } from './view/assets';
import { selectionMixin, SelectionMethods } from './view/selection';
import { contextMenuMixin, ContextMenuMethods } from './view/contextMenu';
import { navigationMixin, NavigationMethods } from './view/navigation';
import { inputMixin, InputMethods } from './view/input';
import { pageSizeMixin, PageSizeMethods, PageLayout } from './view/pageSize';
import { contentsMixin, ContentsMethods } from './view/contents';
import { oledCareMixin, OledCareMethods } from './view/oledCare';
import { zoomPanelMixin, ZoomPanelMethods } from './view/zoomPanel';
import { touchMixin, TouchMethods } from './view/touch';
import { inkLayerMixin, InkLayerMethods } from './view/inkLayer';
import { perfOverlayMixin, PerfOverlayMethods } from './view/perfOverlay';
import { radialMenuMixin, RadialMenuMethods } from './view/radialMenu';
import { actionPanelsMixin, ActionPanelsMethods } from './view/actionPanels';
import { ribbonMixin, RibbonMethods, type RibbonTab } from './view/ribbon';

/** Built stroke path plus the data used to tell that the stroke has not changed. */
export interface PathCacheEntry {
    n: number; x0: number; y0: number; x1: number; y1: number; xm: number; ym: number; w: number; k: number;
    path?: Path2D;
    fill?: Path2D;   // variable-width stroke as a filled shape
}

export default class HandwritingPlugin extends Plugin {
    calcState: CalcState = newCalcState();
    /** When the version history of each note was last pruned (id -> time). */
    lastPrune: Map<string, number> = new Map();
    /** Content hash of history snapshots already read (snapshot path -> hash); snapshot files never change. */
    snapHashes: Map<string, string> = new Map();
    /** Plugin clipboard (cut / copied strokes and images). */
    clip: { strokes: Stroke[]; images: ImageItem[]; from?: string } | null = null;
    /** Circuit editor state for this Obsidian session (kept when the dialog is closed). */
    circuitSession: CircuitSession | null = null;
    /** Copied whole page ("Copy page" / "Paste page" in the page menu) – also between notes. */
    pageClip: { page: PageData; from?: string } | null = null;
    openCalculator() { new CalculatorModal(this.app, this.calcState).open(); }

    settings: HandwritingSettings = { ...DEFAULT_SETTINGS };
    lastPosTimer: number | null = null;

    /** Debug log dialog (collected messages; on desktop also a button that opens the developer console). */
    openDebugLog() {
        new DebugLogModal(this.app, () => this.settings.debugLog).open();
    }

    async onload() {
        // Custom "handwritten note" icon (sheet with a pen) – used in the file menu and commands.
        // The pages panel icon for Obsidian menus (24-unit paths scaled to Obsidian's 100-unit icon box).
        addIcon('hw-pages', `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PAGES}</g>`);
        addIcon(ICON_NEW_NOTE, '<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M58 10H24a8 8 0 0 0-8 8v64a8 8 0 0 0 8 8h22"/><path d="M58 10l22 22v10"/><path d="M58 10v22h22"/><path d="M80 52l10 10-28 28H52V80z"/><path d="M28 64c6-8 10-8 13 0s7 8 11 0"/></g>');
        await this.loadSettings();
        setHapticsLevel(this.settings.haptics);
        this.addSettingTab(new HandwritingSettingTab(this.app, this));
        this.registerView(VIEW_TYPE_HANDWRITING, (leaf) => new HandwritingView(leaf, this));
        this.registerExtensions(["hnote"], VIEW_TYPE_HANDWRITING);

        this.addCommand({
            id: 'show-debug-log',
            name: 'Show debug log',
            callback: () => this.openDebugLog(),
        });
        this.addCommand({
            id: 'open-calculator',
            name: 'Open calculator',
            callback: () => {
                const v = this.app.workspace.getActiveViewOfType(HandwritingView);
                if (v) v.toggleCalculator(); else this.openCalculator();
            },
        });
        this.addCommand({
            id: 'insert-function-plot',
            name: 'Insert function plot into handwritten note',
            checkCallback: (checking: boolean) => {
                const v = this.app.workspace.getActiveViewOfType(HandwritingView);
                if (!v) return false;
                if (!checking) v.insertPlot();
                return true;
            },
        });
        this.addCommand({
            id: 'insert-circuit',
            name: 'Insert circuit into handwritten note',
            checkCallback: (checking: boolean) => {
                const v = this.app.workspace.getActiveViewOfType(HandwritingView);
                if (!v) return false;
                if (!checking) v.insertCircuit();
                return true;
            },
        });
        this.addCommand({
            id: 'export-pdf',
            name: 'Export current note to PDF',
            checkCallback: (checking: boolean) => {
                const v = this.app.workspace.getActiveViewOfType(HandwritingView);
                if (!v) return false;
                if (!checking) void v.exportToPDF();
                return true;
            },
        });
        this.addCommand({
            id: 'print-note',
            name: 'Print current note',
            checkCallback: (checking: boolean) => {
                const v = this.app.workspace.getActiveViewOfType(HandwritingView);
                if (!v) return false;
                if (!checking) void v.printNote();
                return true;
            },
        });
        this.addCommand({
            id: 'show-version-history',
            name: 'Show version history of the current note',
            checkCallback: (checking: boolean) => {
                const v = this.app.workspace.getActiveViewOfType(HandwritingView);
                if (!v) return false;
                if (!checking) v.openVersionHistory();
                return true;
            },
        });
        this.addCommand({
            id: 'save-version-now',
            name: 'Save a version of the current note now',
            checkCallback: (checking: boolean) => {
                const v = this.app.workspace.getActiveViewOfType(HandwritingView);
                if (!v) return false;
                if (!checking) void v.snapshotNow('manual').then(ok => new Notice(ok ? 'Version saved.' : 'Nothing new to save – this state is already in the history.'));
                return true;
            },
        });
        this.addCommand({
            id: 'move-attachments-to-hidden-folder',
            name: 'Move images of the current note into its hidden folder',
            checkCallback: (checking: boolean) => {
                const v = this.app.workspace.getActiveViewOfType(HandwritingView);
                if (!v) return false;
                if (!checking) void v.moveAttachmentsToHidden();
                return true;
            },
        });
        this.addCommand({
            id: 'clean-unused-attachments',
            name: 'Remove unused images from the current note\'s hidden folder',
            checkCallback: (checking: boolean) => {
                const v = this.app.workspace.getActiveViewOfType(HandwritingView);
                if (!v || !v.file) return false;
                if (!checking) void v.syncAttachments(v.file.path, v.getViewData(), true).then(() => new Notice('Unused images removed (images still used by saved versions are kept in history/attachments).'));
                return true;
            },
        });
        this.addCommand({
            id: 'copy-python-pdf-line',
            name: 'Copy terminal line to convert this note to PDF with Python (hnote2pdf.py)',
            checkCallback: (checking: boolean) => {
                const v = this.app.workspace.getActiveViewOfType(HandwritingView);
                if (!v || !v.file) return false;
                if (!checking) void copyConverterCommand(this.app, v.file);
                return true;
            },
        });
        this.addCommand({
            id: 'save-python-converter',
            name: 'Save the PDF converter script (hnote2pdf.py) to the vault',
            callback: () => { void saveConverterScript(this.app); },
        });
        this.addCommand({
            id: 'favourite-zoom',
            name: 'Zoom to favourite zoom (repeat to cycle)',
            checkCallback: (checking: boolean) => {
                const v = this.app.workspace.getActiveViewOfType(HandwritingView);
                if (!v) return false;
                if (!checking) v.cycleZoomPreset();
                return true;
            },
        });
        this.addCommand({
            id: 'save-favourite-zoom',
            name: 'Save current zoom as favourite',
            checkCallback: (checking: boolean) => {
                const v = this.app.workspace.getActiveViewOfType(HandwritingView);
                if (!v) return false;
                if (!checking) v.saveZoomPreset();
                return true;
            },
        });
        this.addCommand({
            id: 'go-to-page',
            name: 'Go to page… (search page titles)',
            checkCallback: (checking: boolean) => {
                const v = this.app.workspace.getActiveViewOfType(HandwritingView);
                if (!v) return false;
                if (!checking) v.openGoToPage();
                return true;
            },
        });
        this.addCommand({
            id: 'set-page-title',
            name: 'Set title of the current page',
            checkCallback: (checking: boolean) => {
                const v = this.app.workspace.getActiveViewOfType(HandwritingView);
                if (!v || !v.canEdit()) return false;
                if (!checking) v.editPageTitle(v.pageIndexAtViewCenter());
                return true;
            },
        });
        this.addCommand({
            id: 'create-new-handwriting-note',
            name: 'Create new handwritten note',
            callback: async () => {
                const activeFile = this.app.workspace.getActiveFile();
                await this.createHandwritingNote(activeFile?.parent?.path ?? "");
            }
        });

        // The hidden data folder (.<name>.hnote-data) follows its note: rename, move, delete.
        this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
            if (!(file instanceof TFile) || file.extension !== 'hnote' || !oldPath.toLowerCase().endsWith('.hnote')) return;
            void moveDataFolder(this.app.vault.adapter as VaultAdapter, oldPath, file.path)
                .then(moved => { if (moved) return writeDataMeta(this.app.vault.adapter as VaultAdapter, file.path, undefined).then(() => undefined); })
                .catch(e => console.error('Handwriting: could not move the note data folder', e));
        }));
        this.registerEvent(this.app.vault.on('delete', (file: TAbstractFile) => {
            if (!(file instanceof TFile) || file.extension !== 'hnote') return;
            void trashDataFolder(this.app.vault.adapter as VaultAdapter, file.path).catch(e => console.error('Handwriting: could not remove the note data folder', e));
        }));

        // Add note creation to the context menu of folders and files.
        this.registerEvent(this.app.workspace.on('file-menu', (menu: Menu, file: TAbstractFile) => {
            const folderPath = file instanceof TFolder ? file.path : (file.parent?.path ?? "");
            menu.addItem((item) => {
                item.setTitle('New handwritten note')
                    .setIcon(ICON_NEW_NOTE)
                    .onClick(() => { void this.createHandwritingNote(folderPath); });
                // The "action-primary" section = top group of the menu (New note, New folder, New canvas, New drawing…).
                if (typeof item.setSection === 'function') item.setSection('action-primary');
            });
        }));
    }

    async loadSettings() {
        // Saved data comes from disk (older versions, hand edits): everything is checked before it is used.
        const loaded: unknown = await this.loadData();
        const saved: Record<string, unknown> | null = loaded && typeof loaded === 'object' ? loaded as Record<string, unknown> : null;
        const st: Record<string, unknown> = Object.assign({}, DEFAULT_SETTINGS, saved);
        const oneOf = <T>(v: unknown, ok: readonly T[]): v is T => (ok as readonly unknown[]).includes(v);
        const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
        const fix = (arr: unknown, def: string[]) => Array.isArray(arr) && arr.length === 5 && arr.every(isHexColor) ? (arr).map(c => c.toLowerCase()) : [...def];
        if (!isTemplate(st.defaultTemplate)) st.defaultTemplate = 'dots';
        if (!isHexColor(st.defaultPaper)) st.defaultPaper = '#ffffff';
        st.penPalette = fix(st.penPalette, DEFAULT_PEN_PALETTE);
        st.highlighterPalette = fix(st.highlighterPalette, DEFAULT_HIGHLIGHTER_PALETTE);
        // 3.16: the page rail was removed (the pages panel does the same) – its settings are dropped.
        for (const k of ['railPrecision', 'minimap', 'minimapSide']) delete st[k];
        if (!oneOf(st.pagesPanelSide, ['right', 'left'])) st.pagesPanelSide = 'right';
        if (!oneOf(st.pagesPanelColumns, [1, 2, 3])) st.pagesPanelColumns = 2;
        if (!oneOf(st.twoPageMode, ['off', 'auto', 'always'])) st.twoPageMode = 'off';
        if (!oneOf(st.twoPageAlone, ['last', 'first'])) st.twoPageAlone = 'last';
        // 3.15: the pages panel replaces the old Pages dialog – put its button on the toolbar once.
        if (!st.pagesPanelIntro) {
            st.pagesPanelIntro = true;
            if (Array.isArray(st.quickActions) && !st.quickActions.includes('pages')) st.quickActions = [...strings(st.quickActions), 'pages'];
        }
        // 3.20: the circuit builder – put its button on the toolbar once.
        if (!st.circuitIntro) {
            st.circuitIntro = true;
            if (Array.isArray(st.quickActions) && !st.quickActions.includes('circuit')) st.quickActions = [...strings(st.quickActions), 'circuit'];
        }
        for (const k of ['minimapStyle', 'minimapSize', 'minimapThumbs', 'minimapLength']) delete st[k];
        if (typeof st.pdfExportFolder !== 'string') st.pdfExportFolder = '';
        if (typeof st.pdfLastFolder !== 'string') st.pdfLastFolder = '';
        if (!oneOf(st.penButtonAction, ['none', 'snip', 'menu', 'undo', 'redo', 'swap', 'hold', 'radial'])) st.penButtonAction = DEFAULT_SETTINGS.penButtonAction;
        if (!oneOf(st.penHoldTool, ['pen', 'lasso', 'eraser', 'highlighter'])) st.penHoldTool = 'eraser';
        if (typeof st.fingerTapUndo !== 'boolean') st.fingerTapUndo = false;
        if (!oneOf(st.haptics, ['off', 'light', 'strong'])) st.haptics = 'off';
        if (!oneOf(st.menuStyle, ['classic', 'panels', 'ribbon'])) st.menuStyle = 'classic';
        if (!oneOf(st.highlighterErase, ['off', 'whole', 'partial'])) st.highlighterErase = 'whole';
        // 3.16: "erase shapes" switch + whole/partial merged into one off/whole/partial setting.
        if (st.shapeEraseOn === false) st.shapeErase = 'off';
        delete st.shapeEraseOn;
        if (typeof st.longPressMenu !== 'boolean') st.longPressMenu = true;
        if (!oneOf(st.nameMode, ['folderDate', 'folder', 'date'])) st.nameMode = st.dateFormat === 'none' ? 'folder' : 'folderDate';
        if (!oneOf(st.dateSeparator, ['-', '.', '_', ' '])) st.dateSeparator = '-';
        if (!oneOf(st.dateParts, ['dmy', 'dm'])) st.dateParts = 'dmy';
        if (typeof st.continueSeries !== 'boolean') st.continueSeries = true;
        delete st.dateFormat;
        if (!oneOf(st.pdfExportMode, ['ask', 'folder', 'disk', 'note'])) st.pdfExportMode = 'ask';
        if (typeof st.pdfExportDiskFolder !== 'string') st.pdfExportDiskFolder = '';
        if (typeof st.pdfLastDisk !== 'string') st.pdfLastDisk = '';
        if (st.pdfLastKind !== 'vault' && st.pdfLastKind !== 'disk') st.pdfLastKind = 'vault';
        let quick = Array.isArray(st.quickActions) ? strings(st.quickActions) : [...DEFAULT_QUICK_ACTIONS];
        quick = quick.map(x => x === 'pagestyle' ? 'pages' : x).filter((x, i, a) => QUICK_ACTIONS.some(q => q.id === x) && a.indexOf(x) === i);
        // v3.10: first run with the configurable toolbar – add the contents button.
        if (saved && !Array.isArray(saved.toolbarHidden) && !quick.includes('contents')) quick.push('contents');
        st.toolbarHidden = strings(st.toolbarHidden).filter((x, i, a) => TOOLBAR_ITEMS.some(t => t.id === x) && a.indexOf(x) === i);
        if (typeof st.debugLog !== 'boolean') st.debugLog = false;
        if (typeof st.dimInactivePages !== 'boolean') st.dimInactivePages = true;
        // v3.16: "writing zoom" replaced by the zoom button (current zoom + favourites). The previously saved zoom
        // becomes the first favourite and the zoom button takes the place of the previous zoom buttons on the toolbar.
        const okZ = (z: unknown): z is number => typeof z === 'number' && z >= 0.4 && z <= 4;
        let presets = Array.isArray(st.zoomPresets) ? (st.zoomPresets as unknown[]).filter(okZ) : [];
        if (saved && saved.zoomPresets === undefined) {
            const wz = saved.writingZoom;
            presets = okZ(wz) ? [Math.round(wz * 100) / 100] : [];
            st.openZoom = okZ(wz) && saved.openAtWritingZoom !== false ? presets[0] : 0;
            const had = quick.includes('writingzoom') || quick.includes('fit');
            let at = Math.max(quick.indexOf('writingzoom'), quick.indexOf('fit'));
            if (at < 0) at = quick.indexOf('calculator') + 1;
            quick = quick.filter(x => x !== 'writingzoom' && x !== 'fit');
            if (had || !quick.includes('zoom')) quick.splice(Math.max(0, Math.min(at, quick.length)), 0, 'zoom');
        }
        st.quickActions = quick;
        delete st.writingZoom; delete st.openAtWritingZoom;
        presets = presets.slice(0, 4).sort((a, b) => a - b);
        st.zoomPresets = presets;
        if (!(st.openZoom === 0 || (okZ(st.openZoom) && presets.includes(st.openZoom)))) st.openZoom = 0;
        if (typeof st.pinchZoom !== 'boolean') st.pinchZoom = true;
        st.penSizes = cleanSizes(st.penSizes, DEFAULT_PEN_SIZES, SIZE_LIMITS.pen[0], SIZE_LIMITS.pen[1]);
        st.highSizes = cleanSizes(st.highSizes, DEFAULT_HIGH_SIZES, SIZE_LIMITS.high[0], SIZE_LIMITS.high[1]);
        st.shapeSizes = cleanSizes(st.shapeSizes, DEFAULT_SHAPE_SIZES, SIZE_LIMITS.shape[0], SIZE_LIMITS.shape[1]);
        if (typeof st.middleMousePan !== 'boolean') st.middleMousePan = true;
        if (typeof st.panKey !== 'string') st.panKey = 'Space';
        if (!oneOf(st.toolOptionsLayout, ['popup', 'dock'])) st.toolOptionsLayout = 'popup';
        // Hand tool (added later): it starts in the ⋯ menu – it can be put on the toolbar in the settings.
        if (!st.handToolIntro) {
            st.handToolIntro = true;
            const hid = strings(st.toolbarHidden);
            if (!hid.includes('hand')) st.toolbarHidden = [...hid, 'hand'];
        }
        for (const k of ['oledDarkPaper', 'oledDimToolbar', 'oledPixelShift', 'oledIdleDim']) if (typeof st[k] !== 'boolean') st[k] = false;
        if (!oneOf(st.oledIdleMinutes, [1, 2, 3, 5, 10, 15, 30])) st.oledIdleMinutes = 3;
        if (typeof st.longPressMs !== 'number' || !(st.longPressMs >= 150 && st.longPressMs <= 1500)) st.longPressMs = 350;
        if (!oneOf(st.canvasQuality, ['high', 'balanced', 'fast'])) st.canvasQuality = 'balanced';
        if (typeof st.lowLatencyInk !== 'boolean') st.lowLatencyInk = true;
        if (typeof st.perfOverlay !== 'boolean') st.perfOverlay = false;
        if (!oneOf(st.shapeErase, ['off', 'whole', 'partial'])) st.shapeErase = 'partial';
        if (st.attachmentLocation !== 'hidden' && st.attachmentLocation !== 'vault') st.attachmentLocation = 'hidden';
        if (typeof st.historyEnabled !== 'boolean') st.historyEnabled = true;
        if (!oneOf(st.historyInterval, [5, 10, 15, 30, 60])) st.historyInterval = 10;
        if (!oneOf(st.historyKeepDays, [7, 30, 90, 365])) st.historyKeepDays = 30;
        if (!oneOf(st.historyMaxMB, [10, 50, 200, 1000])) st.historyMaxMB = 50;
        st.memory = this.readMemory(saved?.memory);
        st.lastPositions = this.readLastPositions(saved?.lastPositions);
        this.settings = st as unknown as HandwritingSettings;
    }

    /** Tool memory (colours, sizes, shape options) from saved data – unknown or invalid values fall back to defaults. */
    readMemory(raw: unknown): ToolMemory {
        const m: Record<string, unknown> = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
        const mem = defaultMemory();
        const sizes: Record<string, unknown> = m.sizes && typeof m.sizes === 'object' ? m.sizes as Record<string, unknown> : {};
        for (const k of ['pen', 'highlighter', 'eraser', 'shape'] as const) {
            const v = sizes[k];
            if (v === 0 || v === 1 || v === 2) mem.sizes[k] = v;
        }
        if (isHexColor(m.penColor)) mem.penColor = m.penColor.toLowerCase();
        if (isHexColor(m.highlighterColor)) mem.highlighterColor = m.highlighterColor.toLowerCase();
        const cl = (a: unknown) => Array.isArray(a) ? a.filter(isHexColor).map(c => c.toLowerCase()).slice(0, 3) : [];
        mem.customPen = cl(m.customPen);
        mem.customHigh = cl(m.customHigh);
        if (isHexColor(m.shapeColor)) mem.shapeColor = m.shapeColor.toLowerCase();
        mem.shapeFillColor = isHexColor(m.shapeFillColor) ? m.shapeFillColor.toLowerCase() : '';
        mem.customShape = cl(m.customShape);
        if (m.shapeType === 'line' || m.shapeType === 'rect' || m.shapeType === 'ellipse' || m.shapeType === 'triangle') mem.shapeType = m.shapeType;
        if (m.shapeDash === 'solid' || m.shapeDash === 'dashed' || m.shapeDash === 'dotted' || m.shapeDash === 'dashdot') mem.shapeDash = m.shapeDash;
        // Older versions stored the fill as true / false.
        mem.shapeFill = m.shapeFill === true ? 'solid' : (m.shapeFill === 'none' || m.shapeFill === 'solid' || m.shapeFill === 'light' ? m.shapeFill : 'none');
        mem.shapeOutline = m.shapeOutline !== false;
        mem.shapeArrow = m.shapeArrow === true;
        mem.shapeTriRight = m.shapeTriRight === true;
        mem.shapeOrtho = m.shapeOrtho === true;
        mem.highlighterRound = m.highlighterRound === true;
        return mem;
    }

    /** "Where I stopped" positions from saved data (invalid entries are dropped). */
    readLastPositions(raw: unknown): Record<string, LastPosition> {
        const lp: Record<string, LastPosition> = {};
        if (!raw || typeof raw !== 'object') return lp;
        const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            if (!v || typeof v !== 'object') continue;
            const p = v as Record<string, unknown>;
            if (num(p.page) && num(p.off) && num(p.zoom)) lp[k] = { page: p.page, off: p.off, zoom: p.zoom, t: num(p.t) ? p.t : 0 };
        }
        return lp;
    }

    setLastPosition(path: string, pos: LastPosition) {
        const all = this.settings.lastPositions;
        all[path] = pos;
        const keys = Object.keys(all);
        if (keys.length > 150) {
            keys.sort((a, b) => all[a].t - all[b].t);
            for (const k of keys.slice(0, keys.length - 150)) delete all[k];
        }
        if (this.lastPosTimer !== null) window.clearTimeout(this.lastPosTimer);
        this.lastPosTimer = window.setTimeout(() => { this.lastPosTimer = null; void this.saveSettings(); }, 800);
    }

    /** Saves positions immediately (note closed / Obsidian quitting) instead of waiting for the delayed save. */
    flushLastPositions() {
        if (this.lastPosTimer === null) return;
        window.clearTimeout(this.lastPosTimer);
        this.lastPosTimer = null;
        void this.saveSettings();
    }

    onunload() { this.flushLastPositions(); }

    renameLastPosition(oldPath: string, newPath: string) {
        const all = this.settings.lastPositions;
        if (all[oldPath]) { all[newPath] = all[oldPath]; delete all[oldPath]; void this.saveSettings(); }
    }

    /** Refreshes open views after a settings change (palette, pressure...). */
    refreshViews() {
        this.app.workspace.getLeavesOfType(VIEW_TYPE_HANDWRITING).forEach(leaf => {
            if (leaf.view instanceof HandwritingView) leaf.view.refreshSettings();
        });
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /** Folder name abbreviation: initials of the words ("Quantum Physics" -> "QP") or the first 3 letters of a single word ("Mathematics" -> "MAT"). */
    private abbreviateFolderName(name: string): string {
        const words = name.split(/[\s\-_.]+/).filter(w => /[\p{L}\p{N}]/u.test(w));
        if (words.length === 0) return name;
        if (words.length === 1) return Array.from(words[0]).slice(0, 3).join('').toUpperCase();
        return words.slice(0, 5).map(w => Array.from(w)[0]).join('').toUpperCase();
    }

    /** Date in the name: always DD-MM[-YYYY]; separator and parts according to the settings. */
    private formatDate(d: Date): string {
        const p = (n: number) => String(n).padStart(2, '0');
        const sep = this.settings.dateSeparator;
        const parts = [p(d.getDate()), p(d.getMonth() + 1)];
        if (this.settings.dateParts === 'dmy') parts.push(String(d.getFullYear()));
        return parts.join(sep);
    }

    /** Folder part of the name of a new note (abbreviated or full folder names). */
    private folderNamePart(folderPath: string): string {
        const s = this.settings;
        const names = folderPath.split('/').filter(Boolean).slice(-s.folderLevels);
        const parts = names.map(n => s.folderStyle === 'abbr' ? this.abbreviateFolderName(n) : n);
        return (parts.length > 0 ? parts.join(s.separator) : 'Note').replace(/[\\/:*?"<>|]/g, '-').trim();
    }

    /** Name of a new note (without extension and collision number) according to the settings. */
    buildNoteName(folderPath: string, now = new Date()): string {
        const s = this.settings;
        const folderPart = this.folderNamePart(folderPath);
        const date = this.formatDate(now);
        const sep = s.separator === '' ? ' ' : s.separator;
        const name = s.nameMode === 'date' ? date : s.nameMode === 'folder' ? folderPart : `${folderPart}${sep}${date}`;
        return name.replace(/[\\/:*?"<>|]/g, '-').trim();
    }

    /**
     * The numbered series in the folder (ćw1, ćw2 → ćw3), when "Continue numbered names" is on.
     * Only the notes directly in the folder count, and names made by the name scheme are skipped.
     */
    private seriesInFolder(folderPath: string) {
        if (!this.settings.continueSeries) return null;
        const folder = folderPath && folderPath !== '/' ? this.app.vault.getAbstractFileByPath(folderPath) : this.app.vault.getRoot();
        if (!(folder instanceof TFolder)) return null;
        const entries = folder.children
            .filter((f): f is TFile => f instanceof TFile && f.extension === 'hnote')
            .map(f => ({ name: f.basename, mtime: f.stat.mtime }));
        const s = this.settings;
        const isScheme = schemeMatcher({ mode: s.nameMode, folderPart: this.folderNamePart(folderPath), separator: s.separator, dateSeparator: s.dateSeparator });
        return detectSeries(entries, isScheme);
    }

    async createHandwritingNote(folderPath: string) {
        const prefix = folderPath && folderPath !== '/' ? folderPath + '/' : '';
        const series = this.seriesInFolder(folderPath);

        let filePath: string;
        if (series) {
            // Continue the series; a taken number (e.g. a folder note) moves on to the next one.
            let n = series.next;
            filePath = `${prefix}${seriesName(series, n)}.hnote`;
            while (this.app.vault.getAbstractFileByPath(filePath)) filePath = `${prefix}${seriesName(series, ++n)}.hnote`;
        } else {
            // No number while the name is free; a number (001, 002...) only on a collision.
            const base = this.buildNoteName(folderPath);
            filePath = `${prefix}${base}.hnote`;
            let sequence = 1;
            while (this.app.vault.getAbstractFileByPath(filePath)) {
                filePath = `${prefix}${base} ${String(sequence++).padStart(3, '0')}.hnote`;
            }
        }

        await this.app.vault.create(filePath, JSON.stringify({ pages: [{ strokes: [] }] }));
        await this.app.workspace.openLinkText(filePath, '', true);
    }
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- mixins: the interface below lists the methods added by Object.assign
export class HandwritingView extends TextFileView {
    noteData: NoteData = { pages: [{ strokes: [] }] };
    pageContexts: { highCtx: CanvasRenderingContext2D, bottomCtx: CanvasRenderingContext2D, topCtx: CanvasRenderingContext2D }[] = [];
    pageViews: PageView[] = [];

    scrollArea!: HTMLElement;
    pagesWrapper!: HTMLElement;
    edgeEls: Partial<Record<'top' | 'right' | 'bottom' | 'left', HTMLElement>> = {};
    resizeObserver!: ResizeObserver;

    currentTool: 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'shape' | 'hand' = 'pen';

    shapeType: 'line' | 'rect' | 'ellipse' | 'triangle' = 'rect';
    shapeDash: 'solid' | 'dashed' | 'dotted' | 'dashdot' = 'solid';
    shapeFill: 'none' | 'solid' | 'light' = 'none';
    /** Outline of filled shapes (false = fill only). */
    shapeLineOn = true;
    shapeArrow = false;
    /** Triangle tool: right triangle (false = isosceles). */
    shapeTriRight = false;
    /** Line tool: right-angle path (each lift of the pen = a corner). */
    shapeOrtho = false;
    /** Right-angle path being drawn with the line tool: the next segment starts at `end`, perpendicular to `dir`. */
    orthoPath: { page: number; g: string; end: Point; dir: 'h' | 'v'; last: Stroke; arrow: boolean } | null = null;
    orthoMarker: HTMLElement | null = null;
    /** Highlighter: round ends (marker) instead of flat ones. */
    highlighterRound = false;
    /** Selection menu → "Split along a line…": the next line drawn with the lasso splits the selection. */
    splitMode = false;

    penColor = '#000000';
    /** Pen opacity (1 = opaque). */
    highlighterColor = '#facc15';
    customPen: string[] = [];
    customHigh: string[] = [];
    shapeColor = '#000000';
    /** Fill colour of new filled shapes ('' = the same as the outline). */
    shapeFillColor = '';
    /** What the palette changes for the shape tool / selected shapes: the outline or the fill colour. */
    shapeColorTarget: 'line' | 'fill' = 'line';
    customShape: string[] = [];

    /** Remembered thickness, separately for each tool. */
    sizeMem: { pen: number; highlighter: number; eraser: number; shape: number } = { pen: 1, highlighter: 1, eraser: 1, shape: 1 };
    get activeSizeIndex(): number {
        const t = this.currentTool;
        return t === 'lasso' || t === 'hand' ? 1 : this.sizeMem[t];
    }
    set activeSizeIndex(v: number) {
        const t = this.currentTool;
        if (t === 'lasso' || t === 'hand') return;
        this.sizeMem[t] = v;
        this.persistMemory();
    }
    memTimer: number | null = null;
    memSnap = '';
    persistMemory() {
        const m = this.plugin.settings.memory;
        m.sizes = { ...this.sizeMem };
        m.penColor = this.penColor;
        m.highlighterColor = this.highlighterColor;
        m.customPen = [...this.customPen];
        m.customHigh = [...this.customHigh];
        m.shapeColor = this.shapeColor;
        m.shapeFillColor = this.shapeFillColor;
        m.customShape = [...this.customShape];
        m.shapeType = this.shapeType;
        m.shapeDash = this.shapeDash;
        m.shapeFill = this.shapeFill;
        m.shapeOutline = this.shapeLineOn;
        m.shapeArrow = this.shapeArrow;
        m.shapeTriRight = this.shapeTriRight;
        m.shapeOrtho = this.shapeOrtho;
        m.highlighterRound = this.highlighterRound;
        const snap = JSON.stringify(m);
        if (snap === this.memSnap) return;   // unchanged – nothing to save
        this.memSnap = snap;
        if (this.memTimer !== null) window.clearTimeout(this.memTimer);
        this.memTimer = window.setTimeout(() => { this.memTimer = null; void this.plugin.saveSettings(); }, 400);
    }
    // Thin / medium / thick widths – set in Settings → Pen and touch → Thickness.
    get penSizes(): number[] { return this.plugin.settings.penSizes; }
    get shapeSizes(): number[] { return this.plugin.settings.shapeSizes; }
    get highSizes(): number[] { return this.plugin.settings.highSizes; }
    /**
     * Eraser diameters in SCREEN pixels – like in Nebo: the eraser always has the same size on screen at any zoom
     * (in page units = size / zoom). Fast rubbing grows it up to 4×.
     */
    eraserSizes = [10, 22, 40];

    currentZoom = 1.0;
    pagePositionX = 0;
    pagePositionY = 0;
    /** Space at the top of the view covered by the floating tool dock (the first page starts below it). */
    topInset = 0;
    layoutVersion = 0;

    undoStack: HistoryEntry[] = [];
    redoStack: HistoryEntry[] = [];
    undoBtn: HTMLButtonElement | null = null;
    redoBtn: HTMLButtonElement | null = null;
    deleteSelBtn: HTMLButtonElement | null = null;
    activateLasso: (() => void) | null = null;
    setTool: ((t: 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'shape' | 'hand') => void) | null = null;
    /** The tool before the current one (pen side button 'swap'). */
    prevTool: HandwritingView['currentTool'] | null = null;
    /** The tool the toolbar last showed as active (to notice a change and remember `prevTool`). */
    toolSeen: HandwritingView['currentTool'] = 'pen';
    /** Tool used while the pen side button is held ('hold'); null = the current tool. */
    tempTool: 'pen' | 'lasso' | 'eraser' | 'highlighter' | null = null;
    /** Pen colours picked recently, newest first (radial menu). */
    recentPenColors: string[] = [];
    radialEl: HTMLElement | null = null;
    radialClose: (() => void) | null = null;
    /** Moves the active tool's options between the popups and the dock (Settings → Toolbar). */
    applyToolOptionsLayout: (() => void) | null = null;
    /** Fits the tool dock again (its content got wider / narrower) and closes its "⋯" submenu. */
    refitToolDock: (() => void) | null = null;
    closeToolDockPop: (() => void) | null = null;
    /** Updates the grab cursor (pan key held / Hand tool). */
    syncPanCursor: (() => void) | null = null;
    /** Tool used before the automatic switch to the lasso (after inserting an image / plot / pasting). */
    toolBeforeInsert: 'pen' | 'highlighter' | 'eraser' | 'shape' | 'hand' | null = null;

    // Lasso selection
    selection: Selection | null = null;
    /** Last style change of the selection (consecutive colour changes are merged into one undo step). */
    lastAttrEntry: { entry: HistoryEntry; key: string; at: number } | null = null;
    selMenuBtn: HTMLButtonElement | null = null;
    splitBtn: HTMLButtonElement | null = null;

    calcPanelEl: HTMLElement | null = null;
    calcBtn: HTMLElement | null = null;
    quickHost: HTMLElement | null = null;
    moreMenuHidden: (() => void) | null = null;
    moreBtn: HTMLElement | null = null;
    /** "+ Insert" button (menu style 'panels'). */
    insertBtn: HTMLElement | null = null;
    /** The open action panel ("+ Insert" / ⋯ in menu style 'panels'). */
    actionPopKey: string | null = null;
    actionPopClose: (() => void) | null = null;
    /** Menu style 'ribbon': the tabs, the row of the open tab and the toolbar it sits in. */
    ribbonTab: RibbonTab = 'draw';
    menuStyleShown: HandwritingSettings['menuStyle'] | null = null;
    ribbonTabsEl: HTMLElement | null = null;
    ribbonRowEl: HTMLElement | null = null;
    ribbonToolbarEl: HTMLElement | null = null;
    activePageIndex = 0;
    redrawTimer: number | null = null;
    virtRaf: number | null = null;
    /**
     * A zoom gesture (pinch, Ctrl + wheel) is in progress: page canvases are redrawn only when needed and at most one
     * per frame – the CSS-scaled old bitmap is shown meanwhile (full redraws every frame made fast zooming stutter).
     */
    zoomGesture = false;
    /** After a zoom / pan settles, the pages are made sharp one per frame (the page in the middle first). */
    settleQueue: number[] = [];
    settleRaf: number | null = null;
    /** Pending once-per-frame view update (applyManualZoom -> afterViewChange). */
    viewRaf: number | null = null;
    /**
     * "Wet ink" layer: one screen-sized canvas above the pages (outside the zoomed page column) on which the pen stroke
     * being written is drawn. Its size does not depend on the zoom.
     * After the pen is lifted the stroke goes to the page canvas and this layer is cleared.
     */
    inkCanvas: HTMLCanvasElement | null = null;
    inkCtx: CanvasRenderingContext2D | null = null;
    /** Redraws the stroke currently being written on the ink layer (set by the page that is being written on). */
    inkRedrawActive: (() => void) | null = null;
    inkClearRaf = 0;
    perf: { el: HTMLElement; raf: number; timer: number; observer: PerformanceObserver | null } | null = null;
    /** The ink context has a saved state (transform + clip of the stroke being written). */
    inkSaved = false;
    inkBegin: { pageIndex: number; rect: DOMRect } | null = null;
    /** The page column has the "moving" hint (will-change) while the view is being moved. */
    movingClassOn = false;
    movingTimer: number | null = null;
    inertiaRaf: number | null = null;
    lastMenuAt = 0;

    // Stroke bounding boxes (cache, cleared after every change of position)
    bboxCache: WeakMap<Stroke, BBox> = new WeakMap();

    // Image files from the vault -> blob URLs
    assetUrls: Map<string, string> = new Map();
    assetLoading: Map<string, Promise<string | null>> = new Map();
    /** Grows every time the note in the view changes: image loads started for the previous note are dropped. */
    assetGen = 0;
    /** Theme accent colour (read once, cleared when the theme / CSS changes). */
    accentCache: string | null = null;
    /** Page objects the page elements were last built from (undo history follows the pages when they are reordered). */
    builtPages: PageData[] = [];
    /** Where the pages sit in the page column (see pageSize.ts layoutNow / applyLayout). */
    pageLayout: PageLayout | null = null;
    /** Two pages side by side (settings: twoPageMode; 'auto' switches it with the zoom). */
    twoUp = false;
    /** The "+ Add new page" row under the last page (absent in a note with an endless page). */
    addRowEl: HTMLElement | null = null;
    /** True while buildPageElements creates the pages (the layout is applied once at the end). */
    buildingPages = false;
    /** Restores the view position as soon as the view becomes visible (see posApplyWhenVisible). */
    posRetry: (() => void) | null = null;

    plugin: HandwritingPlugin;
    snipTimer: number | null = null;

    // Palm rejection
    lastPenAt = -1e9;
    lastPointerType = 'mouse';
    cropOverlay: HTMLElement | null = null;
    cropBar: HTMLElement | null = null;
    cropKeyHandler: ((e: KeyboardEvent) => void) | null = null;
    // Position memory (src/view/position.ts)
    posKey: string | null = null;
    posReady = false;
    posLast: { page: number; off: number; zoom: number } | null = null;
    posTimer: number | null = null;
    posWait: number | null = null;
    pointersDown: Set<number> = new Set();
    menuPending = false;
    lastActivityAt = 0;
    lastPenButtonAt = 0;
    /** Last time a pen event reported the barrel button pressed (tells it apart from Windows press-and-hold). */
    lastPenBarrelAt = 0;
    cancelTouchGestures: (() => void) | null = null;

    // Moving the selection between pages
    ghostPage: number | null = null;
    /** Strokes dragged with the lasso: while dragging they are drawn on the top layer, the rest of the page stays still. */
    dragSet: Set<Stroke> | null = null;
    /** Ready stroke paths (Path2D) – redrawing while scrolling and zooming does not rebuild them. */
    pathCache: WeakMap<Stroke, PathCacheEntry> = new WeakMap();

    // Current page (src/view/currentPage.ts)
    currentPageIdx = -1;
    /** Page made current by tapping / clicking it (stays current while it is visible), -1 = none. */
    pinnedPageIdx = -1;
    /** "12 / 40" indicator beside the current page. */
    pageNumEl: HTMLElement | null = null;
    pageNumW = 0;
    pageNumTimer: number | null = null;
    /** Accent frame around the current page (screen pixels, see placeCurrentFrame). */
    curFrame: HTMLElement | null = null;
    /** Page element currently marked as the current page (the others are dimmed). */
    curPageEl: HTMLElement | null = null;
    // Pages panel (src/view/pagesPanel.ts)
    pagesPanelEl: HTMLElement | null = null;
    ppHead: HTMLElement | null = null;
    ppFoot: HTMLElement | null = null;
    ppList: HTMLElement | null = null;
    ppToast: HTMLElement | null = null;
    ppToastTimer: number | null = null;
    ppCells: HTMLElement[] = [];
    ppCanvases: HTMLCanvasElement[] = [];
    ppSelected: Set<number> = new Set();
    ppSelecting = false;
    ppCollapsed: Set<number> = new Set();
    ppFilter = '';
    ppObserver: IntersectionObserver | null = null;
    ppVisible: Set<number> = new Set();
    ppPainted: Set<number> = new Set();
    ppDirty: Set<number> = new Set();
    ppTimer: number | null = null;
    ppDrag: { from: number; lifted: boolean; started: boolean; x: number; y: number; id: number; ghost: HTMLElement | null; target: number } | null = null;
    ppIndicator: HTMLElement | null = null;
    ppAutoScroll = 0;
    ppScrollRaf = 0;
    ppStylePop: HTMLElement | null = null;
    ppStyleRefresh: (() => void) | null = null;
    ppStyleCleanup: (() => void) | null = null;
    ppCleanup: (() => void) | null = null;
    roomTimer: number | null = null;
    /** Version history: state after loading (in the form written by the plugin) and hash of the last known content. */
    baseCanonical = '';
    idAssigned = false;
    knownHash: string | null = null;
    /** Zoom button on the toolbar and its panel. */
    zoomBtn: HTMLElement | null = null;
    zoomBtnRaf = 0;
    zoomPanel: HTMLElement | null = null;
    zoomPanelCleanup: (() => void) | null = null;
    /** Removes the hidden print frame of the last print job. */
    printCleanup: (() => void) | null = null;
    /** Dragging the selection: image of the selected strokes and its transform since the drag started. */
    dragSprite: { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null = null;
    dragXform: DOMMatrix | null = null;
    /** OLED care: idle overlay, time of last activity, faded toolbar, pixel shift. */
    oledVeil: HTMLElement | null = null;
    oledLastInput = 0;
    oledUiDimmed = false;
    oledDimTimer: number | null = null;
    oledShiftAt = 0;
    oledShiftStep = 0;
    /** Contents panel (when open) and its cleanup. */
    /** Pages panel view: thumbnails or contents (titled pages). */
    ppTab: 'pages' | 'contents' = 'pages';
    ppTabBtns: HTMLElement[] = [];
    ppCols = 2;
    thumbSprites: Map<string, HTMLCanvasElement> = new Map();
    thumbFailAt: Map<string, number> = new Map();
    thumbBitmaps: Map<string, ImageBitmap | null> = new Map();

    // Toolbar callbacks
    refreshToolbarUI: (() => void) | null = null;
    layoutToolbar: (() => void) | null = null;
    /** Hides / shows toolbar buttons according to the settings (Settings → Toolbar). */
    applyToolbarItems: (() => void) | null = null;
    /** Opens the shapes menu under the given element (when the shapes button is moved to the "More" menu). */
    openShapeOptions: ((anchor: HTMLElement) => void) | null = null;
    /** Opens the eraser options (size, what it erases) under the given element. */
    openEraserOptions: ((anchor: HTMLElement) => void) | null = null;

    // Cache: does the stroke have varying pressure
    pressureCache: WeakMap<Stroke, boolean> = new WeakMap();

    /** Save postponed while the user writes (see the constructor). */
    saveDeferTimer: number | null = null;
    saveDeferSince = 0;

    constructor(leaf: WorkspaceLeaf, plugin: HandwritingPlugin) {
        super(leaf);
        this.plugin = plugin;
        // Saving serializes and hashes the whole note – on a large note that is a visible hitch in the middle of writing.
        // While the pen / mouse is active the save waits until ~1.5 s without input (but at most 10 s).
        const obsidianRequestSave = this.requestSave;
        this.requestSave = () => {
            if (!this.saveDeferSince) this.saveDeferSince = performance.now();
            if (this.saveDeferTimer !== null) return;
            const attempt = () => {
                this.saveDeferTimer = null;
                const now = performance.now();
                if (now - this.lastActivityAt < 1500 && now - this.saveDeferSince < 10000) {
                    this.saveDeferTimer = window.setTimeout(attempt, 500);
                    return;
                }
                this.saveDeferSince = 0;
                obsidianRequestSave();
            };
            attempt();
        };
        // Closing the app / window: a postponed save is written at once.
        this.registerDomEvent(window, 'beforeunload', () => {
            if (this.saveDeferTimer === null) return;
            window.clearTimeout(this.saveDeferTimer);
            this.saveDeferTimer = null;
            this.saveDeferSince = 0;
            void this.save();
        });
        const mem = plugin.settings.memory;
        this.penColor = mem.penColor || plugin.settings.penPalette[0] || '#000000';
        this.highlighterColor = mem.highlighterColor || plugin.settings.highlighterPalette[0] || '#facc15';
        this.sizeMem = { ...mem.sizes };
        this.customPen = [...mem.customPen];
        this.customHigh = [...mem.customHigh];
        this.shapeColor = mem.shapeColor || plugin.settings.penPalette[0] || '#000000';
        this.shapeFillColor = mem.shapeFillColor || '';
        this.customShape = [...mem.customShape];
        this.shapeType = mem.shapeType;
        this.shapeDash = mem.shapeDash;
        this.shapeFill = mem.shapeFill;
        this.shapeLineOn = mem.shapeOutline;
        this.shapeArrow = mem.shapeArrow;
        this.shapeTriRight = mem.shapeTriRight;
        this.shapeOrtho = mem.shapeOrtho;
        this.highlighterRound = mem.highlighterRound;
        this.memSnap = JSON.stringify({ ...mem, sizes: { ...mem.sizes } });
    }
    getViewType() { return VIEW_TYPE_HANDWRITING; }

    /** Note saved by a newer plugin version: read-only, saving returns the original data. */
    readOnly = false;
    rawData = '';
    readOnlyBanner: HTMLElement | null = null;
    readOnlyNoticeAt = 0;

    // Version history
    loadedData = '';
    baseSnapDone = false;
    snapDirty = false;
    snapTimer: number | null = null;
    lastSnapAt = 0;
    attachTimer: number | null = null;
    lastAttachSig = '';
    /** Attachment clean-ups run one after another. */
    attachChain: Promise<void> = Promise.resolve();

    async save(clear?: boolean): Promise<void> {
        await super.save(clear);
        this.afterSave();
    }

    async onUnloadFile(file: TFile): Promise<void> {
        // A postponed save is not needed any more: Obsidian saves the file itself when it is unloaded.
        if (this.saveDeferTimer !== null) { window.clearTimeout(this.saveDeferTimer); this.saveDeferTimer = null; this.saveDeferSince = 0; }
        // Save the view position before the view is cleared.
        this.posEnd();
        // Content before closing (the view is cleared afterwards) – for the "on close" snapshot.
        const text = this.readOnly ? '' : this.getViewData();
        await super.onUnloadFile(file);
        if (text) {
            await this.snapshotOnClose(text, file.path);
            if (this.attachTimer !== null) { window.clearTimeout(this.attachTimer); this.attachTimer = null; }
            await this.syncAttachments(file.path, text, true);
        }
    }

    updateReadOnlyBanner() {
        if (!this.contentEl) return;
        if (!this.readOnly) { this.readOnlyBanner?.remove(); this.readOnlyBanner = null; return; }
        if (this.readOnlyBanner) return;
        const b = createDiv();
        b.className = 'hw-readonly-banner';
        b.textContent = ('This note was saved by a newer version of the Handwriting plugin. It is open read-only so nothing gets lost — update the plugin to edit it.');
        const tb = this.contentEl.querySelector('.hw-toolbar');
        if (tb && tb.nextSibling) this.contentEl.insertBefore(b, tb.nextSibling); else this.contentEl.prepend(b);
        this.readOnlyBanner = b;
    }

    /** Whether the note can be edited (with a short notice when it can't). */
    canEdit(): boolean {
        if (!this.readOnly) return true;
        if (Date.now() - this.readOnlyNoticeAt > 3000) {
            this.readOnlyNoticeAt = Date.now();
            new Notice('This note is read-only (it was saved by a newer version of the plugin).');
        }
        return false;
    }
    getDisplayText() { return this.file ? this.file.basename : "Handwritten Note"; }

    // Serialized strokes are cached (recognized by a "fingerprint": point count, selected points and attributes),
    // so saving a large note does not re-serialize thousands of unchanged strokes.
    serCache: WeakMap<Stroke, { fp: string; json: string }> = new WeakMap();

    strokeJson(s: Stroke): string {
        const pts = s.points, n = pts.length;
        const f = pts[0], l = pts[n - 1], m = pts[n >> 1], q = pts[n >> 2];
        const fp = `${n}|${f?.x},${f?.y}|${l?.x},${l?.y}|${m?.x},${m?.y}|${q?.x},${q?.y}|${s.width}|${s.color}|${s.rot ?? ''}|${s.dash ?? ''}|${s.fill ? 1 : 0}|${s.fillColor ?? ''}|${s.fillAlpha ?? ''}|${s.noLine ? 1 : 0}|${s.arrow ? 1 : 0}|${s.shape ?? ''}|${s.right ? 1 : 0}|${s.isHighlighter ? 1 : 0}|${s.poly ? 1 : 0}|${s.g ?? ''}|${s.lock ? 1 : 0}|${s.alpha ?? ''}|${s.round ? 1 : 0}`;
        const hit = this.serCache.get(s);
        if (hit && hit.fp === fp) return hit.json;
        // Pressure is saved (as 0-100) only for strokes in which it varies.
        const hp = !s.isHighlighter && !s.shape && pts.some(pt => typeof pt.pressure === 'number' && pt.pressure !== 0.5);
        const json = JSON.stringify({ ...s, points: pts.map(pt => hp ? [r2(pt.x), r2(pt.y), Math.round(Math.max(0, Math.min(1, pt.pressure)) * 100)] : [r2(pt.x), r2(pt.y)]) });
        this.serCache.set(s, { fp, json });
        return json;
    }

    // Compact form: points as [x, y] rounded to 0.01, without pressure.
    getViewData(): string {
        // Note from a newer plugin version: save it exactly as it was loaded.
        if (this.readOnly) return this.rawData;
        return this.serializeNote(this.noteData);
    }

    /** Serializes a note to file text (always the same text for the same content). */
    serializeNote(note: NoteData): string {
        const pageStrs = note.pages.map(p => {
            const rest: Record<string, unknown> = {};
            if (p.bgPath) rest.bgPath = p.bgPath;
            if (p.bgImage) rest.bgImage = p.bgImage;
            if (p.tpl) rest.tpl = p.tpl;
            if (p.paper) rest.paper = p.paper;
            if (p.w !== undefined) rest.w = r2(p.w);
            if (p.h !== undefined) rest.h = r2(p.h);
            if (p.endless) rest.endless = true;
            if (p.title) rest.title = p.title;
            if (p.pair) rest.pair = true;
            if (p.images && p.images.length > 0) rest.images = p.images.map(i => ({ ...i, x: r2(i.x), y: r2(i.y), w: r2(i.w), h: r2(i.h) }));
            const restStr = JSON.stringify(rest);
            return '{"strokes":[' + p.strokes.map(st => this.strokeJson(st)).join(',') + ']' + (restStr === '{}' ? '' : ',' + restStr.slice(1, -1)) + '}';
        });
        const d = note.defaults;
        const id = note.id ? ',"id":' + JSON.stringify(note.id) : '';
        // "v":4 only when the note uses the new fields (page format, titles) – otherwise older plugin versions can open it too.
        const v = usesV4(note) ? NOTE_FORMAT_VERSION : 3;
        return '{"v":' + v + id + (d !== undefined ? ',"defaults":' + JSON.stringify(d) : '') + ',"pages":[' + pageStrs.join(',') + ']}';
    }

    normalizeNote(input: unknown): NoteData {
        type Obj = Record<string, unknown>;
        const obj = (v: unknown): Obj | null => v && typeof v === 'object' ? v as Obj : null;
        const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
        let parsed = obj(input);
        if (parsed && parsed.strokes && !parsed.pages) parsed = { pages: [{ strokes: parsed.strokes }] };
        if (!parsed || !Array.isArray(parsed.pages) || parsed.pages.length === 0) parsed = { pages: [{ strokes: [] }] };
        const pages: PageData[] = list(parsed.pages).map((raw) => {
            const p = obj(raw) ?? {};
            // Unknown stroke fields are kept (a newer version may have added them); points come as [x, y, pressure 0-100].
            const strokes = list(p.strokes).map((rs) => {
                const s = obj(rs) ?? {};
                // Points with a missing / non-numeric coordinate are dropped (a damaged or hand-edited note must not break drawing).
                const points: { x: number; y: number; pressure: number }[] = [];
                for (const pt of list(s.points)) {
                    const o = Array.isArray(pt) ? { x: pt[0] as unknown, y: pt[1] as unknown, pressure: typeof pt[2] === 'number' ? pt[2] / 100 : 0.5 } : obj(pt);
                    if (!o || typeof o.x !== 'number' || typeof o.y !== 'number' || !Number.isFinite(o.x) || !Number.isFinite(o.y)) continue;
                    points.push({ x: o.x, y: o.y, pressure: typeof o.pressure === 'number' && Number.isFinite(o.pressure) ? o.pressure : 0.5 });
                }
                const color = typeof s.color === 'string' && s.color ? s.color : '#000000';
                const width = typeof s.width === 'number' && Number.isFinite(s.width) && s.width > 0 ? s.width : 2;
                return { ...s, points, color, width, isHighlighter: s.isHighlighter === true };
            });
            const page: PageData = { strokes };
            // Notes may come from other people: only safe vault paths and inline data:image URLs are kept.
            if (isSafeRef(p.bgPath)) page.bgPath = p.bgPath;
            if (isSafeDataUrl(p.bgImage)) page.bgImage = p.bgImage;
            if (isTemplate(p.tpl)) page.tpl = p.tpl;
            if (isHexColor(p.paper)) page.paper = p.paper.toLowerCase();
            const num = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : undefined;
            const w = num(p.w, 200, 4000), h = num(p.h, 200, ENDLESS_MAX);
            if (w !== undefined) page.w = w;
            if (h !== undefined) page.h = h;
            if (p.endless === true) page.endless = true;
            if (typeof p.title === 'string' && p.title.trim()) page.title = p.title.trim().slice(0, 200);
            if (p.pair === true) page.pair = true;
            if (Array.isArray(p.images)) {
                page.images = list(p.images)
                    .map(obj)
                    .filter((i): i is Obj => !!i && typeof i.x === 'number' && typeof i.y === 'number' && typeof i.w === 'number' && typeof i.h === 'number')
                    .map((i) => {
                        const im: Obj = { ...i, id: typeof i.id === 'string' && i.id ? i.id : newId() };
                        if (!isSafeRef(im.path)) delete im.path;
                        if (!isSafeDataUrl(im.data)) delete im.data;
                        return im as unknown as ImageItem;
                    })
                    .filter((i) => i.path || i.data);
            }
            return page;
        });
        const d = obj(parsed.defaults);
        const defaults = d ? { tpl: isTemplate(d.tpl) ? d.tpl : undefined, paper: isHexColor(d.paper) ? d.paper.toLowerCase() : undefined, format: isFormat(d.format) ? d.format : undefined } : undefined;
        const hasId = typeof parsed.id === 'string' && /^[\w-]{4,64}$/.test(parsed.id);
        const id = hasId ? parsed.id as string : newId();
        this.idAssigned = !hasId;
        return { pages, defaults, id };
    }

    setViewData(data: string, _clear: boolean): void {
        this.posLog('setViewData', this.file?.path, 'posKey', this.posKey);
        this.readOnly = false;
        this.rawData = '';
        this.cancelCrop();
        this.releaseAssets();
        try {
            const mig = migrateNote(data ? JSON.parse(data) : null);
            if (mig.tooNew) { this.readOnly = true; this.rawData = data; }
            this.noteData = this.normalizeNote(mig.data);
        } catch {
            this.noteData = { pages: [{ strokes: [] }], id: newId() };
        }
        this.onNoteLoaded(data);
        this.updateReadOnlyBanner();
        void this.repairDataFolder();
        this.bboxCache = new WeakMap();
        this.migrateErasers();
        this.captureLoadedState();
        this.clearHistory();
        // An older note without a permanent id gets one once and for all (otherwise it would get a new one on every open).
        if (this.idAssigned && !this.readOnly) { this.idAssigned = false; window.setTimeout(() => this.requestSave(), 1500); }
        if (this.pagesWrapper) this.buildPageElements();
    }

    clear(): void {
        // The view is about to be cleared: save the position and stop tracking it (an empty view must not overwrite it).
        this.posEnd();
        this.clearHistory();
        this.cancelCrop();
        this.releaseAssets();
        this.readOnly = false;
        this.rawData = '';
        this.noteData = { pages: [{ strokes: [] }], id: newId() };
        this.bboxCache = new WeakMap();
        if (this.pagesWrapper) this.buildPageElements();
    }

    async onOpen() {
        const container = this.contentEl;
        container.empty();
        container.addClass("handwriting-container");

        this.renderToolbar(container);
        this.updateReadOnlyBanner();

        this.scrollArea = container.createDiv({ cls: "hw-scroll-area" });
        this.pagesWrapper = this.scrollArea.createDiv({ cls: "hw-pages-wrapper" });

        this.setupTouchPanZoom(this.scrollArea);
        this.setupWheel(this.scrollArea);
        this.setupMousePan(this.scrollArea);
        this.setupInkLayer();

        // Edge shadows: show that the page continues beyond the screen (when zoomed in).
        for (const side of ['top', 'right', 'bottom', 'left'] as const) {
            this.edgeEls[side] = this.scrollArea.createDiv({ cls: `hw-edge hw-edge-${side}` });
        }

        // Context menu: right mouse button (a long finger press is handled by setupTouchPanZoom).
        // Windows turns a held palm/finger into a contextmenu event, so we only react to the mouse;
        // the pen side button is handled by runPenButton, and touch has its own long-press timer.
        // Windows Ink also turns a pen held still on the screen (press-and-hold, e.g. a pause at the corner of a
        // square) into a contextmenu event – that one must NOT run the pen button action (it launched the Snipping
        // Tool while writing). The pen path only counts when the barrel button was really seen pressed just now.
        this.registerDomEvent(this.scrollArea, 'contextmenu', (e: MouseEvent) => {
            e.preventDefault();
            if (this.lastPointerType === 'mouse') this.requestPageMenu(e.clientX, e.clientY);
            else if (this.lastPointerType === 'pen' && performance.now() - this.lastPenBarrelAt < 1000) this.runPenButton(e.clientX, e.clientY);
        });
        // Track pressed pointers: menus open only after the button / finger is released,
        // otherwise the release itself closed them immediately.
        this.registerDomEvent(window, 'pointerdown', (e: PointerEvent) => { this.pointersDown.add(e.pointerId); }, { capture: true });
        for (const ev of ['pointerup', 'pointercancel'] as const) {
            this.registerDomEvent(window, ev, (e: PointerEvent) => { this.pointersDown.delete(e.pointerId); }, { capture: true });
        }

        // Keyboard shortcuts
        this.contentEl.tabIndex = -1;
        this.registerDomEvent(this.scrollArea, 'pointerdown', () => {
            this.contentEl.focus({ preventScroll: true });
        }, { capture: true });
        // Shortcuts (Delete, Ctrl+Z/X/C…) must not work while typing in a text field (e.g. in the calculator).
        const typingInField = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
        this.registerDomEvent(this.contentEl, 'keydown', (e: KeyboardEvent) => {
            if (typingInField(e) || this.readOnly) return;
            if (this.selection && (e.key === 'Delete' || e.key === 'Backspace')) {
                e.preventDefault();
                this.deleteSelection();
                return;
            }
            if (e.key === 'Escape' && (this.splitMode || this.orthoPath)) {
                e.preventDefault();
                this.cancelSplitMode();
                this.endOrthoPath();
                return;
            }
            if (this.selection && e.key === 'Escape') {
                e.preventDefault();
                this.clearSelection();
                return;
            }
            if (!(e.ctrlKey || e.metaKey)) return;
            const key = e.key.toLowerCase();
            if (key === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
            else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); this.redo(); }
            else if (key === 'x' && this.selection) { e.preventDefault(); this.copySelection(true); }
            else if (key === 'c' && this.selection) { e.preventDefault(); this.copySelection(false); }
        });

        // Pasting images (screenshots, images from the clipboard)
        this.registerDomEvent(activeDocument, 'paste', (e: ClipboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target || !(target === activeDocument.body || this.contentEl.contains(target))) return;
            if (typingInField(e) || this.readOnly) return;
            if (this.app.workspace.getActiveViewOfType(HandwritingView) !== this) return;
            const items = e.clipboardData?.items;
            if (!items) return;
            const blobs: Blob[] = [];
            for (const it of Array.from(items)) {
                if (it.kind === 'file' && it.type.startsWith('image/')) {
                    const f = it.getAsFile();
                    if (f) blobs.push(f);
                }
            }
            if (blobs.length === 0) {
                if (this.plugin.clip) { e.preventDefault(); this.pasteClip(); }
                return;
            }
            e.preventDefault();
            void this.addImageBlobs(blobs);
        });

        // Dropping files onto the view (images and PDFs)
        this.registerDomEvent(this.contentEl, 'dragover', (e: DragEvent) => {
            if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
        });
        this.registerDomEvent(this.contentEl, 'drop', (e: DragEvent) => {
            const files = e.dataTransfer?.files;
            if (!files || files.length === 0) return;
            e.preventDefault();
            if (!this.canEdit()) return;
            const list = Array.from(files);
            const pdf = list.find(f => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
            const images = list.filter(f => f.type.startsWith('image/'));
            if (images.length > 0) void this.addImageBlobs(images, { clientX: e.clientX, clientY: e.clientY });
            if (pdf) void this.importPdfFile(pdf);
        });

        // Palm rejection: remember the last pen activity (hovering over the screen included).
        const markPen = (e: PointerEvent) => {
            // "Activity" (pauses thumbnail rendering) is only writing / dragging – not mere hovering
            // or using the pages panel (otherwise thumbnails were not drawn while using them).
            const t = e.target as Node;
            const onNav = !!this.pagesPanelEl && this.pagesPanelEl.contains(t);
            if (!onNav && (e.type === 'pointerdown' || e.buttons !== 0)) this.lastActivityAt = performance.now();
            if (e.type === 'pointerdown' || e.type === 'pointermove') this.lastPointerType = e.pointerType;
            if (e.pointerType !== 'pen') return;
            this.lastPenAt = performance.now();
            if ((e.buttons & 2) !== 0 || e.button === 2) this.lastPenBarrelAt = performance.now();
            const barrelDown = e.type === 'pointerdown' && (e.button === 2 || (e.buttons & 2) !== 0);
            if (this.plugin.settings.penButtonAction === 'hold') {
                // Held side button: this stroke is drawn with the hold tool (the event goes on to the page as usual).
                if (barrelDown) { this.tempTool = this.plugin.settings.penHoldTool; buzz('snap'); }
            } else if (barrelDown || (e.type === 'pointermove' && e.button === 2)) {
                // Pen side button: don't draw, run the configured action instead.
                e.preventDefault();
                e.stopPropagation();
                this.runPenButton(e.clientX, e.clientY);
                return;
            }
            if (e.type === 'pointerdown' && this.plugin.settings.palmRejection !== 'off' && this.cancelTouchGestures) this.cancelTouchGestures();
        };
        this.registerDomEvent(this.scrollArea, 'pointerdown', markPen, { capture: true });
        this.registerDomEvent(this.scrollArea, 'pointermove', markPen, { capture: true });
        this.registerDomEvent(this.scrollArea, 'pointerup', markPen, { capture: true });
        this.registerDomEvent(this.scrollArea, 'pointerover', markPen, { capture: true });
        // The stroke drawn with the held side button has ended (bubbling phase: after the page has handled it).
        for (const ev of ['pointerup', 'pointercancel'] as const) {
            this.registerDomEvent(window, ev, (e: PointerEvent) => { if (e.pointerType === 'pen' && this.tempTool) this.tempTool = null; });
        }

        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (this.file && file === this.file && oldPath !== file.path) {
                this.plugin.renameLastPosition(oldPath, file.path);
                if (this.posKey === oldPath) this.posKey = file.path;
                void this.onNoteRenamed(oldPath);
            }
        }));

        this.buildPageIndicator();
        this.setupOledCare();
        this.applyPerfOverlay();

        this.registerEvent(this.app.workspace.on('css-change', () => { this.accentCache = null; }));

        this.resizeObserver = new ResizeObserver(() => {
            this.posRetry?.();   // a view that just became visible restores its position right away
            this.sizeInkLayer();
            if (!this.relayoutIfNeeded()) this.applyManualZoom();   // 'auto' two-page view follows the view width
            if (this.layoutToolbar) this.layoutToolbar();
        });
        this.resizeObserver.observe(this.scrollArea);
    }

    async onClose() {
        this.posEnd();
        this.closeRadialMenu();
        this.closeActionPop();
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer);
        if (this.virtRaf !== null) window.cancelAnimationFrame(this.virtRaf);
        if (this.settleRaf !== null) { window.cancelAnimationFrame(this.settleRaf); this.settleRaf = null; }
        if (this.viewRaf !== null) { window.cancelAnimationFrame(this.viewRaf); this.viewRaf = null; }
        if (this.inkClearRaf) { window.cancelAnimationFrame(this.inkClearRaf); this.inkClearRaf = 0; }
        this.stopPerfOverlay();
        if (this.movingTimer !== null) { window.clearTimeout(this.movingTimer); this.movingTimer = null; }
        this.stopInertia();
        this.stopSnipWatch();
        this.closePagesPanel();
        if (this.snapTimer !== null) { window.clearTimeout(this.snapTimer); this.snapTimer = null; }
        if (this.attachTimer !== null) { window.clearTimeout(this.attachTimer); this.attachTimer = null; }
        if (this.pageNumTimer !== null) { window.clearTimeout(this.pageNumTimer); this.pageNumTimer = null; }
        if (this.roomTimer !== null) { window.clearTimeout(this.roomTimer); this.roomTimer = null; }
        this.closeContentsPanel();
        this.closeZoomPanel();
        this.cancelCrop();
        this.printCleanup?.();
        this.contentEl.ownerDocument.querySelectorAll('.hw-align-pop').forEach(el => el.remove());
        this.releaseAssets();
    }

    /** Frees the image URLs and thumbnail copies of the note that was in the view (it is closed or replaced by another one). */
    releaseAssets() {
        this.assetGen++;
        this.assetLoading.clear();
        this.assetUrls.forEach(url => URL.revokeObjectURL(url));
        this.assetUrls.clear();
        this.thumbSprites.forEach(c => { c.width = 0; });
        this.thumbSprites.clear();
        this.thumbFailAt.clear();
        this.thumbBitmaps.forEach(b => { if (b) b.close(); });
        this.thumbBitmaps.clear();
    }

    /**
     * The page list changed (pages added, removed, reordered): undo / redo steps follow their pages to the new
     * positions, and steps of pages that are gone are dropped.
     */
    remapHistory() {
        const prev = this.builtPages, now = this.noteData.pages;
        this.builtPages = [...now];
        if (this.undoStack.length + this.redoStack.length === 0) return;
        const where = new Map<PageData, number>();
        now.forEach((p, i) => where.set(p, i));
        const move = (i: number) => { const p = prev[i]; return p ? where.get(p) ?? -1 : -1; };
        const remap = (stack: HistoryEntry[]) => stack.filter(e => {
            const page = move(e.page);
            if (page < 0) return false;
            if (e.type === 'transfer') {
                const to = move(e.to);
                if (to < 0) return false;
                e.to = to;
            }
            e.page = page;
            return true;
        });
        this.undoStack = remap(this.undoStack);
        this.redoStack = remap(this.redoStack);
        this.updateUndoRedoUI();
    }

    // Called after the plugin settings change (palette, pressure...).
    refreshSettings() {
        // The pages panel is rebuilt so a changed side applies at once.
        const panelOpen = !!this.pagesPanelEl;
        if (panelOpen) this.closePagesPanel();
        this.buildPageIndicator();
        if (panelOpen) this.openPagesPanel();
        this.applyAllPageStyles();
        this.updateCurrentPage();   // "dim other pages" may have changed
        this.renderQuickSlots();
        if (this.refreshToolbarUI) this.refreshToolbarUI();
        if (this.applyToolbarItems) this.applyToolbarItems();
        this.applyMenuStyle();
        if (this.applyToolOptionsLayout) this.applyToolOptionsLayout();
        this.syncPanCursor?.();
        this.applyOledCare();
        if (!!this.inkCanvas !== this.plugin.settings.lowLatencyInk) this.setupInkLayer();
        this.applyPerfOverlay();
        this.resizeAndRedrawAll(true);
        this.pageViews.forEach((v, i) => { if (v.active) this.redrawPage(i); });
    }

    buildPageElements() {
        this.pagesWrapper.empty();
        this.pageContexts = [];
        this.pageViews = [];
        this.pageLayout = null;
        this.addRowEl = null;
        this.twoUp = this.wantTwoUp();
        this.buildingPages = true;
        this.cancelCrop();
        this.remapHistory();
        this.selection = null;
        this.updateSelectionUI();

        this.noteData.pages.forEach((pageData, index) => {
            const singlePageContainer = this.pagesWrapper.createDiv({ cls: "hw-single-page-container" });
            const pageContainer = singlePageContainer.createDiv({ cls: "hw-page-a4" });

            // Background from a PDF as a locked image underneath (its URL is set only when the page gets close to the view)
            let bgEl: HTMLImageElement | null = null;
            if (pageData.bgPath || pageData.bgImage) {
                bgEl = pageContainer.createEl("img", { cls: "hw-page-bg" });
                bgEl.draggable = false;
                bgEl.decoding = 'async';
                pageContainer.addClass('hw-has-bg'); // no dots when the page is an imported PDF
            }
            const imgLayer = pageContainer.createDiv({ cls: "hw-image-layer" });

            // Active page (for menus and the pages dialog): the one under the mouse, or the one touched / drawn on.
            singlePageContainer.addEventListener('pointerenter', (e) => {
                if (e.pointerType !== 'touch') this.activePageIndex = index;
            });
            // Tapping / clicking / writing on a page makes it the current page (a finger scroll does not).
            let tapStart: { id: number; x: number; y: number } | null = null;
            singlePageContainer.addEventListener('pointerdown', (e) => {
                this.activePageIndex = index;
                if (e.pointerType === 'touch') tapStart = { id: e.pointerId, x: e.clientX, y: e.clientY };
                else this.pinCurrentPage(index);
            }, true);
            singlePageContainer.addEventListener('pointerup', (e) => {
                const t = tapStart;
                if (!t || t.id !== e.pointerId) return;
                tapStart = null;
                if (Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10) this.pinCurrentPage(index);
            }, true);
            singlePageContainer.addEventListener('pointercancel', () => { tapStart = null; }, true);

            const highCanvas = pageContainer.createEl("canvas", { cls: "hw-layer-highlighter" });
            const bottomCanvas = pageContainer.createEl("canvas", { cls: "hw-layer-bottom" });
            const topCanvas = pageContainer.createEl("canvas", { cls: "hw-layer-top" });
            // Veil that dims pages other than the current one (see placeCurrentFrame).
            pageContainer.createDiv({ cls: "hw-page-dim" });
            for (const c of [highCanvas, bottomCanvas, topCanvas]) {
                shrinkCanvas(c);
            }

            this.pageViews[index] = {
                outer: singlePageContainer,
                container: pageContainer,
                bgEl,
                imgLayer,
                imgEls: new Map(),
                active: false,
                scale: 1,
                win: { x: 0, y: 0, w: pageWidth(pageData), h: pageHeight(pageData) },
                highAllocated: false,
                crisp: 1,
                fixed: null
            };

            this.applyPageSize(index);
            this.setupDrawingCanvas(topCanvas, bottomCanvas, highCanvas, index);
        });
        this.buildingPages = false;

        this.createAddPageButton();
        this.applyLayout();
        this.applyAllPageStyles();
        this.applyManualZoom();
        this.updateVirtualization();
        this.buildPageIndicator();
    }

    /**
     * Loading a file into the view. First stop tracking the previous note (its content is still in the view),
     * then Obsidian loads the new one, and finally its position is restored.
     */
    async onLoadFile(file: TFile): Promise<void> {
        this.posEnd();
        await super.onLoadFile(file);
        this.posBegin(file.path);
        this.snapshotOnOpen();
    }

}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- the view's mixin methods (src/view/*.ts), added to the class right below
export interface HandwritingView extends HistoryMethods, GeometryMethods, ImagesMethods, CanvasWindowMethods, ImageInsertMethods, PageToolsMethods, ThumbsMethods, CurrentPageMethods, PagesPanelMethods, ToolbarMethods, PdfIOMethods, StrokeDrawMethods, CalcPanelMethods, ClipboardMethods, MenusMethods, SelectionEditMethods, ShapeOpsMethods, VersionsMethods, PositionMethods, AssetsMethods, SelectionMethods, ContextMenuMethods, CircuitInsertMethods, NavigationMethods, InputMethods, PageSizeMethods, ContentsMethods, OledCareMethods, ZoomPanelMethods, TouchMethods, PrintMethods, InkLayerMethods, PerfOverlayMethods, RadialMenuMethods, ActionPanelsMethods, RibbonMethods {}
Object.assign(HandwritingView.prototype, historyMixin, geometryMixin, imagesMixin, canvasWindowMixin, imageInsertMixin, pageToolsMixin, thumbsMixin, currentPageMixin, pagesPanelMixin, toolbarMixin, pdfIOMixin, strokeDrawMixin, calcPanelMixin, clipboardMixin, menusMixin, selectionEditMixin, shapeOpsMixin, versionsMixin, positionMixin, assetsMixin, selectionMixin, contextMenuMixin, circuitInsertMixin, navigationMixin, inputMixin, pageSizeMixin, contentsMixin, oledCareMixin, zoomPanelMixin, touchMixin, printMixin, inkLayerMixin, perfOverlayMixin, radialMenuMixin, actionPanelsMixin, ribbonMixin);
