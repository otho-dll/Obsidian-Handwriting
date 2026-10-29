import type { PlotSpec } from './math/plot';
import { PageTemplate } from './templates';
import type { PageFormat } from './pageFormat';

export interface Point { x: number; y: number; pressure: number; }
export interface Stroke {
    points: Point[];
    color: string;
    width: number;
    isHighlighter: boolean;
    isEraser?: boolean;   // old notes only – converted to cut strokes on load
    // Shapes: points = [start, end]
    shape?: 'line' | 'rect' | 'ellipse';
    dash?: 'solid' | 'dashed' | 'dotted' | 'dashdot';
    fill?: boolean;
    arrow?: boolean;
    poly?: boolean;       // freehand stroke drawn as a polyline (pieces of cut shapes)
    rot?: number;         // rotation of a rectangle / ellipse around its centre (radians)
    g?: string;           // group: items with the same g are selected and moved together (format v3)
    lock?: boolean;       // locked: cannot be selected, moved or erased (format v3)
    alpha?: number;       // pen opacity 0.1–1 (missing = 1, fully opaque)
}
export interface ImageItem {
    id: string;
    path?: string;   // file path in the vault (preferred)
    data?: string;   // data URL – only when the file could not be saved
    x: number; y: number; w: number; h: number;
    rot?: number;    // rotation around the centre (radians)
    plot?: PlotSpec; // function plot – allows editing it later
    g?: string;      // group (format v3)
    lock?: boolean;  // locked (format v3)
}
export interface PageData {
    strokes: Stroke[];
    images?: ImageItem[];
    bgPath?: string;    // page background (imported PDF) as a file in the vault
    bgImage?: string;   // old format: base64
    tpl?: PageTemplate; // pattern of this page (when different from the note default)
    paper?: string;     // paper colour of this page (#rrggbb)
    w?: number;         // page width (logical units; missing = A4 portrait, 800) – format v4
    h?: number;         // page height (missing = 1131)
    endless?: boolean;  // endless page: grows down by itself when you write near its bottom edge
    title?: string;     // page title – entry in the table of contents (bookmark)
}
export interface NoteData {
    pages: PageData[];
    defaults?: { tpl?: PageTemplate; paper?: string; format?: PageFormat };
    /** Permanent note id (format v3) – the version history is tied to it, so it survives renaming. */
    id?: string;
}
export interface Bounds { x: number; y: number; w: number; h: number; }
export interface BBox { x0: number; y0: number; x1: number; y1: number; }

export interface PageView {
    outer: HTMLElement;                  // .hw-single-page-container
    container: HTMLElement;              // .hw-page-a4
    bgEl: HTMLImageElement | null;
    imgLayer: HTMLElement;
    imgEls: Map<string, HTMLImageElement>;
    active: boolean;                     // whether the canvases are "live" (page near the view)
    scale: number;                       // current canvas resolution (pixels per logical unit)
    win: Bounds;                         // part of the page (logical coordinates) covered by the canvases
    highAllocated: boolean;              // whether the highlighter layer has its full size
    crisp: number;                       // requested resolution before the pixel budget limit
    fixed: { w: number; h: number } | null;   // fixed canvas window size (lets it move without redrawing)
}

export type HistoryEntry =
    | { type: 'add'; page: number; stroke: Stroke }
    | { type: 'move'; page: number; strokes: Stroke[]; images: ImageItem[]; dx: number; dy: number }
    | { type: 'scale'; page: number; strokes: Stroke[]; images: ImageItem[]; ax: number; ay: number; k: number }
    | { type: 'rotate'; page: number; strokes: Stroke[]; images: ImageItem[]; cx: number; cy: number; angle: number }
    | { type: 'delete'; page: number; items: { stroke: Stroke; index: number }[]; imgItems: { image: ImageItem; index: number }[] }
    | { type: 'replace'; page: number; before: Stroke[]; after: Stroke[] }
    | { type: 'addImage'; page: number; image: ImageItem; index: number }
    | { type: 'transfer'; page: number; to: number; strokes: Stroke[]; images: ImageItem[]; dy: number }
    | { type: 'paste'; page: number; strokes: Stroke[]; images: ImageItem[] }
    | { type: 'cropImage'; page: number; image: ImageItem; before: ImageSnap; after: ImageSnap }
    | { type: 'attrs'; page: number; changes: AttrChange[] }
    | { type: 'order'; page: number; before: ItemLists; after: ItemLists }
    | { type: 'multiMove'; page: number; moves: { strokes: Stroke[]; images: ImageItem[]; dx: number; dy: number }[] };

/** Change of item attributes (colour, width, group, lock) – state before and after. */
export interface AttrChange { item: Stroke | ImageItem; before: Record<string, unknown>; after: Record<string, unknown>; }
/** Order of page items (for undoing "bring to front / send to back"). */
export interface ItemLists { strokes: Stroke[]; images: ImageItem[]; }

/** Image state before/after cropping (for undo). */
export interface ImageSnap { path?: string; data?: string; x: number; y: number; w: number; h: number; plot?: PlotSpec; }

export interface Selection { page: number; strokes: Stroke[]; images: ImageItem[]; }
