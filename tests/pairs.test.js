// Run: node tests/pairs.test.js
// Every expected score is worked out by hand from the formula in logic.js:
//   60 x share of window home markets are open + 15 if all open the whole time + cost points (major 25, gold 20, cross 15, exotic 5) - news (35 / 25 / 15)
const FX = require('../logic.js');
let fails = 0;
const ok = (label, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + label + (cond && !extra ? '' : '  ' + (extra || ''))); };
const Z = iso => Date.parse(iso);
const score = (o, p) => o.rows.find(r => r.pair === p).score;
const row = (o, p) => o.rows.find(r => r.pair === p);

ok('pair classes', FX.pairClass('EUR/USD') === 'Major' && FX.pairClass('USD/CAD') === 'Major' && FX.pairClass('XAU/USD') === 'Metal' && FX.pairClass('EUR/GBP') === 'Cross' && FX.pairClass('GBP/JPY') === 'Cross' && FX.pairClass('USD/MXN') === 'Exotic' && FX.pairClass('USD/ZAR') === 'Exotic');

// ---- Tue 13 Oct 2026, 12:00 UTC, two hours: London (to 16:00) and New York (from 12:00) are open the whole time; Tokyo and Sydney are shut
let o = FX.pairOutlook(Z('2026-10-13T12:00:00Z'), 2);
ok('EUR/USD: both home markets open throughout -> 60 + 15 + 25 = 100', score(o, 'EUR/USD') === 100 && row(o, 'EUR/USD').allTheTime);
ok('EUR/GBP: London is its only home and it is open -> 60 + 15 + 15 = 90', score(o, 'EUR/GBP') === 90);
ok('XAU/USD: gold -> 60 + 15 + 20 = 95', score(o, 'XAU/USD') === 95);
ok('USD/MXN: an exotic with New York open -> 60 + 15 + 5 = 80', score(o, 'USD/MXN') === 80);
ok('USD/JPY: Tokyo is shut, New York open, so half -> 30 + 25 = 55', score(o, 'USD/JPY') === 55 && near(row(o, 'USD/JPY').homeOpen, 0.5));
ok('GBP/JPY: London open, Tokyo shut -> 30 + 15 = 45', score(o, 'GBP/JPY') === 45);
// AUD's homes (Sydney, Tokyo) are shut but the US dollar side is open, so half: 30 + 25 = 55
ok('AUD/USD: the dollar side is open, the Australian side is not -> 30 + 25 = 55', score(o, 'AUD/USD') === 55 && near(row(o, 'AUD/USD').homeOpen, 0.5));
function near(a, b) { return Math.abs(a - b) < 1e-9; }
ok('ranked best first, ties broken by home markets then name', o.rows[0].pair === 'EUR/USD' && o.rows.every((r, i) => !i || o.rows[i - 1].score >= r.score) && !o.marketQuiet);
ok('every score is 0 to 100', o.rows.every(r => r.score >= 0 && r.score <= 100 && Number.isInteger(r.score)));

// ---- Asian hours (Tue 13 Oct 02:00 UTC, two hours): Sydney and Tokyo open, London and New York shut
o = FX.pairOutlook(Z('2026-10-13T02:00:00Z'), 2);
// AUD/JPY: AUD (Sydney, Tokyo) open, JPY (Tokyo) open -> 60 + 15 + 15 = 90.  USD/JPY: only the yen side -> 30 + 25 = 55.  EUR/USD: neither -> 25
ok('Asian hours: AUD/JPY and NZD/JPY lead (90), USD/JPY is 55, EUR/USD is 25', score(o, 'AUD/JPY') === 90 && score(o, 'NZD/JPY') === 90 && score(o, 'USD/JPY') === 55 && score(o, 'EUR/USD') === 25 && o.rows[0].score === 90, o.rows.slice(0, 4).map(r => r.pair + ' ' + r.score).join(', '));
ok('...and the top of the list is not a European pair', !/EUR|GBP|CHF/.test(o.rows[0].pair));

