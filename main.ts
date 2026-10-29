import { Menu, Notice, Plugin, TAbstractFile, TFile, TFolder, TextFileView, WorkspaceLeaf, addIcon } from 'obsidian';

const ICON_NEW_NOTE = 'hw-handwritten-note';
import { CalculatorModal, CalcState, newCalcState } from './src/math/calculator';
import { VIEW_TYPE_HANDWRITING } from './src/constants';
import { isTemplate, isHexColor } from './src/templates';
import { Stroke, ImageItem, PageData, NoteData, BBox, PageView, HistoryEntry, Selection } from './src/types';
import { r2, newId } from './src/utils';
import { DEFAULT_QUICK_ACTIONS, QUICK_ACTIONS, TOOLBAR_ITEMS } from './src/quickActions';
import { migrateNote, NOTE_FORMAT_VERSION } from './src/format';
import { usesV4, isFormat, ENDLESS_MAX, pageWidth, pageHeight } from './src/pageFormat';
import { VaultAdapter, writeDataMeta, moveDataFolder, trashDataFolder } from './src/dataFolder';
import { HandwritingSettings, LastPosition, defaultMemory, DEFAULT_PEN_PALETTE, DEFAULT_HIGHLIGHTER_PALETTE, DEFAULT_SETTINGS } from './src/settings';
import { HandwritingSettingTab } from './src/settingTab';
import { saveConverterScript, copyConverterCommand } from './src/converter';
import { historyMixin, HistoryMethods } from './src/view/history';
import { geometryMixin, GeometryMethods } from './src/view/geometry';
import { imagesMixin, ImagesMethods } from './src/view/images';
import { canvasWindowMixin, CanvasWindowMethods } from './src/view/canvasWindow';
import { imageInsertMixin, ImageInsertMethods } from './src/view/imageInsert';
import { pageToolsMixin, PageToolsMethods } from './src/view/pageTools';
import { minimapMixin, MinimapMethods } from './src/view/minimap';
import { toolbarMixin, ToolbarMethods } from './src/view/toolbar';
import { pdfIOMixin, PdfIOMethods } from './src/view/pdfIO';
import { printMixin, PrintMethods } from './src/view/print';
import { strokeDrawMixin, StrokeDrawMethods } from './src/view/strokeDraw';
import { calcPanelMixin, CalcPanelMethods } from './src/view/calcPanel';
import { clipboardMixin, ClipboardMethods } from './src/view/clipboard';
import { menusMixin, MenusMethods } from './src/view/menus';
import { selectionEditMixin, SelectionEditMethods } from './src/view/selectionEdit';
import { versionsMixin, VersionsMethods } from './src/view/versions';
import { positionMixin, PositionMethods } from './src/view/position';
import { assetsMixin, AssetsMethods } from './src/view/assets';
import { selectionMixin, SelectionMethods } from './src/view/selection';
import { contextMenuMixin, ContextMenuMethods } from './src/view/contextMenu';
import { navigationMixin, NavigationMethods } from './src/view/navigation';
import { inputMixin, InputMethods } from './src/view/input';
import { pageSizeMixin, PageSizeMethods } from './src/view/pageSize';
import { contentsMixin, ContentsMethods } from './src/view/contents';
import { oledCareMixin, OledCareMethods } from './src/view/oledCare';
import { zoomPanelMixin, ZoomPanelMethods } from './src/view/zoomPanel';
import { touchMixin, TouchMethods } from './src/view/touch';

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
    /** Plugin clipboard (cut / copied strokes and images). */
    clip: { strokes: Stroke[]; images: ImageItem[]; from?: string } | null = null;
    openCalculator() { new CalculatorModal(this.app, this.calcState).open(); }

    settings: HandwritingSettings = { ...DEFAULT_SETTINGS };
    lastPosTimer: number | null = null;

    async onload() {
        // Custom "handwritten note" icon (sheet with a pen) – used in the file menu and commands.
        addIcon(ICON_NEW_NOTE, '<g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><path d="M58 10H24a8 8 0 0 0-8 8v64a8 8 0 0 0 8 8h22"/><path d="M58 10l22 22v10"/><path d="M58 10v22h22"/><path d="M80 52l10 10-28 28H52V80z"/><path d="M28 64c6-8 10-8 13 0s7 8 11 0"/></g>');
        await this.loadSettings();
        this.addSettingTab(new HandwritingSettingTab(this.app, this));
        this.registerView(VIEW_TYPE_HANDWRITING, (leaf) => new HandwritingView(leaf, this));
        this.registerExtensions(["hnote"], VIEW_TYPE_HANDWRITING);

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
            id: 'copy-python-pdf-command',
            name: 'Copy command to convert this note to PDF with Python (hnote2pdf.py)',
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
        const saved = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
        const fix = (arr: any, def: string[]) => Array.isArray(arr) && arr.length === 5 && arr.every(c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? arr.map((c: string) => c.toLowerCase()) : [...def];
        if (!isTemplate(this.settings.defaultTemplate)) this.settings.defaultTemplate = 'dots';
        if (!isHexColor(this.settings.defaultPaper)) this.settings.defaultPaper = '#ffffff';
        this.settings.penPalette = fix(this.settings.penPalette, DEFAULT_PEN_PALETTE);
        this.settings.highlighterPalette = fix(this.settings.highlighterPalette, DEFAULT_HIGHLIGHTER_PALETTE);
        const st = this.settings as any;
        if (!['ask', 'folder', 'note'].includes(st.pdfExportMode)) st.pdfExportMode = 'ask';
        if (typeof st.pdfExportFolder !== 'string') st.pdfExportFolder = '';
        if (typeof st.pdfLastFolder !== 'string') st.pdfLastFolder = '';
        if (!['none', 'snip', 'menu', 'undo', 'redo'].includes(st.penButtonAction)) st.penButtonAction = DEFAULT_SETTINGS.penButtonAction;
        if (!['whole', 'partial'].includes(st.highlighterErase)) st.highlighterErase = 'whole';
        if (typeof st.longPressMenu !== 'boolean') st.longPressMenu = true;
        if (!['folderDate', 'folder', 'date'].includes(st.nameMode)) st.nameMode = st.dateFormat === 'none' ? 'folder' : 'folderDate';
        if (!['-', '.', '_', ' '].includes(st.dateSeparator)) st.dateSeparator = '-';
        if (!['dmy', 'dm'].includes(st.dateParts)) st.dateParts = 'dmy';
        delete st.dateFormat;
        if (!['ask', 'folder', 'disk', 'note'].includes(st.pdfExportMode)) st.pdfExportMode = 'ask';
        if (typeof st.pdfExportDiskFolder !== 'string') st.pdfExportDiskFolder = '';
        if (typeof st.pdfLastDisk !== 'string') st.pdfLastDisk = '';
        if (st.pdfLastKind !== 'vault' && st.pdfLastKind !== 'disk') st.pdfLastKind = 'vault';
        if (!Array.isArray(st.quickActions)) st.quickActions = [...DEFAULT_QUICK_ACTIONS];
        st.quickActions = st.quickActions.map((x: any) => x === 'pagestyle' ? 'pages' : x).filter((x: any, i: number, a: any[]) => typeof x === 'string' && QUICK_ACTIONS.some(q => q.id === x) && a.indexOf(x) === i);
        // v3.10: first run with the configurable toolbar – add the contents button.
        if (!Array.isArray(saved?.toolbarHidden) && saved && !st.quickActions.includes('contents')) st.quickActions.push('contents');
        st.toolbarHidden = Array.isArray(st.toolbarHidden) ? st.toolbarHidden.filter((x: any, i: number, a: any[]) => TOOLBAR_ITEMS.some(t => t.id === x) && a.indexOf(x) === i) : [];
        if (typeof st.debugLog !== 'boolean') st.debugLog = false;
        // v3.16: "writing zoom" replaced by the zoom button (current zoom + favourites). The previously saved zoom
        // becomes the first favourite and the zoom button takes the place of the previous zoom buttons on the toolbar.
        const okZ = (z: any) => typeof z === 'number' && z >= 0.4 && z <= 4;
        if (saved && saved.zoomPresets === undefined) {
            const wz = saved.writingZoom;
            st.zoomPresets = okZ(wz) ? [Math.round(wz * 100) / 100] : [];
            st.openZoom = okZ(wz) && saved.openAtWritingZoom !== false ? st.zoomPresets[0] : 0;
            const had = st.quickActions.includes('writingzoom') || st.quickActions.includes('fit');
            let at = Math.max(st.quickActions.indexOf('writingzoom'), st.quickActions.indexOf('fit'));
            if (at < 0) at = st.quickActions.indexOf('calculator') + 1;
            st.quickActions = st.quickActions.filter((x: string) => x !== 'writingzoom' && x !== 'fit');
            if (had || !st.quickActions.includes('zoom')) st.quickActions.splice(Math.max(0, Math.min(at, st.quickActions.length)), 0, 'zoom');
        }
        delete st.writingZoom; delete st.openAtWritingZoom;
        st.zoomPresets = Array.isArray(st.zoomPresets) ? st.zoomPresets.filter(okZ).slice(0, 4).sort((a: number, b: number) => a - b) : [];
        if (!(st.openZoom === 0 || (okZ(st.openZoom) && st.zoomPresets.includes(st.openZoom)))) st.openZoom = 0;
        if (typeof st.pinchZoom !== 'boolean') st.pinchZoom = true;
        for (const k of ['oledDarkPaper', 'oledDimToolbar', 'oledPixelShift', 'oledIdleDim']) if (typeof st[k] !== 'boolean') st[k] = false;
        if (![1, 2, 3, 5, 10, 15, 30].includes(st.oledIdleMinutes)) st.oledIdleMinutes = 3;
        if (typeof st.longPressMs !== 'number' || !(st.longPressMs >= 150 && st.longPressMs <= 1500)) st.longPressMs = 350;
        if (!['high', 'balanced', 'fast'].includes(st.canvasQuality)) st.canvasQuality = 'balanced';
        if (!['whole', 'partial'].includes(st.shapeErase)) st.shapeErase = 'partial';
        if (st.attachmentLocation !== 'hidden' && st.attachmentLocation !== 'vault') st.attachmentLocation = 'hidden';
        if (typeof st.historyEnabled !== 'boolean') st.historyEnabled = true;
        if (![5, 10, 15, 30, 60].includes(st.historyInterval)) st.historyInterval = 10;
        if (![7, 30, 90, 365].includes(st.historyKeepDays)) st.historyKeepDays = 30;
        if (![10, 50, 200, 1000].includes(st.historyMaxMB)) st.historyMaxMB = 50;
        const m: any = saved?.memory ?? {};
        const mem = defaultMemory();
        for (const k of ['pen', 'highlighter', 'eraser', 'shape'] as const) {
            const v = m.sizes?.[k];
            if (v === 0 || v === 1 || v === 2) mem.sizes[k] = v;
        }
        if (isHexColor(m.penColor)) mem.penColor = m.penColor.toLowerCase();
        if (typeof m.penAlpha === 'number' && m.penAlpha >= 0.1 && m.penAlpha <= 1) mem.penAlpha = m.penAlpha;
        if (isHexColor(m.highlighterColor)) mem.highlighterColor = m.highlighterColor.toLowerCase();
        const cl = (a: any) => Array.isArray(a) ? a.filter((c: any) => isHexColor(c)).map((c: string) => c.toLowerCase()).slice(0, 3) : [];
        mem.customPen = cl(m.customPen);
        mem.customHigh = cl(m.customHigh);
        if (isHexColor(m.shapeColor)) mem.shapeColor = m.shapeColor.toLowerCase();
        mem.customShape = cl(m.customShape);
        if (['line', 'rect', 'ellipse'].includes(m.shapeType)) mem.shapeType = m.shapeType;
        if (['solid', 'dashed', 'dotted', 'dashdot'].includes(m.shapeDash)) mem.shapeDash = m.shapeDash;
        mem.shapeFill = m.shapeFill === true;
        mem.shapeArrow = m.shapeArrow === true;
        this.settings.memory = mem;
        const lp: Record<string, LastPosition> = {};
        const rawLp = saved?.lastPositions;
        if (rawLp && typeof rawLp === 'object') {
            for (const [k, v] of Object.entries(rawLp as Record<string, any>)) {
                if (v && Number.isFinite(v.page) && Number.isFinite(v.off) && Number.isFinite(v.zoom)) lp[k] = { page: v.page, off: v.off, zoom: v.zoom, t: Number.isFinite(v.t) ? v.t : 0 };
            }
        }
        this.settings.lastPositions = lp;
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

    /** Refreshes open views after a settings change (palette, minimap...). */
    refreshViews() {
        this.app.workspace.getLeavesOfType(VIEW_TYPE_HANDWRITING).forEach(leaf => {
            const v = leaf.view as any;
            if (v && typeof v.refreshSettings === 'function') v.refreshSettings();
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

    /** Name of a new note (without extension and collision number) according to the settings. */
    buildNoteName(folderPath: string, now = new Date()): string {
        const s = this.settings;
        const names = folderPath.split('/').filter(Boolean).slice(-s.folderLevels);
        const parts = names.map(n => s.folderStyle === 'abbr' ? this.abbreviateFolderName(n) : n);
        const folderPart = parts.length > 0 ? parts.join(s.separator) : 'Note';
        const date = this.formatDate(now);
        const sep = s.separator === '' ? ' ' : s.separator;
        const name = s.nameMode === 'date' ? date : s.nameMode === 'folder' ? folderPart : `${folderPart}${sep}${date}`;
        return name.replace(/[\\/:*?"<>|]/g, '-').trim();
    }

    async createHandwritingNote(folderPath: string) {
        const base = this.buildNoteName(folderPath);
        const prefix = folderPath && folderPath !== '/' ? folderPath + '/' : '';

        // No number while the name is free; a number (001, 002...) only on a collision.
        let filePath = `${prefix}${base}.hnote`;
        let sequence = 1;
        while (this.app.vault.getAbstractFileByPath(filePath)) {
            filePath = `${prefix}${base} ${String(sequence++).padStart(3, '0')}.hnote`;
        }

        await this.app.vault.create(filePath, JSON.stringify({ pages: [{ strokes: [] }] }));
        await this.app.workspace.openLinkText(filePath, '', true);
    }
}

export class HandwritingView extends TextFileView {
    noteData: NoteData = { pages: [{ strokes: [] }] };
    pageContexts: { highCtx: CanvasRenderingContext2D, bottomCtx: CanvasRenderingContext2D, topCtx: CanvasRenderingContext2D }[] = [];
    pageViews: PageView[] = [];

    scrollArea!: HTMLElement;
    pagesWrapper!: HTMLElement;
    edgeEls: Partial<Record<'top' | 'right' | 'bottom' | 'left', HTMLElement>> = {};
    resizeObserver!: ResizeObserver;

    currentTool: 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'shape' = 'pen';

    shapeType: 'line' | 'rect' | 'ellipse' = 'rect';
    shapeDash: 'solid' | 'dashed' | 'dotted' | 'dashdot' = 'solid';
    shapeFill = false;
    shapeArrow = false;

    penColor = '#000000';
    /** Pen opacity (1 = opaque). */
    penAlpha = 1;
    highlighterColor = '#facc15';
    customPen: string[] = [];
    customHigh: string[] = [];
    shapeColor = '#000000';
    customShape: string[] = [];

    /** Remembered thickness, separately for each tool. */
    sizeMem: { pen: number; highlighter: number; eraser: number; shape: number } = { pen: 1, highlighter: 1, eraser: 1, shape: 1 };
    get activeSizeIndex(): number {
        const t = this.currentTool;
        return t === 'lasso' ? 1 : this.sizeMem[t];
    }
    set activeSizeIndex(v: number) {
        const t = this.currentTool;
        if (t === 'lasso') return;
        this.sizeMem[t] = v;
        this.persistMemory();
    }
    memTimer: number | null = null;
    memSnap = '';
    persistMemory() {
        const m = this.plugin.settings.memory;
        m.sizes = { ...this.sizeMem };
        m.penColor = this.penColor;
        m.penAlpha = this.penAlpha;
        m.highlighterColor = this.highlighterColor;
        m.customPen = [...this.customPen];
        m.customHigh = [...this.customHigh];
        m.shapeColor = this.shapeColor;
        m.customShape = [...this.customShape];
        m.shapeType = this.shapeType;
        m.shapeDash = this.shapeDash;
        m.shapeFill = this.shapeFill;
        m.shapeArrow = this.shapeArrow;
        const snap = JSON.stringify(m);
        if (snap === this.memSnap) return;   // unchanged – nothing to save
        this.memSnap = snap;
        if (this.memTimer !== null) window.clearTimeout(this.memTimer);
        this.memTimer = window.setTimeout(() => { this.memTimer = null; void this.plugin.saveSettings(); }, 400);
    }
    penSizes = [0.5, 1, 2];
    shapeSizes = [1.5, 3, 5];
    highSizes = [15, 25, 35];
    /**
     * Eraser diameters in SCREEN pixels – like in Nebo: the eraser always has the same size on screen at any zoom
     * (in page units = size / zoom). Fast rubbing grows it up to 4×.
     */
    eraserSizes = [10, 22, 40];

    currentZoom = 1.0;
    pagePositionX = 0;
    pagePositionY = 0;
    layoutVersion = 0;

    undoStack: HistoryEntry[] = [];
    redoStack: HistoryEntry[] = [];
    undoBtn: HTMLButtonElement | null = null;
    redoBtn: HTMLButtonElement | null = null;
    deleteSelBtn: HTMLButtonElement | null = null;
    activateLasso: (() => void) | null = null;
    setTool: ((t: 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'shape') => void) | null = null;
    /** Tool used before the automatic switch to the lasso (after inserting an image / plot / pasting). */
    toolBeforeInsert: 'pen' | 'highlighter' | 'eraser' | 'shape' | null = null;

    // Lasso selection
    selection: Selection | null = null;
    /** Last style change of the selection (consecutive colour changes are merged into one undo step). */
    lastAttrEntry: { entry: HistoryEntry; key: string; at: number } | null = null;
    selMenuBtn: HTMLButtonElement | null = null;

    calcPanelEl: HTMLElement | null = null;
    calcBtn: HTMLElement | null = null;
    quickHost: HTMLElement | null = null;
    moreMenuHidden: (() => void) | null = null;
    activePageIndex = 0;
    redrawTimer: number | null = null;
    virtRaf: number | null = null;
    inertiaRaf: number | null = null;
    lastMenuAt = 0;

    // Stroke bounding boxes (cache, cleared after every change of position)
    bboxCache: WeakMap<Stroke, BBox> = new WeakMap();

    // Image files from the vault -> blob URLs
    assetUrls: Map<string, string> = new Map();
    assetLoading: Map<string, Promise<string | null>> = new Map();

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
    cancelTouchGestures: (() => void) | null = null;

    // Moving the selection between pages
    ghostPage: number | null = null;
    /** Strokes dragged with the lasso: while dragging they are drawn on the top layer, the rest of the page stays still. */
    dragSet: Set<Stroke> | null = null;
    /** Ready stroke paths (Path2D) – redrawing while scrolling and zooming does not rebuild them. */
    pathCache: WeakMap<Stroke, PathCacheEntry> = new WeakMap();

    // Minimap
    minimapEl: HTMLElement | null = null;
    minimapInner: HTMLElement | null = null;
    minimapVp: HTMLElement | null = null;
    minimapCells: HTMLElement[] = [];
    minimapCanvases: (HTMLCanvasElement | null)[] = [];
    /** Minimap: thumbnail width, height of each thumbnail, their positions and total height. */
    minimapW = 56;
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
    contentsPanel: HTMLElement | null = null;
    contentsAnchor: HTMLElement | null = null;
    contentsCleanup: (() => void) | null = null;
    minimapHs: number[] = [];
    minimapTops: number[] = [];
    minimapTotal = 0;
    minimapOffset = 0;
    minimapDragging = false;
    minimapCurrent = -1;
    minimapHideTimer: number | null = null;
    minimapOpen = true;
    minimapCloseTimer: number | null = null;
    minimapBadge: HTMLElement | null = null;
    minimapBadgeTimer: number | null = null;
    thumbStale = false;
    pageStyleScope: 'page' | 'all' = 'all';
    thumbSprites: Map<string, HTMLCanvasElement> = new Map();
    thumbFailAt: Map<string, number> = new Map();
    thumbRenderId: Map<number, number> = new Map();
    thumbBitmaps: Map<string, ImageBitmap | null> = new Map();
    thumbDirty: Set<number> = new Set();
    thumbTimer: number | null = null;

    // Toolbar callbacks
    refreshToolbarUI: (() => void) | null = null;
    layoutToolbar: (() => void) | null = null;
    /** Hides / shows toolbar buttons according to the settings (Settings → Toolbar). */
    applyToolbarItems: (() => void) | null = null;
    /** Opens the shapes menu under the given element (when the shapes button is moved to the "More" menu). */
    openShapeOptions: ((anchor: HTMLElement) => void) | null = null;

    // Cache: does the stroke have varying pressure
    pressureCache: WeakMap<Stroke, boolean> = new WeakMap();

    constructor(leaf: WorkspaceLeaf, plugin: HandwritingPlugin) {
        super(leaf);
        this.plugin = plugin;
        const mem = plugin.settings.memory;
        this.penColor = mem.penColor || plugin.settings.penPalette[0] || '#000000';
        this.penAlpha = mem.penAlpha ?? 1;
        this.highlighterColor = mem.highlighterColor || plugin.settings.highlighterPalette[0] || '#facc15';
        this.sizeMem = { ...mem.sizes };
        this.customPen = [...mem.customPen];
        this.customHigh = [...mem.customHigh];
        this.shapeColor = mem.shapeColor || plugin.settings.penPalette[0] || '#000000';
        this.customShape = [...mem.customShape];
        this.shapeType = mem.shapeType;
        this.shapeDash = mem.shapeDash;
        this.shapeFill = mem.shapeFill;
        this.shapeArrow = mem.shapeArrow;
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
    attachSyncing = false;

    async save(clear?: boolean): Promise<void> {
        await super.save(clear);
        this.afterSave();
    }

    async onUnloadFile(file: TFile): Promise<void> {
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
        const b = document.createElement('div');
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
        const fp = `${n}|${f?.x},${f?.y}|${l?.x},${l?.y}|${m?.x},${m?.y}|${q?.x},${q?.y}|${s.width}|${s.color}|${s.rot ?? ''}|${s.dash ?? ''}|${s.fill ? 1 : 0}|${s.arrow ? 1 : 0}|${s.shape ?? ''}|${s.isHighlighter ? 1 : 0}|${s.poly ? 1 : 0}|${s.g ?? ''}|${s.lock ? 1 : 0}|${s.alpha ?? ''}`;
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
            const rest: any = {};
            if (p.bgPath) rest.bgPath = p.bgPath;
            if (p.bgImage) rest.bgImage = p.bgImage;
            if (p.tpl) rest.tpl = p.tpl;
            if (p.paper) rest.paper = p.paper;
            if (p.w !== undefined) rest.w = r2(p.w);
            if (p.h !== undefined) rest.h = r2(p.h);
            if (p.endless) rest.endless = true;
            if (p.title) rest.title = p.title;
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

    normalizeNote(input: any): NoteData {
        let parsed = input;
        if (parsed && parsed.strokes && !parsed.pages) parsed = { pages: [{ strokes: parsed.strokes }] };
        if (!parsed || !Array.isArray(parsed.pages) || parsed.pages.length === 0) parsed = { pages: [{ strokes: [] }] };
        const pages: PageData[] = parsed.pages.map((p: any) => {
            const strokes: Stroke[] = (Array.isArray(p.strokes) ? p.strokes : []).map((s: any) => ({
                ...s,
                points: (Array.isArray(s.points) ? s.points : []).map((pt: any) =>
                    Array.isArray(pt) ? { x: pt[0], y: pt[1], pressure: typeof pt[2] === 'number' ? pt[2] / 100 : 0.5 } : pt)
            }));
            const page: PageData = { strokes };
            if (p.bgPath) page.bgPath = p.bgPath;
            if (p.bgImage) page.bgImage = p.bgImage;
            if (isTemplate(p.tpl)) page.tpl = p.tpl;
            if (isHexColor(p.paper)) page.paper = p.paper.toLowerCase();
            const num = (v: any, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : undefined;
            const w = num(p.w, 200, 4000), h = num(p.h, 200, ENDLESS_MAX);
            if (w !== undefined) page.w = w;
            if (h !== undefined) page.h = h;
            if (p.endless === true) page.endless = true;
            if (typeof p.title === 'string' && p.title.trim()) page.title = p.title.trim().slice(0, 200);
            if (Array.isArray(p.images)) {
                page.images = p.images
                    .filter((i: any) => i && typeof i.x === 'number' && typeof i.y === 'number' && typeof i.w === 'number' && typeof i.h === 'number' && (i.path || i.data))
                    .map((i: any) => ({ ...i, id: i.id || newId() }));
            }
            return page;
        });
        const d = parsed.defaults;
        const defaults = d && typeof d === 'object' ? { tpl: isTemplate(d.tpl) ? d.tpl : undefined, paper: isHexColor(d.paper) ? d.paper.toLowerCase() : undefined, format: isFormat(d.format) ? d.format : undefined } : undefined;
        const hasId = typeof parsed.id === 'string' && /^[\w-]{4,64}$/.test(parsed.id);
        const id = hasId ? parsed.id : newId();
        this.idAssigned = !hasId;
        return { pages, defaults, id };
    }

    setViewData(data: string, _clear: boolean): void {
        this.posLog('setViewData', this.file?.path, 'posKey', this.posKey);
        this.readOnly = false;
        this.rawData = '';
        try {
            const mig = migrateNote(data ? JSON.parse(data) : null);
            if (mig.tooNew) { this.readOnly = true; this.rawData = data; }
            this.noteData = this.normalizeNote(mig.data);
        } catch (e) {
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

        this.scrollArea = container.createEl("div", { cls: "hw-scroll-area" });
        this.pagesWrapper = this.scrollArea.createEl("div", { cls: "hw-pages-wrapper" });

        this.setupTouchPanZoom(this.scrollArea);
        this.setupWheel(this.scrollArea);

        // Edge shadows: show that the page continues beyond the screen (when zoomed in).
        for (const side of ['top', 'right', 'bottom', 'left'] as const) {
            this.edgeEls[side] = this.scrollArea.createEl('div', { cls: `hw-edge hw-edge-${side}` });
        }

        // Context menu: right mouse button (a long finger press is handled by setupTouchPanZoom).
        // Windows turns a held palm/finger into a contextmenu event, so we only react to the mouse;
        // the pen side button is handled by runPenButton, and touch has its own long-press timer.
        this.registerDomEvent(this.scrollArea, 'contextmenu', (e: MouseEvent) => {
            e.preventDefault();
            if (this.lastPointerType === 'mouse') this.requestPageMenu(e.clientX, e.clientY);
            else if (this.lastPointerType === 'pen') this.runPenButton(e.clientX, e.clientY);
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
        this.registerDomEvent(document, 'paste', (e: ClipboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target || !(target === document.body || this.contentEl.contains(target))) return;
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
            // or using the minimap (otherwise thumbnails were not drawn while the mouse was over the minimap).
            const onMinimap = !!this.minimapEl && this.minimapEl.contains(e.target as Node);
            if (!onMinimap && (e.type === 'pointerdown' || e.buttons !== 0)) this.lastActivityAt = performance.now();
            if (e.type === 'pointerdown' || e.type === 'pointermove') this.lastPointerType = e.pointerType;
            if (e.pointerType !== 'pen') return;
            this.lastPenAt = performance.now();
            // Pen side button: don't draw, run the configured action instead.
            if ((e.type === 'pointerdown' && (e.button === 2 || (e.buttons & 2) !== 0)) || (e.type === 'pointermove' && e.button === 2)) {
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

        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (this.file && file === this.file && oldPath !== file.path) {
                this.plugin.renameLastPosition(oldPath, file.path);
                if (this.posKey === oldPath) this.posKey = file.path;
                void this.onNoteRenamed(oldPath);
            }
        }));

        this.buildMinimap();
        this.setupOledCare();

        this.resizeObserver = new ResizeObserver(() => {
            this.applyManualZoom();
            if (this.layoutToolbar) this.layoutToolbar();
        });
        this.resizeObserver.observe(this.scrollArea);
    }

    async onClose() {
        this.posEnd();
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        if (this.redrawTimer !== null) window.clearTimeout(this.redrawTimer);
        if (this.virtRaf !== null) window.cancelAnimationFrame(this.virtRaf);
        this.stopInertia();
        this.stopSnipWatch();
        if (this.thumbTimer !== null) window.clearTimeout(this.thumbTimer);
        if (this.snapTimer !== null) { window.clearTimeout(this.snapTimer); this.snapTimer = null; }
        if (this.attachTimer !== null) { window.clearTimeout(this.attachTimer); this.attachTimer = null; }
        if (this.minimapHideTimer !== null) window.clearTimeout(this.minimapHideTimer);
        if (this.roomTimer !== null) { window.clearTimeout(this.roomTimer); this.roomTimer = null; }
        this.closeContentsPanel();
        this.closeZoomPanel();
        this.thumbBitmaps.forEach(b => { if (b) b.close(); });
        this.thumbBitmaps.clear();
        if (this.minimapCloseTimer !== null) window.clearTimeout(this.minimapCloseTimer);
        if (this.minimapBadgeTimer !== null) window.clearTimeout(this.minimapBadgeTimer);
        this.assetUrls.forEach(url => URL.revokeObjectURL(url));
        this.assetUrls.clear();
    }

    // Called after the plugin settings change (palette, minimap, pressure...).
    refreshSettings() {
        this.buildMinimap();
        this.applyAllPageStyles();
        this.renderQuickSlots();
        if (this.refreshToolbarUI) this.refreshToolbarUI();
        if (this.applyToolbarItems) this.applyToolbarItems();
        this.applyOledCare();
        this.resizeAndRedrawAll(true);
        this.pageViews.forEach((v, i) => { if (v.active) this.redrawPage(i); });
    }

    buildPageElements() {
        this.pagesWrapper.empty();
        this.pageContexts = [];
        this.pageViews = [];
        this.clearHistory();

        this.noteData.pages.forEach((pageData, index) => {
            const singlePageContainer = this.pagesWrapper.createEl("div", { cls: "hw-single-page-container" });
            const pageContainer = singlePageContainer.createEl("div", { cls: "hw-page-a4" });

            // Background from a PDF as a locked image underneath (its URL is set only when the page gets close to the view)
            let bgEl: HTMLImageElement | null = null;
            if (pageData.bgPath || pageData.bgImage) {
                bgEl = pageContainer.createEl("img", { cls: "hw-page-bg" });
                bgEl.draggable = false;
                bgEl.decoding = 'async';
                pageContainer.addClass('hw-has-bg'); // no dots when the page is an imported PDF
            }
            const imgLayer = pageContainer.createEl("div", { cls: "hw-image-layer" });

            // Active page (for menus and the pages dialog): the one under the mouse, or the one touched / drawn on.
            singlePageContainer.addEventListener('pointerenter', (e) => {
                if (e.pointerType !== 'touch') this.activePageIndex = index;
            });
            singlePageContainer.addEventListener('pointerdown', () => { this.activePageIndex = index; }, true);

            const highCanvas = pageContainer.createEl("canvas", { cls: "hw-layer-highlighter" });
            const bottomCanvas = pageContainer.createEl("canvas", { cls: "hw-layer-bottom" });
            const topCanvas = pageContainer.createEl("canvas", { cls: "hw-layer-top" });
            for (const c of [highCanvas, bottomCanvas, topCanvas]) {
                c.width = 1; c.height = 1;
                c.style.width = '1px'; c.style.height = '1px';
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
        if (this.pagesWrapper) this.pagesWrapper.style.width = `${this.wrapperW()}px`;

        this.createAddPageButton();
        this.applyAllPageStyles();
        this.applyManualZoom();
        this.updateVirtualization();
        this.buildMinimap();
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

export interface HandwritingView extends HistoryMethods, GeometryMethods, ImagesMethods, CanvasWindowMethods, ImageInsertMethods, PageToolsMethods, MinimapMethods, ToolbarMethods, PdfIOMethods, StrokeDrawMethods, CalcPanelMethods, ClipboardMethods, MenusMethods, SelectionEditMethods, VersionsMethods, PositionMethods, AssetsMethods, SelectionMethods, ContextMenuMethods, NavigationMethods, InputMethods, PageSizeMethods, ContentsMethods, OledCareMethods, ZoomPanelMethods, TouchMethods, PrintMethods {}
Object.assign(HandwritingView.prototype, historyMixin, geometryMixin, imagesMixin, canvasWindowMixin, imageInsertMixin, pageToolsMixin, minimapMixin, toolbarMixin, pdfIOMixin, strokeDrawMixin, calcPanelMixin, clipboardMixin, menusMixin, selectionEditMixin, versionsMixin, positionMixin, assetsMixin, selectionMixin, contextMenuMixin, navigationMixin, inputMixin, pageSizeMixin, contentsMixin, oledCareMixin, zoomPanelMixin, touchMixin, printMixin);
