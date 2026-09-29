// Serves the app and keeps the economic calendar fresh. No dependencies.
//   node tools/serve.mjs            -> http://localhost:5177  (this computer only)
//   node tools/serve.mjs --lan      -> also reachable from a tablet on the same Wi-Fi (plain http, so
//                                      the page works there, but installing it as an app does not)
//   PORT=8080 node tools/serve.mjs  -> another port
//
// /calendar.json is refreshed in the background when it is older than 20 minutes, and never more than
// once every 5 minutes even if the feed is failing, so this cannot hammer the source.
import { createServer } from 'node:http';
import { readFile, stat, writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';
import { fetchCalendar } from './calendar-lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const calFile = join(root, 'calendar.json');
const port = Number(process.env.PORT) || 5177;
const host = process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1';
const FRESH_MS = 20 * 60000, RETRY_MS = 5 * 60000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const log = m => console.log(new Date().toISOString().slice(11, 19) + '  ' + m);
let lastAttempt = 0, refreshing = null;

async function ageOfCalendar() {
  try { return Date.now() - (await stat(calFile)).mtimeMs; } catch { return Infinity; }
}
// Refresh in the background; concurrent requests share one attempt.
function refresh() {
  if (refreshing) return refreshing;
  lastAttempt = Date.now();
  refreshing = (async () => {
    try {
      const cal = await fetchCalendar();
      await writeFile(calFile + '.tmp', JSON.stringify(cal));
      await rename(calFile + '.tmp', calFile);
      log(`calendar refreshed: ${cal.events.length} events`);
    } catch (e) {
      log('calendar NOT refreshed: ' + e.message + ' (serving the previous file if there is one)');
    } finally { refreshing = null; }
  })();
  return refreshing;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(root, rel));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end('Forbidden'); return; }   // no path traversal

    if (rel === '/calendar.json') {
      const age = await ageOfCalendar();
      if (age === Infinity) await refresh();                                     // first run: wait for it
      else if (age > FRESH_MS && Date.now() - lastAttempt > RETRY_MS) refresh(); // later: refresh in the background
    }
    // Do not serve the tools, tests or the calendar's temp file.
    if (/^\/(tools|tests|\.claude)(\/|$)/.test(rel) || rel.endsWith('.tmp')) { res.writeHead(404).end('Not found'); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Cache-Control': rel === '/calendar.json' || rel === '/sw.js' ? 'no-store' : 'no-cache',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500).end(e.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});
server.listen(port, host, () => {
  log(`Meridian on http://${host === '0.0.0.0' ? '<this-computer-ip>' : 'localhost'}:${port}`);
  ageOfCalendar().then(a => { if (a > FRESH_MS) refresh(); });
});
