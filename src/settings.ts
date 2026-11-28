import { Platform } from 'obsidian';
import { PageTemplate } from './templates';
import { DEFAULT_QUICK_ACTIONS } from './quickActions';

export interface HandwritingSettings {
    /** How many folder levels (counting from the nearest) go into the name of a new note. */
    folderLevels: 1 | 2 | 3;
    /** 'abbr' = abbreviation (initials or 3 letters), 'full' = full folder name. */
    folderStyle: 'abbr' | 'full';
    /** Separator between folder names and between the name and the date. */
    separator: string;
    /** What the name of a new note consists of. */
    nameMode: 'folderDate' | 'folder' | 'date';
    /** Date separator (the format is always DD-MM-YYYY; "/" is not allowed in file names). */
    dateSeparator: '-' | '.' | '_' | ' ';
    /** 'dmy' = day, month, year; 'dm' = day and month only. */
    dateParts: 'dmy' | 'dm';
    /** A new note continues a numbered series of the folder (ćw1, ćw2 → ćw3) instead of using the name scheme. */
    continueSeries: boolean;
    /** Old date format setting (migration only). */
    dateFormat?: string;
    /** Default selection mode: lasso or rectangle. */
    selectMode: 'lasso' | 'rect';

    /** Pen pressure sensitivity (stroke width depends on pressure). */
    pressureEnabled: boolean;
    pressureSensitivity: number;   // 0..1

    /** Palm rejection: 'off', 'auto' (a finger is ignored when the pen is near or the touch is large), 'strict' (fingers never scroll). */
    palmRejection: 'off' | 'auto' | 'strict';
    palmPenTimeout: number;        // ms after the last pen activity during which touch is ignored
    palmContactSize: number;       // px; touches wider than this are treated as a palm (0 = don't check)
    /** Two-finger zoom (can be turned off if a hand zooms the view by accident). */
    pinchZoom: boolean;
    /** Dragging with the middle mouse button moves the page. */
    middleMousePan: boolean;
    /** Key (KeyboardEvent.code) held while dragging with the left mouse button moves the page ('' = off). */
    panKey: string;
    /** The Hand tool was put into the ⋯ menu once (it is off the toolbar by default). */
    handToolIntro?: boolean;
    /** Options of the active tool: popups (tap the tool again) or a floating dock under the toolbar. */
    toolOptionsLayout: 'popup' | 'dock';
    /**
     * Where the actions that are not on the toolbar live: 'classic' = one ⋯ menu; 'panels' = a "+ Insert" panel and
     * ⋯ as a panel of tiles in sections.
     */
    menuStyle: 'classic' | 'panels';

    /** Thin / medium / thick widths (page pixels) of the pen, the highlighter and shapes. */
    penSizes: number[];
    highSizes: number[];
    shapeSizes: number[];

    /** Pen and highlighter colours (5 each). */
    penPalette: string[];
    highlighterPalette: string[];

    /** Side of the pages panel. */
    pagesPanelSide: 'right' | 'left';
    /** Thumbnail columns in the pages panel. */
    pagesPanelColumns: 1 | 2 | 3;
    /** Two pages side by side: never, automatically when a pair fits the view width, or always. */
    twoPageMode: 'off' | 'auto' | 'always';
    /** Two-page view with an odd number of pages: the last page sits alone (1-2, 3-4, 5) or the first one (1 | 2-3 | 4-5). */
    twoPageAlone: 'last' | 'first';
    /** Pages other than the current one are slightly dimmed (with 2+ pages). */
    dimInactivePages: boolean;
    /** The pages panel button was added to the toolbar (one-time, 3.15). */
    pagesPanelIntro?: boolean;
    circuitIntro?: boolean;

    /** Default page pattern and paper colour (for notes without their own settings). */
    defaultTemplate: PageTemplate;
    defaultPaper: string;

    /** PDF export resolution (multiplier relative to the on-screen size). */
    pdfScale: 2 | 3 | 4;
    /** Where to save PDFs: 'ask' = ask every time, 'folder' = default folder, 'note' = next to the note. */
    pdfExportMode: 'ask' | 'folder' | 'disk' | 'note';
    pdfExportFolder: string;
    pdfLastFolder: string;
    /** Folder on the computer (outside the vault) – desktop only. */
    pdfExportDiskFolder: string;
    /** Last target used in the export dialog: 'vault' or 'disk'. */
    pdfLastKind: 'vault' | 'disk';
    pdfLastDisk: string;

