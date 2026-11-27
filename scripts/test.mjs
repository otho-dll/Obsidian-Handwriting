// Unit tests: bundles tests/*.test.ts with esbuild and runs them with Node's built-in test runner (no extra packages).
import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const out = path.join(root, 'build', 'tests');
fs.rmSync(out, { recursive: true, force: true });
const entries = fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.ts')).map(f => path.join(root, 'tests', f));
await esbuild.build({ entryPoints: entries, bundle: true, platform: 'node', format: 'esm', outdir: out, outExtension: { '.js': '.mjs' }, logLevel: 'error' });
const files = fs.readdirSync(out).filter(f => f.endsWith('.mjs')).map(f => path.join(out, f));
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(r.status ?? 1);
