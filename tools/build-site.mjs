// Assembles the publishable site into _site/: the app files only, not the tests, tools or a stale calendar.
// Used by the hosting build (see vercel.json). Run: node tools/build-site.mjs
import { rm, mkdir, copyFile, cp, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
const FILES = ['index.html', 'style.css', 'app.js', 'logic.js', 'glossary.js', 'journal.js', 'sw.js', 'manifest.webmanifest'];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const f of FILES) await copyFile(join(root, f), join(out, f));
await cp(join(root, 'icons'), join(out, 'icons'), { recursive: true });
// calendar.json is deliberately NOT copied: the host serves it live from api/calendar.mjs.
console.log('site built in _site: ' + (await readdir(out)).join(', '));
