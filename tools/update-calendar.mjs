// Refreshes calendar.json once and exits. Use it by hand, from a scheduled task, or from the GitHub Pages
// workflow (.github/workflows/pages.yml). Run: node tools/update-calendar.mjs
//
// On failure it keeps the previous calendar.json and exits with an error code, so a broken
// refresh is loud in a scheduled run rather than silently serving old data.
import { writeFile, rename } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fetchCalendar } from './calendar-lib.mjs';

const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'calendar.json');
try {
  const cal = await fetchCalendar();
  const tmp = target + '.tmp';
  await writeFile(tmp, JSON.stringify(cal));
  await rename(tmp, target);                                        // never leave a half-written file
  const high = cal.events.filter(e => e.impact === 'high').length;
  console.log(`calendar.json updated: ${cal.events.length} events, ${high} high impact.`);
} catch (e) {
  console.error('Calendar NOT updated: ' + e.message);
  process.exit(1);
}
