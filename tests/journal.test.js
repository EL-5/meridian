// Run: node tests/journal.test.js
// Expected values are worked out by hand in the comments, not produced by the code under test.
const J = require('../journal.js');
const FX = require('../logic.js');
let fails = 0;
const ok = (label, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + label + (cond && !extra ? '' : '  ' + (extra || ''))); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

let n = 0;
const T = (result, o = {}) => ({ id: 't' + (++n), pair: 'EUR/USD', dir: 'buy', openedAt: 1000 * n, closedAt: 1000 * n + 500, status: 'closed', result, ccy: 'USD', risk: null, ...o });

// ---- 1. a ten-trade set worked out by hand
// results:  +10 -5 +10 -5 -5 +20 -5 +10 0 -5
// wins 4 (10,10,20,10)  losses 5  break-even 1.  net = 25.  gross win 50, gross loss 25.
const set = [10, -5, 10, -5, -5, 20, -5, 10, 0, -5].map(r => T(r));
let s = J.stats(set);
ok('counts: 10 trades, 4 won, 5 lost, 1 break-even', s.n === 10 && s.wins === 4 && s.losses === 5 && s.breakeven === 1);
ok('win rate 40% (a break-even is not a win)', near(s.winRate, 0.4));
ok('net 25', near(s.net, 25));
ok('average win 12.5, average loss -5, payoff 2.5', near(s.avgWin, 12.5) && near(s.avgLoss, -5) && near(s.payoff, 2.5));
ok('profit factor 50 / 25 = 2', near(s.profitFactor, 2));
ok('expectancy 25 / 10 = 2.5 per trade', near(s.expectancy, 2.5));
// equity: 10 5 15 10 5 25 20 30 30 25. Peaks 10, 15, 25, 30. Largest fall: 15 -> 5 = 10
ok('max drawdown 10 (15 down to 5)', near(s.maxDrawdown, 10), s.maxDrawdown);
ok('equity curve ends at 25 with 10 points', s.curve.length === 10 && near(s.curve[9].equity, 25) && near(s.curve[0].equity, 10));
// + - + - - + - + 0 - : longest losing run is 2 (the 4th and 5th). A break-even ends a run.
ok('longest losing streak 2, longest winning streak 1', s.maxLoseRun === 2 && s.maxWinRun === 1, s.maxLoseRun + '/' + s.maxWinRun);
ok('sample label: 10 trades is "early"', s.label === 'early' && J.sampleLabel(9) === 'too few to judge' && J.sampleLabel(30) === 'more reliable');

// ---- 2. the confidence interval on a win rate (Wilson, 95%): 4 wins of 10 is 16.8% to 68.7%
const w = J.wilson(4, 10);
ok('Wilson 4/10 -> 16.8% to 68.7%', near(w.lo, 0.168, 0.002) && near(w.hi, 0.687, 0.002), w.lo.toFixed(4) + ' - ' + w.hi.toFixed(4));
const w2 = J.wilson(60, 100);
ok('Wilson 60/100 -> 50.2% to 69.1% (a bigger sample is tighter)', near(w2.lo, 0.502, 0.002) && near(w2.hi, 0.691, 0.002), w2.lo.toFixed(4) + ' - ' + w2.hi.toFixed(4));
ok('Wilson stays inside 0..1 at the extremes', J.wilson(0, 5).lo === 0 && J.wilson(5, 5).hi === 1 && J.wilson(0, 0) === null);

// ---- 3. R multiples: result divided by planned risk
const rSet = [T(20, { risk: 10 }), T(-10, { risk: 10 }), T(5, { risk: 10 }), T(7)];       // last one has no planned risk
s = J.stats(rSet);
// R: +2, -1, +0.5 -> mean 0.5, over 3 trades; the trade without a risk is left out of R only
ok('average R 0.5 over the 3 trades that have a planned risk', near(s.avgR, 0.5) && s.rN === 3 && s.n === 4);
ok('rOf ignores open trades and zero risk', J.rOf({ status: 'open', result: null, risk: 10 }) === null && J.rOf(T(5, { risk: 0 })) === null);

