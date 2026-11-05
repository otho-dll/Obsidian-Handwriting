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

    /** Pen and highlighter colours (5 each). */
    penPalette: string[];
    highlighterPalette: string[];

    /** Page rail (thin strip along the edge for jumping through the note): always, while scrolling, off. Key kept from the old minimap. */
    minimap: 'off' | 'always' | 'auto';
    /** Side of the page rail. */
    minimapSide: 'right' | 'left';
    /** Page rail: 'fine' = moving away from the edge slows it down and snaps to sections, 'simple' = direct. */
    railPrecision: 'fine' | 'simple';
    /** Side of the pages panel. */
    pagesPanelSide: 'right' | 'left';
    /** Thumbnail columns in the pages panel. */
    pagesPanelColumns: 1 | 2 | 3;
    /** The pages panel button was added to the toolbar (one-time, 3.15). */
    pagesPanelIntro?: boolean;

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

    /** Pen side button. */
    penButtonAction: 'none' | 'snip' | 'menu' | 'undo' | 'redo';
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
    /** Diagnostic log in the developer console (position memory, page rail). */
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
    /** Pen opacity (1 = opaque). */
    penAlpha: number;
    highlighterColor: string;
    customPen: string[];
    customHigh: string[];
    shapeColor: string;
    customShape: string[];
    shapeType: 'line' | 'rect' | 'ellipse';
    shapeDash: 'solid' | 'dashed' | 'dotted' | 'dashdot';
    /** Shape fill: none, solid colour or a light (semi-transparent) fill. */
    shapeFill: 'none' | 'solid' | 'light';
    /** Outline of rectangles / ellipses (off = only the fill is drawn). */
    shapeOutline: boolean;
    shapeArrow: boolean;
}

export function defaultMemory(): ToolMemory {
    return { sizes: { pen: 1, highlighter: 1, eraser: 1, shape: 1 }, penColor: '', penAlpha: 1, highlighterColor: '', customPen: [], customHigh: [], shapeColor: '', customShape: [], shapeType: 'rect', shapeDash: 'solid', shapeFill: 'none', shapeOutline: true, shapeArrow: false };
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
    selectMode: 'lasso',
    pressureEnabled: true,
    pressureSensitivity: 0.7,
    palmRejection: 'auto',
    palmPenTimeout: 600,
    palmContactSize: 40,
    pinchZoom: true,
    penPalette: [...DEFAULT_PEN_PALETTE],
    highlighterPalette: [...DEFAULT_HIGHLIGHTER_PALETTE],
    minimap: 'always',
    minimapSide: 'right',
    railPrecision: 'fine',
    pagesPanelSide: 'right',
    pagesPanelColumns: 2,
    defaultTemplate: 'dots',
    defaultPaper: '#ffffff',
    pdfScale: 3,
    pdfExportMode: 'ask',
    pdfExportFolder: '',
    pdfExportDiskFolder: '',
    pdfLastKind: 'vault',
    pdfLastDisk: '',
    pdfLastFolder: '',
    penButtonAction: Platform.isWin ? 'snip' : 'menu',
    highlighterErase: 'whole',
    longPressMenu: true,
    longPressMs: 350,
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
