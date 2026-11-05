// setIcon / addIcon with only the Lucide icons the plugin uses (named imports → the rest is tree-shaken away).
import {
    AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
    ArrowDown, ArrowDownFromLine, ArrowRight, ArrowUp, ArrowUpFromLine, BringToFront, Calculator, ChartLine, Check,
    ChevronDown, ChevronLeft, ChevronRight, ClipboardPaste, Columns3, Copy, CopyPlus, Crop, Eraser, FileInput, FileOutput,
    FolderOpen, Group, Hand, Heading, Highlighter, History, ImagePlus, Lasso, List, Lock, LockOpen, Map as MapIcon,
    Maximize, Minimize, MoveVertical, Paintbrush, PenTool, Pencil, Plus, Printer, Redo2, RotateCcw, RotateCw, Ruler, Save,
    Scissors, Search, SendToBack, Settings, Shapes, SlidersHorizontal, Trash, Trash2, Undo2, Ungroup, X, ZoomIn,
    Download, Info, type IconNode as LucideIconNode,
} from 'lucide';

type IconNode = LucideIconNode;

const LUCIDE: Record<string, IconNode> = {
    'align-center-horizontal': AlignCenterHorizontal, 'align-center-vertical': AlignCenterVertical,
    'align-end-horizontal': AlignEndHorizontal, 'align-end-vertical': AlignEndVertical,
    'align-start-horizontal': AlignStartHorizontal, 'align-start-vertical': AlignStartVertical,
    'arrow-down': ArrowDown, 'arrow-down-from-line': ArrowDownFromLine, 'arrow-right': ArrowRight, 'arrow-up': ArrowUp,
    'arrow-up-from-line': ArrowUpFromLine, 'bring-to-front': BringToFront, 'calculator': Calculator, 'chart-line': ChartLine,
    'check': Check, 'chevron-down': ChevronDown, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight,
    'clipboard-paste': ClipboardPaste, 'columns-3': Columns3, 'copy': Copy, 'copy-plus': CopyPlus, 'crop': Crop,
    'eraser': Eraser, 'file-input': FileInput, 'file-output': FileOutput, 'folder-open': FolderOpen, 'group': Group,
    'hand': Hand, 'heading': Heading, 'highlighter': Highlighter, 'history': History, 'image-plus': ImagePlus,
    'lasso': Lasso, 'list': List, 'lock': Lock, 'lock-open': LockOpen, 'map': MapIcon, 'maximize': Maximize,
    'minimize': Minimize, 'move-vertical': MoveVertical, 'paintbrush': Paintbrush, 'pen-tool': PenTool, 'pencil': Pencil,
    'plus': Plus, 'printer': Printer, 'redo-2': Redo2, 'rotate-ccw': RotateCcw, 'rotate-cw': RotateCw, 'ruler': Ruler,
    'save': Save, 'scissors': Scissors, 'search': Search, 'send-to-back': SendToBack, 'settings': Settings,
    'shapes': Shapes, 'sliders-horizontal': SlidersHorizontal, 'trash': Trash, 'trash-2': Trash2, 'undo-2': Undo2,
    'ungroup': Ungroup, 'x': X, 'zoom-in': ZoomIn, 'download': Download, 'info': Info,
};

/** Obsidian names (or old Lucide names) → the Lucide icon used here. */
const ALIASES: Record<string, string> = {
    'reset': 'rotate-ccw',
    'line-chart': 'chart-line',
    'unlock': 'lock-open',
    'cross': 'x',
    'lucide-x': 'x',
    'checkmark': 'check',
    'gear': 'settings',
};

/** Icons added with addIcon (SVG content in a 0 0 100 100 box, like Obsidian). */
const custom = new Map<string, string>();

const SVG_NS = 'http://www.w3.org/2000/svg';

export function addIcon(id: string, svgContent: string) { custom.set(id, svgContent); }

export function getIconIds(): string[] { return [...Object.keys(LUCIDE), ...Object.keys(ALIASES), ...custom.keys()]; }

export function getIcon(id: string): SVGSVGElement | null {
    const key = ALIASES[id] ?? id;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('xmlns', SVG_NS);
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.classList.add('svg-icon', `lucide-${key}`);
    const c = custom.get(id);
    if (c !== undefined) {
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.innerHTML = c;
        return svg;
    }
    const node = LUCIDE[key];
    if (!node) return null;
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    for (const [tag, attrs] of node) {
        const child = document.createElementNS(SVG_NS, tag);
        for (const [k, v] of Object.entries(attrs)) if (v !== undefined) child.setAttribute(k, String(v));
        svg.appendChild(child);
    }
    return svg;
}

const warned = new Set<string>();

export function setIcon(parent: HTMLElement, id: string) {
    parent.empty();
    const svg = getIcon(id);
    if (svg) { parent.appendChild(svg); return; }
    if (!warned.has(id)) { warned.add(id); console.warn(`[demo shim] unknown icon: ${id}`); }
}
