import { defineMixin } from './mixin';
import { ICON_ERASER, ICON_HIGHLIGHTER, ICON_LASSO_LOOP, ICON_PEN, ICON_SHAPES, ICON_UNDO } from '../icons';
import { setSvg } from '../svg';
import { buzz } from '../haptics';

/** Ring radii (px): the tools on the outer ring, the colours on the inner one. */
const R_OUT = 66, R_IN = 30, SIZE = 2 * R_OUT + 52;
/** Sliding the pen further than this from the centre picks the field it points at when the pen is lifted. */
const PICK_PX = 18;

interface RadialItem { label: string; icon?: string; color?: string; active: boolean; run: () => void; el?: HTMLElement; a: number; ring: 'out' | 'in' }

/**
 * Radial menu (pen side button = 'radial'): a ring of tools, recent pen colours and undo around the pen tip.
 * Tap a field, or – when it was opened with the pen on the page – slide towards it and lift the pen.
 */
export const radialMenuMixin = defineMixin({
    /** Remembers a pen colour for the radial menu (newest first, without repeats). */
    noteRecentPenColor(c: string) {
        const col = c.toLowerCase();
        this.recentPenColors = [col, ...this.recentPenColors.filter(x => x !== col)].slice(0, 6);
    },

    /** Three colours for the inner ring: recently picked ones, then the pen palette. */
    radialColors(): string[] {
        const out: string[] = [];
        for (const c of [...this.recentPenColors, this.penColor.toLowerCase(), ...this.plugin.settings.penPalette.map(x => x.toLowerCase())]) {
            if (!out.includes(c)) out.push(c);
            if (out.length === 3) break;
        }
        return out;
    },

    closeRadialMenu() {
        const c = this.radialClose;
        this.radialClose = null;
        c?.();
    },

    showRadialMenu(clientX: number, clientY: number, penDown: boolean) {
        if (this.radialEl) return;
        const tool = (t: 'pen' | 'highlighter' | 'eraser' | 'lasso' | 'shape') => () => this.setTool?.(t);
        const cur = this.currentTool;
        const outer: Omit<RadialItem, 'a' | 'ring'>[] = [
            { label: 'Pen', icon: ICON_PEN, active: cur === 'pen', run: tool('pen') },
            { label: 'Highlighter', icon: ICON_HIGHLIGHTER, active: cur === 'highlighter', run: tool('highlighter') },
            { label: 'Eraser', icon: ICON_ERASER, active: cur === 'eraser', run: tool('eraser') },
            { label: 'Selection', icon: ICON_LASSO_LOOP, active: cur === 'lasso', run: tool('lasso') },
            { label: 'Shapes', icon: ICON_SHAPES, active: cur === 'shape', run: tool('shape') },
            { label: 'Undo', icon: ICON_UNDO, active: false, run: () => this.undo() },
        ];
        const pen = this.penColor.toLowerCase();
        const inner = this.radialColors().map(c => ({
            label: `Pen colour ${c}`, color: c, active: cur === 'pen' && c === pen,
            run: () => { this.penColor = c; this.noteRecentPenColor(c); this.persistMemory(); this.setTool?.('pen'); },
        }));
        // Angles: the first field straight up, clockwise.
        const items: RadialItem[] = [
            ...outer.map((it, i) => ({ ...it, ring: 'out' as const, a: -Math.PI / 2 + i * 2 * Math.PI / outer.length })),
            ...inner.map((it, i) => ({ ...it, ring: 'in' as const, a: -Math.PI / 2 + i * 2 * Math.PI / inner.length })),
        ];

        const backdrop = activeDocument.body.createDiv({ cls: 'hw-radial-backdrop' });
        this.radialEl = backdrop;
        const cx = Math.max(SIZE / 2 + 4, Math.min(window.innerWidth - SIZE / 2 - 4, clientX));
        const cy = Math.max(SIZE / 2 + 4, Math.min(window.innerHeight - SIZE / 2 - 4, clientY));
        const ring = backdrop.createDiv({ cls: 'hw-radial' });
        ring.style.left = `${cx - SIZE / 2}px`;
        ring.style.top = `${cy - SIZE / 2}px`;
        ring.style.width = ring.style.height = `${SIZE}px`;

        let done = false;
        const cleanup = () => {
            window.removeEventListener('pointermove', onMove, true);
            window.removeEventListener('pointerup', onUp, true);
            window.removeEventListener('keydown', onKey, true);
        };
        const close = () => {
            if (done) return;
            done = true;
            cleanup();
            backdrop.remove();
            if (this.radialEl === backdrop) { this.radialEl = null; this.radialClose = null; }
        };
        this.radialClose = close;
        const pick = (it: RadialItem) => { close(); it.run(); buzz('confirm'); };

        for (const it of items) {
            const r = it.ring === 'out' ? R_OUT : R_IN;
            const b = ring.createEl('button', { cls: `hw-radial-item hw-radial-${it.ring}`, attr: { 'aria-label': it.label, title: it.label } });
            b.style.left = `${SIZE / 2 + Math.cos(it.a) * r}px`;
            b.style.top = `${SIZE / 2 + Math.sin(it.a) * r}px`;
            if (it.icon) setSvg(b, this.iconSvg(it.icon));
            if (it.color) b.style.setProperty('--hw-radial-color', it.color);
            b.toggleClass('is-active', it.active);
            b.addEventListener('pointerdown', e => e.stopPropagation());
            b.onclick = (e) => { e.stopPropagation(); pick(it); };
            it.el = b;
        }
        ring.addEventListener('pointerdown', e => e.stopPropagation());
        backdrop.addEventListener('pointerdown', () => close());
        backdrop.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });

        /** The field the pen points at from the centre (null in the middle). */
        const aimed = (x: number, y: number): RadialItem | null => {
            const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
            if (d < PICK_PX) return null;
            const list = items.filter(it => it.ring === (d < (R_IN + R_OUT) / 2 ? 'in' : 'out'));
            const ang = Math.atan2(dy, dx);
            let best: RadialItem | null = null, bd = Infinity;
            for (const it of list) {
                const diff = Math.abs(Math.atan2(Math.sin(ang - it.a), Math.cos(ang - it.a)));
                if (diff < bd) { bd = diff; best = it; }
            }
            return best;
        };
        let hot: RadialItem | null = null;
        let moved = false;
        const onMove = (e: PointerEvent) => {
            if (!penDown || e.pointerType !== 'pen' || e.buttons === 0) return;
            if (Math.hypot(e.clientX - cx, e.clientY - cy) > PICK_PX) moved = true;
            const h = aimed(e.clientX, e.clientY);
            if (h === hot) return;
            hot?.el?.removeClass('is-hot');
            hot = h;
            hot?.el?.addClass('is-hot');
            if (hot) buzz('tick');
        };
        const onUp = (e: PointerEvent) => {
            if (!penDown || e.pointerType !== 'pen') return;
            penDown = false;   // later taps work like with a finger
            if (moved && hot) { e.preventDefault(); e.stopPropagation(); pick(hot); }
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', onUp, true);
        window.addEventListener('keydown', onKey, true);
    },
});
export type RadialMenuMethods = typeof radialMenuMixin;
