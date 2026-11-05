// Page structure of the website. The texts come from site/content.mjs – edit that file to change the content.
// Used by scripts/build-site.mjs.

/** Escapes text for HTML attributes. */
const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Icons (24 × 24, stroke) used by content.mjs. */
export const ICONS = {
    pen: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    shapes: '<rect x="3" y="3" width="9" height="9" rx="1"/><circle cx="16.5" cy="16.5" r="4.5"/><path d="M14 4l6 6"/>',
    lasso: '<path d="M7 22a5 5 0 0 1-2-4"/><path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1"/><circle cx="5" cy="16" r="2"/>',
    pages: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="9" rx="1"/><rect x="3" y="15" width="7" height="6" rx="1"/><path d="M14 18h7"/>',
    pagestyle: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8.5 7h7M8.5 11h7M8.5 15h4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    plot: '<path d="M3 3v18h18"/><path d="M7 15c2-8 4-8 6-3s4 3 5-5"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    phone: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    github: '<path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"/>',
    demo: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>',
    bug: '<path d="m8 2 1.9 1.9"/><path d="M14.1 3.9 16 2"/><path d="M9 7.1V6a3 3 0 1 1 6 0v1.1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.5 13H3"/><path d="M21 13h-3.5"/>',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 17v-6"/><path d="m9.5 13.5 2.5-2.5 2.5 2.5"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    settings: '<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/>',
    fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    sparkles: '<path d="M12 3l1.8 4.6L18.5 9.4l-4.7 1.8L12 16l-1.8-4.8-4.7-1.8 4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/><path d="M5 15l.6 1.4L7 17l-1.4.6L5 19l-.6-1.4L3 17l1.4-.6z"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    shield: '<path d="M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
};
const icon = (name, cls = '') => ICONS[name] ? `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>` : '';

/**
 * The logo: a handwritten (cursive) "H" in three strokes – top wave and left stem, the diagonal from the bottom loop,
 * the right stem with its exit stroke – on a rounded green square. The same path is in src/settingTab.ts (settings)
 * and docs/banner.svg (README). Also used as favicon.svg.
 */
export const LOGO_H_PATH = 'M12.4 14.8C14.4 11.2 18.2 10.3 20.7 12.2C22.7 13.8 24.6 13.7 26.1 12.4C26.5 22.5 26 33 24.4 43.5C23.8 48.2 21.7 52.6 18.8 53.2C16.2 53.7 15.4 50.7 17.6 47.9C19.9 45 23.6 43.4 27 41.4C33 35 39.5 25.5 45 15.8C47 12.2 47.2 8.6 44.6 8.6C42 8.6 40.9 11.6 41 15.4C41.3 27 41.7 38.5 42.3 46.8C42.6 51.6 45 54.2 47.7 53C50.2 51.9 51.6 49.2 52.2 46.6';
export const LOGO_SVG = (size = 28) => `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#4f7552"/><path d="${LOGO_H_PATH}" fill="none" stroke="#fff" stroke-width="3.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
export const FAVICON_SVG = () => LOGO_SVG(64).replace('class="logo" ', 'xmlns="http://www.w3.org/2000/svg" ').replace(' aria-hidden="true"', '');

/** Fills {{placeholders}} in all strings of the content (repeated, so placeholders may contain placeholders). */
export function resolveContent(content, extra) {
    const scope = { ...content, ...extra };
    const lookup = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), scope);
    const fill = (s) => {
        for (let i = 0; i < 5 && /\{\{[\w.]+\}\}/.test(s); i++) {
            s = s.replace(/\{\{([\w.]+)\}\}/g, (m, p) => { const v = lookup(p); return typeof v === 'string' || typeof v === 'number' ? String(v) : m; });
        }
        const left = s.match(/\{\{[\w.]+\}\}/);
        if (left) throw new Error(`content.mjs: unknown placeholder ${left[0]}`);
        return s;
    };
    const walk = (v) => typeof v === 'string' ? fill(v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
    return walk(content);
}

/** The demo also allows WebAssembly, which pdf.js uses to decode some images in PDFs (it does not allow JavaScript eval). */
const CSP_DEMO_EXTRA = " 'wasm-unsafe-eval'";
const CSP = "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'";
const CSP_DEMO = CSP.replace("script-src 'self'", "script-src 'self'" + CSP_DEMO_EXTRA);

function head({ title, description, themeColor, root, css, scripts, dev, app = false, themeScript = true }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover${app ? ', interactive-widget=resizes-content' : ''}">
<meta http-equiv="Content-Security-Policy" content="${app ? CSP_DEMO : CSP}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="${attr(themeColor)}">
<title>${attr(title)}</title>
<meta name="description" content="${attr(description)}">
<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
${themeScript ? `<script src="${root}theme.js"></script>\n` : ''}${css.map(c => `<link rel="stylesheet" href="${c}">`).join('\n')}
${scripts.map(s => `<script type="module" src="${s}"></script>`).join('\n')}
${dev ? '<script src="/livereload.js"></script>' : ''}
</head>`;
}

const themeToggle = (c, cls = 'theme-toggle') =>
    `<button type="button" class="${cls}" data-theme-toggle data-label-light="${attr(c.theme.toLight)}" data-label-dark="${attr(c.theme.toDark)}" aria-label="${attr(c.theme.toDark)}" title="${attr(c.theme.toDark)}">${icon('moon', 'icon-moon')}${icon('sun', 'icon-sun')}</button>`;

const button = (b, extra = '') => {
    const ext = /^https?:/.test(b.href) ? ' rel="noopener"' : '';
    return `<a class="btn${b.primary ? ' btn-primary' : ''}${extra}" href="${attr(b.href)}"${ext}>${b.icon ? icon(b.icon) : ''}<span>${b.label}</span></a>`;
};

