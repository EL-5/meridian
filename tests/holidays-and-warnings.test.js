const FX = require('../logic.js');
const d = iso => Date.parse(iso);
let fails = 0;
const ok = (label, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + label + (extra ? '  ' + extra : '')); };

// Weekday holidays per country for 2026, read back through the public API one calendar day at a time.
function list(cc, year) {
  const out = [];
  const tzOf = { US: 'America/New_York', GB: 'Europe/London', EU: 'Europe/Berlin', JP: 'Asia/Tokyo', AU: 'Australia/Sydney' }[cc];
  for (let t = d(year + '-01-01T12:00:00Z'); t < d((year + 1) + '-01-01T00:00:00Z'); t += 86400000) {
    const n = FX.holidayOn(cc, t);
    if (n) out.push(new Intl.DateTimeFormat('en-CA', { timeZone: tzOf }).format(t).slice(5) + ' ' + n);
  }
  return out;
}
const expect = {
  US: ['01-01', '01-19', '02-16', '05-25', '06-19', '07-03', '09-07', '10-12', '11-11', '11-26', '12-25'],
  GB: ['01-01', '04-03', '04-06', '05-04', '05-25', '08-31', '12-25', '12-28'],
  EU: ['01-01', '04-03', '04-06', '05-01', '12-25'],
  JP: ['01-01', '01-02', '01-12', '02-11', '02-23', '03-20', '04-29', '05-04', '05-05', '05-06', '07-20', '08-11', '09-21', '09-22', '09-23', '10-12', '11-03', '11-23', '12-31'],
  AU: ['01-01', '01-26', '04-03', '04-06', '06-08', '10-05', '12-25', '12-28'],
};
for (const cc of Object.keys(expect)) {
  const got = list(cc, 2026).map(x => x.slice(0, 5));
  const same = JSON.stringify(got) === JSON.stringify(expect[cc]);
  ok(cc + ' 2026 dates match', same, same ? '' : '\n   got      ' + got.join(' ') + '\n   expected ' + expect[cc].join(' '));
}
// 2027 spot checks: Thanksgiving, Easter Monday, Christmas on a Saturday, Japan Silver Week
ok('US 2027 Thanksgiving is 25 Nov', /Thanksgiving/.test(FX.holidayOn('US', d('2027-11-25T15:00:00Z')) || ''));
ok('GB 2027 Easter Monday is 29 Mar', FX.holidayOn('GB', d('2027-03-29T12:00:00Z')) === 'Easter Monday');
ok('GB 2027 Christmas Sat moves to Mon 27 and Boxing Day to Tue 28',
   /Christmas/.test(FX.holidayOn('GB', d('2027-12-27T12:00:00Z')) || '') && /Boxing/.test(FX.holidayOn('GB', d('2027-12-28T12:00:00Z')) || ''));
ok('Weekends never count', FX.holidayOn('EU', d('2026-12-26T12:00:00Z')) === null);

// ---- how the headline reacts
const A = iso => FX.assess(d(iso));
let a = A('2026-11-26T15:00:00Z');   // Thanksgiving, London + NY on the clock
ok('Thanksgiving is no longer "Busiest"', a.level === 'good' && /bank holiday \(Thanksgiving Day\)/.test(a.reason), a.label + ' | ' + a.reason);
ok('...and carries a holiday warning', a.notes.some(n => n.warn && /United States holiday today/.test(n.text)));
a = A('2026-12-25T12:00:00Z');       // Christmas: US, UK, EU all shut
ok('Christmas Day is capped at Quiet', a.level === 'quiet', a.label + ' | ' + a.tag);
a = A('2026-04-03T14:00:00Z');       // Good Friday: UK + EU shut, NY open
ok('Good Friday: London out, so New York alone', a.level === 'steady', a.label + ' | ' + a.reason);
a = A('2026-10-13T14:00:00Z');       // an ordinary Tuesday
ok('Ordinary day unchanged: Busiest', a.level === 'peak' && a.label === 'Busiest time' && !a.notes.some(n => /holiday/i.test(n.text)));

// ---- rollover, swap, week close, Sunday open
const notesAt = iso => A(iso).notes;
let n = notesAt('2026-10-06T20:35:00Z');          // Tue 16:35 New York (EDT)
ok('Tue 16:35 NY: rollover countdown', n.some(x => x.warn && /Rollover is at 5 pm New York.*in 25 min/.test(x.text)), n.map(x => x.text.slice(0, 60)).join(' / '));
n = notesAt('2026-10-06T20:58:00Z');
ok('Tue 16:58 NY: in the rollover window', n.some(x => x.warn && /Rollover window/.test(x.text)));
n = notesAt('2026-10-06T22:00:00Z');
ok('Tue 18:00 NY: no rollover warning', !n.some(x => /Rollover/.test(x.text)));
n = notesAt('2026-10-07T14:00:00Z');              // Wed 10:00 NY
ok('Wed morning: triple swap as information', n.some(x => !x.warn && /three days of swap/.test(x.text)));
n = notesAt('2026-10-07T19:00:00Z');              // Wed 15:00 NY
ok('Wed afternoon: triple swap as warning', n.some(x => x.warn && /three days of swap/.test(x.text)));
n = notesAt('2026-10-08T14:00:00Z');
ok('Thursday: no swap note', !n.some(x => /three days of swap/.test(x.text)));
n = notesAt('2026-10-02T18:30:00Z');              // Fri 14:30 NY, 6h29 before... closes 20:59Z
ok('Fri 14:30 NY: week closes soon warning', n.some(x => x.warn && /week closes in 2h 29m/.test(x.text)), n.map(x => x.text.slice(0, 50)).join(' / '));
n = notesAt('2026-10-02T14:00:00Z');              // Fri 10:00 NY
ok('Fri 10:00 NY: no weekend note yet', !n.some(x => /weekend/.test(x.text)));
n = notesAt('2026-10-02T17:00:00Z');              // Fri 13:00 NY: info
ok('Fri 13:00 NY: gentle weekend note', n.some(x => !x.warn && /Friday: many traders/.test(x.text)));
n = notesAt('2026-10-04T21:30:00Z');              // Sun 17:30 NY
ok('Sun 17:30 NY: just opened warning', n.some(x => x.warn && /week has just opened/.test(x.text)));
n = notesAt('2026-10-03T12:00:00Z');
ok('Saturday: no trading warnings at all', n.length === 0, n.map(x => x.text.slice(0, 40)).join(' / '));

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