// ---- news
const ev = (iso, ccy, title, impact = 'high') => ({ at: Z(iso), ccy, title, impact, id: iso + ccy });
const cal = evs => ({ events: evs });
o = FX.pairOutlook(Z('2026-10-13T12:00:00Z'), 2, null, cal([ev('2026-10-13T12:20:00Z', 'USD', 'Retail Sales')]));
ok('USD news in 20 min: EUR/USD 100 - 35 = 65, EUR/GBP unaffected at 90, USD/JPY 55 - 35 = 20', score(o, 'EUR/USD') === 65 && score(o, 'EUR/GBP') === 90 && score(o, 'USD/JPY') === 20, [score(o, 'EUR/USD'), score(o, 'EUR/GBP'), score(o, 'USD/JPY')].join('/'));
ok('the reason names the event and the minutes', row(o, 'EUR/USD').reasons.some(r => /High-impact news in 20 min: USD Retail Sales/.test(r)) && row(o, 'EUR/USD').news.kind === 'soon');
o = FX.pairOutlook(Z('2026-10-13T12:00:00Z'), 2, null, cal([ev('2026-10-13T13:30:00Z', 'GBP', 'CPI')]));
ok('GBP news later in the window: GBP/USD 100 - 15 = 85, EUR/GBP 90 - 15 = 75', score(o, 'GBP/USD') === 85 && score(o, 'EUR/GBP') === 75 && row(o, 'GBP/USD').news.kind === 'later');
o = FX.pairOutlook(Z('2026-10-13T12:00:00Z'), 2, null, cal([ev('2026-10-13T11:50:00Z', 'USD', 'Jobs')]));
ok('USD news 10 minutes ago: EUR/USD 100 - 25 = 75, and it says prices can stay erratic', score(o, 'EUR/USD') === 75 && row(o, 'EUR/USD').reasons.some(r => /just came out.*erratic/.test(r)));
o = FX.pairOutlook(Z('2026-10-13T12:00:00Z'), 2, null, cal([ev('2026-10-13T12:10:00Z', 'USD', 'A'), ev('2026-10-13T11:45:00Z', 'USD', 'B'), ev('2026-10-13T13:00:00Z', 'USD', 'C')]));
ok('news soon, recent and later together: only the worst penalty (35) applies', score(o, 'EUR/USD') === 65);
o = FX.pairOutlook(Z('2026-10-13T12:00:00Z'), 2, null, cal([ev('2026-10-13T12:20:00Z', 'USD', 'Retail Sales', 'medium')]));
ok('medium-impact news is ignored', score(o, 'EUR/USD') === 100);
o = FX.pairOutlook(Z('2026-10-13T12:00:00Z'), 2, null, cal([ev('2026-10-13T12:20:00Z', 'USD', 'Retail Sales')]), ['EUR']);
ok('the user\'s currency filter is respected (EUR only: USD news does not count)', score(o, 'EUR/USD') === 100);
o = FX.pairOutlook(Z('2026-10-13T12:00:00Z'), 2, null, null);
ok('without a calendar, news is unknown, not "none"', o.newsKnown === false && row(o, 'EUR/USD').news === null);

// ---- a window that spans a session close: London shuts at 16:00 UTC in summer
o = FX.pairOutlook(Z('2026-10-13T15:00:00Z'), 2);
// EUR/GBP: London open for 4 of 8 steps -> 30 + 0 + 15 = 45.  EUR/USD: both open for 4 steps (1.0), New York only for 4 (0.5) -> avg 0.75 -> 45 + 25 = 70
ok('EUR/GBP loses London halfway: 30 + 15 = 45', score(o, 'EUR/GBP') === 45 && !row(o, 'EUR/GBP').allTheTime);
ok('EUR/USD is 75% covered: 45 + 25 = 70', score(o, 'EUR/USD') === 70 && near(row(o, 'EUR/USD').homeOpen, 0.75));

// ---- holidays and closed markets
o = FX.pairOutlook(Z('2026-11-26T15:00:00Z'), 2);              // US Thanksgiving: New York is shut, London open
ok('Thanksgiving: EUR/USD drops to half its homes (55) while EUR/GBP stays at 90', score(o, 'EUR/USD') === 55 && score(o, 'EUR/GBP') === 90);
o = FX.pairOutlook(Z('2026-10-17T12:00:00Z'), 2);              // Saturday
ok('Saturday: everything is quiet, and scores are the cost points alone (EUR/USD 25)', o.marketQuiet && score(o, 'EUR/USD') === 25 && o.rows.every(r => r.homeOpen === 0));
o = FX.pairOutlook(Z('2026-10-17T12:00:00Z'), 2, ['USD/MXN'], cal([ev('2026-10-17T12:10:00Z', 'USD', 'x')]));
ok('a score never goes below zero (5 - 35 -> 0)', score(o, 'USD/MXN') === 0);

// ---- choosing pairs and the horizon
o = FX.pairOutlook(Z('2026-10-13T12:00:00Z'), 2, ['GBP/USD', 'EUR/GBP']);
ok('only the pairs asked for are ranked', o.rows.length === 2 && o.rows[0].pair === 'GBP/USD');
const one = FX.pairOutlook(Z('2026-10-13T15:30:00Z'), 1), four = FX.pairOutlook(Z('2026-10-13T15:30:00Z'), 4);
ok('a longer horizon sees London close: EUR/GBP scores higher over 1 hour than over 4', score(one, 'EUR/GBP') > score(four, 'EUR/GBP'), score(one, 'EUR/GBP') + ' vs ' + score(four, 'EUR/GBP'));
ok('the window it covered is reported', four.hours === 4 && four.to - four.from === 4 * 3600000);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
