// Light / dark mode. Follows the system setting; the toggle button picks the other mode and remembers it in
// localStorage. Choosing the mode the system uses anyway removes the choice again, so the page follows the
// system from then on. Loaded in <head> (not deferred) so the page never flashes in the wrong colours.
(function () {
    var KEY = 'hw-theme';
    var root = document.documentElement;
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    var system = function () { return mq && mq.matches ? 'dark' : 'light'; };
    var memo;   // used when localStorage is blocked (the choice then lasts until the page is reloaded)
    var stored = function () {
        if (memo !== undefined) return memo;
        try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null; } catch (e) { return null; }
    };
    var current = function () { return stored() || system(); };

    function apply() {
        var t = current();
        root.setAttribute('data-theme', t);
        root.style.colorScheme = t;
        var btns = document.querySelectorAll('[data-theme-toggle]');
        for (var i = 0; i < btns.length; i++) {
            var b = btns[i];
            var label = t === 'dark' ? b.getAttribute('data-label-light') : b.getAttribute('data-label-dark');
            if (label) { b.setAttribute('aria-label', label); b.setAttribute('title', label); }
            b.setAttribute('aria-pressed', String(t === 'dark'));
        }
        try { window.dispatchEvent(new CustomEvent('hw-theme-change', { detail: t })); } catch (e) { /* old browser */ }
    }

    function toggle() {
        var next = current() === 'dark' ? 'light' : 'dark';
        var choice = next === system() ? null : next;
        try { if (choice) localStorage.setItem(KEY, choice); else localStorage.removeItem(KEY); }
        catch (e) { memo = choice; }
        apply();
    }

    apply();
    if (mq) {
        var onChange = function () { if (!stored()) apply(); };
        if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
    }
    document.addEventListener('click', function (e) {
        var t = e.target && e.target.closest ? e.target.closest('[data-theme-toggle]') : null;
        if (t) { e.preventDefault(); toggle(); }
    });
    document.addEventListener('DOMContentLoaded', apply);
})();
