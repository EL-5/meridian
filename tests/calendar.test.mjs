// Run: node tests/calendar.test.mjs
// Uses a synthetic week built to have exactly the shape of the real feed (title, country, date with offset, impact,
// forecast, previous), so it checks parsing, filters and warnings without storing anyone else's data in this repository.
import { createRequire } from 'node:module';
import { normalize, fetchCalendar } from '../tools/calendar-lib.mjs';
const require = createRequire(import.meta.url);
const FX = require('../logic.js');

const row = (title, country, date, impact, forecast = '', previous = '') => ({ title, country, date, impact, forecast, previous });
const DAYS = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];
const rows = [
  row('Cash Rate', 'AUD', '2026-09-29T00:30:00-04:00', 'High', '4.60%', '4.35%'),
  row('RBA Rate Statement', 'AUD', '2026-09-29T00:30:00-04:00', 'High'),
  row('CPI m/m', 'AUD', '2026-09-29T21:30:00-04:00', 'High', '0.5%', '1.0%'),
  row('CPI y/y', 'AUD', '2026-09-29T21:30:00-04:00', 'High', '4.1%', '3.5%'),
  row('Trimmed Mean CPI m/m', 'AUD', '2026-09-29T21:30:00-04:00', 'High', '0.3%', '0.5%'),
  row('Core PCE Price Index m/m', 'USD', '2026-09-30T08:30:00-04:00', 'High', '0.3%', '0.2%'),
  row('Final GDP q/q', 'USD', '2026-09-30T08:30:00-04:00', 'High', '1.5%', '1.5%'),
  row('Average Hourly Earnings m/m', 'USD', '2026-10-02T08:30:00-04:00', 'High', '0.3%', '0.3%'),
  row('Non-Farm Employment Change', 'USD', '2026-10-02T08:30:00-04:00', 'High', '90K', '162K'),
  row('Unemployment Rate', 'USD', '2026-10-02T08:30:00-04:00', 'High', '4.1%', '4.1%'),
  ...Array.from({ length: 19 }, (_, i) => row('Medium event ' + (i + 1), ['USD', 'EUR', 'GBP', 'JPY'][i % 4], DAYS[i % 5] + 'T' + String(3 + (i % 8)).padStart(2, '0') + ':15:00-04:00', 'Medium', '1.0%', '0.9%')),
  ...Array.from({ length: 108 }, (_, i) => row('Low event ' + (i + 1), ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'][i % 8], DAYS[i % 5] + 'T' + String(1 + (i % 18)).padStart(2, '0') + ':' + (i % 2 ? '45' : '05') + ':00-04:00', 'Low')),
  row('Bank Holiday', 'CAD', '2026-10-01T00:00:00-04:00', 'Holiday'),
  row('Bank Holiday', 'CNY', '2026-10-01T00:00:00-04:00', 'Holiday'),
  row('Golden Week', 'CNY', '2026-10-02T00:00:00-04:00', 'Holiday'),
  row('Daylight Saving Time Shift', 'AUD', '2026-10-03T12:00:00-04:00', 'Holiday'),
];

let fails = 0;
const ok = (label, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? '  ' + extra : '')); };
const T = iso => Date.parse(iso);

// ---- normalising the feed
const events = normalize(rows);
ok('every row of the week is kept', events.length === rows.length, events.length + ' of ' + rows.length);
ok('sorted by time', events.every((e, i) => !i || events[i - 1].at <= e.at));
const nfp = events.find(e => e.title === 'Non-Farm Employment Change');
ok('NFP is high impact, USD, 08:30 New York = 12:30 UTC', nfp && nfp.impact === 'high' && nfp.ccy === 'USD' && nfp.at === '2026-10-02T12:30:00.000Z', JSON.stringify(nfp));
ok('forecast and previous carried through', nfp && nfp.forecast === '90K' && nfp.previous === '162K');
ok('bad rows are dropped, not guessed at', normalize([{ title: 'x', date: 'not a date', impact: 'High' }, { title: '', date: rows[0].date, impact: 'High' }, { title: 'y', date: rows[0].date, impact: 'Weird' }]).length === 0);
ok('exact duplicates are merged', normalize([rows[0], rows[0]]).length === 1);

// ---- reading the file in the app
const cal = FX.parseCalendar({ generatedAt: '2026-09-29T11:00:00Z', source: 'test', events });
ok('parseCalendar accepts a normalised file', cal && cal.events.length === events.length && cal.generatedAt === T('2026-09-29T11:00:00Z'));
ok('parseCalendar rejects junk', FX.parseCalendar(null) === null && FX.parseCalendar({}) === null && FX.parseCalendar({ events: 'no' }) === null);

