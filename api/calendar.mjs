// Serves /calendar.json live (vercel.json rewrites that address here). Fetches the public feed on the server, which the
// browser cannot do itself, and lets the host's cache answer for 15 minutes, so the unofficial feed is asked at most
// about four times an hour however many people open the app. If the feed fails, the last good copy is served for up to
// a day (stale-while-revalidate) instead of an error, and a failure is a plain 503 the app understands.
import { fetchCalendar } from '../tools/calendar-lib.mjs';

export default async function handler(req, res) {
  try {
    const cal = await fetchCalendar();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=86400');
    res.status(200).send(JSON.stringify(cal));
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).json({ error: 'Calendar unavailable: ' + e.message });
  }
}
