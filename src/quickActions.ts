import { ICON_CALC, ICON_FIT, ICON_IMAGE, ICON_PLOT, ICON_PAGES, ICON_PDF_IN, ICON_PDF_OUT, ICON_SNIP, ICON_HISTORY, ICON_CONTENTS } from './icons';

/** Actions that can be pinned as shortcuts on the toolbar (Settings → Toolbar shortcuts). */
export const QUICK_ACTIONS: { id: string; label: string; icon: string }[] = [
    { id: 'calculator', label: 'Calculator', icon: ICON_CALC },
    { id: 'fit', label: 'Fit to width (also in the zoom panel)', icon: ICON_FIT },
    { id: 'zoom', label: 'Zoom (shows the current zoom; fit, 100%, favourites)', icon: '' },
    { id: 'contents', label: 'Contents (page titles)', icon: ICON_CONTENTS },
    { id: 'plot', label: 'Function plot', icon: ICON_PLOT },
    { id: 'image', label: 'Insert image', icon: ICON_IMAGE },
    { id: 'pages', label: 'Pages and style', icon: ICON_PAGES },
    { id: 'screenshot', label: 'Screenshot (Snipping Tool, Windows)', icon: ICON_SNIP },
    { id: 'importpdf', label: 'Import PDF', icon: ICON_PDF_IN },
    { id: 'exportpdf', label: 'Export to PDF', icon: ICON_PDF_OUT },
    { id: 'history', label: 'Version history', icon: ICON_HISTORY },
];
export const DEFAULT_QUICK_ACTIONS = ['calculator', 'zoom', 'contents'];

/** Fixed toolbar buttons that can be moved to the "More" menu (Settings → Toolbar). The pen always stays. */
export const TOOLBAR_ITEMS: { id: string; label: string }[] = [
    { id: 'eraser', label: 'Eraser' },
    { id: 'highlighter', label: 'Highlighter' },
    { id: 'lasso', label: 'Selection (lasso / rectangle)' },
    { id: 'shapes', label: 'Shapes' },
    { id: 'undo', label: 'Undo and redo' },
];