// ---- 4. open trades are never counted
s = J.stats([T(10), { ...T(0), status: 'open', result: null, closedAt: null }]);
ok('open trades are excluded from every statistic', s.n === 1 && near(s.net, 10));

// ---- 5. mixed currencies are not added together
s = J.stats([T(100, { ccy: 'USD' }), T(-40, { ccy: 'USD' }), T(999, { ccy: 'EUR' })]);
ok('money totals use the main currency only (USD 60), and say one trade was left out', s.ccy === 'USD' && near(s.net, 60) && s.otherCcy === 1 && s.n === 3);

// ---- 6. grouping
const gs = J.groupStats([T(10, { session: 'London' }), T(-5, { session: 'London' }), T(20, { session: 'Tokyo' }), T(5, { session: null })], t => t.session);
ok('groups by key, biggest first, skipping trades with no key', gs.length === 2 && gs[0].key === 'London' && gs[0].n === 2 && gs[1].key === 'Tokyo' && near(gs[0].net, 5));
ok('empty input gives no groups and no crash', J.groupStats([], t => t.pair).length === 0 && J.stats([]).n === 0 && J.stats([]).winRate === null);

// ---- 7. observations: only from groups big enough, always with the caveat
const many = (session, results) => results.map(r => T(r, { session, risk: 10 }));
const fewGroups = J.groupStats([...many('London', [10, 10, 10]), ...many('Tokyo', [-10, -10, -10])], t => t.session);
ok('groups under 10 trades produce no observation', J.observations(fewGroups, 'By session').length === 0);
const bigGroups = J.groupStats([...many('London', Array(12).fill(0).map((_, i) => i % 3 ? 10 : -10)), ...many('Tokyo', Array(12).fill(0).map((_, i) => i % 3 ? -10 : 10))], t => t.session);
const obs = J.observations(bigGroups, 'By session');
// London: 8 wins of +1R, 4 losses of -1R over 12 -> +0.33R. Tokyo: 4 wins, 8 losses -> -0.33R
ok('with two groups of 12: names best and worst, with R, and warns it is early', obs.length === 1 && /London has done best so far \(\+0\.33R per trade, 12 trades\)/.test(obs[0]) && /Tokyo worst \(-0\.33R per trade, 12 trades\)/.test(obs[0]) && /early/.test(obs[0]), obs[0]);
ok('one group alone gives no comparison', J.observations([bigGroups[0]], 'x').length === 0);

// ---- 8. CSV: safe for a spreadsheet, and numbers stay numbers
const csv = J.toCsv([T(-12.5, { notes: '=HYPERLINK("http://x")', setup: 'break, retest', pair: 'EUR/USD', session: 'London + New York overlap', risk: 10 }),
                     T(5, { notes: 'line one\nline two, with "quotes"', news: true })]);
const lines = csv.split('\r\n');
ok('header row has every column', lines[0] === J.COLS.join(',') && J.COLS.length === 21);
ok('a note starting with = is defused', csv.includes('"\'=HYPERLINK(""http://x"")"'), csv.split('\r\n')[1].slice(0, 200));
ok('commas and quotes are escaped and newlines kept inside quotes', csv.includes('"break, retest"') && csv.includes('"line one\nline two, with ""quotes"""'));
ok('a negative result stays a plain number, not text', /,-12\.5,USD,10,-1\.250,/.test(csv), lines[1]);
ok('news flag is yes / no / unknown', /,yes,/.test(csv) && /,unknown,/.test(csv));
const csvW = J.toCsv([T(1, { inWindow: true }), T(2, { inWindow: false }), T(3)]).split('\r\n');
ok('in-my-window column: yes / no / not set', csvW[1].includes(',yes,') && csvW[2].includes(',no,') && csvW[3].includes(',not set,'),
   csvW.slice(1, 4).map(l => l.split(',').slice(-3).join('|')).join('  '));
ok('the flag survives a backup restore, and junk becomes unknown', J.cleanTrade({ pair: 'EUR/USD', openedAt: 1, status: 'closed', result: 1, inWindow: false }).inWindow === false && J.cleanTrade({ pair: 'EUR/USD', openedAt: 1, status: 'closed', result: 1, inWindow: 'yes please' }).inWindow === null);
ok('cell() guards only text', J.cell('-5', false) === '-5' && J.cell('-5', true) === "'-5" && J.cell('+1', true) === "'+1" && J.cell('@x', true) === "'@x");

