import { ICON_SOLID, ICON_CIRCUIT, ICON_CALC, ICON_FIT, ICON_IMAGE, ICON_PLOT, ICON_PAGES, ICON_PDF_IN, ICON_PDF_OUT, ICON_PRINT, ICON_PAGE_STYLE, ICON_SNIP, ICON_HISTORY, ICON_CONTENTS, ICON_ZOOM_PEN } from './icons';

/**
 * Every action of the toolbar shortcuts and the menus (one list for all three menu styles).
 * `label`: in Settings → Toolbar shortcuts; `title`: in the menus; `icon`: SVG paths (24-unit box);
 * `menuIcon`: Lucide icon for Obsidian menus; `windowsOnly`: hidden elsewhere in the menus.
 */
export interface QuickAction { id: string; label: string; title: string; icon: string; menuIcon: string; windowsOnly?: boolean }

export const QUICK_ACTIONS: QuickAction[] = [
    { id: 'calculator', label: 'Calculator', title: 'Calculator', icon: ICON_CALC, menuIcon: 'calculator' },
    { id: 'fit', label: 'Fit to width (also in the zoom panel)', title: 'Fit to width', icon: ICON_FIT, menuIcon: 'maximize' },
    { id: 'zoom', label: 'Zoom (shows the current zoom; fit, 100%, favourites)', title: 'Zoom…', icon: ICON_ZOOM_PEN, menuIcon: 'zoom-in' },
    { id: 'contents', label: 'Contents (page titles, in the pages panel)', title: 'Contents…', icon: ICON_CONTENTS, menuIcon: 'list' },
    { id: 'plot', label: 'Function plot', title: 'Function plot…', icon: ICON_PLOT, menuIcon: 'line-chart' },
    { id: 'circuit', label: 'Circuit diagram', title: 'Circuit diagram…', icon: ICON_CIRCUIT, menuIcon: 'zap' },
    { id: 'solid', label: '3D solid (cube, cylinder, cone, sphere…)', title: '3D solid…', icon: ICON_SOLID, menuIcon: 'box' },
    { id: 'image', label: 'Insert image', title: 'Insert image…', icon: ICON_IMAGE, menuIcon: 'image-plus' },
    { id: 'pagestyle', label: 'Page style (size, pattern, paper)', title: 'Page style…', icon: ICON_PAGE_STYLE, menuIcon: 'paintbrush' },
    { id: 'pages', label: 'Pages panel (thumbnails, add / move / delete pages, page style)', title: 'Pages panel', icon: ICON_PAGES, menuIcon: 'hw-pages' },
    { id: 'screenshot', label: 'Screenshot (Snipping Tool, Windows)', title: 'Screenshot (Snipping Tool)', icon: ICON_SNIP, menuIcon: 'scissors', windowsOnly: true },
    { id: 'importpdf', label: 'Import PDF', title: 'Import PDF…', icon: ICON_PDF_IN, menuIcon: 'file-input' },
    { id: 'exportpdf', label: 'Export to PDF', title: 'Export to PDF', icon: ICON_PDF_OUT, menuIcon: 'file-output' },
    { id: 'print', label: 'Print', title: 'Print…', icon: ICON_PRINT, menuIcon: 'printer' },
    { id: 'history', label: 'Version history', title: 'Version history…', icon: ICON_HISTORY, menuIcon: 'history' },
];
export const DEFAULT_QUICK_ACTIONS = ['calculator', 'zoom', 'contents', 'pages', 'circuit'];

export const quickAction = (id: string) => QUICK_ACTIONS.find(a => a.id === id);

/** Which actions each menu shows, and in what order. */
export const MENU_LAYOUT = {
    /** The classic ⋯ menu: three groups divided by lines (only what is not on the toolbar). */
    classic: [
        ['image', 'screenshot', 'plot', 'circuit', 'solid', 'calculator'],
        ['zoom', 'contents', 'pages', 'pagestyle'],
        ['importpdf', 'exportpdf', 'print', 'history'],
    ],
    /** "+ Insert" panel / Insert tab: everything that puts something into the note. */
    insert: ['image', 'screenshot', 'plot', 'circuit', 'solid', 'importpdf', 'calculator'],
    view: ['zoom', 'fit', 'contents', 'pages', 'pagestyle'],
    file: ['exportpdf', 'print', 'history'],
};

/** Fixed toolbar buttons that can be moved to the "More" menu (Settings → Toolbar). The pen always stays. */
export const TOOLBAR_ITEMS: { id: string; label: string }[] = [
    { id: 'eraser', label: 'Eraser' },
    { id: 'hand', label: 'Hand (move the page)' },
    { id: 'highlighter', label: 'Highlighter' },
    { id: 'lasso', label: 'Selection (lasso / rectangle)' },
    { id: 'shapes', label: 'Shapes' },
    { id: 'undo', label: 'Undo and redo' },
];
