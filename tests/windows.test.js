// Run: node tests/windows.test.js
// Expected instants are worked out by hand in the comments, not produced by the code under test.
const FX = require('../logic.js');
let fails = 0;
const ok = (label, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + label + (cond && !extra ? '' : '  ' + (extra || ''))); };
const Z = iso => Date.parse(iso);
const f = ms => ms == null ? 'none' : new Date(ms).toISOString().slice(5, 16).replace('T', ' ');
const UTC = 'Africa/Accra';                      // UTC+0, no daylight saving: local time equals UTC
const WD = [1, 2, 3, 4, 5], ALL = [0, 1, 2, 3, 4, 5, 6];
const morning = { id: 'a', name: 'Morning', days: WD, start: '07:00', end: '10:00' };

// ---- reading times and checking a window
ok('parseHM: valid', FX.parseHM('07:00').min === 420 && FX.parseHM('7:05').min === 425 && FX.parseHM('23:59').min === 1439 && FX.parseHM('00:00').min === 0);
ok('parseHM: invalid', ['24:00', '7', '07:60', 'ab:cd', '', null, '07:00:00'].every(x => FX.parseHM(x) === null));
ok('problems: a good window has none', FX.windowProblems(morning).length === 0);
ok('problems: no days, bad time, same times are all named', FX.windowProblems({ ...morning, days: [] }).some(p => /at least one day/.test(p)) &&
   FX.windowProblems({ ...morning, start: '25:00' }).some(p => /start time/.test(p)) && FX.windowProblems({ ...morning, end: 'x' }).some(p => /end time/.test(p)) &&
   FX.windowProblems({ ...morning, end: '07:00' }).some(p => /different/.test(p)));

// ---- a simple weekday window
let n = FX.windowNow([morning], Z('2026-10-13T08:30:00Z'), UTC);                 // Tuesday 08:30
ok('Tue 08:30: inside, 07:00 to 10:00, next is Wednesday 07:00', n.inside && f(n.inside.start) === '10-13 07:00' && f(n.inside.end) === '10-13 10:00' && f(n.next.start) === '10-14 07:00', f(n.inside && n.inside.start) + ' / ' + f(n.next && n.next.start));
n = FX.windowNow([morning], Z('2026-10-13T10:30:00Z'), UTC);
ok('Tue 10:30: outside, next is Wednesday 07:00', !n.inside && f(n.next.start) === '10-14 07:00');
ok('the end is exclusive (10:00 exactly is outside)', !FX.insideWindow([morning], Z('2026-10-13T10:00:00Z'), UTC) && FX.insideWindow([morning], Z('2026-10-13T07:00:00Z'), UTC) && FX.insideWindow([morning], Z('2026-10-13T09:59:00Z'), UTC));
n = FX.windowNow([morning], Z('2026-10-16T10:30:00Z'), UTC);                     // Friday after the window
ok('Friday after the window: next is Monday 07:00', f(n.next.start) === '10-19 07:00', f(n.next.start));
n = FX.windowNow([morning], Z('2026-10-17T08:00:00Z'), UTC);                     // Saturday
ok('Saturday 08:00: outside, next is Monday', !n.inside && f(n.next.start) === '10-19 07:00');

// ---- a window that crosses midnight belongs to the day it starts on
const night = { id: 'b', name: 'Night', days: WD, start: '22:00', end: '02:00' };
const inN = iso => FX.insideWindow([night], Z(iso), UTC);
ok('Tue 23:00 inside', inN('2026-10-13T23:00:00Z'));
ok('Wed 01:00 inside (it is Tuesday\'s window)', inN('2026-10-14T01:00:00Z'));
ok('Wed 02:00 outside (end is exclusive)', !inN('2026-10-14T02:00:00Z'));
ok('Sat 01:00 inside (Friday\'s window runs into Saturday)', inN('2026-10-17T01:00:00Z'));
ok('Sat 23:00 outside (Saturday is not a chosen day)', !inN('2026-10-17T23:00:00Z'));
ok('Sun 01:00 outside (Saturday did not start one)', !inN('2026-10-18T01:00:00Z'));
ok('Mon 01:00 outside (Sunday did not start one)', !inN('2026-10-12T01:00:00Z'));
n = FX.windowNow([night], Z('2026-10-14T01:00:00Z'), UTC);
ok('inside a midnight window: it began the day before', f(n.inside.start) === '10-13 22:00' && f(n.inside.end) === '10-14 02:00', f(n.inside.start) + ' -> ' + f(n.inside.end));

