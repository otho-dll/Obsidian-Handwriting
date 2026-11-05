// ============================================================================================================
//  WEBSITE CONTENT – edit this file to change the texts, titles and links of the website.
//  (The page structure lives in site/render.mjs, the styles in site/site.css – you normally don't need them.)
//
//  • Texts may contain simple HTML: <strong>, <em>, <code>, <a href="…">, <br>.
//  • Placeholders, filled in when the site is built:
//      {{version}}  plugin version from manifest.json      {{pluginId}}  plugin id from manifest.json
//      {{year}}     current year                           {{links.repo}}, {{links.issues}}, … any value below
//  • Icons (features, buttons): pen, shapes, lasso, pages, pagestyle, image, plot, history, phone,
//    download, github, demo, bug, reset, file, pdf, settings, fullscreen, sparkles.
//  • Build and preview:  npm run site:dev   (http://localhost:8080)   ·   npm run site:build  (→ build/site/)
// ============================================================================================================

export default {
    site: {
        /** Custom domain of the GitHub Pages site (written to CNAME). */
        domain: 'handwriting.anulab.tech',
        /** Browser tab title and search-engine description of the landing page. */
        title: 'Handwritten A4 Notebook – handwritten notes for Obsidian',
        description: 'An Obsidian plugin for pen-first handwritten notes on A4 pages: pressure ink, highlighter, shapes, lasso, PDF import and export, calculator, function plots and version history. Try the live demo in your browser.',
        /** Name shown in the header next to the logo. */
        name: 'Handwritten A4 Notebook',
        /** Colour of the browser UI on phones. */
        themeColor: '#0f49be',
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

    /** Header navigation. `highlight: true` = shown in the accent colour and also on phones. */
    nav: [
        { label: 'Live demo', href: '{{links.demo}}', highlight: true },
        { label: 'Features', href: '#features' },
        { label: 'Install', href: '#install' },
        { label: 'Privacy', href: '#privacy' },
    ],

    hero: {
        /** Not shown on the page (the screenshots speak for themselves) – used by screen readers and search engines. */
        title: 'Handwritten A4 Notebook – handwritten notes for Obsidian',
        pitch: 'Write by hand on real pages in Obsidian: pressure ink, highlighter, shapes, PDFs and a calculator, all saved as open JSON in your vault.',
        buttons: [
            { label: 'Try the live demo', href: '{{links.demo}}', icon: 'pen', primary: true },
            { label: 'Install in Obsidian', href: '{{links.obsidian}}', icon: 'download' },
            { label: 'GitHub', href: '{{links.repo}}', icon: 'github' },
        ],
        meta: 'Free and open source (MIT) · Desktop, tablets and phones',
        /** Screenshots that cycle at the top of the page – files from docs/Screenshots (2880 × ~1700 px). */
        slideSeconds: 5,
        slides: [
            { file: 'PagesAndPageStyle.png', alt: 'A handwritten note with the page style panel and the pages panel open' },
            { file: 'blankPage.png', alt: 'A blank dotted A4 page with the toolbar' },
            { file: 'Pages.png', alt: 'The pages panel with page thumbnails' },
            { file: 'BuiltInCalculator.png', alt: 'The built-in calculator floating over a note' },
            { file: 'SciencetificCalculator.png', alt: 'The scientific calculator tab' },
            { file: 'FunctionPloting.png', alt: 'The function plot dialog' },
        ],
    },

    aiNotice: {
        title: 'Made with AI',
        lead: 'This project is entirely vibe-coded using Claude Code.',
        text: 'It started as a personal tool, made just for me and my own notes. Over time it grew into something complete and useful enough that I decided to share it. Expect a few rough edges - feedback and bug reports are welcome.',
    },

    features: {
        title: 'Everything a paper notebook can do, and more',
        lead: 'Real pages, a pen that feels right, and the tools you reach for while studying or sketching.',
        items: [
            { icon: 'pen', title: 'Pressure pen, highlighter & eraser', text: 'Pressure-sensitive ink in three thicknesses with opacity. A flat-ended highlighter that doesn\'t darken where strokes overlap. The eraser cuts strokes where you rub and can leave shapes or the highlighter alone.' },
            { icon: 'shapes', title: 'Shapes & fills', text: 'Lines and arrows, rectangles and ellipses. Solid, dashed, dotted or dash-dot lines, outline, solid or light fill, with separate outline and fill colours. Hold Shift for squares and circles.' },
            { icon: 'lasso', title: 'Lasso selection', text: 'Draw around strokes and images, or use a rectangle. Move, scale, rotate, recolour, group, lock and align, even onto another page.' },
            { icon: 'pages', title: 'Pages panel', text: 'Thumbnails grouped into sections by page title: jump to a page, reorder, duplicate, restyle or delete pages. The current page is framed, with its number shown beside it.' },
            { icon: 'pagestyle', title: 'Page styles', text: 'A4 portrait, landscape or one endless page. Dots, lines, grid, Cornell, isometric, checklist, millimetre paper, music staff and any paper colour.' },
            { icon: 'image', title: 'Images & PDF import', text: 'Paste, drop or insert images, then move, scale, rotate and crop them. Import a PDF and write on lecture slides, worksheets or papers.' },
            { icon: 'plot', title: 'Calculator & function plots', text: 'A basic and a scientific calculator with complex numbers, matrices, integrals and units. Plot functions, parametric and polar curves; plots stay editable.' },
            { icon: 'history', title: 'PDF export, printing & history', text: 'Export to PDF with page titles as bookmarks, or print with one sheet per page. Versions are saved automatically, so you can restore any of them.' },
            { icon: 'phone', title: 'Tablets, phones & OLED care', text: 'Palm rejection, pinch zoom, the pen\'s side button and long-press menus. Dark paper, a fading toolbar, pixel shift and idle dimming protect OLED screens.' },
        ],
    },

    install: {
        title: 'Installation',
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

    privacy: {
        title: 'Privacy',
        items: [
            'The plugin doesn\'t make network requests or collect telemetry. PDF import uses the PDF engine bundled with Obsidian.',
            'It writes only your <code>.hnote</code> notes, their hidden <code>.&lt;name&gt;.hnote-data</code> folders and, when you ask, <code>hnote2pdf.py</code>. Files outside the vault only when you pick a folder on your computer for PDF export (desktop).',
            'The clipboard is used only when you copy, paste or take a screenshot yourself.',
            'This website has no cookies, no analytics and no external requests. The demo keeps its note only in your browser\'s storage; <em>Reset</em> removes it. Your light / dark choice is remembered in the browser too.',
        ],
    },

    data: {
        title: 'Your data stays open',
        paragraphs: [
            'Notes are <code>.hnote</code> files: plain JSON next to your Markdown, with images, imported PDF pages and versions in a hidden folder that moves with the note.',
            'The standalone script <code>hnote2pdf.py</code> turns notes into vector PDFs on any computer, with no Obsidian, no plugin and no extra packages (Python 3.8+).',
        ],
        code: 'python3 hnote2pdf.py "Lectures/Physics/Lecture 1.hnote"\npython3 hnote2pdf.py MyVault -r -o ~/PDF/',
    },

    footer: {
        /** First line: project name, version and links. */
        project: 'Handwritten A4 Notebook <span class="version">v{{version}}</span> · <a href="{{links.license}}" rel="noopener">MIT License</a> · <a href="{{links.repo}}" rel="noopener">Source on GitHub</a> · <a href="{{links.issues}}" rel="noopener">Report a bug or send feedback</a>',
        /** The lines below are the same as on tycho.anulab.tech / anulab.tech. */
        lines: [
            'Made with <span class="heart">💛</span> by Simon',
            'Copyright &copy; {{year}} Szymon Glinka',
            'This site does NOT use cookies for tracking or collect your personal information.',
            'This site has been made with the help of AI',
        ],
    },

    /** The live demo page (/demo/). */
    demo: {
        title: 'Live demo – Handwritten A4 Notebook',
        description: 'Try the Handwritten A4 Notebook plugin for Obsidian in your browser: write with a pen or a mouse on real A4 pages.',
        badge: 'Live demo',
        /** Shown once on the first visit. */
        welcome: 'This is the real plugin running in your browser. Write with a pen or a mouse – your changes stay on this device.',
        buttons: {
            reset: 'Reset', download: '.hnote', pdf: 'PDF', settings: 'Settings', fullscreen: 'Fullscreen', install: 'Install',
        },
    },

    /** Labels of the light / dark switch. */
    theme: {
        toLight: 'Switch to light mode',
        toDark: 'Switch to dark mode',
    },
};
