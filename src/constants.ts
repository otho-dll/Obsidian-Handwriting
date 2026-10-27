

export const VIEW_TYPE_HANDWRITING = "handwriting-view";

// --- CONSTANTS ---
// Page sizes: see pageFormat.ts (A4 = 800 × 1131 logical units; pages may have their own size).
export const MAX_CANVAS_SCALE = 8;         // max. internal canvas resolution relative to logical coordinates
export const CANVAS_PIXEL_BUDGET = { high: 24e6, balanced: 8e6, fast: 3.5e6 };
export const PDF_TARGET_WIDTH = 2800;      // width (px) of rendered pages of an imported PDF
export const PDF_MAX_HEIGHT = 4200;        // max. height (px) of a rendered PDF page
export const IMAGE_MAX_SIDE = 3200;        // larger images are scaled down on paste / import
export const SIMPLIFY_EPSILON = 0.15;      // stroke simplification tolerance (Ramer-Douglas-Peucker)
export const INERTIA_TAU_MS = 325;         // time constant of scroll inertia decay
export const ROTATE_STEP = Math.PI / 12;   // rotation step with Shift (15°)
/** File name of the plugin logo. Put it in the plugin folder (next to manifest.json); change this name if the file is named differently. */
export const LOGO_FILE = 'logo.png';
