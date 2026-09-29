// Pure logic: no DOM, so it can be unit-tested in Node and reused by the page.
(function (g) {
  'use strict';

  // Each session is defined in its own city's clock. Intl handles daylight
  // saving, so nothing here needs editing twice a year.
  const SESSIONS = [
    { key: 'syd', name: 'Sydney', city: 'Sydney', tz: 'Australia/Sydney', from: 7, to: 16,
      about: 'The quietest session. Mostly Australian and New Zealand dollar pairs. Moves are small and spreads are wider.',
      pairs: ['AUD/USD', 'NZD/USD', 'AUD/NZD', 'AUD/JPY', 'NZD/JPY', 'AUD/CAD', 'AUD/CHF'],
      watch: ['AUD/USD', 'NZD/USD', 'AUD/JPY'] },
    { key: 'tyo', name: 'Tokyo', city: 'Tokyo', tz: 'Asia/Tokyo', from: 9, to: 18,
      about: 'Yen pairs lead. Moves are usually steady, and the range often sets up the breakout London makes.',
      pairs: ['USD/JPY', 'EUR/JPY', 'GBP/JPY', 'AUD/JPY', 'NZD/JPY', 'CHF/JPY', 'CAD/JPY', 'AUD/USD'],
      watch: ['USD/JPY', 'EUR/JPY', 'AUD/JPY'] },
    { key: 'lon', name: 'London', city: 'London', tz: 'Europe/London', from: 8, to: 17,
      about: 'The biggest session by volume. Euro and pound pairs move the most, and gold is active.',
      pairs: ['EUR/USD', 'GBP/USD', 'EUR/GBP', 'EUR/CHF', 'USD/CHF', 'EUR/JPY', 'GBP/JPY', 'EUR/AUD', 'XAU/USD'],
      watch: ['EUR/USD', 'GBP/USD', 'USD/CHF'] },
    { key: 'nyc', name: 'New York', city: 'New York', tz: 'America/New_York', from: 8, to: 17,
      about: 'US data and US dollar pairs. Strongest in its first four hours, while London is still open.',
      pairs: ['EUR/USD', 'GBP/USD', 'USD/CAD', 'USD/CHF', 'USD/JPY', 'USD/MXN', 'XAU/USD'],
      watch: ['EUR/USD', 'USD/CAD', 'USD/JPY'] },
  ];

  const MIN = 60000;
  const fmtCache = {};
  function parts(tz, ms) {
    const f = fmtCache[tz] || (fmtCache[tz] = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
    const o = {};
    for (const p of f.formatToParts(ms)) o[p.type] = p.value;
    return { wd: o.weekday, h: +o.hour, m: +o.minute };
  }

  function isOpen(s, ms) {
    const p = parts(s.tz, ms);
    if (p.wd === 'Sat' || p.wd === 'Sun') return false;
    return p.h >= s.from && p.h < s.to;
  }

  // Coarse 30-minute scan finds the next change, then a minute scan pins it down.
  function nextFlip(s, ms) {
    const start = Math.floor(ms / MIN) * MIN;
    const now = isOpen(s, start);
    let t = start;
    for (let i = 0; i < 8 * 48; i++) {
      t += 30 * MIN;
      if (isOpen(s, t) !== now) {
        for (let b = t - 30 * MIN; b <= t; b += MIN) if (isOpen(s, b) !== now) return b;
        return t;
      }
    }
    return null;
  }

  // The open window containing an instant that is known to be open.
  function windowAt(s, ms) {
    const at = Math.floor(ms / MIN) * MIN;
    let t = at, lo = at;
    for (let i = 0; i < 48; i++) {           // a session is at most a day long
      t -= 30 * MIN;
      if (!isOpen(s, t)) { lo = t; break; }
      lo = t;
    }
    let start = lo;
    while (!isOpen(s, start)) start += MIN;   // refine to the first open minute
    return { start, end: nextFlip(s, at) };
  }

  // The window that is open now, or the most recent one that finished.
  function lastWindow(s, ms) {
    let t = Math.floor(ms / MIN) * MIN;
    if (!isOpen(s, t)) {
      let found = false;
      for (let i = 0; i < 8 * 48; i++) {
        t -= 30 * MIN;
        if (isOpen(s, t)) { found = true; break; }
      }
      if (!found) return null;
    }
    return windowAt(s, t);
  }

  // The n windows before a given one, newest first.
  function priorWindows(s, beforeMs, n) {
    const out = [];
    let cursor = beforeMs - MIN;
    for (let i = 0; i < n; i++) {
      const w = lastWindow(s, cursor);
      if (!w) break;
      out.push(w);
      cursor = w.start - MIN;
    }
    return out;
  }

  // ---- market data ------------------------------------------------------

  // Twelve Data returns "YYYY-MM-DD HH:mm:ss" in the timezone we ask for (UTC).
  function parseCandles(values) {
    return values.map(v => [Date.parse(v.datetime.replace(' ', 'T') + 'Z'), +v.open, +v.high, +v.low, +v.close])
      .filter(c => c.every(Number.isFinite))
      .sort((a, b) => a[0] - b[0]);
  }
  function pipSize(symbol) { return symbol.includes('JPY') ? 0.01 : 0.0001; }

  // candles are [t, o, h, l, c]; a candle at t covers t .. t + 15 min.
  function stats(candles, win, nowMs) {
    const end = Math.min(win.end, nowMs);
    const sub = candles.filter(c => c[0] >= win.start && c[0] < end);
    if (!sub.length) return null;
    const hi = Math.max(...sub.map(c => c[2]));
    const lo = Math.min(...sub.map(c => c[3]));
    return { open: sub[0][1], close: sub[sub.length - 1][4], hi, lo, range: hi - lo,
             net: sub[sub.length - 1][4] - sub[0][1], count: sub.length };
  }

  // The high-low range of the first `elapsedMs` of a window, or null if the data has gaps there.
  function rangeSoFar(candles, win, elapsedMs, candleMin) {
    const to = Math.min(win.start + elapsedMs, win.end);
    const sub = candles.filter(c => c[0] >= win.start && c[0] < to);
    const expected = Math.floor((to - win.start) / (candleMin * MIN));
    if (!expected || sub.length < expected * 0.8) return null;   // a holiday or feed gap would skew the comparison
    return Math.max(...sub.map(c => c[2])) - Math.min(...sub.map(c => c[3]));
  }

  // Compare today's session with earlier ones at the same point in the session: the range in the
  // first N minutes now, against the range in the first N minutes of each earlier session.
  // No modelling: every number is a real range from real history.
  function compareSession(candles, win, nowMs, priorWins, candleMin) {
    const elapsed = Math.min(nowMs, win.end) - win.start;
    if (elapsed < 30 * MIN) return null;                        // too early in the session to say anything
    const current = rangeSoFar(candles, win, elapsed, candleMin);
    if (current === null) return null;
    const past = priorWins.map(w => rangeSoFar(candles, w, elapsed, candleMin)).filter(r => r !== null);
    if (past.length < 5) return null;                           // fewer than five comparable sessions is not evidence
    const smaller = past.filter(r => r < current).length;
    const sorted = past.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const share = smaller / past.length;
    return { current, median, ratio: median ? current / median : null, smaller, n: past.length, share,
             label: share >= 0.7 ? 'Busier than usual' : share <= 0.3 ? 'Quieter than usual' : 'About usual' };
  }

  // ---- the plain-language answer -----------------------------------------

  // What each level means in two vocabularies. `plain` is for someone new, `tech` for someone who trades.
  const LEVELS = {
    peak:   { begin: 'Busiest time', word: 'Peak',
      meaning: 'Most traders are active, so costs are at their lowest and prices move freely. Prices also move fast, so losses can come as quickly as wins. Busiest is not the same as safest.',
      plain: { busy: 'Very busy', cost: 'Lowest', move: 'A lot' }, tech: { liq: 'Highest', spr: 'Tightest', vol: 'High' } },
    good:   { begin: 'Busy', word: 'Good',
      meaning: 'Plenty of traders are active and costs are low. Look at the pairs listed below, and remember that a busy market can move fast.',
      plain: { busy: 'Busy', cost: 'Low', move: 'Moderate' }, tech: { liq: 'High', spr: 'Tight', vol: 'Medium' } },
    steady: { begin: 'Slower market', word: 'Steady',
      meaning: 'Fewer traders are active, so prices move less and small moves can stall. Costs are a little higher.',
      plain: { busy: 'Moderate', cost: 'Normal', move: 'Small' }, tech: { liq: 'Medium', spr: 'Normal', vol: 'Low to medium' } },
    quiet:  { begin: 'Quiet market', word: 'Quiet',
      meaning: 'Few traders are active. Costs are higher, and prices can either go nowhere or jump on little volume. Many traders wait for the next session.',
      plain: { busy: 'Quiet', cost: 'Higher', move: 'Small, can jump' }, tech: { liq: 'Low', spr: 'Wide', vol: 'Low' } },
    closed: { begin: 'Market closed', word: 'Closed',
      meaning: 'There is nothing to trade until the market reopens, and prices do not move. Use the time to plan.',
      plain: { busy: 'None', cost: '—', move: 'None' }, tech: { liq: '—', spr: '—', vol: '—' } },
  };

  function joinNames(names) {
    return names.length <= 1 ? names.join('') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  // ---- bank holidays -----------------------------------------------------
  // Computed from the rules each country uses, so there is no yearly list to keep up to date.
  // Covers the five markets that matter to a forex day. Other countries are not included.

  const pad2 = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => y + '-' + pad2(m) + '-' + pad2(d);                 // m is 1 to 12
  const utcDay = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
  const isoOf = dt => iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  const addDays = (dt, n) => new Date(dt.getTime() + n * 86400000);
  const dowOf = (y, m, d) => utcDay(y, m, d).getUTCDay();                     // 0 = Sunday
  const weekdayDate = dt => dt.getUTCDay() !== 0 && dt.getUTCDay() !== 6;

  // Day of month of the nth given weekday; n = -1 means the last one.
  function nthDow(y, m, wd, n) {
    if (n > 0) return 1 + ((wd - dowOf(y, m, 1) + 7) % 7) + (n - 1) * 7;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return last - ((dowOf(y, m, last) - wd + 7) % 7);
  }
  function easterSunday(y) {                                                  // Gregorian computus
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    return utcDay(y, Math.floor((h + l - 7 * m + 114) / 31), ((h + l - 7 * m + 114) % 31) + 1);
  }
  // Fixed-date holidays that move to the next free weekday when they fall on a weekend (UK, Australia).
  function withSubstitutes(h, list, y) {
    const taken = new Set(Object.keys(h));
    for (const [m, d, n] of list) if (weekdayDate(utcDay(y, m, d))) { h[iso(y, m, d)] = n; taken.add(iso(y, m, d)); }
    for (const [m, d, n] of list) {
      const dt = utcDay(y, m, d);
      if (weekdayDate(dt)) continue;
      let s = dt;
      do { s = addDays(s, 1); } while (!weekdayDate(s) || taken.has(isoOf(s)));
      h[isoOf(s)] = n + ' (substitute day)'; taken.add(isoOf(s));
    }
  }

  function usHolidays(y) {                       // Federal holidays. Saturday goes to Friday, Sunday to Monday.
    const h = {};
    const fixed = (m, d, n) => {
      const w = dowOf(y, m, d); let dt = utcDay(y, m, d), label = n;
      if (w === 6) { dt = addDays(dt, -1); label += ' (observed)'; } else if (w === 0) { dt = addDays(dt, 1); label += ' (observed)'; }
      h[isoOf(dt)] = label;
    };
    fixed(1, 1, "New Year's Day"); fixed(6, 19, 'Juneteenth'); fixed(7, 4, 'Independence Day');
    fixed(11, 11, 'Veterans Day'); fixed(12, 25, 'Christmas Day');
    h[iso(y, 1, nthDow(y, 1, 1, 3))] = 'Martin Luther King Jr. Day';
    h[iso(y, 2, nthDow(y, 2, 1, 3))] = "Presidents' Day";
    h[iso(y, 5, nthDow(y, 5, 1, -1))] = 'Memorial Day';
    h[iso(y, 9, nthDow(y, 9, 1, 1))] = 'Labor Day';
    h[iso(y, 10, nthDow(y, 10, 1, 2))] = 'Columbus Day';
    h[iso(y, 11, nthDow(y, 11, 4, 4))] = 'Thanksgiving Day';
    return h;
  }
  function gbHolidays(y) {                       // England and Wales
    const h = {}, E = easterSunday(y);
    h[isoOf(addDays(E, -2))] = 'Good Friday'; h[isoOf(addDays(E, 1))] = 'Easter Monday';
    h[iso(y, 5, nthDow(y, 5, 1, 1))] = 'Early May bank holiday';
    h[iso(y, 5, nthDow(y, 5, 1, -1))] = 'Spring bank holiday';
    h[iso(y, 8, nthDow(y, 8, 1, -1))] = 'Summer bank holiday';
    withSubstitutes(h, [[1, 1, "New Year's Day"], [12, 25, 'Christmas Day'], [12, 26, 'Boxing Day']], y);
    return h;
  }
  function euHolidays(y) {                       // TARGET, the euro payment system
    const h = {}, E = easterSunday(y);
    h[isoOf(addDays(E, -2))] = 'Good Friday'; h[isoOf(addDays(E, 1))] = 'Easter Monday';
    h[iso(y, 1, 1)] = "New Year's Day"; h[iso(y, 5, 1)] = 'Labour Day';
    h[iso(y, 12, 25)] = 'Christmas Day'; h[iso(y, 12, 26)] = 'Boxing Day';
    return h;
  }
  function jpHolidays(y) {
    const base = {}, h = {};
    const put = (m, d, n) => { base[iso(y, m, d)] = n; };
    const equinox = c => Math.floor(c + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));   // valid 1980 to 2099
    put(1, 1, "New Year's Day"); put(1, nthDow(y, 1, 1, 2), 'Coming of Age Day'); put(2, 11, 'National Foundation Day');
    put(2, 23, "Emperor's Birthday"); put(3, equinox(20.8431), 'Vernal Equinox Day'); put(4, 29, 'Showa Day');
    put(5, 3, 'Constitution Memorial Day'); put(5, 4, 'Greenery Day'); put(5, 5, "Children's Day");
    put(7, nthDow(y, 7, 1, 3), 'Marine Day'); put(8, 11, 'Mountain Day'); put(9, nthDow(y, 9, 1, 3), 'Respect for the Aged Day');
    put(9, equinox(23.2488), 'Autumnal Equinox Day'); put(10, nthDow(y, 10, 1, 2), 'Sports Day');
    put(11, 3, 'Culture Day'); put(11, 23, 'Labour Thanksgiving Day');
    Object.assign(h, base);
    for (const k of Object.keys(base).sort()) {                       // a Sunday holiday moves to the next free day
      const dt = new Date(k + 'T00:00:00Z');
      if (dt.getUTCDay() !== 0) continue;
      let s = addDays(dt, 1);
      while (h[isoOf(s)]) s = addDays(s, 1);
      h[isoOf(s)] = 'Substitute holiday';
    }
    for (const k of Object.keys(base)) {                              // a weekday between two holidays is one too
      const dt = new Date(k + 'T00:00:00Z'), mid = addDays(dt, 1);
      if (h[isoOf(addDays(dt, 2))] && !h[isoOf(mid)] && weekdayDate(mid)) h[isoOf(mid)] = "Citizens' Holiday";
    }
    h[iso(y, 12, 31)] = 'Year-end bank holiday'; h[iso(y, 1, 2)] = 'New Year bank holiday'; h[iso(y, 1, 3)] = 'New Year bank holiday';
    return h;
  }
  function auHolidays(y) {                       // New South Wales, where Sydney is
    const h = {}, E = easterSunday(y);
    h[isoOf(addDays(E, -2))] = 'Good Friday'; h[isoOf(addDays(E, 1))] = 'Easter Monday';
    h[iso(y, 4, 25)] = 'Anzac Day';
    h[iso(y, 6, nthDow(y, 6, 1, 2))] = "King's Birthday"; h[iso(y, 10, nthDow(y, 10, 1, 1))] = 'Labour Day';
    withSubstitutes(h, [[1, 1, "New Year's Day"], [1, 26, 'Australia Day'], [12, 25, 'Christmas Day'], [12, 26, 'Boxing Day']], y);
    return h;
  }

  const BUILD = { US: usHolidays, GB: gbHolidays, EU: euHolidays, JP: jpHolidays, AU: auHolidays };
  const COUNTRY_TZ = { US: 'America/New_York', GB: 'Europe/London', EU: 'Europe/Berlin', JP: 'Asia/Tokyo', AU: 'Australia/Sydney' };
  const COUNTRY_NAME = { US: 'United States', GB: 'United Kingdom', EU: 'Euro area', JP: 'Japan', AU: 'Australia' };
  const SESSION_COUNTRY = { syd: 'AU', tyo: 'JP', lon: 'GB', nyc: 'US' };
  const HOLIDAY_EFFECT = {
    US: 'US banks are closed, so dollar pairs trade thin.',
    GB: 'UK banks are closed, so London liquidity is thin, especially for pound pairs.',
    EU: 'Euro-area markets are closed, so euro pairs trade thin.',
    JP: 'Japanese banks are closed, so yen pairs trade thin in Asia.',
    AU: 'Australian banks are closed, so Sydney trading is thin.',
  };
  const holidayCache = {};
  function holidayMap(cc, y) {
    const k = cc + y;
    return holidayCache[k] || (holidayCache[k] = Object.assign({}, BUILD[cc](y - 1), BUILD[cc](y), BUILD[cc](y + 1)));
  }
  const ymdFmt = {};
  function localYmd(tz, ms) {
    const f = ymdFmt[tz] || (ymdFmt[tz] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }));
    return f.format(ms);
  }
  // The holiday name if it is a weekday holiday on that country's calendar day, else null.
  function holidayOn(cc, ms) {
    const tz = COUNTRY_TZ[cc], d = localYmd(tz, ms);
    const wd = parts(tz, ms).wd;
    if (wd === 'Sat' || wd === 'Sun') return null;
    return holidayMap(cc, +d.slice(0, 4))[d] || null;
  }
  const holidayName = (sessionKey, ms) => holidayOn(SESSION_COUNTRY[sessionKey], ms);

  // Weekday holidays in the next `days` days, soonest first.
  function upcomingHolidays(ms, days) {
    const seen = new Set(), out = [];
    for (let i = 0; i <= days; i++) for (const cc of Object.keys(BUILD)) {
      const t = ms + i * 86400000, tz = COUNTRY_TZ[cc], d = localYmd(tz, t);
      const wd = parts(tz, t).wd, name = holidayMap(cc, +d.slice(0, 4))[d];
      if (!name || wd === 'Sat' || wd === 'Sun' || seen.has(cc + d)) continue;
      seen.add(cc + d); out.push({ cc, country: COUNTRY_NAME[cc], date: d, name, today: i === 0 });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  // ---- economic calendar --------------------------------------------------

  const IMPACT_RANK = { holiday: 0, low: 1, medium: 2, high: 3 };
  const MAJOR_CCY = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF'];

  // Validate a calendar file (the shape tools/calendar-lib.mjs writes). Returns null if it is not usable.
  function parseCalendar(json) {
    if (!json || !Array.isArray(json.events)) return null;
    const events = json.events.map(e => ({
      id: String(e.id || ''), title: String(e.title || '').trim(), ccy: String(e.ccy || '').toUpperCase(),
      impact: IMPACT_RANK[e.impact] !== undefined ? e.impact : 'low', at: Date.parse(e.at),
      forecast: String(e.forecast || ''), previous: String(e.previous || ''),
    })).filter(e => e.title && Number.isFinite(e.at)).sort((a, b) => a.at - b.at);
    const gen = Date.parse(json.generatedAt);
    return { events, generatedAt: Number.isFinite(gen) ? gen : null, source: String(json.source || '') };
  }

  // Events between two instants. impact: 'high' | 'medium' | 'all'. ccys: array of currency codes or null for all.
  function newsBetween(cal, from, to, impact, ccys) {
    const min = impact === 'all' ? 0 : impact === 'medium' ? 2 : 3;
    return cal.events.filter(e => e.at >= from && e.at <= to && IMPACT_RANK[e.impact] >= min &&
      (!ccys || ccys.includes(e.ccy) || e.ccy === 'ALL'));
  }

  // A plain-English line for the events beginners meet most, and the glossary term to link to.
  const EVENT_HELP = [
    [/\bADP\b/i, 'A private-sector jobs estimate that comes out two days before the official US jobs report.', null],
    [/non-?farm/i, 'The US jobs report. One of the biggest movers of the dollar and gold.', 'nfp-non-farm-payrolls'],
    [/\b(core )?(cpi|pce|inflation)\b/i, 'Inflation: how fast prices are rising. It shapes interest-rate expectations.', 'cpi-inflation'],
    [/(cash|official|interest|policy|refinancing|bank) rate|rate (decision|statement)|monetary policy (statement|meeting|summary)|fomc/i,
      'A central bank\'s interest-rate news. Often the biggest mover for that currency.', 'interest-rate-decision'],
    [/speaks|press conference|testif|minutes/i, 'A central bank official is speaking, or a meeting record is out. Their tone can move prices even with no new data.', 'hawkish-and-dovish'],
    [/\bgdp\b/i, 'GDP measures the size of the economy. A big surprise can move the currency.', null],
    [/unemployment|employment change|jobless|claims|payroll|earnings/i, 'Jobs data. Strong jobs usually support a currency.', null],
    [/retail sales/i, 'Retail sales show how much people are spending.', null],
    [/pmi|ism|manufacturing|services/i, 'A survey of business activity. Above 50 usually means growth.', null],
    [/trade balance|current account/i, 'How much a country sells abroad compared with what it buys.', null],
  ];
  function eventHelp(title) {
    for (const [re, plain, id] of EVENT_HELP) if (re.test(title)) return { plain, id };
    return null;
  }

  const RANK = { closed: 0, quiet: 1, steady: 2, good: 3, peak: 4 };
  const hmLocal = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function dur(ms) {
    const m = Math.max(1, Math.round(ms / 60000));
    return m >= 60 ? Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm' : m + ' min';
  }

  function assess(ms, cal, ccys) {
    const open = SESSIONS.filter(s => isOpen(s, ms)).map(s => s.key);
    // A session that is open on the clock but on a bank holiday is not really trading.
    const hol = {};
    open.forEach(k => { const n = holidayName(k, ms); if (n) hol[k] = n; });
    const live = open.filter(k => !hol[k]);
    const has = k => live.includes(k);
    const names = SESSIONS.filter(s => has(s.key)).map(s => s.name);
    const ny = parts('America/New_York', ms);
    const notes = [];
    const note = (text, warn) => notes.push({ text, warn: !!warn });
    let level, reason, tag;

    if (!open.length) {
      const weekend = ny.wd === 'Sat' || ny.wd === 'Sun' || (ny.wd === 'Fri' && ny.h >= 17);
      level = weekend ? 'closed' : 'quiet';
      reason = weekend ? 'The market is shut for the weekend.' : 'No major session is open right now.';
      tag = weekend ? 'Weekend' : 'Between sessions';
    } else if (!live.length) {
      level = 'quiet'; tag = 'Bank holiday';
      reason = joinNames(open.map(k => SESSIONS.find(s => s.key === k).name)) + (open.length > 1 ? ' are' : ' is') + ' on a bank holiday.';
    } else if (has('lon') && has('nyc')) { level = 'peak'; tag = 'London + New York overlap'; }
    else if (has('tyo') && has('lon'))   { level = 'good'; tag = 'Tokyo + London overlap'; }
    else if (has('lon'))                 { level = 'good'; tag = 'London session'; }
    else if (has('nyc'))                 { level = 'steady'; tag = 'New York only, London closed'; }
    else if (has('tyo'))                 { level = 'steady'; tag = names.length > 1 ? 'Sydney + Tokyo overlap' : 'Tokyo session'; }
    else                                 { level = 'quiet'; tag = 'Sydney only'; }
    if (live.length) {
      reason = joinNames(names) + (names.length > 1 ? ' are' : ' is') + ' open.';
      Object.keys(hol).forEach(k => {
        reason += ' ' + SESSIONS.find(s => s.key === k).name + ' is on a bank holiday (' + hol[k] + ').';
      });
    }

    // When the US, UK and euro area are all shut (Christmas, New Year) nothing is really busy.
    const thin = holidayOn('US', ms) && holidayOn('GB', ms) && holidayOn('EU', ms);
    if (thin && RANK[level] > RANK.quiet) { level = 'quiet'; tag = 'US, UK and euro-area holidays'; }

    // ---- warnings, most urgent first
    for (const cc of ['US', 'GB', 'EU', 'JP', 'AU']) {
      const n = holidayOn(cc, ms);
      if (n) note(COUNTRY_NAME[cc] + ' holiday today (' + n + '). ' + HOLIDAY_EFFECT[cc] + ' Some brokers change their hours on holidays, so check yours.', true);
    }
    const t = ny.h * 60 + ny.m;
    const weekday = !['Sat', 'Sun'].includes(ny.wd);
    const rollAt = hmLocal.format(zonedInstant('America/New_York', ms, 17, 0));
    if (['Mon', 'Tue', 'Wed', 'Thu'].includes(ny.wd) && t >= 16 * 60 + 30 && t < 17 * 60 + 20) {
      note(t < 16 * 60 + 55
        ? 'Rollover is at 5 pm New York (' + rollAt + ' your time), in ' + dur((17 * 60 - t) * 60000) + '. Spreads can widen sharply from about 16:55 to 17:15 New York time. Many traders avoid new entries then.'
        : 'Rollover window. Spreads can widen sharply until about 17:15 New York time. Many traders avoid new entries now.', true);
    }
    if (ny.wd === 'Wed') {
      note('Wednesday: most brokers charge three days of swap on forex positions still open at the 5 pm New York rollover (' + rollAt + ' your time). Check your broker\'s swap table before holding overnight.',
        t >= 14 * 60 && t < 17 * 60 + 20);
    }
    const wk = marketWeek(ms);
    if (wk.openNow && wk.nextClose - ms <= 3 * 3600000) {
      note('The forex week closes in ' + dur(wk.nextClose - ms) + '. A position held over the weekend can gap when the market reopens on Sunday.', true);
    } else if (ny.wd === 'Fri' && t >= 12 * 60 && t < 17 * 60) {
      note('Friday: many traders close positions before the weekend, and volume fades in the afternoon.', false);
    }
    if (ny.wd === 'Sun' && t >= 17 * 60 + 5 && t < 18 * 60 + 20) {
      note('The week has just opened. Spreads are wide and prices can gap for the first hour.', true);
    }
    // Real news when there is a calendar. Without one, the old fixed guess for US data.
    const newsCcys = new Set();
    if (cal) {
      const soon = newsBetween(cal, ms, ms + 60 * 60000, 'high', ccys);
      const recent = newsBetween(cal, ms - 30 * 60000, ms - 1, 'high', ccys);
      const label = e => e.ccy + ' ' + e.title;
      const list = (evs, first) => evs.slice(0, 2).map(label).join(', ') + (evs.length > 2 ? ' and ' + (evs.length - 2) + ' more' : '');
      if (recent.length) {
        recent.forEach(e => newsCcys.add(e.ccy));
        note('Just released ' + dur(ms - recent[recent.length - 1].at) + ' ago: ' + list(recent) + '. Spreads and prices can stay erratic for about 30 minutes after a release.', true);
      }
      if (soon.length) {
        soon.forEach(e => newsCcys.add(e.ccy));
        const first = soon[0];
        note('High-impact news in ' + dur(first.at - ms) + ': ' + list(soon) + '. Spreads widen and price can jump. Pairs with ' +
          [...new Set(soon.map(e => e.ccy))].join(' or ') + ' are the most exposed.', first.at - ms <= 30 * 60000);
      }
    } else if (weekday && t >= 8 * 60 + 15 && t <= 8 * 60 + 50) {
      note('US data usually lands at 08:30 New York time. Check an economic calendar: on a release day, spreads widen and price can jump.', false);
    }

    // When nothing is open, which session opens next (used in the headline sentence).
    let nextOpen = null;
    if (!open.length) SESSIONS.forEach(s => { const at = nextFlip(s, ms); if (at && (!nextOpen || at < nextOpen.at)) nextOpen = { s, at }; });
    const L = LEVELS[level];
    return { open, live, holidays: hol, level, tag, reason, notes, nextOpen, newsCcys: [...newsCcys],
             label: L.begin, word: L.word, meaning: L.meaning, plain: L.plain, tech: L.tech };
  }

  // ---- overlap window ---------------------------------------------------

  // The window when both sessions are open: the current one, or the next.
  function overlapWindow(ms, ka, kb) {
    const a = SESSIONS.find(s => s.key === ka), b = SESSIONS.find(s => s.key === kb);
    const both = t => isOpen(a, t) && isOpen(b, t);
    const now = Math.floor(ms / MIN) * MIN;
    let start = now;
    if (both(now)) {
      let lo = now;
      for (let i = 0; i < 48; i++) { lo -= 30 * MIN; if (!both(lo)) break; }
      start = lo; while (!both(start)) start += MIN;
    } else {
      let t = now, found = false;
      for (let i = 0; i < 4 * 48; i++) { t += 30 * MIN; if (both(t)) { found = true; break; } }
      if (!found) return null;
      start = t;
      for (let m = t - 30 * MIN; m <= t; m += MIN) if (both(m)) { start = m; break; }
    }
    let e = start;
    for (let i = 0; i < 48; i++) { e += 30 * MIN; if (!both(e)) break; }
    let end = e;
    for (let m = e - 30 * MIN; m <= e; m += MIN) if (!both(m)) { end = m; break; }
    return { start, end, active: start <= now && now < end };
  }

  // Offset of a zone from UTC at an instant, in ms.
  const offCache = {};
  function tzOffset(tz, ms) {
    const f = offCache[tz] || (offCache[tz] = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    const o = {};
    for (const p of f.formatToParts(ms)) o[p.type] = p.value;
    return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second) - Math.floor(ms / 1000) * 1000;
  }
  // The instant when it is h:m on the calendar day (in tz) that contains ms.
  function zonedInstant(tz, ms, h, m) {
    const [y, mo, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(ms).split('-').map(Number);
    const guess = Date.UTC(y, mo - 1, d, h, m);
    let t = guess - tzOffset(tz, guess);
    t = guess - tzOffset(tz, t);          // second pass settles the daylight-saving edge
    return t;
  }

  // The forex week as Exness publishes it: open Sunday 21:05 GMT and close Friday 20:59 GMT in
  // northern summer, an hour later in winter. Both are pinned to New York time (17:05 and 16:59).
  function marketWeek(ms) {
    const NY = 'America/New_York';
    let nextOpen = null, nextClose = null;
    for (let d = -1; d <= 8; d++) {
      const day = ms + d * 86400000;
      const o = zonedInstant(NY, day, 17, 5), c = zonedInstant(NY, day, 16, 59);
      if (o > ms && parts(NY, o).wd === 'Sun' && (!nextOpen || o < nextOpen)) nextOpen = o;
      if (c > ms && parts(NY, c).wd === 'Fri' && (!nextClose || c < nextClose)) nextClose = c;
    }
    return { nextOpen, nextClose, openNow: nextClose < nextOpen };
  }

  // ---- position size ------------------------------------------------------
  // How many lots to trade so that one stop-loss costs only the amount you chose to risk.
  // Every step is in the returned `working` list, so the page can show its arithmetic.

  // Accepts "1,000", "1 000.50", "0,5" and "1.5". A lone comma is a thousands separator only when it
  // splits three-digit groups; otherwise it is a decimal comma. Returns NaN for anything else.
  function parseNum(text) {
    let s = String(text == null ? '' : text).trim().replace(/\s/g, '');
    if (!s) return NaN;
    if (s.includes(',') && s.includes('.')) s = s.replace(/,/g, '');
    else if (s.includes(',')) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    return /^\d*\.?\d+$|^\d+\.$/.test(s) ? Number(s) : NaN;
  }

  // Contract size and pip definition for a symbol. Gold has no agreed "pip", so its distances are dollars per ounce.
  function instrumentFor(sym, goldContract) {
    const [base, quote] = sym.split('/');
    if (base === 'XAU') return { sym, base, quote, contract: goldContract > 0 ? goldContract : 100, pip: 1, dp: 2, gold: true };
    const jpy = quote === 'JPY';
    return { sym, base, quote, contract: 100000, pip: jpy ? 0.01 : 0.0001, dp: jpy ? 3 : 5, gold: false };
  }
  const stepDecimals = step => (String(step).split('.')[1] || '').length;

  // in: { sym, balance, ccy, riskPct, stop, spread, entry, tp, rate, minLot, lotStep, leverage, dir, goldContract }
  // `stop`, `spread` and `tp` are pips (dollars for gold). `rate` is how many account-currency units one
  // quote-currency unit is worth. Returns { ok:false, errors, needRate } or { ok:true, ... }.
  function positionSize(inp) {
    const inst = instrumentFor(inp.sym, inp.goldContract);
    const errors = [];
    const ccy = String(inp.ccy || '').toUpperCase();
    if (!(inp.balance > 0)) errors.push('balance');
    if (!/^[A-Z]{3}$/.test(ccy)) errors.push('ccy');
    if (!(inp.riskPct > 0 && inp.riskPct <= 100)) errors.push('risk');
    if (!(inp.stop > 0)) errors.push('stop');
    if (inp.entry !== undefined && !(inp.entry > 0)) errors.push('entry');
    if (inp.tp !== undefined && !(inp.tp > 0)) errors.push('tp');
    if (inp.spread !== undefined && !(inp.spread >= 0)) errors.push('spread');
    if (errors.length) return { ok: false, errors, inst };

    // How much is one unit of the quote currency worth in the account currency?
    let q2a, q2aHow;
    if (inst.quote === ccy) { q2a = 1; q2aHow = inst.quote + ' is your account currency'; }
    else if (inst.base === ccy && inp.entry > 0) { q2a = 1 / inp.entry; q2aHow = '1 ÷ entry price, because ' + ccy + ' is the base currency of ' + inst.sym; }
    else if (inp.rate > 0) { q2a = inp.rate; q2aHow = 'the rate you entered: 1 ' + inst.quote + ' = ' + inp.rate + ' ' + ccy; }
    else return { ok: false, errors: ['rate'], needRate: { from: inst.quote, to: ccy }, inst };

    const spread = inp.spread || 0;
    const pipValue = inst.contract * inst.pip * q2a;             // money per pip, per 1 lot
    const effStop = inp.stop + spread;                           // a stop is hit at a price the spread has already moved
    const riskBudget = inp.balance * inp.riskPct / 100;
    const raw = riskBudget / (effStop * pipValue);
    const step = inp.lotStep > 0 ? inp.lotStep : 0.01;
    const minLot = inp.minLot > 0 ? inp.minLot : step;
    const dec = stepDecimals(step);
    const lots = Number((Math.floor(raw / step + 1e-9) * step).toFixed(dec));   // always round DOWN: never risk more than planned
    const tooSmall = lots < minLot - 1e-12;
    const size = tooSmall ? 0 : lots;
    const minLotRisk = minLot * effStop * pipValue;

    const risk = size * effStop * pipValue;
    const units = size * inst.contract;
    const tpNet = inp.tp > 0 ? inp.tp - spread : null;           // the target is reached at a price the spread has moved against
    const reward = tpNet !== null ? size * tpNet * pipValue : null;
    const rr = tpNet !== null ? tpNet / effStop : null;

    let margin = null;
    if (inp.entry > 0 && inp.leverage > 0) margin = units * inp.entry * q2a / inp.leverage;

    let stopPrice = null, tpPrice = null;
    if (inp.entry > 0 && (inp.dir === 'buy' || inp.dir === 'sell')) {
      const sign = inp.dir === 'buy' ? 1 : -1;
      stopPrice = inp.entry - sign * inp.stop * inst.pip;
      if (inp.tp > 0) tpPrice = inp.entry + sign * inp.tp * inst.pip;
    }

    const warnings = [];
    const w = (text, warn) => warnings.push({ text, warn: !!warn });
    if (tooSmall) w('Your risk budget of ' + riskBudget.toFixed(2) + ' ' + ccy + ' is too small for the minimum lot size. The smallest trade (' + minLot + ' lots) would risk ' +
      minLotRisk.toFixed(2) + ' ' + ccy + ', which is ' + (minLotRisk / inp.balance * 100).toFixed(2) + '% of your account. Tighten the stop, raise the risk, or skip this trade.', true);
    if (inp.riskPct > 5) w('Risking more than 5% on one trade is very aggressive. A short losing streak can remove a large part of the account.', true);
    else if (inp.riskPct > 2) w('Many traders keep risk at 1 to 2 percent per trade.', false);
    if (margin !== null && margin > inp.balance * 0.5) w('This trade would use ' + (margin / inp.balance * 100).toFixed(0) + '% of your balance as margin. Little room is left if price moves against you.', true);
    if (spread > 0 && spread > inp.stop * 0.2) w('The spread is ' + (spread / inp.stop * 100).toFixed(0) + '% of your stop distance, so a fifth or more of your risk is cost, not market movement.', true);
    if (!tooSmall && size > 0 && risk < riskBudget * 0.8) w('Rounded down to the lot step, so you risk ' + risk.toFixed(2) + ' ' + ccy + ', less than the ' + riskBudget.toFixed(2) + ' ' + ccy + ' planned.', false);
    if (rr !== null && rr < 1) w('The reward is smaller than the risk. You would need to win more than half your trades just to break even.', false);
    if (tpNet !== null && tpNet <= 0) w('The target is no bigger than the spread, so even a winning trade cannot make money.', true);

    return { ok: true, inst, ccy, q2a, pipValue, effStop, riskBudget, raw, lots: size, minLot, step, tooSmall, minLotRisk,
             risk, riskPct: risk / inp.balance * 100, units, reward, rr, margin, stopPrice, tpPrice, warnings,
             working: { q2aHow, pipValueQuote: inst.contract * inst.pip, spread } };
  }

  // ---- my trading windows -------------------------------------------------
  // A window is the hours you have chosen to trade: { id, name, days: [0..6], start: 'HH:MM', end: 'HH:MM' }
  // in your own clock (days: 0 = Sunday). A window whose end is earlier than its start crosses midnight and
  // belongs to the day it starts on. Times are wall-clock times, so they stay put when daylight saving moves.

  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function parseHM(s) {
    const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(s == null ? '' : s).trim());
    return m ? { h: +m[1], m: +m[2], min: +m[1] * 60 + +m[2] } : null;
  }
  // Plain reasons a window cannot be used; an empty list means it is fine.
  function windowProblems(w) {
    const out = [];
    if (!Array.isArray(w.days) || !w.days.length || w.days.some(d => !(d >= 0 && d <= 6))) out.push('Choose at least one day.');
    const a = parseHM(w.start), b = parseHM(w.end);
    if (!a) out.push('Enter a start time such as 07:00.');
    if (!b) out.push('Enter an end time such as 10:00.');
    if (a && b && a.min === b.min) out.push('The start and end times must be different.');
    return out;
  }

  // Every occurrence of the windows that overlaps [from, to], soonest first. `tz` is an IANA zone (the device's by default).
  function windowSpans(windows, from, to, tz) {
    const zone = tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const out = [], seen = new Set();
    const noon0 = zonedInstant(zone, from, 12, 0);              // anchor each day at local noon so daylight saving cannot skip or repeat a date
    const days = Math.ceil((to - from) / 86400000) + 3;
    for (const w of windows) {
      const a = parseHM(w.start), b = parseHM(w.end);
      if (!a || !b || a.min === b.min || !Array.isArray(w.days) || !w.days.length) continue;
      const cross = b.min < a.min;
      for (let d = -2; d <= days; d++) {
        const start = zonedInstant(zone, noon0 + d * 86400000, a.h, a.m);
        if (!w.days.includes(DOW[parts(zone, start).wd])) continue;
        const end = zonedInstant(zone, cross ? start + 86400000 : start, b.h, b.m);
        const key = (w.id || w.name) + '|' + start;
        if (end > from && start < to && !seen.has(key)) { seen.add(key); out.push({ w, start, end }); }
      }
    }
    return out.sort((x, y) => x.start - y.start);
  }

  // Are you inside a window now, and when is the next one? With overlapping windows, the one that ends last counts.
  function windowNow(windows, ms, tz) {
    if (!windows || !windows.length) return { inside: null, next: null };
    const spans = windowSpans(windows, ms - 36 * 3600000, ms + 9 * 86400000, tz);
    const inside = spans.filter(s => s.start <= ms && ms < s.end).sort((a, b) => b.end - a.end)[0] || null;
    const next = spans.find(s => s.start > ms) || null;
    return { inside, next };
  }
  const insideWindow = (windows, ms, tz) => !!windowNow(windows, ms, tz).inside;

  // What the market is scheduled to do during one occurrence of a window: minutes at each level, the sessions
  // involved, any bank holidays and high-impact news. Sampled every 15 minutes with the same logic as the headline.
  function windowOutlook(span, cal, ccys) {
    const step = 15 * MIN, minutes = { peak: 0, good: 0, steady: 0, quiet: 0, closed: 0 };
    const sessions = new Set(), holidays = new Set();
    for (let t = span.start; t < span.end; t += step) {
      const mid = Math.min(t + step / 2, span.end - 1);
      const a = assess(mid, cal, ccys);
      minutes[a.level] += Math.min(step, span.end - t) / MIN;
      a.live.forEach(k => sessions.add(k));
      Object.keys(a.holidays).forEach(k => holidays.add(SESSIONS.find(s => s.key === k).name + ': ' + a.holidays[k]));
    }
    const top = Object.keys(minutes).sort((x, y) => minutes[y] - minutes[x])[0];
    const news = cal ? newsBetween(cal, span.start, span.end, 'high', ccys) : null;      // null means "no calendar", not "no news"
    return { minutes, top, sessions: SESSIONS.filter(s => sessions.has(s.key)).map(s => s.name), holidays: [...holidays], news,
             busyMinutes: minutes.peak + minutes.good, totalMinutes: (span.end - span.start) / MIN };
  }

  // ---- which pairs have the best conditions in the next few hours ---------------------------------
  // A transparent score, not a prediction. It says where trading is likely to be busy, cheap and free of
  // surprises, using only things the app already knows: which home markets are open (holidays included),
  // the pair's usual cost class, and high-impact news. It never says which way price will go.
  // A pair trades best when BOTH of its currencies have their home market open, so each currency has home
  // sessions (USD: New York, EUR/GBP/CHF: London, JPY: Tokyo, AUD/NZD: Sydney and Tokyo, gold: London and New York).
  //   score = 60 x average of (base currency home open, quote currency home open) over the window
  //         + 15 if both are open the whole time
  //         + cost points (major 25, gold 20, cross 15, exotic 5)
  //         - news: 35 if high-impact news for either currency lands in the first 30 minutes,
  //                 25 if it came out in the last 30 minutes, 15 if it lands later in the window
  const MAJOR_PAIRS = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'USD/CAD', 'AUD/USD', 'NZD/USD'];
  function pairClass(p) {
    if (MAJOR_PAIRS.includes(p)) return 'Major';
    if (p.startsWith('XAU/')) return 'Metal';
    return /\/(MXN|ZAR|TRY|PLN|HUF|CZK|SEK|NOK)$/.test(p) ? 'Exotic' : 'Cross';
  }
  const COST_POINTS = { Major: 25, Metal: 20, Cross: 15, Exotic: 5 };
  const CCY_HOMES = { USD: ['nyc'], CAD: ['nyc'], MXN: ['nyc'], EUR: ['lon'], GBP: ['lon'], CHF: ['lon'], SEK: ['lon'], NOK: ['lon'], PLN: ['lon'], HUF: ['lon'], CZK: ['lon'], TRY: ['lon'], ZAR: ['lon'],
                      JPY: ['tyo'], AUD: ['syd', 'tyo'], NZD: ['syd', 'tyo'], XAU: ['lon', 'nyc'] };
  const homesOf = c => CCY_HOMES[c] || ['lon'];

  // pairs: the pairs to rank (defaults to every pair the sessions list). cal/ccys: the calendar and the user's currency filter.
  function pairOutlook(ms, hours, pairs, cal, ccys) {
    const step = 15 * MIN, end = ms + hours * 3600000, steps = [];
    for (let t = ms; t < end; t += step) steps.push(Math.min(t + step / 2, end - 1));
    const liveAt = steps.map(t => SESSIONS.filter(s => isOpen(s, t) && !holidayName(s.key, t)).map(s => s.key));
    const list = pairs && pairs.length ? pairs : [...new Set(SESSIONS.flatMap(s => s.pairs))];
    const soon = cal ? newsBetween(cal, ms, ms + 30 * MIN, 'high', ccys) : [];
    const later = cal ? newsBetween(cal, ms + 30 * MIN, end, 'high', ccys) : [];
    const recent = cal ? newsBetween(cal, ms - 30 * MIN, ms - 1, 'high', ccys) : [];
    let anyOpen = false;

    const rows = list.map(pair => {
      const ccysOf = pair.split('/');
      const homes = [...new Set(ccysOf.flatMap(homesOf))];
      const open2 = live => ccysOf.map(c => homesOf(c).some(k => live.includes(k)) ? 1 : 0);   // [base open, quote open]
      const frac = liveAt.reduce((a, live) => a + open2(live).reduce((x, y) => x + y, 0) / 2, 0) / steps.length;
      const allTheTime = liveAt.every(live => open2(live).every(v => v === 1));
      if (frac > 0) anyOpen = true;
      const hit = evs => evs.filter(e => ccysOf.includes(e.ccy) || e.ccy === 'ALL');
      const nSoon = hit(soon), nLater = hit(later), nRecent = hit(recent);
      const cls = pairClass(pair);
      const newsAdj = nSoon.length ? -35 : nRecent.length ? -25 : nLater.length ? -15 : 0;
      const score = Math.max(0, Math.min(100, Math.round(60 * frac + (allTheTime ? 15 : 0) + COST_POINTS[cls] + newsAdj)));
      const reasons = [];
      reasons.push(allTheTime ? "Both currencies' home markets are open for the whole window"
        : frac >= 0.5 ? "Its currencies' home markets are open about " + Math.round(frac * 100) + '% of the time, counting both'
        : frac > 0 ? "Its currencies' home markets are open only about " + Math.round(frac * 100) + '% of the time, counting both' : 'Neither currency has its home market open');
      reasons.push(cls === 'Major' ? 'Major pair, usually the lowest cost' : cls === 'Metal' ? 'Gold, with big moves and a higher cost than the majors'
        : cls === 'Cross' ? 'Cross pair, wider spreads than the majors' : 'Exotic pair, high cost and prices can jump');
      const news = nSoon.length ? { kind: 'soon', events: nSoon } : nRecent.length ? { kind: 'recent', events: nRecent } : nLater.length ? { kind: 'later', events: nLater } : null;
      if (news) {
        const e = news.events[0], label = e.ccy + ' ' + e.title;
        reasons.push(news.kind === 'soon' ? 'High-impact news in ' + Math.max(1, Math.round((e.at - ms) / MIN)) + ' min: ' + label
          : news.kind === 'recent' ? 'High-impact news just came out: ' + label + ', so prices can stay erratic'
          : 'High-impact news later in the window: ' + label);
      }
      return { pair, score, homeOpen: frac, allTheTime, cls, news, reasons, homes };
    });
    rows.sort((a, b) => b.score - a.score || b.homeOpen - a.homeOpen || a.pair.localeCompare(b.pair));
    return { rows, marketQuiet: !anyOpen || Math.max(...rows.map(r => r.homeOpen)) < 0.15, hours, from: ms, to: end, newsKnown: !!cal };
  }

  function hms(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    const p = n => String(n).padStart(2, '0');
    return (d ? d + 'd ' : '') + p(h) + ':' + p(m) + ':' + p(sec);
  }

  g.FX = { SESSIONS, parts, isOpen, nextFlip, lastWindow, priorWindows,
           parseCandles, pipSize, stats, compareSession, assess, hms,
           overlapWindow, marketWeek, LEVELS,
           holidayName, holidayOn, upcomingHolidays,
           parseCalendar, newsBetween, eventHelp, MAJOR_CCY,
           parseNum, instrumentFor, positionSize,
           parseHM, windowProblems, windowSpans, windowNow, insideWindow, windowOutlook,
           pairClass, pairOutlook };
  if (typeof module !== 'undefined') module.exports = g.FX;
})(typeof window !== 'undefined' ? window : globalThis);
