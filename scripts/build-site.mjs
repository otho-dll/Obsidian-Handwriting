// Builds the website into build/site/:
//   /            landing page   – texts in site/content.mjs, structure in site/render.mjs, styles in site/site.css
//   /demo/       live demo      – the real plugin (src/) with `obsidian` aliased to a browser shim (site/shim/)
//
//   node scripts/build-site.mjs           – production build (minified)
//   node scripts/build-site.mjs --serve   – development: local server on http://localhost:8080, rebuild + reload on change
//
// The plugin build itself (scripts/esbuild.config.mjs) is not affected.
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Output of this command-line script. */
const say = (...parts) => process.stdout.write(parts.join(' ') + '\n');
const complain = (...parts) => process.stderr.write(parts.join(' ') + '\n');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site');
const out = path.join(root, 'build', 'site');
const serve = process.argv.includes('--serve');
const port = Number(process.env.PORT) || 8080;

const read = (p) => fs.readFileSync(p, 'utf8');
/** Imports a module fresh on every rebuild (so edits to content.mjs / render.mjs show up in --serve mode). */
const fresh = (p) => import(`${pathToFileURL(p).href}?t=${Date.now()}`);

/** HTML, CSS, images – everything except the JavaScript bundle. */
async function buildStatic() {
    const manifest = JSON.parse(read(path.join(root, 'manifest.json')));
    const { default: raw } = await fresh(path.join(site, 'content.mjs'));
    const render = await fresh(path.join(site, 'render.mjs'));
    const content = render.resolveContent(raw, { version: manifest.version, pluginId: manifest.id, year: String(new Date().getFullYear()) });

    fs.mkdirSync(path.join(out, 'demo'), { recursive: true });

    // Landing page: /
    fs.writeFileSync(path.join(out, 'index.html'), render.renderLanding(content, { dev: serve }));
    // Optional backgrounds: site/background.jpg (dark mode) and site/background-light.jpg (light mode). With only one, both
    // use it; with none the pages have a plain colour (site.css).
    const pick = (base) => ['jpg', 'webp', 'png'].map(e => `${base}.${e}`).find(f => fs.existsSync(path.join(site, f)));
    const bgDark = pick('background'), bgLight = pick('background-light');
    /** CSS variable with the background of each mode (`prefix` = path from the stylesheet to the site root). */
    const bgVars = (prefix, name) => {
        const light = bgLight ?? bgDark, dark = bgDark ?? bgLight;
        if (!light) return '';
        return `\n:root { --${name}: url('${prefix}${light}'); }\n:root[data-theme="dark"] { --${name}: url('${prefix}${dark}'); }\n`;
    };
    fs.writeFileSync(path.join(out, 'site.css'), read(path.join(site, 'site.css')) + bgVars('', 'site-bg-image'));
    for (const f of [bgDark, bgLight]) if (f) fs.copyFileSync(path.join(site, f), path.join(out, f));
    fs.writeFileSync(path.join(out, 'favicon.svg'), render.FAVICON_SVG());
    fs.copyFileSync(path.join(site, 'theme.js'), path.join(out, 'theme.js'));
    // Live demo: /demo/ – Obsidian variables and base styles, then the plugin's own styles, then the demo page.
    fs.writeFileSync(path.join(out, 'demo', 'index.html'), render.renderDemo(content, { dev: serve }));
    const css = [
        '/* Obsidian look (site/shim/obsidian.css) */', read(path.join(site, 'shim', 'obsidian.css')),
        '/* Plugin styles (src/styles.css) */', read(path.join(root, 'src', 'styles.css')),
        '/* Demo page (site/demo/demo.css) */', read(path.join(site, 'demo', 'demo.css')),
    ].join('\n');
    fs.writeFileSync(path.join(out, 'demo', 'demo.css'), css + bgVars('../', 'demo-bg-image'));

    // pdf.js for PDF import in the demo (the library itself is a lazily loaded chunk of demo.js): the worker, fonts,
    // character maps and image decoders it loads at run time, plus its licence (Apache-2.0).
    const pdfjs = path.join(root, 'node_modules', 'pdfjs-dist');
    const pdfOut = path.join(out, 'demo', 'pdfjs');
    fs.mkdirSync(pdfOut, { recursive: true });
    fs.copyFileSync(path.join(pdfjs, 'build', 'pdf.worker.min.mjs'), path.join(pdfOut, 'pdf.worker.min.mjs'));
    fs.copyFileSync(path.join(pdfjs, 'LICENSE'), path.join(pdfOut, 'LICENSE'));
    for (const dir of ['cmaps', 'standard_fonts', 'wasm']) fs.cpSync(path.join(pdfjs, dir), path.join(pdfOut, dir), { recursive: true });

    if (serve) fs.writeFileSync(path.join(out, 'livereload.js'), "new EventSource('/esbuild').addEventListener('change', () => location.reload());\n");
    fs.writeFileSync(path.join(out, 'CNAME'), content.site.domain + '\n');
    fs.writeFileSync(path.join(out, '.nojekyll'), '');
}

const staticPlugin = {
    name: 'site-static',
    setup(build) {
        build.onEnd(async (result) => {
            if (result.errors.length) return;
            try {
                await buildStatic();
                say(new Date().toLocaleTimeString(), 'site built → build/site/');
            } catch (e) {
                complain('site build failed:', e.message);
                if (!serve) process.exitCode = 1;
            }
        });
    },
};

if (!serve) fs.rmSync(out, { recursive: true, force: true });

const ctx = await esbuild.context({
    absWorkingDir: root,
    entryPoints: [path.join(site, 'demo', 'main.ts')],
    // demo/demo.js plus chunks loaded on demand (pdf.js, only when a PDF is imported)
    outdir: path.join(out, 'demo'),
    entryNames: 'demo',
    chunkNames: 'chunks/[name]-[hash]',
    splitting: true,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    alias: { obsidian: './site/shim/obsidian.ts' },
    minify: !serve,
    sourcemap: serve ? 'inline' : false,
    legalComments: 'none',
    logLevel: 'info',
    plugins: [staticPlugin],
});

if (serve) {
    await ctx.watch();
    // esbuild watches only imported files – content, templates, styles and images are watched here.
    const watched = [
        'content.mjs', 'render.mjs', 'site.css', 'theme.js', 'background.jpg', 'background-light.jpg', 'shim/obsidian.css', 'demo/demo.css',
    ].map(f => path.join(site, f)).concat([path.join(root, 'src', 'styles.css'), path.join(root, 'manifest.json')]);
    for (const f of watched) fs.watchFile(f, { interval: 400 }, () => { void ctx.rebuild(); });
    const { host } = await ctx.serve({ servedir: out, port });
    say(`Website: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/   ·   demo: http://localhost:${port}/demo/`);
} else {
    await ctx.rebuild();
    await ctx.dispose();
}
