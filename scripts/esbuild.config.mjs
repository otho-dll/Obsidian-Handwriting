// Builds the plugin into build/: main.js (bundled src/main.ts), styles.css and manifest.json.
//   node scripts/esbuild.config.mjs              – production build (minified)
//   node scripts/esbuild.config.mjs --watch      – development: rebuild on every change
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Output of this command-line script. */
const say = (...parts) => process.stdout.write(parts.join(' ') + '\n');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'build');
const watch = process.argv.includes('--watch');

// styles.css and manifest.json are copied next to main.js after every build.
const copyStatic = {
    name: 'copy-static',
    setup(build) {
        build.onEnd((result) => {
            if (result.errors.length) return;
            fs.mkdirSync(out, { recursive: true });
            fs.copyFileSync(path.join(root, 'src', 'styles.css'), path.join(out, 'styles.css'));
            fs.copyFileSync(path.join(root, 'manifest.json'), path.join(out, 'manifest.json'));
            say(new Date().toLocaleTimeString(), 'built → build/');
        });
    },
};

const ctx = await esbuild.context({
    entryPoints: [path.join(root, 'src', 'main.ts')],
    outfile: path.join(out, 'main.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2020',
    external: ['obsidian', 'electron'],
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    logLevel: 'info',
    plugins: [copyStatic],
});

if (watch) {
    await ctx.watch();
    // esbuild watches only imported files – styles.css and manifest.json are watched here.
    for (const f of [path.join(root, 'src', 'styles.css'), path.join(root, 'manifest.json')]) {
        fs.watchFile(f, { interval: 500 }, () => { void ctx.rebuild(); });
    }
} else {
    await ctx.rebuild();
    await ctx.dispose();
}