// ---- 9. restoring a backup: validate, skip duplicates, reject junk
const mine = [T(10, { id: 'keep-1' })];
const backup = { app: 'session-clock-journal', version: 1, trades: [
  { id: 'keep-1', pair: 'EUR/USD', dir: 'buy', openedAt: 5, closedAt: 9, status: 'closed', result: 3, ccy: 'USD' },   // duplicate id
  { id: 'new-1', pair: 'GBP/USD', dir: 'sell', openedAt: 6, closedAt: 8, status: 'closed', result: -2, ccy: 'USD', notes: 'ok' },
  { id: 'new-2', pair: 'EUR/USD', dir: 'buy', openedAt: 7, status: 'open' },
  { id: 'bad-1', pair: 'not a pair', openedAt: 1, status: 'closed', result: 1 },                                      // bad pair
  { id: 'bad-2', pair: 'EUR/USD', openedAt: 'x', status: 'closed', result: 1 },                                       // bad time
  { id: 'bad-3', pair: 'EUR/USD', openedAt: 1, status: 'closed' },                                                    // closed without a result
  null, 'text'] };
const m = J.mergeBackup(mine, backup, () => 'gen');
ok('restore: 2 added, 1 duplicate skipped, 5 rejected', m.added === 2 && m.skipped === 1 && m.rejected === 5 && m.trades.length === 3, JSON.stringify({ a: m.added, s: m.skipped, r: m.rejected }));
ok('restore: an open trade keeps no result', m.trades.find(t => t.id === 'new-2').result === null && m.trades.find(t => t.id === 'new-2').status === 'open');
ok('restore: rejects a file that is not a journal', J.mergeBackup([], { foo: 1 }, () => 'x').error && J.mergeBackup([], null, () => 'x').error);
ok('restore: script and oversized text is trimmed, not executed', (() => { const t = J.cleanTrade({ pair: 'EUR/USD', openedAt: 1, status: 'closed', result: 1, notes: 'x'.repeat(5000), setup: '<img onerror=1>' }); return t.notes.length === 2000 && t.setup === '<img onerror=1>'; })());

// ---- 10. reading a typed number
const num = FX.parseNum;
ok('parseSigned: signs, unicode minus, thousands', J.parseSigned('-12.50', num) === -12.5 && J.parseSigned('−5', num) === -5 && J.parseSigned('+3', num) === 3 && J.parseSigned('1,250.50', num) === 1250.5 && J.parseSigned('-1,000', num) === -1000);
ok('parseSigned: junk is NaN', isNaN(J.parseSigned('', num)) && isNaN(J.parseSigned('abc', num)) && isNaN(J.parseSigned('-', num)) && isNaN(J.parseSigned('--5', num)));

// ---- 11. news near the open
const cal = { events: [{ at: 1000000, impact: 'high', ccy: 'USD' }, { at: 5000000, impact: 'medium', ccy: 'EUR' }, { at: 9000000, impact: 'high', ccy: 'GBP' }] };
ok('news within 30 min for a currency in the pair: yes', J.newsNear(cal, 1000000 + 20 * 60000, 'EUR/USD') === true);
ok('news 31 min away: no', J.newsNear(cal, 1000000 + 31 * 60000, 'EUR/USD') === false);
ok('news for a currency not in the pair: no', J.newsNear(cal, 9000000, 'EUR/USD') === false);
ok('medium impact does not count', J.newsNear(cal, 5000000, 'EUR/USD') === false);
ok('outside what the calendar covers: unknown, not "no"', J.newsNear(cal, 50, 'EUR/USD') === null && J.newsNear(cal, 99999999, 'EUR/USD') === null && J.newsNear(null, 5, 'EUR/USD') === null);

// ---- 12. the session tag the journal records comes from the same logic as the headline
ok('session tag at 14:00 UTC on a normal Tuesday', FX.assess(Date.parse('2026-10-13T14:00:00Z')).tag === 'London + New York overlap');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