    /**
     * Pen side button. 'swap': a click switches between the current and the previous tool; 'hold': strokes drawn
     * with the button held use `penHoldTool`; 'radial': a ring of tools, colours and undo around the pen.
     */
    penButtonAction: 'none' | 'snip' | 'menu' | 'undo' | 'redo' | 'swap' | 'hold' | 'radial';
    /** Tool used while the side button is held ('hold'). */
    penHoldTool: 'pen' | 'lasso' | 'eraser' | 'highlighter';
    /** Tap with two fingers = undo, with three = redo. */
    fingerTapUndo: boolean;
    /** Short vibrations of the device (Android only) when snapping, selecting or switching tools. */
    haptics: 'off' | 'light' | 'strong';
    /** Eraser vs highlighter: 'off' = never erased, 'whole' = removes the whole stroke at a touch, 'partial' = cuts pieces out. */
    highlighterErase: 'off' | 'whole' | 'partial';
    /** Menu on a long finger press on the page. */
    longPressMenu: boolean;
    /** Finger hold time (ms) needed to open the menu. */
    longPressMs: number;
    /** Toolbar shortcuts (action ids from quickActions.ts). */
    quickActions: string[];
    /** Toolbar buttons moved to the "More" menu (ids from TOOLBAR_ITEMS). */
    toolbarHidden: string[];
    /** Favourite zoom levels (up to 4) and the zoom notes open at (0 = the last zoom used in the note). */
    zoomPresets: number[];
    openZoom: number;
    /** OLED care: dark paper on screen, fading toolbar while writing, pixel shift, dimming when idle. */
    oledDarkPaper: boolean;
    oledDimToolbar: boolean;
    oledPixelShift: boolean;
    oledIdleDim: boolean;
    /** After how many minutes without input the note view dims. */
    oledIdleMinutes: number;
    /** Diagnostic log in the developer console (position memory, page thumbnails). */
    debugLog: boolean;
    /** Canvas resolution: fewer pixels = smoother writing at high zoom, but less sharp strokes. */
    canvasQuality: 'high' | 'balanced' | 'fast';
    /** The pen stroke being written is drawn on a separate low-latency screen layer (cost independent of zoom). */
    lowLatencyInk: boolean;
    /** Small overlay with frame times and long tasks (diagnostics). */
    perfOverlay: boolean;
    /** Eraser vs shapes (and pieces of partly erased shapes): 'off' = never erased, 'whole' = removes the whole shape, 'partial' = cuts a piece out. */
    shapeErase: 'off' | 'whole' | 'partial';

    /** Where pasted images and PDF pages are stored: the plugin's hidden folder or Obsidian's attachment folder. */
    attachmentLocation: 'hidden' | 'vault';

    /** Version history: automatic note snapshots in the note's hidden folder. */
    historyEnabled: boolean;
    /** How often (at most, in minutes) a snapshot is made while working. */
    historyInterval: number;
    /** After how many days snapshots are deleted. */
    historyKeepDays: number;
    /** Space limit for the history of one note (MB). */
    historyMaxMB: number;

    /** Remembered tool settings (thickness, colours). */
    memory: ToolMemory;

    /** Last view position in each note (to return where you stopped). */
    lastPositions: Record<string, LastPosition>;
}

export interface LastPosition { page: number; off: number; zoom: number; t: number; }

export interface ToolMemory {
    sizes: { pen: number; highlighter: number; eraser: number; shape: number };
    penColor: string;
    highlighterColor: string;
    customPen: string[];
    customHigh: string[];
    shapeColor: string;
    /** Fill colour of new filled shapes ('' = the same as the outline). */
    shapeFillColor: string;
    customShape: string[];
    shapeType: 'line' | 'rect' | 'ellipse' | 'triangle';
    shapeDash: 'solid' | 'dashed' | 'dotted' | 'dashdot';
    /** Shape fill: none, solid colour or a light (semi-transparent) fill. */
    shapeFill: 'none' | 'solid' | 'light';
    /** Outline of rectangles / ellipses / triangles (off = only the fill is drawn). */
    shapeOutline: boolean;
    shapeArrow: boolean;
    /** Triangle tool: right triangle (false = isosceles). */
    shapeTriRight: boolean;
    /** Line tool: right-angle path (KiCad-like wires – every lift of the pen makes a 90° corner). */
    shapeOrtho: boolean;
    /** Highlighter: round ends and corners like a felt-tip marker (false = flat, chisel-like ends). */
    highlighterRound: boolean;
}