// ---- filtering
const wk = [T('2026-09-27T00:00:00Z'), T('2026-10-04T00:00:00Z')];
const high = FX.newsBetween(cal, ...wk, 'high', null), med = FX.newsBetween(cal, ...wk, 'medium', null), all = FX.newsBetween(cal, ...wk, 'all', null);
ok('impact filter widens: high < high+medium < all', high.length === 10 && med.length === 29 && all.length === 141, high.length + '/' + med.length + '/' + all.length);
ok('high never includes medium or low', high.every(e => e.impact === 'high'));
ok('currency filter', FX.newsBetween(cal, ...wk, 'high', ['USD']).every(e => e.ccy === 'USD') && FX.newsBetween(cal, ...wk, 'high', ['USD']).length === 5);

// ---- what the headline says around the release (NFP is 12:30 UTC on Fri 2 Oct)
const at = (iso, ccys) => FX.assess(T(iso), cal, ccys);
let n = at('2026-10-02T12:00:00Z').notes.filter(x => /High-impact news/.test(x.text));
ok('30 min before NFP: a warning that names it', n.length === 1 && n[0].warn && /in 30 min: USD Average Hourly Earnings m\/m, USD Non-Farm Employment Change and 1 more/.test(n[0].text), n[0] && n[0].text.slice(0, 120));
n = at('2026-10-02T11:45:00Z').notes.filter(x => /High-impact news/.test(x.text));
ok('45 min before: information, not yet a warning', n.length === 1 && !n[0].warn);
ok('90 min before: nothing yet', at('2026-10-02T11:00:00Z').notes.every(x => !/High-impact news/.test(x.text)));
n = at('2026-10-02T12:45:00Z').notes.filter(x => /Just released/.test(x.text));
ok('15 min after: "just released" warning', n.length === 1 && n[0].warn && /15 min ago/.test(n[0].text));
ok('35 min after: quiet again', at('2026-10-02T13:05:00Z').notes.every(x => !/Just released|High-impact news/.test(x.text)));
ok('currency filter silences other currencies', at('2026-10-02T12:00:00Z', ['EUR']).notes.every(x => !/High-impact news/.test(x.text)));
ok('exposed currencies are reported for tagging pairs', at('2026-10-02T12:00:00Z').newsCcys.join() === 'USD', at('2026-10-02T12:00:00Z').newsCcys.join());
ok('with a calendar the vague 08:30 guess is gone', at('2026-10-07T12:25:00Z').notes.every(x => !/usually lands/.test(x.text)));
ok('without a calendar the guess is still there', FX.assess(T('2026-10-07T12:25:00Z')).notes.some(x => /usually lands/.test(x.text)));

// ---- plain-English help
ok('NFP help links to the glossary term', FX.eventHelp('Non-Farm Employment Change').id === 'nfp-non-farm-payrolls');
ok('ADP is not mistaken for the official report', /private-sector/.test(FX.eventHelp('ADP Non-Farm Employment Change').plain));
ok('CPI recognised', FX.eventHelp('CPI m/m').id === 'cpi-inflation');
ok('rate decision recognised', FX.eventHelp('Cash Rate').id === 'interest-rate-decision' && FX.eventHelp('BOJ Monetary Policy Statement').id === 'interest-rate-decision');
ok('unknown events get no invented explanation', FX.eventHelp('Some Obscure Auction') === null);

// ---- the fetch, with a fake network
const res = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => body });
try { await fetchCalendar(async u => res(200, '<html>slow down</html>')); ok('a web page instead of data is refused', false); }
catch (e) { ok('a web page instead of data is refused, with a plain reason', /rate limiting/.test(e.message), e.message); }
try { await fetchCalendar(async () => res(404, 'nope')); ok('all feeds missing is an error', false); }
catch (e) { ok('all feeds missing is an error', /no calendar feed/.test(e.message)); }
try { await fetchCalendar(async () => res(500, 'x')); ok('HTTP 500 is an error', false); }
catch (e) { ok('HTTP 500 is an error', /HTTP 500/.test(e.message)); }
const got = await fetchCalendar(async u => /thisweek/.test(u) ? res(200, JSON.stringify(rows)) : res(404, 'not yet'));
ok('next week missing is fine', got.events.length === rows.length && /unofficial/.test(got.source));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