export function renderLanding(c, { dev = false } = {}) {
    const h = c.hero;
    const title = (id, text, extra = '') => `<h2 id="${id}" class="section-title">${LOGO_SVG(30)}<span>${text}</span></h2>${extra}`;
    return `${head({ title: c.site.title, description: c.site.description, themeColor: c.site.themeColor, root: '', css: ['site.css'], scripts: [], dev, themeScript: false })}
<body>
<a class="skip-link" href="#features">Skip to the features</a>

<main>
  <!-- 1. Intro -->
  <section class="intro" aria-labelledby="intro-title">
    <div class="wrap intro-inner">
      ${LOGO_SVG(84).replace('class="logo"', 'class="logo intro-logo"')}
      <h1 id="intro-title" class="intro-name">${c.site.name}</h1>
      <p class="intro-about">${h.about}</p>
      <div class="intro-actions">
        ${button({ ...h.demo, primary: true }, ' btn-hero')}
        <nav class="intro-links" aria-label="More">
          ${h.links.map(l => `<a class="chip" href="${attr(l.href)}"${/^https?:/.test(l.href) ? ' rel="noopener"' : ''}>${icon(l.icon)}<span>${l.label}</span></a>`).join('\n          ')}
        </nav>
      </div>
      <p class="intro-meta">${h.meta}</p>
    </div>
  </section>

  <!-- 2. Features and privacy -->
  <section id="features" class="section" aria-labelledby="features-title">
    <div class="wrap">
      ${title('features-title', c.features.title, `<p class="section-lead">${c.features.lead}</p>`)}
      <ul class="feature-grid">
${c.features.items.map(f => `        <li class="card feature">
          <span class="icon-box">${icon(f.icon)}</span>
          <div><h3>${f.title}</h3><p>${f.text}</p></div>
        </li>`).join('\n')}
      </ul>
      <div id="privacy" class="privacy card" aria-labelledby="privacy-title">
        <h3 id="privacy-title"><span class="icon-box icon-box-small">${icon('shield')}</span>${c.privacy.title}</h3>
        <ul class="check-list">
          ${c.privacy.items.map(t => `<li>${t}</li>`).join('\n          ')}
        </ul>
      </div>
    </div>
  </section>

  <!-- 3. AI notice and installation -->
  <section id="install" class="section section-alt" aria-labelledby="install-title">
    <div class="wrap">
      ${title('install-title', c.install.title)}
      <aside class="ai-notice" aria-labelledby="ai-title">
        <span class="icon-box ai-icon">${icon('sparkles')}</span>
        <div class="ai-body">
          <h3 id="ai-title">${c.aiNotice.title}</h3>
          <p class="ai-lead">${c.aiNotice.lead}</p>
          <p>${c.aiNotice.text}</p>
        </div>
      </aside>
      <div class="install-grid">
${c.install.steps.map((s, i) => `        <div class="card install-card">
          <span class="step-badge">${i + 1}</span>
          <h3>${s.title}</h3>
          <p>${s.text}</p>
          ${s.button ? button(s.button, ' btn-small') : ''}
        </div>`).join('\n')}
      </div>
      <p class="getting-started">${c.install.gettingStarted}</p>
    </div>
  </section>
</main>

<!-- Footer as on tycho.anulab.tech (three animated crystal layers). -->
<footer class="siteFooter">
  <div class="footer-bg-layer layer-1"></div>
  <div class="footer-bg-layer layer-2"></div>
  <div class="footer-bg-layer layer-3"></div>
  <div class="footer-bottom">
    <p class="footer-project">${c.footer.project}</p>
    ${c.footer.lines.map(l => `<p>${l}</p>`).join('\n    ')}
  </div>
</footer>
</body>
</html>
`;
}

export function renderDemo(c, { dev = false } = {}) {
    const d = c.demo, B = d.buttons;
    const btn = (id, ic, label, title) => `<button type="button" class="demo-btn" id="${id}" title="${attr(title)}">${icon(ic)}<span class="demo-btn-label">${label}</span></button>`;
    return `${head({ title: d.title, description: d.description, themeColor: c.site.themeColor, root: '../', css: ['demo.css'], scripts: ['demo.js'], dev, app: true })}
<body class="demo-page">
<header class="demo-top">
  <a class="demo-brand" href="../" title="About the plugin">${LOGO_SVG(28)}<span class="demo-brand-name">${c.site.name}</span><span class="demo-badge">${d.badge}</span></a>
  <div class="demo-bar" role="toolbar" aria-label="Demo controls">
    ${btn('demo-reset', 'reset', B.reset, 'Restore the sample note')}
    ${btn('demo-download', 'download', B.download, 'Download the note as a .hnote file (JSON)')}
    ${btn('demo-export', 'pdf', B.pdf, 'Export the note to PDF with the plugin\'s own exporter')}
    ${btn('demo-settings', 'settings', B.settings, 'Plugin settings')}
    ${btn('demo-fullscreen', 'fullscreen', B.fullscreen, 'Fullscreen')}
    ${themeToggle(c, 'theme-toggle demo-theme-toggle')}
    <a class="demo-btn demo-btn-primary" href="${attr(c.links.obsidian)}" title="Install the plugin in Obsidian">${icon('download')}<span class="demo-btn-label">${B.install}</span></a>
  </div>
</header>
<main id="demo-view" class="demo-app" aria-label="Handwritten note – live demo" data-welcome="${attr(d.welcome)}">
  <div class="demo-loading">Loading the demo…</div>
  <noscript><p class="demo-loading">The live demo needs JavaScript.</p></noscript>
</main>
</body>
</html>
`;
}
