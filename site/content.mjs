// ============================================================================================================
//  WEBSITE CONTENT – edit this file to change the texts, titles and links of the website.
//  (The page structure lives in site/render.mjs, the styles in site/site.css – you normally don't need them.)
//
//  The landing page has three sections: 1) intro (name, what it is, Features / Demo / Install buttons),
//  2) features and privacy, 3) AI notice and installation. Light / dark follows the system.
//
//  • Texts may contain simple HTML: <strong>, <em>, <code>, <a href="…">, <br>.
//  • Placeholders, filled in when the site is built:
//      {{version}}  plugin version from manifest.json      {{pluginId}}  plugin id from manifest.json
//      {{year}}     current year                           {{links.repo}}, {{links.issues}}, … any value below
//  • Icons (features, buttons): pen, shapes, lasso, pages, pagestyle, image, plot, history, phone,
//    download, github, demo, bug, reset, file, pdf, settings, fullscreen, sparkles, grid, shield, lock, code.
//  • Build and preview:  npm run site:dev   (http://localhost:8080)   ·   npm run site:build  (→ build/site/)
// ============================================================================================================

export default {
    site: {
        /** Custom domain of the GitHub Pages site (written to CNAME). */
        domain: 'handwriting.anulab.tech',
        /** Browser tab title (short – tabs are narrow) and search-engine description of the landing page. */
        title: 'Handwritten A4 Notebook',
        description: 'An Obsidian plugin for pen-first handwritten notes on A4 pages: pressure ink, highlighter, shapes, lasso, PDF import and export, calculator, function plots and version history. Try the live demo in your browser.',
        /** Project name (intro section, demo header). */
        name: 'Handwritten A4 Notebook',
        /** Colour of the browser UI on phones. */
        themeColor: '#4f7552',
    },

    links: {
        repo: 'https://github.com/otho-dll/Obsidian-Handwriting',
        issues: 'https://github.com/otho-dll/Obsidian-Handwriting/issues',
        releases: 'https://github.com/otho-dll/Obsidian-Handwriting/releases/latest',
        license: 'https://github.com/otho-dll/Obsidian-Handwriting/blob/main/LICENSE',
        /** Opens the plugin page in Obsidian's community plugin browser. */
        obsidian: 'obsidian://show-plugin?id={{pluginId}}',
        demo: 'demo/',
        /** Repository name for BRAT (beta installs). */
        brat: 'otho-dll/Obsidian-Handwriting',
    },

    /** Section 1 – the first screen. */
    hero: {
        /** What the plugin is, under the name. */
        about: 'An Obsidian plugin for writing by hand on real pages: pressure ink, highlighter, shapes, PDFs and a calculator, all saved as open JSON in your vault.',
        /** The big button in the accent colour. */
        demo: { label: 'Try the live demo', href: '{{links.demo}}', icon: 'pen' },
        /** Smaller links in one row under it. */
        links: [
            { label: 'Features', href: '#features', icon: 'grid' },
            { label: 'Install', href: '#install', icon: 'download' },
            { label: 'GitHub', href: '{{links.repo}}', icon: 'github' },
        ],
        meta: 'Free and open source (MIT) · Desktop, tablets and phones · v{{version}}',
    },

    /** Section 2 – features and privacy. */
    features: {
        title: 'Features',
        lead: 'Everything a paper notebook can do, and more.',
        items: [
            { icon: 'pen', title: 'Pen, highlighter & eraser', text: 'Pressure ink with opacity, a flat highlighter, and an eraser that cuts strokes.' },
            { icon: 'shapes', title: 'Shapes', text: 'Lines, arrows, rectangles and ellipses with dashes, fills and separate outline and fill colours.' },
            { icon: 'lasso', title: 'Lasso selection', text: 'Move, scale, rotate, recolour, group and lock, even onto another page.' },
            { icon: 'pages', title: 'Pages panel', text: 'Thumbnails and sections: jump to, reorder, duplicate or restyle pages.' },
            { icon: 'pagestyle', title: 'Page styles', text: 'Portrait, landscape or endless; dots, lines, grid, Cornell, music staff and more.' },
            { icon: 'image', title: 'Images & PDFs', text: 'Paste, crop and rotate images; import a PDF and write on it.' },
            { icon: 'plot', title: 'Calculator & plots', text: 'Scientific calculator with units and matrices; editable function plots.' },
            { icon: 'history', title: 'Export & history', text: 'PDF export with bookmarks, printing, and automatic version history.' },
            { icon: 'phone', title: 'Tablets & OLED care', text: 'Palm rejection, pinch zoom, pen button, dark paper and burn-in protection.' },
        ],
    },

    privacy: {
        title: 'Privacy',
        items: [
            'No network requests and no telemetry – PDF import uses the engine bundled with Obsidian.',
            'Writes only your <code>.hnote</code> notes and their hidden data folders (PDF export to a folder you pick).',
            'Notes are plain JSON; <code>hnote2pdf.py</code> turns them into PDFs without Obsidian.',
            'This website has no cookies or analytics; the demo keeps its note only in your browser.',
        ],
    },

    /** Section 3 – AI notice, then installation. */
    aiNotice: {
        title: 'Made with AI',
        lead: 'This project is entirely vibe-coded using Claude Code.',
        text: 'It started as a personal tool, made just for me and my own notes. Over time it grew into something complete and useful enough that I decided to share it. Expect a few rough edges - feedback and bug reports are welcome.',
    },

    install: {
        title: 'Install',
        steps: [
            {
                title: 'Community plugins',
                text: 'Settings → Community plugins → Browse → search <em>Handwritten A4 Notebook</em> → Install → Enable.',
                button: { label: 'Open in Obsidian', href: '{{links.obsidian}}', primary: true },
            },
            {
                title: 'Beta via BRAT',
                text: 'Install the <em>BRAT</em> plugin → <em>Add beta plugin</em> → <code>{{links.brat}}</code>',
            },
            {
                title: 'Manually',
                text: 'Download <code>main.js</code>, <code>manifest.json</code> and <code>styles.css</code> from the <a href="{{links.releases}}" rel="noopener">latest release</a> into <code>&lt;your vault&gt;/.obsidian/plugins/{{pluginId}}/</code>, then enable the plugin in Settings → Community plugins.',
            },
        ],
        gettingStarted: '<strong>Getting started:</strong> right-click a folder in the file explorer → <em>New handwritten note</em>, or run the command <em>Create new handwritten note</em>. Fingers scroll and zoom, the pen draws, and everything saves automatically.',
    },

    footer: {
        /** First line: project name and version (no links). */
        project: 'Handwritten A4 Notebook <span class="version">v{{version}}</span> · MIT License',
        /** The lines below are the same as on tycho.anulab.tech / anulab.tech. */
        lines: [
            'Made with <span class="heart">💚</span> by Simon',
            'Copyright &copy; {{year}} Szymon Glinka',
            'This site does NOT use cookies for tracking or collect your personal information.',
            'This site has been made with the help of AI',
        ],
    },

    /** The live demo page (/demo/). */
    demo: {
        title: 'Demo · Handwritten A4 Notebook',
        description: 'Try the Handwritten A4 Notebook plugin for Obsidian in your browser: write with a pen or a mouse on real A4 pages.',
        badge: 'Live demo',
        /** Shown once on the first visit. */
        welcome: 'This is the real plugin running in your browser. Write with a pen or a mouse – your changes stay on this device.',
        buttons: {
            reset: 'Reset', download: '.hnote', pdf: 'PDF', settings: 'Settings', fullscreen: 'Fullscreen', install: 'Install',
        },
    },

    /** Labels of the light / dark switch (demo page). */
    theme: {
        toLight: 'Switch to light mode',
        toDark: 'Switch to dark mode',
    },
};
