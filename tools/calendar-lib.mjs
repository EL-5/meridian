// Fetches the economic calendar and turns it into the small file the app reads (calendar.json).
//
// Why this exists: the public feed has no CORS header, so a browser page cannot call it directly, and
// it is rate limited, so it should be fetched once by a server and shared, not by every open tab.
// The feed is unofficial (it is the one behind the Forex Factory calendar). If it changes or goes away,
// the app says so and falls back to its fixed daily events; nothing else breaks.

const FEEDS = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  'https://nfs.faireconomy.media/ff_calendar_nextweek.json',   // often 404 until later in the week; that is fine
];
const IMPACT = { high: 'high', medium: 'medium', low: 'low', holiday: 'holiday' };

// The feed lists the currency in a field called "country". Normalise to our own shape.
export function normalize(rows) {
  const seen = new Set();
  const events = [];
  for (const r of rows) {
    const at = Date.parse(r.date);
    const impact = IMPACT[String(r.impact || '').toLowerCase()];
    if (!r.title || !Number.isFinite(at) || !impact) continue;       // skip rows we cannot trust
    const ccy = String(r.country || '').toUpperCase();
    const id = `${new Date(at).toISOString()}|${ccy}|${r.title}`;
    if (seen.has(id)) continue;
    seen.add(id);
    events.push({ id, title: String(r.title).trim(), ccy, impact, at: new Date(at).toISOString(),
                  forecast: String(r.forecast || ''), previous: String(r.previous || '') });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

// Returns { generatedAt, source, events }. Throws with a plain reason if it cannot get a usable calendar.
export async function fetchCalendar(fetchImpl = fetch) {
  const rows = [];
  let got = 0;
  for (const url of FEEDS) {
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'Meridian/1.0 (personal use)', Accept: 'application/json' } });
    if (res.status === 404) continue;                                // next week is not published yet
    if (!res.ok) throw new Error(`calendar feed answered HTTP ${res.status}`);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); }
    catch { throw new Error('calendar feed sent a web page instead of data, which usually means it is rate limiting this address'); }
    if (!Array.isArray(json)) throw new Error('calendar feed sent an unexpected shape');
    rows.push(...json); got++;
  }
  if (!got) throw new Error('no calendar feed was available');
  const events = normalize(rows);
  if (!events.length) throw new Error('calendar feed had no usable events');
  return { generatedAt: new Date().toISOString(), source: 'Forex Factory feed via faireconomy.media (unofficial)', events };
}