export function defaultMemory(): ToolMemory {
    return { sizes: { pen: 1, highlighter: 1, eraser: 1, shape: 1 }, penColor: '', highlighterColor: '', customPen: [], customHigh: [], shapeColor: '', shapeFillColor: '', customShape: [], shapeType: 'rect', shapeDash: 'solid', shapeFill: 'none', shapeOutline: true, shapeArrow: false, shapeTriRight: false, shapeOrtho: false, highlighterRound: false };
}

export const DEFAULT_PEN_SIZES = [0.5, 1, 2];
export const DEFAULT_HIGH_SIZES = [15, 25, 35];
export const DEFAULT_SHAPE_SIZES = [1.5, 3, 5];
/** Allowed range of the thickness values (Settings → Pen and touch → Thickness). */
export const SIZE_LIMITS = { pen: [0.1, 20], high: [2, 80], shape: [0.1, 20] } as const;

/** Three ascending widths within [min, max]; anything else falls back to the defaults. */
export function cleanSizes(v: unknown, def: number[], min: number, max: number): number[] {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(x => typeof x === 'number' && isFinite(x))) return [...def];
    return (v as number[]).map(x => Math.round(Math.max(min, Math.min(max, x)) * 100) / 100).sort((a, b) => a - b);
}

export const DEFAULT_PEN_PALETTE = ['#000000', '#dc2626', '#2563eb', '#16a34a', '#737373'];
export const DEFAULT_HIGHLIGHTER_PALETTE = ['#facc15', '#60a5fa', '#4ade80', '#f472b6', '#fb923c'];

export const DEFAULT_SETTINGS: HandwritingSettings = {
    folderLevels: 1,
    folderStyle: 'abbr',
    separator: '-',
    nameMode: 'folderDate',
    dateSeparator: '-',
    dateParts: 'dmy',
    continueSeries: true,
    selectMode: 'lasso',
    pressureEnabled: true,
    pressureSensitivity: 0.7,
    palmRejection: 'auto',
    palmPenTimeout: 600,
    palmContactSize: 40,
    pinchZoom: true,
    middleMousePan: true,
    panKey: 'Space',
    toolOptionsLayout: 'popup',
    menuStyle: 'classic',
    penPalette: [...DEFAULT_PEN_PALETTE],
    highlighterPalette: [...DEFAULT_HIGHLIGHTER_PALETTE],
    pagesPanelSide: 'right',
    pagesPanelColumns: 2,
    twoPageMode: 'off',
    twoPageAlone: 'last',
    dimInactivePages: true,
    defaultTemplate: 'dots',
    defaultPaper: '#ffffff',
    pdfScale: 3,
    pdfExportMode: 'ask',
    pdfExportFolder: '',
    pdfExportDiskFolder: '',
    pdfLastKind: 'vault',
    pdfLastDisk: '',
    pdfLastFolder: '',
    penButtonAction: Platform.isWin ? 'snip' : 'swap',
    penHoldTool: 'eraser',
    fingerTapUndo: false,
    haptics: 'off',
    highlighterErase: 'whole',
    longPressMenu: true,
    longPressMs: 350,
    penSizes: [...DEFAULT_PEN_SIZES],
    highSizes: [...DEFAULT_HIGH_SIZES],
    shapeSizes: [...DEFAULT_SHAPE_SIZES],
    quickActions: [...DEFAULT_QUICK_ACTIONS],
    toolbarHidden: [],
    debugLog: false,
    zoomPresets: [],
    openZoom: 0,
    oledDarkPaper: false,
    oledDimToolbar: false,
    oledPixelShift: false,
    oledIdleDim: false,
    oledIdleMinutes: 3,
    canvasQuality: 'balanced',
    lowLatencyInk: true,
    perfOverlay: false,
    shapeErase: 'partial',
    attachmentLocation: 'hidden',
    historyEnabled: true,
    historyInterval: 10,
    historyKeepDays: 30,
    historyMaxMB: 50,
    memory: defaultMemory(),
    lastPositions: {},
};
