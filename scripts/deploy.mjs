// Copies the built plugin (main.js, manifest.json, styles.css) into your vault's plugin folder.
//   node scripts/deploy.mjs          – copy once
//   node scripts/deploy.mjs --watch  – copy again every time one of the files changes
// The target folder is read from the file ".vault-plugin-dir" (one line, not committed – see .gitignore),
// e.g.  G:\My Drive\Vault\.obsidian\plugins\handwriting
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILES = ['main.js', 'manifest.json', 'styles.css'];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = path.join(root, '.vault-plugin-dir');

if (!fs.existsSync(cfg)) {
    console.error('Missing .vault-plugin-dir – create it with the path to <vault>/.obsidian/plugins/<plugin id>');
    process.exit(1);
}
const target = fs.readFileSync(cfg, 'utf8').trim();
fs.mkdirSync(target, { recursive: true });
// Lets the Hot Reload plugin reload this plugin automatically after each copy.
fs.writeFileSync(path.join(target, '.hotreload'), '');

function copy(file) {
    const src = path.join(root, file);
    if (!fs.existsSync(src)) { console.warn('skipped (not built yet):', file); return; }
    fs.copyFileSync(src, path.join(target, file));
    console.log(new Date().toLocaleTimeString(), 'copied', file, '→', target);
}

FILES.forEach(copy);

if (process.argv.includes('--watch')) {
    const timers = {};
    for (const file of FILES) {
        fs.watchFile(path.join(root, file), { interval: 500 }, () => {
            clearTimeout(timers[file]);
            timers[file] = setTimeout(() => copy(file), 200);
        });
    }
    console.log('Watching for changes… (Ctrl+C to stop)');
}
