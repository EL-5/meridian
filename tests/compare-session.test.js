// Run: node tests/compare-session.test.js
// The "busier or quieter than usual" comparison, on candles built so the right answer is known in advance.
// (An earlier version of this file only printed its results, so it could never fail. These are real assertions.)
const FX = require('../logic.js');
let fails = 0;
const ok = (label, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + label + (cond && !extra ? '' : '  ' + (extra || ''))); };
const lon = FX.SESSIONS.find(s => s.key === 'lon');
const now = Date.parse('2026-09-29T11:00:00Z');          // four hours into the London session
const MIN = 60000, Q = 15 * MIN;

// Each weekday's London window gets a known range (in pips), carried by its first candle.
function build(rangeFor, skipDays = []) {
  const cs = [];
  for (let d = 0; d < 22; d++) {
    const day = Date.parse('2026-09-08T00:00:00Z') + d * 86400000;
    const wd = new Date(day).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const key = new Date(day).toISOString().slice(0, 10);
    if (skipDays.includes(key)) continue;
    const start = day + 7 * 3600000;                      // London 08:00 BST = 07:00 UTC
    const r = rangeFor(key) * 0.0001;
    for (let t = start; t < start + 9 * 3600000 && t < now; t += Q) {
      const first = t === start;
      cs.push([t, 1.1, first ? 1.1 + r / 2 : 1.1 + 0.00001, first ? 1.1 - r / 2 : 1.1 - 0.00001, 1.1]);
    }
  }
  return cs;
}
const win = FX.lastWindow(lon, now);
const prior = FX.priorWindows(lon, win.start, 10);
const base = k => 30 + (+k.slice(8) % 7);                 // earlier days: 30 to 36 pips
ok('ten earlier London sessions are found (weekends skipped)', prior.length === 10 && prior[0].start < win.start);

let r = FX.compareSession(build(k => k === '2026-09-29' ? 90 : base(k)), win, now, prior, 15);
ok('today far bigger than all ten: larger than 10 of 10, "Busier than usual"', r.smaller === 10 && r.n === 10 && r.label === 'Busier than usual' && Math.round(r.current * 1e4) === 90 && r.ratio > 2, JSON.stringify({ s: r.smaller, l: r.label, ratio: r.ratio }));
r = FX.compareSession(build(k => k === '2026-09-29' ? 10 : base(k)), win, now, prior, 15);
ok('today far smaller than all ten: larger than 0 of 10, "Quieter than usual"', r.smaller === 0 && r.label === 'Quieter than usual');
r = FX.compareSession(build(k => k === '2026-09-29' ? 33 : base(k)), win, now, prior, 15);
ok('today in the middle: "About usual"', r.label === 'About usual' && r.smaller > 3 && r.smaller < 8, r.smaller + ' of ' + r.n);
r = FX.compareSession(build(k => k === '2026-09-29' ? 90 : 30, ['2026-09-24', '2026-09-23', '2026-09-22']), win, now, prior, 15);
ok('three days with no data are skipped, not counted as quiet: 7 comparable', r.n === 7 && r.label === 'Busier than usual', r.n);
ok('fewer than five comparable sessions refuses to answer', FX.compareSession(build(k => 30).filter(c => c[0] > Date.parse('2026-09-24T00:00:00Z')), win, now, prior, 15) === null);
ok('in the first 30 minutes it refuses to answer', FX.compareSession(build(k => 30), win, win.start + 10 * MIN, prior, 15) === null);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
