import { defineMixin } from './mixin';

/**
 * Performance overlay (Settings → Advanced): a small box in the corner of the note with frame times, long tasks
 * (main thread blocked > 50 ms), zoom, page canvas pixels and the stroke count of the current page.
 * Diagnostics only – it shows which part of a frame is expensive when writing / scrolling lags.
 */
export const perfOverlayMixin = defineMixin({
    applyPerfOverlay() {
        if (this.plugin.settings.perfOverlay) this.startPerfOverlay();
        else this.stopPerfOverlay();
    },

    startPerfOverlay() {
        if (this.perf || !this.scrollArea) return;
        const el = this.scrollArea.createDiv({ cls: 'hw-perf' });
        const frames: number[] = [];          // frame timestamps (last 2 s)
        const longTasks: { t: number; d: number }[] = [];
        let last = 0, worst = 0;
        let observer: PerformanceObserver | null = null;
        try {
            observer = new PerformanceObserver((list) => {
                for (const e of list.getEntries()) longTasks.push({ t: e.startTime, d: e.duration });
            });
            observer.observe({ entryTypes: ['longtask'] });
        } catch { observer = null; /* not supported */ }
        const state = { el, raf: 0, timer: 0, observer };
        const tick = (now: number) => {
            if (last) worst = Math.max(worst, now - last);
            last = now;
            frames.push(now);
            while (frames.length && now - frames[0] > 2000) frames.shift();
            state.raf = window.requestAnimationFrame(tick);
        };
        state.raf = window.requestAnimationFrame(tick);
        state.timer = window.setInterval(() => {
            const now = performance.now();
            while (longTasks.length && now - longTasks[0].t > 5000) longTasks.shift();
            let slow = 0;
            for (let i = 1; i < frames.length; i++) if (frames[i] - frames[i - 1] > 25) slow++;
            const fps = frames.length > 1 ? (frames.length - 1) / ((frames[frames.length - 1] - frames[0]) / 1000) : 0;
            let px = 0;
            this.pageViews.forEach((v, i) => {
                const c = this.pageContexts[i];
                if (!v.active || !c) return;
                for (const ctx of [c.bottomCtx, c.topCtx, c.highCtx]) px += ctx.canvas.width * ctx.canvas.height;
            });
            const cur = Math.max(0, this.railCurrent);
            const strokes = this.noteData.pages[cur]?.strokes.length ?? 0;
            const lt = longTasks.length ? Math.round(Math.max(...longTasks.map(x => x.d))) : 0;
            el.setText(
                `${fps.toFixed(0)} fps · worst ${worst.toFixed(0)} ms · slow ${slow}/2s\n` +
                `long tasks ${longTasks.length}/5s (max ${lt} ms)\n` +
                `zoom ${Math.round(this.currentZoom * 100)}% · canvas ${(px / 1e6).toFixed(1)} Mpx\n` +
                `page ${cur + 1}: ${strokes} strokes · ink ${this.inkCanvas ? 'low-latency' : 'page canvas'}`
            );
            worst = 0;
        }, 500);
        this.perf = state;
    },

    stopPerfOverlay() {
        const p = this.perf;
        if (!p) return;
        window.cancelAnimationFrame(p.raf);
        window.clearInterval(p.timer);
        p.observer?.disconnect();
        p.el.remove();
        this.perf = null;
    },
});
export type PerfOverlayMethods = typeof perfOverlayMixin;
