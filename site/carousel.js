// Screenshot carousel at the top of the landing page.
// Cycles every N seconds (data-interval), pauses while hovered / focused / the tab is hidden, and does not
// auto-advance when the system asks for reduced motion. Arrows, dots, swipe and the ← → keys change the slide.
for (const root of document.querySelectorAll('[data-carousel]')) {
    const slides = [...root.querySelectorAll('.carousel-slide')];
    const dots = [...root.querySelectorAll('[data-carousel-dot]')];
    if (slides.length < 2) continue;
    const seconds = Math.max(2, Number(root.dataset.interval) || 5);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let index = 0, timer = 0, paused = false;

    const show = (i) => {
        index = (i + slides.length) % slides.length;
        slides.forEach((s, k) => {
            const on = k === index;
            s.classList.toggle('is-active', on);
            if (on) s.removeAttribute('aria-hidden'); else s.setAttribute('aria-hidden', 'true');
        });
        dots.forEach((d, k) => d.setAttribute('aria-selected', String(k === index)));
        // Load the next image early, so the change is never blank.
        const next = slides[(index + 1) % slides.length].querySelector('img');
        if (next && next.loading === 'lazy') next.loading = 'eager';
    };
    const stop = () => { window.clearTimeout(timer); timer = 0; };
    const schedule = () => {
        stop();
        if (reduced || paused || document.hidden) return;
        timer = window.setTimeout(() => { show(index + 1); schedule(); }, seconds * 1000);
    };
    const go = (i) => { show(i); schedule(); };

    root.querySelector('[data-carousel-prev]')?.addEventListener('click', () => go(index - 1));
    root.querySelector('[data-carousel-next]')?.addEventListener('click', () => go(index + 1));
    dots.forEach((d, k) => d.addEventListener('click', () => go(k)));
    root.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
    });

    // Pause while the visitor looks at a screenshot or uses the controls.
    const setPaused = (p) => { paused = p; schedule(); };
    root.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') setPaused(true); });
    root.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') setPaused(false); });
    root.addEventListener('focusin', () => setPaused(true));
    root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) setPaused(false); });
    document.addEventListener('visibilitychange', schedule);

    // Swipe on touch screens.
    let startX = null, startY = 0;
    const frame = root.querySelector('.carousel-frame') ?? root;
    frame.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { startX = e.clientX; startY = e.clientY; } });
    frame.addEventListener('pointerup', (e) => {
        if (startX === null) return;
        const dx = e.clientX - startX, dy = e.clientY - startY;
        startX = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
    });
    frame.addEventListener('pointercancel', () => { startX = null; });

    show(0);
    schedule();
}
