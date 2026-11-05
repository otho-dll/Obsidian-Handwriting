// Copies the built plugin (build/main.js, build/manifest.json, build/styles.css) into your vault's plugin folder.
//   node scripts/deploy.mjs          – copy once
//   node scripts/deploy.mjs --watch  – copy again every time one of the files changes
// The target folder is read from the file ".vault-plugin-dir" (one line, not committed – see .gitignore),
// e.g.  G:\My Drive\Vault\.obsidian\plugins\handwritten-notebook
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Output of this command-line script. */
const say = (...parts) => process.stdout.write(parts.join(' ') + '\n');
const complain = (...parts) => process.stderr.write(parts.join(' ') + '\n');

const FILES = ['main.js', 'manifest.json', 'styles.css'];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
const cfg = path.join(root, '.vault-plugin-dir');

if (!fs.existsSync(cfg)) {
    complain('Missing .vault-plugin-dir – create it with the path to the plugin folder: <vault>/<config folder>/plugins/<plugin id>');
    process.exit(1);
}
const target = fs.readFileSync(cfg, 'utf8').trim();
fs.mkdirSync(target, { recursive: true });
// Lets the Hot Reload plugin reload this plugin automatically after each copy.
fs.writeFileSync(path.join(target, '.hotreload'), '');

function copy(file) {
    const src = path.join(buildDir, file);
    if (!fs.existsSync(src)) { complain('skipped (not built yet):', file); return; }
    fs.copyFileSync(src, path.join(target, file));
    say(new Date().toLocaleTimeString(), 'copied', file, '→', target);
}

FILES.forEach(copy);

if (process.argv.includes('--watch')) {
    const timers = {};
    for (const file of FILES) {
        fs.watchFile(path.join(buildDir, file), { interval: 500 }, () => {
            clearTimeout(timers[file]);
            timers[file] = setTimeout(() => copy(file), 200);
        });
    }
    say('Watching for changes… (Ctrl+C to stop)');
}