// ---- daylight saving: windows are wall-clock times, so the real length can change
const NY = 'America/New_York';
let sp = FX.windowSpans([{ id: 'c', days: ALL, start: '08:00', end: '10:00' }], Z('2026-10-30T00:00:00Z'), Z('2026-11-04T00:00:00Z'), NY);
// 8:00 New York is 12:00 UTC while summer time lasts and 13:00 UTC after the clocks go back on 1 Nov
ok('08:00 New York is 12:00 UTC before 1 Nov and 13:00 UTC after', sp.map(x => f(x.start)).join(' | ') === '10-30 12:00 | 10-31 12:00 | 11-01 13:00 | 11-02 13:00 | 11-03 13:00', sp.map(x => f(x.start)).join(' | '));
ok('every one of them is 2 hours long', sp.every(x => x.end - x.start === 2 * 3600000));
sp = FX.windowSpans([{ id: 'd', days: ALL, start: '23:00', end: '03:00' }], Z('2026-10-31T00:00:00Z'), Z('2026-11-01T12:00:00Z'), NY);
const dst = sp.find(x => f(x.start) === '11-01 03:00');
// starts 23:00 EDT on 31 Oct (= 03:00 UTC) and ends 03:00 EST on 1 Nov (= 08:00 UTC): five real hours, because an hour repeats
ok('a night window across the clocks going back is 5 real hours', dst && f(dst.end) === '11-01 08:00' && (dst.end - dst.start) === 5 * 3600000, dst && f(dst.start) + ' -> ' + f(dst.end));
sp = FX.windowSpans([{ id: 'e', days: ALL, start: '01:00', end: '04:00' }], Z('2026-03-07T00:00:00Z'), Z('2026-03-10T00:00:00Z'), NY);
const spring = sp.find(x => f(x.start) === '03-08 06:00');
// 8 Mar 2026: 01:00 EST is 06:00 UTC, and 04:00 EDT is 08:00 UTC: two real hours, because an hour is skipped
ok('a window across the clocks going forward is 2 real hours', spring && f(spring.end) === '03-08 08:00' && (spring.end - spring.start) === 2 * 3600000, spring && f(spring.start) + ' -> ' + f(spring.end));

// ---- days are the user's local days, not UTC days
const tokyo = 'Asia/Tokyo';
const tk = { id: 't', days: WD, start: '07:00', end: '09:00' };
ok('Tokyo: 22:30 UTC Monday is 07:30 Tuesday local: inside', FX.insideWindow([tk], Z('2026-10-12T22:30:00Z'), tokyo));
ok('Tokyo: 00:30 UTC Tuesday is 09:30 local: outside', !FX.insideWindow([tk], Z('2026-10-13T00:30:00Z'), tokyo));
ok('Tokyo: Saturday morning local is outside', !FX.insideWindow([tk], Z('2026-10-16T22:30:00Z'), tokyo));   // 07:30 Saturday in Tokyo

// ---- several windows, and bad data
const late = { id: 'l', name: 'Late', days: WD, start: '09:00', end: '12:00' };
n = FX.windowNow([morning, late], Z('2026-10-13T09:30:00Z'), UTC);
ok('overlapping windows: the one that ends last is reported', n.inside.w.id === 'l' && f(n.inside.end) === '10-13 12:00');
ok('no windows: nothing inside, nothing next', (r => r.inside === null && r.next === null)(FX.windowNow([], Z('2026-10-13T09:30:00Z'), UTC)) && FX.windowNow(null, 5, UTC).inside === null);
ok('unusable windows are skipped, not crashed on', FX.windowSpans([{ id: 'x', days: WD, start: '25:00', end: '10:00' }, { id: 'y', days: [], start: '07:00', end: '10:00' }, { id: 'z', days: WD, start: '07:00', end: '07:00' }], Z('2026-10-13T00:00:00Z'), Z('2026-10-20T00:00:00Z'), UTC).length === 0);
ok('a window is never counted twice', FX.windowSpans([morning], Z('2026-10-13T00:00:00Z'), Z('2026-10-20T00:00:00Z'), UTC).length === 5);   // Tue Wed Thu Fri Mon

// ---- what the market does during a window
let o = FX.windowOutlook({ w: morning, start: Z('2026-10-13T12:00:00Z'), end: Z('2026-10-13T16:00:00Z') }, null, null);
ok('12:00-16:00 on a normal summer Tuesday is all Peak, London and New York', o.minutes.peak === 240 && o.top === 'peak' && o.sessions.join() === 'London,New York' && o.busyMinutes === 240 && o.totalMinutes === 240, JSON.stringify(o.minutes) + ' ' + o.sessions.join());
ok('without a calendar, news is null (unknown), not an empty list', o.news === null);
const cal = { events: [{ at: Z('2026-10-13T13:30:00Z'), impact: 'high', ccy: 'USD', title: 'US retail sales', id: 'e1' }, { at: Z('2026-10-13T17:00:00Z'), impact: 'high', ccy: 'USD', title: 'later', id: 'e2' }] };
o = FX.windowOutlook({ w: morning, start: Z('2026-10-13T12:00:00Z'), end: Z('2026-10-13T16:00:00Z') }, cal, null);
ok('with a calendar, only news inside the window is listed', o.news.length === 1 && o.news[0].title === 'US retail sales');
o = FX.windowOutlook({ w: morning, start: Z('2026-10-13T06:00:00Z'), end: Z('2026-10-13T08:00:00Z') }, null, null);
// 06:00-07:00 only Tokyo is open (Sydney closes at 06:00 UTC): Steady. 07:00-08:00 Tokyo + London: Good.
ok('a window that crosses two conditions splits the minutes (60 steady, 60 good)', o.minutes.steady === 60 && o.minutes.good === 60 && o.busyMinutes === 60, JSON.stringify(o.minutes));
o = FX.windowOutlook({ w: morning, start: Z('2026-11-26T14:00:00Z'), end: Z('2026-11-26T16:00:00Z') }, null, null);
ok('US Thanksgiving: Good, not Peak, and the holiday is named', o.minutes.good === 120 && o.minutes.peak === 0 && o.holidays.some(h => /New York: Thanksgiving Day/.test(h)), JSON.stringify(o.minutes) + ' ' + o.holidays);
o = FX.windowOutlook({ w: morning, start: Z('2026-10-17T10:00:00Z'), end: Z('2026-10-17T12:00:00Z') }, null, null);
ok('a Saturday window is Closed', o.minutes.closed === 120 && o.top === 'closed');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
