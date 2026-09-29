(function () {
  'use strict';
  const { SESSIONS, parts, isOpen, nextFlip, lastWindow, priorWindows, parseCandles,
          pipSize, stats, compareSession, assess, hms, overlapWindow, marketWeek, holidayName, upcomingHolidays, parseCalendar, newsBetween, eventHelp, MAJOR_CCY, parseNum, instrumentFor, positionSize, windowNow, windowSpans, windowOutlook, windowProblems, insideWindow, pairOutlook } = window.FX;
  const GLOSSARY = window.GLOSSARY, GCATS = window.GLOSSARY_CATS, GLEVELS = window.GLOSSARY_LEVELS;

  const app = document.getElementById('app');
  // Look up by selector inside #app, not document: the app can move into a floating window.
  const $ = sel => app.querySelector(sel);

  // ---- settings ------------------------------------------------------------

  const DEFAULTS = {
    level: 'beginner',       // 'beginner' | 'experienced'
    sound: false, notify: false, headsUp: 0,
    alerts: { syd: true, tyo: true, lon: true, nyc: true },
    broker: 'exness',        // 'exness' pins chart time to UTC+0; 'other' uses chartOffset
    chartOffset: 'device',   // 'device' or minutes east of UTC, used when broker is 'other'
    apiKey: '', selected: null, compact: false, firstDismissed: false,
    newsImpact: 'high',      // 'high' | 'medium' | 'all'
    newsCcy: null,           // null = every major currency, or an array of codes
    newsLead: 10,            // minutes of warning before high-impact news; 0 = off
    calUrl: 'calendar.json',
    myPairs: [], pairsView: 'all', pairsHours: 2, pairsOpen: true,
    windows: [],             // my trading windows: [{ id, name, days, start, end }] in my own clock
    winLead: 10,             // minutes of warning before a window starts; 0 = off
  };
  let S;
  try { S = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('fx-settings') || '{}') }; }
  catch (e) { S = { ...DEFAULTS }; }
  S.alerts = { ...DEFAULTS.alerts, ...S.alerts };
  if (S.level !== 'experienced') S.level = 'beginner';
  // One-off tidy-up after removing the levels/killzones feature and the duplicate pairs list. The Best pairs card is now the
  // only pairs list, so it starts open, and the settings and cached data of the removed feature are dropped.
  if (!S.pairsMigrated) S.pairsOpen = true;
  S.pairsMigrated = true;
  ['killzones', 'kzAlert', 'levelsPair', 'levelsOpen'].forEach(k => delete S[k]);
  try { Object.keys(localStorage).filter(k => k.startsWith('fx-lv-')).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  function save() { try { localStorage.setItem('fx-settings', JSON.stringify(S)); } catch (e) {} }
  const beginner = () => S.level === 'beginner';

  // ---- formatting ----------------------------------------------------------

  const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const dayName = new Intl.DateTimeFormat('en-GB', { weekday: 'long' });
  const hmDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const pad = n => String(n).padStart(2, '0');
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function offsetLabel(min) {
    const sign = min < 0 ? '-' : '+', a = Math.abs(min);
    return 'UTC' + sign + pad(Math.floor(a / 60)) + (a % 60 ? ':' + pad(a % 60) : '');
  }
  // Minutes east of UTC that the user's chart shows, or 'device'.
  const chartOff = () => S.broker === 'exness' ? 0 : S.chartOffset;
  // Null when the chart clock is the same as the device's, so the same time is never printed twice.
  function chartTime(ms) {
    const off = chartOff();
    if (off === 'device' || off === -new Date(ms).getTimezoneOffset()) return null;
    const d = new Date(ms + off * 60000);
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }
  // "12:00" or "12:00 (chart 14:00)"
  function both(ms) { const c = chartTime(ms); return hm.format(ms) + (c ? ' (chart ' + c + ')' : ''); }
  function span(ms) { const m = Math.round(ms / 60000); return Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm'; }
  // Only touch the DOM when the content changed, so screen readers are not re-read every second.
  function setHTML(el, html) { if (el.__h !== html) { el.__h = html; el.innerHTML = html; } }
  const fewer = () => app.classList.contains('compact');

  // Underline the first mention of a technical word so a beginner can tap it for a plain meaning.
  const TERM_IDS = { spread: 'spread', spreads: 'spread', pip: 'pip', pips: 'pip', liquidity: 'liquidity',
    volatility: 'volatility', volatile: 'volatility', overlap: 'overlap', overlaps: 'overlap',
    breakout: 'breakout', breakouts: 'breakout', 'safe haven': 'safe-haven',
    rollover: 'swap-rollover', 'triple swap': 'swap-rollover', 'bank holiday': 'bank-holiday', 'bank holidays': 'bank-holiday' };
  const TERM_RE = /\b(spreads?|pips?|liquidity|volatility|volatile|overlaps?|breakouts?|safe haven|rollover|triple swap|bank holidays?)\b/gi;
  function rich(text) {
    const h = esc(text);
    if (!beginner() || fewer()) return h;
    const used = new Set();
    return h.replace(TERM_RE, m => {
      const id = TERM_IDS[m.toLowerCase()];
      if (used.has(id)) return m;
      used.add(id);
      return `<button type="button" class="term" data-t="${id}">${m}</button>`;
    });
  }

  // The full name of each pair.
  const PAIRS = {
    'EUR/USD': 'Euro / US dollar',
    'GBP/USD': 'British pound / US dollar',
    'USD/JPY': 'US dollar / Japanese yen',
    'USD/CHF': 'US dollar / Swiss franc',
    'USD/CAD': 'US dollar / Canadian dollar',
    'AUD/USD': 'Australian dollar / US dollar',
    'NZD/USD': 'New Zealand dollar / US dollar',
    'EUR/GBP': 'Euro / British pound',
    'EUR/JPY': 'Euro / Japanese yen',
    'GBP/JPY': 'British pound / Japanese yen',
    'EUR/CHF': 'Euro / Swiss franc',
    'AUD/JPY': 'Australian dollar / Japanese yen',
    'NZD/JPY': 'New Zealand dollar / Japanese yen',
    'CHF/JPY': 'Swiss franc / Japanese yen',
    'CAD/JPY': 'Canadian dollar / Japanese yen',
    'AUD/NZD': 'Australian dollar / New Zealand dollar',
    'AUD/CAD': 'Australian dollar / Canadian dollar',
    'AUD/CHF': 'Australian dollar / Swiss franc',
    'EUR/AUD': 'Euro / Australian dollar',
    'USD/MXN': 'US dollar / Mexican peso',
    'XAU/USD': 'Gold / US dollar',
  };

  // ---- static DOM ----------------------------------------------------------

  $('#zone').textContent = 'Your time zone: ' + userTz;
  $('#sessions').innerHTML = SESSIONS.map(s => `
    <button type="button" class="srow" data-k="${s.key}" aria-pressed="false">
      <span class="nm">${s.name}<small class="lc"></small></span>
      <span class="st"></span>
      <span class="win"></span>
      <span class="ct"></span>
    </button>`).join('');
  $('#rows').innerHTML = SESSIONS.map(s =>
    `<div class="trow"><span class="n">${s.name}</span><div class="tbar" data-k="${s.key}">${'<i></i>'.repeat(48)}</div></div>`).join('') +
    `<div class="trow mine" hidden><span class="n">My window</span><div class="tbar" data-k="mine">${'<i></i>'.repeat(48)}</div></div>`;
  $('#ticks').innerHTML = [0, 3, 6, 9, 12, 15, 18, 21].map(h => `<span>${pad(h)}:00</span>`).join('');
  const rowOf = k => $('.srow[data-k="' + k + '"]');
  SESSIONS.forEach(s => rowOf(s.key).addEventListener('click', () => select(s.key)));
  const sessionByKey = k => SESSIONS.find(s => s.key === k);

  // ---- audio ---------------------------------------------------------------

  // Sound is synthesised, so there is no audio file to ship. Browsers only allow
  // audio after a click, which is why the settings toggle creates the context.
  let audio = null;
  const PITCH = { syd: 523.25, tyo: 587.33, lon: 659.25, nyc: 783.99 }; // C5 D5 E5 G5
  function ensureAudio() {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  }
  function chime(freq, soft) {
    if (!audio) return;
    const t0 = audio.currentTime;
    (soft ? [freq] : [freq, freq * 1.5]).forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = t0 + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(soft ? 0.12 : 0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(audio.destination);
      o.start(t); o.stop(t + 1);
    });
  }
  // A saved "on" cannot make sound until the page gets a click, so arm on the first one.
  document.addEventListener('click', () => { if (S.sound) ensureAudio(); }, { once: true });

  // ---- notifications ---------------------------------------------------------

  const canNotify = 'Notification' in window;
  // Phones and tablets refuse `new Notification()`; they need the service worker to show it.
  async function showNotification(title, body, tag) {
    if (!canNotify || Notification.permission !== 'granted') return;
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) return await reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' });
    } catch (e) { /* fall through */ }
    try { new Notification(title, { body, tag, icon: 'icons/icon-192.png' }); } catch (e) {}
  }

  // ---- alerts (called from the tick) ----------------------------------------

  const prevOpen = {};   // last seen state, to catch closed -> open
  const flips = {};      // cached next change per session
  const warned = {};     // heads-up already given for this opening

  function onOpened(s, closesAt) {
    if (!S.alerts[s.key]) return;
    if (S.sound) chime(PITCH[s.key]);
    if (S.notify) showNotification(s.name + ' session is open',
      (closesAt ? 'Closes ' + both(closesAt) + '. ' : '') + 'Home pairs: ' + s.pairs.slice(0, 5).join(', '), 'fx-' + s.key);
  }
  function onHeadsUp(s, at, mins) {
    if (!S.alerts[s.key]) return;
    if (S.sound) chime(PITCH[s.key], true);
    if (S.notify) showNotification(s.name + ' opens in ' + mins + ' minutes',
      'Opens ' + both(at) + '. Home pairs: ' + s.pairs.slice(0, 5).join(', '), 'fx-soon-' + s.key);
  }

  // ---- timeline --------------------------------------------------------------

  let barDay = null;
  function drawBars(ms) {
    const d = new Date(ms); d.setHours(0, 0, 0, 0);
    const day0 = d.getTime();
    SESSIONS.forEach(s => {
      const cells = $('.tbar[data-k="' + s.key + '"]').children;
      for (let i = 0; i < 48; i++) cells[i].className = isOpen(s, day0 + i * 30 * 60000 + 60000) ? 'on' : '';
    });
    // My own windows, as one more row.
    const mineRow = $('.trow.mine');
    mineRow.hidden = !S.windows.length;
    if (S.windows.length) {
      const spans = windowSpans(S.windows, day0 - 86400000, day0 + 2 * 86400000);
      const cells = mineRow.querySelector('.tbar').children;
      for (let i = 0; i < 48; i++) {
        const mid = day0 + i * 30 * 60000 + 60000;
        cells[i].className = spans.some(x => x.start <= mid && mid < x.end) ? 'on' : '';
      }
    }
    barDay = day0;
  }

  // ---- market data (optional) -------------------------------------------------

  const CANDLE_MIN = 15;
  const COMPARE_N = 10;                 // how many earlier sessions of the same name to compare with
  // One store per session, because the headline and the overview can need different sessions at once.
  const feeds = {};
  const F = k => feeds[k] || (feeds[k] = { data: {}, at: 0, error: null, loading: false });

  const cacheKey = k => 'fx-candles2-' + k;
  function loadCache(k) {
    try {
      const c = JSON.parse(localStorage.getItem(cacheKey(k)) || 'null');
      if (c && Date.now() - c.at < 5 * 60000) { Object.assign(F(k), { data: c.data, at: c.at, error: null }); return true; }
    } catch (e) {}
    return false;
  }
  async function fetchFeed(k, force) {
    const s = sessionByKey(k), feed = F(k);
    if (!S.apiKey || feed.loading) return;
    if (!force && feed.at && Date.now() - feed.at < 10 * 60000) return;
    if (force && !feed.error && feed.at && Date.now() - feed.at < 60000) return;   // protect the free quota
    if (!force && !feed.at && loadCache(k)) { refreshLive(); return renderOverview(); }
    feed.loading = true; feed.error = null; renderOverview();
    try {
      const url = 'https://api.twelvedata.com/time_series?symbol=' + encodeURIComponent(s.watch.join(',')) +
        '&interval=' + CANDLE_MIN + 'min&outputsize=1500&timezone=UTC&order=asc&apikey=' + encodeURIComponent(S.apiKey);
      const res = await fetch(url);
      const j = await res.json();
      if (j.status === 'error') {
        throw new Error(j.code === 401 || /api ?key/i.test(String(j.message))
          ? 'Twelve Data does not accept this key. Check it in Settings.'
          : String(j.message || 'The data service refused the request.').replace(/\*/g, ''));
      }
      // One symbol returns the series directly; several return an object keyed by symbol.
      const bySymbol = s.watch.length === 1 ? { [s.watch[0]]: j } : j;
      const out = {};
      for (const sym of s.watch) {
        const r = bySymbol[sym];
        if (r && r.status === 'ok' && Array.isArray(r.values)) out[sym] = parseCandles(r.values);
        else out[sym] = { error: (r && r.message) || 'No data returned for ' + sym };
      }
      feed.data = out; feed.at = Date.now();
      try { localStorage.setItem(cacheKey(k), JSON.stringify({ at: feed.at, data: out })); } catch (e) {}
    } catch (e) {
      feed.error = e.message === 'Failed to fetch' ? 'Could not reach the data service. Check your connection.' : e.message;
      // Stamp the failure so the once-a-second tick does not hammer the API; retry is manual or in 10 minutes.
      feed.at = Date.now();
    }
    feed.loading = false;
    refreshLive();
    renderOverview();
  }

  // How today is actually going against earlier sessions, for the headline. Recomputed once a minute
  // and after each fetch, because it scans every candle.
  const liveAct = {};
  function computeLive(k, ms) {
    const s = sessionByKey(k), f = F(k);
    if (!f.at || f.error || !isOpen(s, ms)) return null;
    const w = lastWindow(s, ms);
    if (!w) return null;
    const prior = priorWindows(s, w.start, COMPARE_N);
    const cmps = [];
    for (const sym of s.watch) {
      const c = f.data[sym];
      if (!Array.isArray(c)) continue;
      const r = compareSession(c, w, ms, prior, CANDLE_MIN);
      if (r) cmps.push(r);
    }
    if (!cmps.length) return null;
    const share = cmps.reduce((a, r) => a + r.share, 0) / cmps.length;
    return { share, n: cmps[0].n, pairs: cmps.length,
             smaller: Math.round(cmps.reduce((a, r) => a + r.smaller, 0) / cmps.length),
             label: share >= 0.7 ? 'more' : share <= 0.3 ? 'less' : 'same' };
  }
  function refreshLive() { const ms = Date.now(); SESSIONS.forEach(s => { liveAct[s.key] = computeLive(s.key, ms); }); }
  // The session whose activity drives the headline: the busiest home market that is really trading.
  const headKey = a => ['lon', 'nyc', 'tyo', 'syd'].find(k => a.live.includes(k)) || null;

  // ---- overview ---------------------------------------------------------------

  function select(k) {
    S.selected = k; save();
    SESSIONS.forEach(s => rowOf(s.key).setAttribute('aria-pressed', String(s.key === k)));
    renderOverview();
    fetchFeed(k, false);
  }
  const signed = n => { const r = Math.round(n); return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r); };

  function renderOverview() {
    const s = sessionByKey(S.selected);
    const el = $('#overview');
    if (!s) { el.innerHTML = ''; return; }
    const feed = F(s.key);
    const ms = Date.now();
    const open = isOpen(s, ms);
    const w = lastWindow(s, ms);
    if (!w) { el.innerHTML = ''; return; }

    const total = w.end - w.start;
    const elapsed = Math.min(total, Math.max(0, ms - w.start));
    const pct = open ? (elapsed / total) * 100 : 100;
    const state = open
      ? span(elapsed) + ' in, ' + span(total - elapsed) + ' left'
      : 'Closed. Showing the last session, ' + hmDay.format(w.start) + ' to ' + hm.format(w.end);

    let body;
    if (!S.apiKey) {
      body = `<div class="note"><b>Price movement is off.</b> To see how each pair has moved during this session, add a free Twelve Data key in Settings. The session times and pairs above work without it.<br><button type="button" id="ov-settings">Open settings</button></div>`;
    } else if (feed.error) {
      body = `<div class="note"><b>Could not load prices.</b> ${esc(feed.error)}<br><button type="button" id="ov-retry">Try again</button></div>`;
    } else if (!feed.at) {
      body = `<div class="note">Loading prices for ${s.name}…</div>`;
    } else {
      body = movementTable(s, w, ms);
    }

    const ds = dataStatus(s, open, ms);
    el.innerHTML = `
      <div class="ovhead"><h2>${s.name} session</h2><span class="ovstate">${state}</span></div>
      <div class="dstatus ${ds.cls}"><span>${esc(ds.text)}</span>${S.apiKey && ds.cls !== 'wait' ? '<button type="button" class="plain" id="ov-refresh">Refresh now</button>' : ''}</div>
      <p class="ovabout">${rich(s.about)}</p>
      <div class="bar" role="progressbar" aria-label="Session progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><i style="width:${pct}%"></i></div>
      <div class="barlabels"><span>${both(w.start)}</span><span>${both(w.end)}</span></div>
      ${body}`;
    const b1 = el.querySelector('#ov-settings'); if (b1) b1.addEventListener('click', openSettings);
    const b2 = el.querySelector('#ov-retry'); if (b2) b2.addEventListener('click', () => fetchFeed(s.key, true));
    const b3 = el.querySelector('#ov-refresh');
    if (b3) b3.addEventListener('click', () => {
      if (!feed.error && Date.now() - feed.at < 60000) { b3.textContent = 'Updated a moment ago'; return; }   // free plans are rate limited
      fetchFeed(s.key, true);
    });
  }

  // One plain line that answers "is the price data working?"
  function dataStatus(s, open, ms) {
    const feed = F(s.key);
    if (!S.apiKey) return { cls: 'off', text: 'Price data: off. Add a Twelve Data key in Settings to turn it on.' };
    if (feed.error) return { cls: 'bad', text: 'Price data: not working. ' + feed.error };
    if (feed.loading || !feed.at) return { cls: 'wait', text: 'Price data: loading…' };
    let latest = 0;
    for (const sym of s.watch) { const c = feed.data[sym]; if (Array.isArray(c) && c.length) latest = Math.max(latest, c[c.length - 1][0]); }
    if (!latest) return { cls: 'bad', text: 'Price data: connected, but no prices came back for these pairs.' };
    const stale = open && ms - latest > 45 * 60000;
    return { cls: stale ? 'bad' : 'ok', text: 'Price data: ' + (stale ? 'connected, but prices look delayed' : 'working') +
      ' · updated ' + hm.format(feed.at) + ' · latest price ' + hm.format(latest) + ' · next refresh ' + hm.format(feed.at + 10 * 60000) };
  }

  const PLAIN_VERDICT = { 'Busier than usual': 'Moving more than usual', 'Quieter than usual': 'Moving less than usual', 'About usual': 'About usual' };

  function movementTable(s, w, ms) {
    const feed = F(s.key);
    const prior = priorWindows(s, w.start, COMPARE_N);
    const rows = [], shares = [];
    const cols = beginner() ? 3 : 5;
    const tooEarly = Math.min(ms, w.end) - w.start < 30 * 60000;
    for (const sym of s.watch) {
      const candles = feed.data[sym];
      if (!candles || candles.error) { rows.push(`<tr><td>${sym}</td><td colspan="${cols - 1}" class="verdict">${esc((candles && candles.error) || 'No data')}</td></tr>`); continue; }
      const st = stats(candles, w, ms);
      if (!st) { rows.push(`<tr><td>${sym}</td><td colspan="${cols - 1}" class="verdict">No prices for this window yet.</td></tr>`); continue; }
      const pip = pipSize(sym), dec = pip === 0.01 ? 3 : 5;
      const cmp = compareSession(candles, w, ms, prior, CANDLE_MIN);
      if (cmp) shares.push(cmp.share);
      const none = tooEarly ? 'Too early to compare' : 'Not enough history yet';
      const net = st.net / pip, cls = net > 0 ? 'up' : net < 0 ? 'down' : '';
      if (beginner()) {
        const n = Math.abs(Math.round(net));
        const dir = n === 0 ? 'Flat' : (net > 0 ? 'Up ' : 'Down ') + n + (n === 1 ? ' pip' : ' pips');
        rows.push(`<tr><td>${sym}<div class="hint">${PAIRS[sym] || ''}</div></td>
          <td class="${cls}" data-label="Since the session opened">${dir}</td>
          <td class="verdict" data-label="Compared with usual">${cmp ? PLAIN_VERDICT[cmp.label] + `<div class="hint">Bigger range than ${cmp.smaller} of the last ${cmp.n} ${s.name} sessions at this point.</div>` : none}</td></tr>`);
      } else {
        rows.push(`<tr><td>${sym}</td>
          <td class="num" data-label="Open → now">${st.open.toFixed(dec)} → ${st.close.toFixed(dec)}</td>
          <td class="num ${cls}" data-label="Net pips">${signed(net)}</td>
          <td class="num" data-label="Range pips">${Math.round(st.range / pip)}</td>
          <td class="verdict" data-label="Versus last ${prior.length}">${cmp ? `${cmp.label}<div class="hint">${cmp.ratio ? cmp.ratio.toFixed(2) + '× median · ' : ''}larger than ${cmp.smaller} of ${cmp.n}</div>` : none}</td></tr>`);
      }
    }
    let summary = '';
    if (shares.length) {
      const avg = shares.reduce((a, b) => a + b, 0) / shares.length;
      const label = avg >= 0.7 ? 'more' : avg <= 0.3 ? 'less' : 'same';
      summary = beginner()
        ? `<p class="ovsummary">Prices are moving ${label === 'same' ? 'about as much as usual' : label + ' than usual'} for this point in the ${s.name} session.</p>`
        : `<p class="ovsummary">${label === 'more' ? 'Busier than usual' : label === 'less' ? 'Quieter than usual' : 'About usual'} · on average ${Math.round(avg * 100)}% of the last ${prior.length} ${s.name} sessions had a smaller range at this point, across ${shares.length} pairs.</p>`;
    }
    const head = beginner()
      ? '<th>Pair</th><th>Since the session opened</th><th>Compared with usual</th>'
      : '<th>Pair</th><th class="num">Open → now</th><th class="num">Net pips</th><th class="num">Range pips</th><th>Versus last ' + prior.length + '</th>';
    const foot = beginner()
      ? `<p class="hint">${rich('A pip is the standard small step of price.')} "Usual" means the last ${prior.length} ${s.name} sessions, compared at the same point in the session. Prices come from Twelve Data and may be delayed.</p>`
      : `<p class="src">Method: high to low range since the session opened, against the range over the same elapsed time in each of the last ${prior.length} ${s.name} sessions. Sessions with missing data are skipped, and at least 5 must remain. Busier means larger than at least 70% of them, quieter means larger than at most 30%. Prices: Twelve Data, 15-minute candles, may be delayed. Updated ${hm.format(feed.at)}.</p>`;
    return `${summary}<table class="mv"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table>${foot}`;
  }

  // ---- economic calendar -------------------------------------------------------
  // The app reads calendar.json from its own address. tools/serve.mjs keeps that file fresh, or a scheduled
  // job does when the app is hosted. The browser never calls the news feed itself: it cannot (no CORS).

  const cal = { data: null, status: 'loading', reason: '', fromCache: false };
  const IMP_LABEL = { high: 'HIGH', medium: 'MED', low: 'LOW', holiday: 'HOLIDAY' };
  const newsAlerted = {};
  let newsShowAll = false;

  async function loadCalendar() {
    try {
      const res = await fetch(S.calUrl || 'calendar.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status === 404 ? 'MISSING' : 'the calendar file answered HTTP ' + res.status);
      const text = await res.text();
      const parsed = parseCalendar(JSON.parse(text));
      if (!parsed || !parsed.events.length) throw new Error('The calendar file could not be read.');
      Object.assign(cal, { data: parsed, status: 'ok', reason: '', fromCache: false });
      try { localStorage.setItem('fx-cal', text); } catch (e) {}
    } catch (e) {
      cal.reason = e.message === 'MISSING' ? 'MISSING' : e instanceof SyntaxError ? 'The calendar file could not be read.'
        : e.message === 'Failed to fetch' ? 'Could not reach the calendar file.' : e.message;
      // Keep working from the last good copy, and say that it is a copy.
      let cached = null;
      try { cached = parseCalendar(JSON.parse(localStorage.getItem('fx-cal') || 'null')); } catch (x) {}
      if (cached && cached.events.length) Object.assign(cal, { data: cached, status: 'ok', fromCache: true });
      else Object.assign(cal, { data: null, status: 'off' });
    }
    renderNews(); paintCalStatus();
    if (window.__started) tick();
  }

  // One plain line that answers "is the calendar working?"
  function calStatus() {
    const ms = Date.now();
    if (cal.status === 'loading') return { cls: 'wait', text: 'Calendar: loading…' };
    if (!cal.data) {
      return { cls: 'off', text: cal.reason === 'MISSING'
        ? 'Calendar: not loaded. Start the app with "node tools/serve.mjs" and it fetches one, or run "node tools/update-calendar.mjs" once.'
        : 'Calendar: not working. ' + cal.reason };
    }
    const c = cal.data, when = c.generatedAt ? hm.format(c.generatedAt) : 'unknown time';
    if (cal.fromCache) return { cls: 'bad', text: 'Calendar: could not refresh (' + (cal.reason === 'MISSING' ? 'the file is missing' : cal.reason) + '). Showing the last saved copy from ' + when + '.' };
    if (c.generatedAt && ms - c.generatedAt > 6 * 3600000)
      return { cls: 'bad', text: 'Calendar: out of date. It was last updated ' + span(ms - c.generatedAt) + ' ago. Run "node tools/update-calendar.mjs", or start the app with "node tools/serve.mjs".' };
    const last = c.events[c.events.length - 1].at;
    if (last < ms) return { cls: 'bad', text: 'Calendar: this week is over. The next week appears when the feed publishes it.' };
    return { cls: 'ok', text: 'Calendar: working · updated ' + when + ' · ' + c.events.length + ' events · covers until ' + hmDay.format(last) };
  }
  function paintCalStatus() {
    const st = calStatus(), el = dlg.querySelector('#s-calstatus');
    if (el) { el.textContent = st.text; el.className = 'keystatus ' + (st.cls === 'ok' ? 'ok' : st.cls === 'bad' ? 'bad' : ''); }
  }

  const relTime = ms => { const m = Math.round(Math.abs(ms) / 60000); return m < 1 ? 'now' : m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + pad(m % 60) + 'm'; };
  const dayHead = (t, ms) => {
    const key = d => new Date(d).toDateString();
    return key(t) === key(ms) ? 'Today' : key(t) === key(ms + 86400000) ? 'Tomorrow' : dayName.format(t) + ' ' + new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };

  function renderNews() {
    const list = $('#news-list');
    if (!list) return;
    const ms = Date.now();
    $('#news-imp').querySelectorAll('[data-imp]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.imp === S.newsImpact)));
    const st = calStatus();
    setHTML($('#news-status'), esc(st.text));
    $('#news-status').className = 'hint news-' + st.cls;
    if (!cal.data) {
      setHTML(list, `<li class="evempty">${beginner()
        ? 'There is no news calendar yet, so the app cannot warn you before big news. The line below says how to get one.'
        : 'No calendar loaded.'}</li>`);
      return;
    }
    const events = newsBetween(cal.data, ms - 60 * 60000, ms + 24 * 3600000, S.newsImpact, S.newsCcy);
    const firstUp = events.findIndex(e => e.at >= ms);
    let html = '', lastDay = '';
    events.slice(0, newsShowAll ? 30 : 6).forEach((e, i) => {
      const day = dayHead(e.at, ms);
      if (day !== lastDay) { lastDay = day; html += `<li class="dayrow">${esc(day)}</li>`; }
      const past = e.at < ms, help = beginner() && !fewer() ? eventHelp(e.title) : null;
      const cc = chartTime(e.at);
      const nums = beginner()
        ? [e.forecast && 'Expected ' + e.forecast, e.previous && 'last time ' + e.previous].filter(Boolean).join(', ')
        : (e.forecast || e.previous ? 'F ' + (e.forecast || '—') + ' · P ' + (e.previous || '—') : '');
      const detail = [help && help.plain, nums && (help ? '' : '') + nums + (nums && beginner() ? '.' : '')].filter(Boolean).join(' ');
      html += `<li class="ev${past ? ' past' : ''}${i === firstUp ? ' next' : ''}">
        <span class="et">${hm.format(e.at)}<small>${cc ? 'chart ' + cc : ''}</small></span>
        <span class="en"><b class="imp ${e.impact}">${IMP_LABEL[e.impact]}</b> <b>${esc(e.ccy)}</b> ${esc(e.title)}
          ${detail || (help && help.id) ? `<small>${esc(detail)}${help && help.id ? ` <button type="button" class="term" data-t="${help.id}">What is this?</button>` : ''}</small>` : ''}</span>
        <span class="ec">${past ? relTime(ms - e.at) + ' ago' : 'in ' + relTime(e.at - ms)}</span></li>`;
    });
    if (firstUp < 0) {
      const nxt = newsBetween(cal.data, ms, ms + 7 * 86400000, S.newsImpact, S.newsCcy)[0];
      html += `<li class="evempty">No ${S.newsImpact === 'high' ? 'high-impact ' : ''}news in the next 24 hours.${nxt
        ? ' Next: ' + esc(nxt.ccy + ' ' + nxt.title) + ', ' + esc(dayHead(nxt.at, ms)) + ' at ' + hm.format(nxt.at) + '.' : ''}</li>`;
    }
    setHTML(list, html);
    const more = $('#news-more');
    more.hidden = events.length <= 6;
    more.textContent = newsShowAll ? 'Show fewer' : 'Show all ' + events.length + ' events';
  }

  // A sound and a notification shortly before a high-impact release.
  function checkNewsAlerts(ms) {
    if (!cal.data || !S.newsLead || cal.fromCache) return;
    // Releases often come in bunches at the same minute (jobs, earnings, unemployment): one alert for the bunch.
    const soon = newsBetween(cal.data, ms, ms + S.newsLead * 60000, 'high', S.newsCcy);
    const groups = new Map();
    soon.forEach(e => { if (!groups.has(e.at)) groups.set(e.at, []); groups.get(e.at).push(e); });
    groups.forEach((evs, at) => {
      if (newsAlerted[at]) return;
      newsAlerted[at] = true;
      const mins = Math.max(1, Math.round((at - ms) / 60000));
      const names = evs.slice(0, 2).map(e => e.ccy + ' ' + e.title).join(', ') + (evs.length > 2 ? ' and ' + (evs.length - 2) + ' more' : '');
      if (S.sound) chime(440, true);
      if (S.notify) showNotification('High-impact news in ' + mins + ' min', names + ' at ' + both(at) + '. Spreads can widen and price can jump.', 'fx-news-' + at);
    });
  }

  // ---- position size calculator ---------------------------------------------------
  // The arithmetic lives in logic.js (positionSize) and is tested there. This part only reads the form,
  // asks for anything missing in plain words, and shows the answer with its working.

  const CALC_DEFAULTS = { balance: '', ccy: 'USD', risk: '1', pair: 'EUR/USD', lev: '100', minLot: '0.01', step: '0.01', gold: '100' };
  S.calc = { ...CALC_DEFAULTS, ...(S.calc || {}) };
  const cv = id => $('#' + id).value.trim();
  const cblank = id => cv(id) === '';
  const cnum = id => parseNum(cv(id));

  const fmt = (n, dp = 2) => n.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  const money = (n, c) => fmt(n) + ' ' + c;
  const priceFmt = (n, dp) => n.toFixed(dp);

  let calcReady = false, journalReady = false;
  function calcInit() {
    $('#c-pair').innerHTML = Object.keys(PAIRS).map(p => `<option value="${p}">${p} — ${esc(PAIRS[p])}</option>`).join('');
    const c = S.calc;
    $('#c-balance').value = c.balance; $('#c-ccy').value = c.ccy; $('#c-risk').value = c.risk;
    $('#c-pair').value = PAIRS[c.pair] ? c.pair : 'EUR/USD'; $('#c-lev').value = c.lev;
    $('#c-minlot').value = c.minLot; $('#c-step').value = c.step; $('#c-gold').value = c.gold;
    $('#calc-form').addEventListener('input', () => { calcSave(); calcRender(); });
    $('#calc-form').addEventListener('change', () => { calcSave(); calcRender(); });
    $('#calc-form').addEventListener('submit', e => e.preventDefault());
    $('#c-entry-live').addEventListener('click', useLiveEntry);
    $('#c-rate-live').addEventListener('click', useLiveRate);
    calcRender();
  }
  // Only account-level settings are remembered. Entry and stop are for one trade and would go stale.
  function calcSave() {
    S.calc = { balance: cv('c-balance'), ccy: cv('c-ccy').toUpperCase(), risk: cv('c-risk'), pair: cv('c-pair'), lev: cv('c-lev'),
               minLot: cv('c-minlot'), step: cv('c-step'), gold: cv('c-gold') };
    save();
  }

  // ---- live prices (optional; uses the Twelve Data key)
  async function fetchPrice(symbol) {
    const res = await fetch('https://api.twelvedata.com/price?symbol=' + encodeURIComponent(symbol) + '&apikey=' + encodeURIComponent(S.apiKey));
    const j = await res.json();
    if (j.status === 'error' || !(Number(j.price) > 0)) throw new Error(String(j.message || 'No price came back.').replace(/\*/g, ''));
    return Number(j.price);
  }
  async function useLiveEntry() {
    const sym = cv('c-pair'), inst = instrumentFor(sym, cnum('c-gold')), st = $('#c-entry-status');
    st.textContent = 'Getting the price…';
    try {
      $('#c-entry').value = priceFmt(await fetchPrice(sym), inst.dp);
      st.textContent = 'Live price from Twelve Data at ' + hm.format(Date.now()) + '. Check it against your platform before trading.';
      calcRender();
    } catch (e) { st.textContent = e.message === 'Failed to fetch' ? 'Could not reach Twelve Data.' : 'Could not get the price: ' + e.message; }
  }
  async function useLiveRate() {
    const need = calcNeed, st = $('#c-rate-hint');
    if (!need) return;
    st.textContent = 'Getting the rate…';
    try {
      let rate;
      try { rate = await fetchPrice(need.from + '/' + need.to); }                       // 1 GBP in USD
      catch (e) { rate = 1 / await fetchPrice(need.to + '/' + need.from); }             // or the inverse pair
      $('#c-rate').value = String(Number(rate.toPrecision(7)));
      st.textContent = 'Live rate from Twelve Data at ' + hm.format(Date.now()) + '.';
      calcRender();
    } catch (e) { st.textContent = 'Could not get the rate. Type it in from your platform.'; }
  }

  // ---- reading the form
  let calcNeed = null;
  const CALC_ERR = {
    balance: 'Balance must be a number above 0.', ccy: 'Enter your account currency as three letters, for example USD.',
    risk: 'Risk must be above 0 and no more than 100 percent.', stop: 'Stop-loss distance must be a number above 0.',
    entry: 'Entry price must be a number above 0, or left empty.', tp: 'Take-profit distance must be a number above 0, or left empty.',
    spread: 'Spread must be 0 or more, or left empty.', rate: 'Exchange rate must be a number above 0.',
  };
  function calcInputs() {
    const opt = id => cblank(id) ? undefined : cnum(id);
    return { sym: cv('c-pair'), balance: cnum('c-balance'), ccy: cv('c-ccy').toUpperCase(), riskPct: cnum('c-risk'), stop: cnum('c-stop'),
             spread: opt('c-spread'), entry: opt('c-entry'), tp: opt('c-tp'), rate: opt('c-rate'), dir: cv('c-dir'),
             minLot: opt('c-minlot'), lotStep: opt('c-step'), leverage: Number(cv('c-lev')) || undefined, goldContract: opt('c-gold') };
  }

  function calcRender() {
    const out = $('#calc-out');
    const inp = calcInputs(), inst = instrumentFor(inp.sym, inp.goldContract);

    // Labels follow the instrument: gold is measured in dollars, everything else in pips.
    const unit = inst.gold ? 'dollars per ounce' : 'pips';
    $('#c-stop-label').innerHTML = beginner() && !inst.gold
      ? 'Stop-loss distance in <button type="button" class="term" data-t="pip">pips</button>' : 'Stop-loss distance in ' + unit;
    $('#c-tp-label').textContent = 'Take-profit distance in ' + unit;
    $('#c-spread-label').textContent = 'Spread in ' + unit;
    $('#c-stop-hint').textContent = inst.gold
      ? 'Gold has no standard pip, so enter the distance in dollars per ounce.'
      : (inst.pip === 0.01 ? 'For a yen pair one pip is 0.01, so 20 pips is a price move of 0.20.' : 'One pip is 0.0001, so 25 pips is a price move of 0.0025.');
    $('#c-gold-wrap').hidden = !inst.gold;
    $('#c-entry-live').hidden = !S.apiKey;

    // Required fields first, in plain words.
    const missing = [['c-balance', 'your balance'], ['c-ccy', 'your account currency'], ['c-risk', 'the risk percent'], ['c-stop', 'your stop-loss distance']]
      .filter(([id]) => cblank(id)).map(x => x[1]);
    const r0 = positionSize(inp);
    const KEYID = { balance: 'c-balance', ccy: 'c-ccy', risk: 'c-risk', stop: 'c-stop', entry: 'c-entry', tp: 'c-tp', spread: 'c-spread' };
    const invalid = (r0.errors || []).filter(k => KEYID[k] && !cblank(KEYID[k]));       // typed, but not a usable number
    if (!cblank('c-rate') && !(inp.rate > 0)) invalid.push('rate');
    if (missing.length || invalid.length) {
      calcNeed = null; $('#c-rate-wrap').hidden = true;
      setHTML(out, `<div class="note">${invalid.length ? invalid.map(k => `<p>${CALC_ERR[k]}</p>`).join('')
        : `<b>Fill in ${missing.length > 1 ? missing.slice(0, -1).join(', ') + ' and ' + missing[missing.length - 1] : missing[0]}</b> to see how many lots to trade.`}</div>`);
      return;
    }

    const r = r0;
    if (!r.ok && r.needRate) {
      calcNeed = r.needRate;
      $('#c-rate-wrap').hidden = false;
      $('#c-rate-label').textContent = 'Exchange rate: 1 ' + r.needRate.from + ' = ? ' + r.needRate.to;
      $('#c-rate-hint').textContent = 'To count your risk in ' + r.needRate.to + ', the calculator needs to convert ' + r.needRate.from + ', the currency ' + inp.sym + ' is priced in.' +
        (S.apiKey ? '' : ' Type today\'s rate from your platform, or add a Twelve Data key in Settings to fetch it.');
      $('#c-rate-live').hidden = !S.apiKey;
      setHTML(out, `<div class="note"><b>One more number needed.</b> Enter the exchange rate 1 ${esc(r.needRate.from)} = ? ${esc(r.needRate.to)} on the left.</div>`);
      return;
    }
    calcNeed = null;
    $('#c-rate-wrap').hidden = !(r.ok && inst.quote !== r.ccy && !(inst.base === r.ccy && inp.entry > 0));
    if (!r.ok) { setHTML(out, `<div class="note">${r.errors.map(k => `<p>${CALC_ERR[k] || 'Check the numbers.'}</p>`).join('')}</div>`); return; }
    lastCalc = { pair: inp.sym, dir: inp.dir === 'buy' || inp.dir === 'sell' ? inp.dir : undefined, lots: r.tooSmall ? null : r.lots,
                 entry: inp.entry !== undefined ? inp.entry : null, stop: r.stopPrice !== null ? Number(r.stopPrice.toFixed(r.inst.dp)) : null,
                 risk: r.tooSmall ? null : Number(r.risk.toFixed(2)), ccy: r.ccy };
    setHTML(out, calcResultHtml(inp, r));
  }

  function calcResultHtml(inp, r) {
    const c = r.ccy, dp = r.inst.dp, unit = r.inst.gold ? 'dollars' : 'pips';
    const lotsTxt = r.tooSmall ? 'Below the minimum' : fmt(r.lots, Math.max(2, (String(r.step).split('.')[1] || '').length)) + ' lots';
    const sentence = r.tooSmall
      ? `Your risk budget of <b>${money(r.riskBudget, c)}</b> cannot buy even the smallest lot. See the warning below.`
      : `Trade <b>${fmt(r.lots, Math.max(2, (String(r.step).split('.')[1] || '').length))} lots</b>. If price reaches your stop-loss, you lose about <b>${money(r.risk, c)}</b>, which is <b>${fmt(r.riskPct)}%</b> of your account.`;
    const cell = (k, v, sub) => `<div><dt>${k}</dt><dd>${v}${sub ? `<small>${sub}</small>` : ''}</dd></div>`;
    const cells = [
      cell('Loss if stopped out', r.tooSmall ? '—' : money(r.risk, c), r.tooSmall ? '' : fmt(r.riskPct) + '% of balance'),
      r.reward !== null ? cell('Gain at target', r.tooSmall ? '—' : money(r.reward, c), 'reward-to-risk 1 : ' + fmt(r.rr, 1)) : '',
      cell('Value of one ' + (r.inst.gold ? 'dollar' : 'pip') + ', 1 lot', money(r.pipValue, c)),
      cell('Position', r.tooSmall ? '—' : fmt(r.units, 0) + (r.inst.gold ? ' oz' : ' units')),
      r.margin !== null ? cell('Margin needed', r.tooSmall ? '—' : money(r.margin, c), r.tooSmall ? '' : fmt(r.margin / inp.balance * 100, 1) + '% of balance') : '',
      r.stopPrice !== null ? cell('Stop-loss price', priceFmt(r.stopPrice, dp)) : '',
      r.tpPrice !== null ? cell('Take-profit price', priceFmt(r.tpPrice, dp)) : '',
    ].join('');
    const warn = r.warnings.map(w => `<li class="${w.warn ? 'warn' : ''}">${rich(w.text)}</li>`).join('');

    const wk = r.working, lotDec = Math.max(2, (String(r.step).split('.')[1] || '').length);
    const contractTxt = r.inst.gold ? fmt(r.inst.contract, 0) + ' oz × $1' : fmt(r.inst.contract, 0) + ' × ' + r.inst.pip;
    const lines = [
      `Risk budget: ${fmt(inp.balance)} ${c} × ${fmt(inp.riskPct)}% = <b>${money(r.riskBudget, c)}</b>`,
      `Value of one ${r.inst.gold ? 'dollar' : 'pip'} for 1 lot: ${contractTxt} = ${fmt(wk.pipValueQuote)} ${r.inst.quote}` +
        (r.inst.quote === c ? '' : `, converted using ${esc(wk.q2aHow)}: <b>${money(r.pipValue, c)}</b>`),
      `Stop distance counted: ${fmt(inp.stop, 1)}${wk.spread ? ' + ' + fmt(wk.spread, 1) + ' spread' : ''} = <b>${fmt(r.effStop, 1)} ${unit}</b>`,
      `Lots = ${fmt(r.riskBudget)} ÷ (${fmt(r.effStop, 1)} × ${fmt(r.pipValue)}) = ${r.raw.toFixed(4)}, rounded <b>down</b> to the lot step of ${r.step}: <b>${r.tooSmall ? '0 (below the minimum of ' + r.minLot + ')' : fmt(r.lots, lotDec)}</b>`,
      r.tooSmall ? '' : `Real risk = ${fmt(r.lots, lotDec)} × ${fmt(r.effStop, 1)} × ${fmt(r.pipValue)} = <b>${money(r.risk, c)}</b>`,
    ].filter(Boolean).map(l => `<li>${l}</li>`).join('');

    return `<div class="big"><span class="k">${beginner() ? 'How many lots to trade' : 'Position size'}</span><span class="v${r.tooSmall ? ' small' : ''}">${lotsTxt}</span>${r.tooSmall ? '' : `<span class="sub">${fmt(r.units, 0)} ${r.inst.gold ? 'oz' : 'units'}</span>`}</div>
      <p class="only-beg csentence">${sentence}</p>
      <dl class="cgrid">${cells}</dl>
      ${warn ? `<ul class="anotes calc-warn">${warn}</ul>` : ''}
      <details class="working"${beginner() ? ' open' : ''}><summary>Show the working</summary><ol>${lines}</ol></details>
      ${r.tooSmall ? '' : '<p><button type="button" class="primary" id="calc-to-journal">Add this trade to the journal</button></p>'}`;
  }

  // ---- trading journal ---------------------------------------------------------------------
  // The maths is in journal.js (tested). This part stores trades on the device, draws them, and does import/export.
  // Everything a person typed is escaped with esc() before it reaches the page.

  const FXJ = window.FXJ;
  const JKEY = 'fx-journal';
  const journal = { trades: [], error: '' };
  S.journal = { lastBackup: 0, sinceBackup: 0, ...(S.journal || {}) };
  let jEditing = null, jConfirm = null, jShowAll = false, jStatusTimer = null;
  const jNewId = () => 't_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const jdlg = () => document.getElementById('jr-dialog');
  const jq = id => jdlg().querySelector('#' + id);

  function jLoad() {
    try {
      const raw = JSON.parse(localStorage.getItem(JKEY) || 'null');
      if (raw && Array.isArray(raw.trades)) journal.trades = FXJ.mergeBackup([], { app: 'session-clock-journal', trades: raw.trades }, jNewId).trades;
    } catch (e) { journal.trades = []; journal.error = 'The saved journal could not be read.'; }
  }
  function jSave() {
    try {
      localStorage.setItem(JKEY, JSON.stringify({ v: 1, trades: journal.trades }));
      journal.error = '';
      // Ask the browser not to clear this data when it is short of space. It may decline; the backup button is the real safety net.
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      return true;
    } catch (e) {
      journal.error = 'Could not save the journal: this browser is blocking or has run out of storage. Export a backup now.';
      return false;
    }
  }
  function jStatus(msg, cls) {
    const el = $('#jr-status'); el.textContent = msg; el.className = 'keystatus ' + (cls || '');
    clearTimeout(jStatusTimer); if (msg) jStatusTimer = setTimeout(() => { el.textContent = ''; }, 8000);
  }

  // ---- numbers and dates
  const sgn = (n, dp = 2) => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n), dp);
  const pctTxt = x => Math.round(x * 100) + '%';
  const localInput = ms => { const d = new Date(ms), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
  const whenTxt = ms => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + hm.format(ms);
  const termBtn = (label, id) => beginner() && !fewer() ? `<button type="button" class="term" data-t="${id}">${label}</button>` : label;

  // ---- the form
  let lastCalc = null;      // the calculator's latest good answer, so a trade can be logged from it
  function jFillSetups() { jq('j-setups').innerHTML = [...new Set(journal.trades.map(t => t.setup).filter(Boolean))].map(s => `<option value="${esc(s)}">`).join(''); }
  function jToggleClosed() { jq('j-closed-wrap').hidden = jq('j-status').value !== 'closed'; }
  function jOpenForm(trade, prefill) {
    jEditing = trade ? trade.id : null;
    jq('jr-form-title').textContent = trade ? 'Edit trade' : 'Log a trade';
    jq('j-pair').innerHTML = Object.keys(PAIRS).map(p => `<option value="${p}">${p}</option>`).join('');
    const t = trade || {}, pf = prefill || {}, now = Date.now();
    const num = v => v === null || v === undefined ? '' : String(v);
    jq('j-pair').value = t.pair || pf.pair || (PAIRS[S.calc.pair] ? S.calc.pair : 'EUR/USD');
    jq('j-dir').value = t.dir || pf.dir || 'buy';
    jq('j-opened').value = localInput(t.openedAt || now);
    jq('j-status').value = t.status || 'closed';
    jq('j-closedat').value = localInput(t.closedAt || now);
    jq('j-result').value = num(t.result);
    jq('j-ccy').value = t.ccy || pf.ccy || (S.calc.ccy || 'USD');
    jq('j-ccy-label').textContent = jq('j-ccy').value.toUpperCase() || 'your currency';
    jq('j-risk').value = num(t.risk ?? pf.risk); jq('j-lots').value = num(t.lots ?? pf.lots);
    jq('j-entry').value = num(t.entry ?? pf.entry); jq('j-stop').value = num(t.stop ?? pf.stop);
    jq('j-exit').value = num(t.exit); jq('j-pips').value = num(t.pips);
    jq('j-plan').value = t.plan || ''; jq('j-setup').value = t.setup || ''; jq('j-notes').value = t.notes || '';
    jq('j-error').textContent = '';
    jq('j-fromcalc').hidden = !lastCalc;
    jFillSetups(); jToggleClosed();
    if (!jdlg().open) jdlg().showModal();
  }
  function jReadForm() {
    const v = id => jq(id).value.trim();
    const optNum = (id, label, positive) => {
      if (!v(id)) return { v: null };
      const n = FXJ.parseSigned(v(id), parseNum);
      if (Number.isNaN(n) || (positive && !(n > 0))) return { err: label + ' must be a number' + (positive ? ' above 0' : '') + ', or left empty.' };
      return { v: n };
    };
    const opened = new Date(jq('j-opened').value).getTime();
    if (!Number.isFinite(opened)) return { err: 'Enter when the trade was opened.' };
    if (opened > Date.now() + 3600000) return { err: 'The opening time is in the future.' };
    const status = v('j-status') === 'open' ? 'open' : 'closed';
    let closedAt = null, result = null;
    if (status === 'closed') {
      closedAt = new Date(jq('j-closedat').value).getTime();
      if (!Number.isFinite(closedAt)) return { err: 'Enter when the trade was closed.' };
      if (closedAt < opened) return { err: 'The trade cannot close before it opened.' };
      result = FXJ.parseSigned(v('j-result'), parseNum);
      if (Number.isNaN(result)) return { err: 'Enter the result as a number, with a minus sign for a loss. Copy it from your platform.' };
    }
    const ccy = v('j-ccy').toUpperCase();
    if (!/^[A-Z]{3}$/.test(ccy)) return { err: 'Enter your account currency as three letters, for example USD.' };
    const f = { risk: optNum('j-risk', 'Planned risk', true), lots: optNum('j-lots', 'Lots', true), entry: optNum('j-entry', 'Entry price', true),
                stop: optNum('j-stop', 'Stop-loss price', true), exit: optNum('j-exit', 'Exit price', true), pips: optNum('j-pips', 'Pips', false) };
    for (const k of Object.keys(f)) if (f[k].err) return { err: f[k].err };
    const pair = v('j-pair');
    const ms = opened;
    const sess = assess(ms);
    return { trade: { id: jEditing, pair, dir: v('j-dir') === 'sell' ? 'sell' : 'buy', openedAt: opened, closedAt, status, lots: f.lots.v, entry: f.entry.v, stop: f.stop.v,
      exit: f.exit.v, result, ccy, risk: f.risk.v, pips: f.pips.v, plan: v('j-plan'), setup: v('j-setup'), notes: jq('j-notes').value.trim(),
      session: sess.tag, news: FXJ.newsNear(cal.data, ms, pair), inWindow: S.windows.length ? insideWindow(S.windows, ms) : null } };
  }
  function jSubmit(e) {
    e.preventDefault();
    const r = jReadForm();
    if (r.err) { jq('j-error').textContent = r.err; return; }
    const now = Date.now(), t = r.trade;
    if (jEditing) {
      const i = journal.trades.findIndex(x => x.id === jEditing);
      if (i >= 0) journal.trades[i] = { ...journal.trades[i], ...t, id: jEditing, updatedAt: now };
    } else journal.trades.push({ ...t, id: jNewId(), createdAt: now, updatedAt: now });
    S.journal.sinceBackup++; save();
    const saved = jSave();
    jdlg().close();
    jStatus(saved ? (jEditing ? 'Trade updated.' : 'Trade saved.') : journal.error, saved ? 'ok' : 'bad');
    renderJournal();
  }

  // ---- calculator hand-off
  function journalFromCalc() {
    if (!lastCalc) return;
    showTab('journal');
    jOpenForm(null, lastCalc);
  }
  function jFromCalcButton() {
    if (!lastCalc) return;
    const p = lastCalc;
    if (p.risk !== undefined) jq('j-risk').value = p.risk !== null ? String(p.risk) : '';
    if (p.lots !== undefined) jq('j-lots').value = p.lots !== null ? String(p.lots) : '';
    if (p.entry !== undefined) jq('j-entry').value = p.entry !== null ? String(p.entry) : '';
    if (p.stop !== undefined) jq('j-stop').value = p.stop !== null ? String(p.stop) : '';
    if (p.pair) jq('j-pair').value = p.pair; if (p.dir) jq('j-dir').value = p.dir; if (p.ccy) jq('j-ccy').value = p.ccy;
  }

  // ---- export, backup, restore
  function jDownload(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);
  function jExportCsv() {
    if (!journal.trades.length) return jStatus('There are no trades to export yet.', 'bad');
    jDownload('session-clock-journal-' + stamp() + '.csv', '﻿' + FXJ.toCsv(journal.trades), 'text/csv;charset=utf-8');   // the BOM makes Excel read accents correctly
    jStatus('CSV exported (' + journal.trades.length + ' trades).', 'ok');
  }
  function jBackup() {
    if (!journal.trades.length) return jStatus('There are no trades to back up yet.', 'bad');
    jDownload('session-clock-journal-' + stamp() + '.json', JSON.stringify({ app: 'session-clock-journal', version: 1, exportedAt: new Date().toISOString(), trades: journal.trades }, null, 1), 'application/json');
    S.journal.lastBackup = Date.now(); S.journal.sinceBackup = 0; save();
    jStatus('Backup saved (' + journal.trades.length + ' trades). Keep the file somewhere safe.', 'ok');
    renderJournal();
  }
  function jRestore(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => jStatus('Could not read that file.', 'bad');
    reader.onload = () => {
      let json;
      try { json = JSON.parse(String(reader.result)); } catch (e) { return jStatus('That file is not a journal backup (it is not valid JSON).', 'bad'); }
      const m = FXJ.mergeBackup(journal.trades, json, jNewId);
      if (m.error) return jStatus(m.error, 'bad');
      journal.trades = m.trades;
      const saved = jSave();
      jStatus(saved ? `Restored: ${m.added} added, ${m.skipped} already here, ${m.rejected} unreadable and skipped.` : journal.error, saved && !m.rejected ? 'ok' : 'bad');
      renderJournal();
    };
    reader.readAsText(file);
  }

  // ---- drawing
  function curveSvg(curve, ccy) {
    if (curve.length < 2) return '';
    const W = 640, H = 170, padL = 8, padR = 8, padT = 12, padB = 22;
    const ys = curve.map(p => p.equity).concat(0), lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
    const x = i => padL + (W - padL - padR) * i / (curve.length - 1), y = v => padT + (H - padT - padB) * (1 - (v - lo) / span);
    const pts = curve.map((p, i) => x(i).toFixed(1) + ',' + y(p.equity).toFixed(1)).join(' ');
    const last = curve[curve.length - 1].equity;
    return `<svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Equity curve: ${curve.length} trades, now ${sgn(last)} ${ccy}, lowest ${sgn(Math.min(...ys))}, highest ${sgn(Math.max(...ys))}">
      <line class="zero" x1="${padL}" x2="${W - padR}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>
      <polyline points="${pts}"/>
      <text x="${padL}" y="${H - 6}">${esc(whenTxt(curve[0].at))}</text>
      <text x="${W - padR}" y="${H - 6}" text-anchor="end">${esc(whenTxt(curve[curve.length - 1].at))}</text>
      <text x="${W - padR}" y="${(y(last) - 6).toFixed(1)}" text-anchor="end" class="end">${esc(sgn(last))} ${esc(ccy)}</text></svg>`;
  }
  function groupTable(title, groups, moneyCcy, open) {
    if (!groups.length) return '';
    const rows = groups.map(g => {
      const wr = g.winRate === null ? '—' : `${g.wins} of ${g.n} · ${pctTxt(g.winRate)}` + (!beginner() && g.winInterval ? `<small>${pctTxt(g.winInterval.lo)} to ${pctTxt(g.winInterval.hi)}</small>` : '');
      return `<tr><td>${esc(g.key)}</td><td class="num" data-label="Trades">${g.n}</td><td class="num" data-label="Won">${wr}</td>
        <td class="num ${g.net > 0 ? 'up' : g.net < 0 ? 'down' : ''}" data-label="Net ${esc(moneyCcy || '')}">${g.moneyN ? sgn(g.net) : '—'}</td>
        <td class="num" data-label="Average R">${g.avgR === null ? '—' : sgn(g.avgR)}</td><td class="rel" data-label="Reliability">${esc(g.label)}</td></tr>`;
    }).join('');
    return `<details class="jg"${open ? ' open' : ''}><summary>${esc(title)}</summary>
      <table class="mv"><thead><tr><th>Group</th><th class="num">Trades</th><th class="num">Won</th><th class="num">Net ${esc(moneyCcy || '')}</th><th class="num">Average R</th><th>Reliability</th></tr></thead><tbody>${rows}</tbody></table></details>`;
  }
  const tile = (k, v, sub) => `<div><dt>${k}</dt><dd>${v}${sub ? `<small>${sub}</small>` : ''}</dd></div>`;

  function renderJournal() {
    $('#jr-lead').textContent = beginner()
      ? 'A journal shows what you actually do, not what you remember doing. After about 30 trades it starts to show real patterns, such as which session or pair suits you. Until then, treat every percentage with caution.'
      : 'Log trades to see expectancy, R multiples and results by session, pair and behaviour. Groups under 30 trades are flagged, and win rates carry a 95% range.';
    const banner = $('#jr-banner'), n = journal.trades.length;
    const showBanner = journal.error || S.journal.sinceBackup >= 10 || (!S.journal.lastBackup && n >= 5);
    banner.hidden = !showBanner;
    if (showBanner) banner.innerHTML = journal.error ? `<b>${esc(journal.error)}</b>`
      : `<b>Back up your journal.</b> It lives only in this browser${S.journal.lastBackup ? ', and you have added or changed ' + S.journal.sinceBackup + ' trades since your last backup' : ', and has never been backed up'}. Press the <b>Back up</b> button on this page.`;

    const body = $('#jr-body');
    if (!n) {
      body.innerHTML = `<div class="note"><p><b>No trades yet.</b> Each trade you log is tagged with the session it opened in, and whether high-impact news was close by, so the journal can show which conditions suit you. You can also add a trade straight from the Calculator.</p><button type="button" class="primary" id="jr-add2">Log your first trade</button></div>`;
      return;
    }
    const s = FXJ.stats(journal.trades), open = journal.trades.filter(t => t.status === 'open').length, c = s.ccy || 'USD';
    if (!s.n) {
      body.innerHTML = `<div class="note">${open} open trade${open === 1 ? '' : 's'} logged. Statistics appear once a trade is closed. Edit an open trade to add its result.</div>` + listHtml();
      return;
    }
    const tiles = beginner() ? [
      tile('Trades closed', String(s.n), open ? open + ' still open' : ''),
      tile(termBtn('Win rate', 'win-rate'), `${s.wins} of ${s.n}`, pctTxt(s.winRate) + (s.winInterval ? ' · the real rate could be anywhere from ' + pctTxt(s.winInterval.lo) + ' to ' + pctTxt(s.winInterval.hi) : '')),
      tile('Net result', `<span class="${s.net > 0 ? 'up' : s.net < 0 ? 'down' : ''}">${sgn(s.net)} ${esc(c)}</span>`, s.otherCcy ? s.otherCcy + ' trade' + (s.otherCcy === 1 ? '' : 's') + ' in another currency left out' : ''),
      tile('Average win and loss', s.avgWin === null && s.avgLoss === null ? '—' : `${s.avgWin === null ? '—' : sgn(s.avgWin)} and ${s.avgLoss === null ? '—' : sgn(s.avgLoss)}`, s.payoff ? 'wins are ' + fmt(s.payoff, 1) + ' times the size of losses' : ''),
    ] : [
      tile('Trades', String(s.n), open ? open + ' open' : ''),
      tile('Win rate', pctTxt(s.winRate), s.winInterval ? '95%: ' + pctTxt(s.winInterval.lo) + ' to ' + pctTxt(s.winInterval.hi) : ''),
      tile('Net', `<span class="${s.net > 0 ? 'up' : s.net < 0 ? 'down' : ''}">${sgn(s.net)} ${esc(c)}</span>`, s.otherCcy ? s.otherCcy + ' excluded (other currency)' : ''),
      tile('Expectancy', s.expectancy === null ? '—' : sgn(s.expectancy) + ' ' + esc(c), 'per trade' + (s.avgR !== null ? ' · ' + sgn(s.avgR) + 'R over ' + s.rN : '')),
      tile('Profit factor', s.profitFactor === null ? '—' : fmt(s.profitFactor, 2), s.payoff ? 'payoff ' + fmt(s.payoff, 2) : ''),
      tile('Average win / loss', `${s.avgWin === null ? '—' : sgn(s.avgWin)} / ${s.avgLoss === null ? '—' : sgn(s.avgLoss)}`),
      tile('Max drawdown', fmt(s.maxDrawdown) + ' ' + esc(c), 'closed-trade equity'),
      tile('Streaks', `${s.maxWinRun}W / ${s.maxLoseRun}L`, 'longest'),
    ];
    const warn = s.n < 30 ? `<p class="hint jr-warn">${s.n} trade${s.n === 1 ? '' : 's'} is ${s.n < 10 ? 'far too few' : 'still early'} to draw conclusions. Percentages from small samples swing wildly. Around 30 or more starts to mean something.</p>` : '';

    const by = { session: FXJ.groupStats(journal.trades, t => t.session || null), pair: FXJ.groupStats(journal.trades, t => t.pair),
      plan: FXJ.groupStats(journal.trades, t => ({ yes: 'Followed my plan', partly: 'Partly followed', no: 'Did not follow my plan' })[t.plan] || null),
      win: FXJ.groupStats(journal.trades, t => t.inWindow === true ? 'Inside my trading window' : t.inWindow === false ? 'Outside my trading window' : null),
      news: FXJ.groupStats(journal.trades, t => t.news === true ? 'Opened within 30 min of high-impact news' : t.news === false ? 'No high-impact news nearby' : null),
      day: FXJ.groupStats(journal.trades, t => new Date(t.openedAt).toLocaleDateString('en-GB', { weekday: 'long' })),
      dir: FXJ.groupStats(journal.trades, t => t.dir === 'buy' ? 'Buys' : 'Sells') };
    const obs = FXJ.observations(by.session, 'By session').concat(FXJ.observations(by.pair, 'By pair'), FXJ.observations(by.plan, 'By discipline'), FXJ.observations(by.win, 'By trading window'));
    const tables = groupTable('By session when the trade opened', by.session, c, true) + groupTable('By pair', by.pair, c) +
      groupTable('By whether you followed your plan', by.plan, c) + groupTable('By whether it was inside your trading window', by.win, c) + groupTable('By news', by.news, c) +
      (beginner() ? '' : groupTable('By weekday', by.day, c) + groupTable('Buys and sells', by.dir, c));

    body.innerHTML = `<dl class="cgrid jr-tiles">${tiles.join('')}</dl>${warn}
      ${s.curve.length >= 2 ? `<h3 class="sect">Running total</h3>${curveSvg(s.curve, c)}` : ''}
      ${obs.length ? `<h3 class="sect">What stands out</h3><ul class="anotes jr-obs">${obs.map(o => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
      <h3 class="sect">Breakdowns</h3>${tables}${listHtml()}`;
  }

  function listHtml() {
    const rows = journal.trades.slice().sort((a, b) => b.openedAt - a.openedAt);
    const shown = jShowAll ? rows : rows.slice(0, 30);
    const html = shown.map(t => {
      const r = FXJ.rOf(t), isOpen = t.status === 'open';
      const res = isOpen ? '<b class="imp medium">OPEN</b>' : `<span class="${t.result > 0 ? 'up' : t.result < 0 ? 'down' : ''}">${sgn(t.result)} ${esc(t.ccy)}</span>${r !== null ? `<small>${sgn(r)}R</small>` : ''}`;
      const flags = [t.session, t.plan ? ({ yes: 'followed plan', partly: 'partly followed plan', no: 'did not follow plan' })[t.plan] : '', t.news === true ? 'news nearby' : '', t.setup].filter(Boolean).map(esc).join(' · ');
      const confirming = jConfirm === t.id;
      return `<li class="jt" data-id="${esc(t.id)}">
        <span class="jt-when">${esc(whenTxt(t.openedAt))}<small>${t.lots ? esc(String(t.lots)) + ' lots' : ''}</small></span>
        <span class="jt-what"><b>${esc(t.pair)}</b> ${t.dir === 'buy' ? 'Buy' : 'Sell'}${flags ? `<small>${flags}</small>` : ''}${t.notes ? `<small class="jt-notes">${esc(t.notes.length > 140 ? t.notes.slice(0, 140) + '…' : t.notes)}</small>` : ''}</span>
        <span class="jt-res">${res}</span>
        <span class="jt-act"><button type="button" class="plain" data-act="edit">${isOpen ? 'Close or edit' : 'Edit'}</button>
          <button type="button" class="plain${confirming ? ' danger' : ''}" data-act="del">${confirming ? 'Really delete?' : 'Delete'}</button></span></li>`;
    }).join('');
    return `<h3 class="sect">Trades</h3><ul class="jlist">${html}</ul>` +
      (rows.length > 30 ? `<p><button type="button" class="plain" id="jr-more">${jShowAll ? 'Show only the latest 30' : 'Show all ' + rows.length + ' trades'}</button></p>` : '');
  }

  function jInit() {
    jLoad();
    jq('jr-form').addEventListener('submit', jSubmit);
    jq('jr-cancel').addEventListener('click', () => jdlg().close());
    jq('jr-cancel2').addEventListener('click', () => jdlg().close());
    jq('j-status').addEventListener('change', jToggleClosed);
    jq('j-ccy').addEventListener('input', () => { jq('j-ccy-label').textContent = jq('j-ccy').value.toUpperCase() || 'your currency'; });
    jq('j-fromcalc').addEventListener('click', jFromCalcButton);
    jdlg().addEventListener('click', e => { if (e.target === jdlg()) jdlg().close(); });
    $('#jr-add').addEventListener('click', () => jOpenForm(null, null));
    $('#jr-csv').addEventListener('click', jExportCsv);
    $('#jr-backup').addEventListener('click', jBackup);
    $('#jr-restore').addEventListener('click', () => $('#jr-file').click());
    $('#jr-file').addEventListener('change', e => { jRestore(e.target.files[0]); e.target.value = ''; });
    $('#jr-body').addEventListener('click', e => {
      if (e.target.closest('#jr-add2')) { jOpenForm(null, null); return; }
      const more = e.target.closest('#jr-more'); if (more) { jShowAll = !jShowAll; renderJournal(); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = b.closest('.jt').dataset.id, t = journal.trades.find(x => x.id === id);
      if (!t) return;
      if (b.dataset.act === 'edit') { jConfirm = null; jOpenForm(t, null); return; }
      if (jConfirm !== id) {                                    // first click asks; second click deletes
        jConfirm = id; renderJournal(); setTimeout(() => { if (jConfirm === id) { jConfirm = null; renderJournal(); } }, 4000); return;
      }
      journal.trades = journal.trades.filter(x => x.id !== id); jConfirm = null;
      S.journal.sinceBackup++; save();
      jStatus(jSave() ? 'Trade deleted.' : journal.error, 'ok'); renderJournal();
    });
    renderJournal();
  }

  // ---- my trading window -------------------------------------------------------------------
  // The hours you chose to trade, in your own clock. The maths is in logic.js (windowNow, windowOutlook) and is tested,
  // including windows that cross midnight and daylight saving changes. This part draws the card and edits the hours.

  S.windows = Array.isArray(S.windows) ? S.windows.filter(w => w && windowProblems(w).length === 0) : [];
  const winAlerted = {}, winOutlookCache = {};
  const DAY_ORDER = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
  const wdlg = () => document.getElementById('win-dialog');
  const wq = sel => wdlg().querySelector(sel);
  const winId = () => 'w_' + Math.random().toString(36).slice(2, 8);

  // The outlook is a scan of the whole window, so compute it once per occurrence, and again when the calendar changes.
  function outlookFor(span) {
    const key = span.w.id + '|' + span.start + '|' + (cal.data ? cal.data.generatedAt : 0);
    if (!winOutlookCache[key]) winOutlookCache[key] = windowOutlook(span, cal.data, S.newsCcy);
    return winOutlookCache[key];
  }
  function outlookLines(o) {
    const L = window.FX.LEVELS;
    const order = ['peak', 'good', 'steady', 'quiet', 'closed'];
    const parts = order.filter(k => o.minutes[k] > 0).map(k => `${L[k].word} ${span(o.minutes[k] * 60000)}`).join(' · ');
    const lines = [];
    lines.push(o.top === 'closed' && o.minutes.closed === o.totalMinutes ? 'The market is closed for the whole window.' : beginner()
      ? `For most of it the market should be rated <b>${esc(L[o.top].begin)}</b>. ${esc(parts)}.`
      : `Scheduled: ${esc(parts)}`);
    lines.push(o.sessions.length ? `Sessions open in it: ${esc(o.sessions.join(', '))}.` : 'None of the four sessions is open during it.');
    if (o.news === null) lines.push('News: the calendar is not loaded, so news in this window is unknown.');
    else if (!o.news.length) lines.push('No high-impact news in this window.');
    else lines.push(`<b>High-impact news in this window:</b> ${esc(o.news.slice(0, 3).map(e => e.ccy + ' ' + e.title + ' at ' + hm.format(e.at)).join(', '))}${o.news.length > 3 ? ' and ' + (o.news.length - 3) + ' more' : ''}.`);
    o.holidays.forEach(h => lines.push(`<b>Bank holiday:</b> ${esc(h)}.`));
    return lines;
  }

  function renderMyWindow(ms, wn) {
    const el = $('#mywin-body');
    if (!S.windows.length) {
      setHTML(el, `<p class="hint">${beginner()
        ? 'Choose the hours you actually plan to trade. The app will tell you when you are inside them, what the market and the news will be doing during them, and warn you before they start.'
        : 'Set your trading hours for a window outlook, a pre-start warning, and a journal tag for trades taken outside them.'}</p>
        <button type="button" class="primary" id="win-edit">Set my trading hours</button>`);
      return;
    }
    const inside = !!wn.inside, sp = wn.inside || wn.next;
    if (!sp) { setHTML(el, '<p class="hint">Your windows have no upcoming occurrence. Check the days you chose.</p><button type="button" id="win-edit" class="plain">Edit my hours</button>'); return; }
    const o = outlookFor(sp);
    const head = inside
      ? `Ends ${both(sp.end)} · in ${relTime(sp.end - ms)}`
      : `Next: ${dayHead(sp.start, ms)} ${both(sp.start)} to ${hm.format(sp.end)} · in ${relTime(sp.start - ms)}`;
    setHTML(el, `<div class="wstate ${inside ? 'in' : 'out'}"><b>${inside ? 'In your window' : 'Outside your window'}</b><span>${esc(sp.w.name)}</span></div>
      <div class="wline">${head}</div>
      <ul class="wout">${outlookLines(o).map(l => `<li>${l}</li>`).join('')}</ul>
      <button type="button" id="win-edit" class="plain">Edit my hours</button>`);
  }

  // A sound and a notification shortly before a window starts.
  function checkWindowAlert(ms, wn) {
    if (!S.winLead || !wn.next) return;
    const n = wn.next, until = n.start - ms;
    if (until <= 0 || until > S.winLead * 60000) return;
    const key = n.w.id + '|' + n.start;
    if (winAlerted[key]) return;
    winAlerted[key] = true;
    const o = outlookFor(n), mins = Math.max(1, Math.round(until / 60000));
    if (S.sound) chime(587.33, true);
    if (S.notify) showNotification('Your trading window starts in ' + mins + ' min',
      n.w.name + ', ' + both(n.start) + ' to ' + hm.format(n.end) + '. ' + window.FX.LEVELS[o.top].begin + '.' +
      (o.news && o.news.length ? ' News: ' + o.news[0].ccy + ' ' + o.news[0].title + '.' : ''), 'fx-win-' + key);
  }

  // ---- the editor
  function winRowHtml(w, i) {
    const days = DAY_ORDER.map(([n, l]) => `<label class="check"><input type="checkbox" class="w-day" data-d="${n}"${w.days.includes(n) ? ' checked' : ''}> ${l}</label>`).join('');
    return `<fieldset class="winrow" data-id="${esc(w.id)}"><legend>Window ${i + 1}</legend>
      <label class="field">Name <input type="text" class="w-name" maxlength="30" value="${esc(w.name || '')}" placeholder="London morning"></label>
      <div class="field">Days<div class="checks">${days}</div></div>
      <div class="wtimes"><label class="field">From <input type="time" class="w-start" value="${esc(w.start)}"></label>
        <label class="field">To <input type="time" class="w-end" value="${esc(w.end)}"></label></div>
      <button type="button" class="plain w-del">Remove this window</button></fieldset>`;
  }
  let winDraft = [];
  function winRender() { wq('#win-rows').innerHTML = winDraft.length ? winDraft.map(winRowHtml).join('') : '<p class="hint">No windows yet. Add one below.</p>'; }
  function winReadRows() {
    return [...wdlg().querySelectorAll('.winrow')].map((row, i) => ({
      id: row.dataset.id, name: row.querySelector('.w-name').value.trim() || 'Window ' + (i + 1),
      days: [...row.querySelectorAll('.w-day:checked')].map(c => Number(c.dataset.d)),
      start: row.querySelector('.w-start').value, end: row.querySelector('.w-end').value }));
  }
  function winOpen() {
    winDraft = S.windows.map(w => ({ ...w, days: w.days.slice() }));
    const ms = Date.now(), tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    wq('#win-tz').textContent = tz;
    // Presets use today's real times in your clock. Clocks change twice a year, so edit them then.
    const ov = overlapWindow(ms, 'lon', 'nyc'), lon = SESSIONS.find(s => s.key === 'lon');
    const lonStart = isOpen(lon, ms) ? lastWindow(lon, ms).start : nextFlip(lon, ms);
    wq('#win-preset-overlap').textContent = ov ? `Add London + New York overlap (${hm.format(ov.start)} to ${hm.format(ov.end)})` : '';
    wq('#win-preset-overlap').hidden = !ov; wq('#win-preset-overlap').dataset.s = ov ? hm.format(ov.start) : ''; wq('#win-preset-overlap').dataset.e = ov ? hm.format(ov.end) : '';
    wq('#win-preset-london').textContent = `Add London's first 3 hours (${hm.format(lonStart)} to ${hm.format(lonStart + 3 * 3600000)})`;
    wq('#win-preset-london').dataset.s = hm.format(lonStart); wq('#win-preset-london').dataset.e = hm.format(lonStart + 3 * 3600000);
    wq('#win-error').textContent = '';
    winRender();
    if (!wdlg().open) wdlg().showModal();
  }
  function winSave(e) {
    e.preventDefault();
    const list = winReadRows();
    if (list.length > 5) { wq('#win-error').textContent = 'Five windows is the most.'; return; }
    for (const [i, w] of list.entries()) {
      const p = windowProblems(w);
      if (p.length) { wq('#win-error').textContent = `Window ${i + 1}: ${p[0]}`; return; }
    }
    S.windows = list; save(); barDay = null;                      // redraw the timeline row
    wdlg().close(); tick();
  }
  function winInit() {
    wq('#win-form').addEventListener('submit', winSave);
    wq('#win-cancel').addEventListener('click', () => wdlg().close());
    wq('#win-add').addEventListener('click', () => {
      winDraft = winReadRows(); winDraft.push({ id: winId(), name: '', days: [1, 2, 3, 4, 5], start: '', end: '' }); winRender();
    });
    for (const id of ['#win-preset-overlap', '#win-preset-london']) wq(id).addEventListener('click', e => {
      const b = e.currentTarget; winDraft = winReadRows();
      winDraft.push({ id: winId(), name: id.endsWith('overlap') ? 'London + New York overlap' : 'London morning', days: [1, 2, 3, 4, 5], start: b.dataset.s, end: b.dataset.e }); winRender();
    });
    wq('#win-rows').addEventListener('click', e => {
      if (!e.target.closest('.w-del')) return;
      const id = e.target.closest('.winrow').dataset.id; winDraft = winReadRows().filter(w => w.id !== id); winRender();
    });
    wq('#win-clear').addEventListener('click', () => { winDraft = []; winRender(); });
    wdlg().addEventListener('click', e => { if (e.target === wdlg()) wdlg().close(); });
    app.addEventListener('click', e => { if (e.target.closest('#win-edit')) winOpen(); });
  }

  // ---- best pairs for the next few hours -----------------------------------------------------
  // The scoring is in logic.js (pairOutlook) and is tested. It is a guide to conditions, never to direction.

  let poShowAll = false, poKey = '';
  function renderPairsOutlook(ms) {
    const list = $('#po-list');
    if (!list) return;
    const hours = [1, 2, 4].includes(S.pairsHours) ? S.pairsHours : 2;
    const mine = (S.myPairs || []).filter(p => PAIRS[p]);
    const useMine = S.pairsView === 'mine';
    // Recompute once a minute, or when a setting or the calendar changes.
    const key = [Math.floor(ms / 60000), hours, S.pairsView, mine.join(), S.newsCcy ? S.newsCcy.join() : '', cal.data ? cal.data.generatedAt : 0, poShowAll, S.level].join('|');
    if (key === poKey) return;
    poKey = key;
    if (useMine && !mine.length) {
      setHTML(list, '<li class="evempty">Choose the pairs you trade under Settings, "Pairs I trade", or switch to "All pairs".</li>');
      $('#po-window').textContent = ''; $('#po-more').hidden = true; return;
    }
    const o = pairOutlook(ms, hours, useMine ? mine : null, cal.data, S.newsCcy);
    $('#po-window').textContent = 'Next ' + hours + (hours === 1 ? ' hour' : ' hours') + ', ' + hm.format(o.from) + ' to ' + hm.format(o.to) + ' your time.' +
      (o.newsKnown ? '' : ' News is not counted because the calendar is not loaded.');
    const shown = poShowAll ? o.rows : o.rows.slice(0, 3);
    const html = shown.map((r, i) => {
      const nm = (PAIRS[r.pair] || '');
      const newsShort = r.news ? (r.news.kind === 'soon' ? 'news soon' : r.news.kind === 'recent' ? 'news just out' : 'news later') : 'no news';
      const detail = beginner()
        ? r.reasons.filter((x, i) => i !== 1).map(x => `<span>${esc(x)}.</span>`).join('')      // the cost class sits beside the name instead
        : `<span>${Math.round(r.homeOpen * 100)}% home open · ${esc(r.cls)} · ${esc(newsShort)}</span>`;
      return `<li class="po"><span class="pr">${i + 1}</span><span class="pp"><b>${esc(r.pair)}</b>${beginner() ? `<small>${nm ? esc(nm) + ' · ' : ''}${esc(r.cls)}</small>` : ''}</span>
        <span class="ps">${r.score}</span><span class="pd">${detail}</span></li>`;
    }).join('');
    setHTML(list, (o.marketQuiet ? '<li class="evempty">Very little is open in this window, so every score is low.</li>' : '') + html);
    const more = $('#po-more');
    more.hidden = o.rows.length <= 3;
    more.textContent = poShowAll ? 'Show only the top 3' : 'Show all ' + o.rows.length + ' pairs';
    setHTML($('#po-how'), beginner()
      ? rich('The score is out of 100. It rewards pairs whose two currencies both have their home markets open, that usually cost less, and that have no high-impact news. It measures conditions only. It says nothing about which way price will go.')
      : 'Score = 60 × share of the window both currencies\' home markets are open + 15 if both open throughout + cost class (major 25, gold 20, cross 15, exotic 5) − news (35 within 30 min, 25 just released, 15 later). Schedule and holidays only, no price data.');
  }

  function poInit() {
    $('#po-hours').value = String([1, 2, 4].includes(S.pairsHours) ? S.pairsHours : 2);
    $('#po-view').value = S.pairsView === 'mine' ? 'mine' : 'all';
    $('#po-hours').addEventListener('change', e => { S.pairsHours = +e.target.value; save(); poKey = ''; renderPairsOutlook(Date.now()); });
    $('#po-view').addEventListener('change', e => { S.pairsView = e.target.value; save(); poKey = ''; renderPairsOutlook(Date.now()); });
    $('#po-more').addEventListener('click', () => { poShowAll = !poShowAll; renderPairsOutlook(Date.now()); });
    const det = $('#pairsout');
    det.open = !!S.pairsOpen;
    det.addEventListener('toggle', () => { S.pairsOpen = det.open; save(); if (det.open) { poKey = ''; renderPairsOutlook(Date.now()); } });
    renderPairsOutlook(Date.now());
  }

  // The compact strip has no room for the Best pairs card, so it shows the top pairs from the same ranking as chips.
  let cpKey = '';
  function renderCompactPairs(ms) {
    const mine = (S.myPairs || []).filter(p => PAIRS[p]);
    const key = Math.floor(ms / 60000) + '|' + mine.join() + '|' + (cal.data ? cal.data.generatedAt : 0);
    if (key === cpKey) return;
    cpKey = key;
    const o = pairOutlook(ms, 1, mine.length ? mine : null, cal.data, S.newsCcy);
    setHTML($('#a-pairs'), o.rows.slice(0, 5).map(r => `<li><b>${esc(r.pair)}</b></li>`).join(''));
  }

  // ---- the tick ----------------------------------------------------------------

  const LEVEL_ORDER = ['closed', 'quiet', 'steady', 'good', 'peak'];
  let lastMinute = -1, ov = null, lastTick = 0;

  function tick() {
    const ms = Date.now();
    // If the clock jumped backwards (a time sync, or waking from sleep), cached "next" times are stale.
    if (ms < lastTick - 5000) { Object.keys(flips).forEach(k => delete flips[k]); ov = null; lastMinute = -1; barDay = null; }
    lastTick = ms;
    const now = new Date(ms);
    $('#clock').textContent = now.toLocaleTimeString('en-GB', { hourCycle: 'h23' });
    $('#date').textContent = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const cc = chartTime(ms), exn = S.broker === 'exness';
    $('#chartclock').hidden = !cc && !exn;
    $('#chartclock').innerHTML = cc
      ? (exn ? 'Exness chart time' : 'Chart time') + ' (' + offsetLabel(chartOff()) + '): <b>' + cc + ':' + pad(now.getUTCSeconds()) + '</b>'
      : (exn ? 'Exness chart time (UTC+0) is the same as your time.' : '');

    const d0 = new Date(ms); d0.setHours(0, 0, 0, 0);
    if (barDay !== d0.getTime()) drawBars(ms);
    const frac = (ms - d0.getTime()) / 86400000;

    SESSIONS.forEach(s => {
      const on = isOpen(s, ms);
      const hol = on ? holidayName(s.key, ms) : null;   // open on the clock, but shut for a bank holiday
      const justOpened = on && prevOpen[s.key] === false;
      prevOpen[s.key] = on;
      if (!flips[s.key] || flips[s.key].at <= ms) flips[s.key] = { at: nextFlip(s, ms) };
      const at = flips[s.key].at;
      if (justOpened && !hol) onOpened(s, at);   // no "it opened" chime on a holiday
      if (!on && at && S.headsUp && at - ms <= S.headsUp * 60000 && !warned[s.key + at]) {
        warned[s.key + at] = true;
        onHeadsUp(s, at, Math.max(1, Math.round((at - ms) / 60000)));
      }

      const row = rowOf(s.key);
      row.classList.toggle('open', on && !hol);
      row.classList.toggle('holiday', !!hol);
      const lp = parts(s.tz, ms);
      row.querySelector('.st').textContent = on ? (hol ? 'HOLIDAY' : 'OPEN') : 'CLOSED';
      row.querySelector('.lc').textContent = pad(lp.h) + ':' + pad(lp.m) + ' in ' + s.city;
      const w = lastWindow(s, ms);
      row.querySelector('.win').innerHTML = on
        ? 'Closes ' + both(at) + '<small>' + (hol ? 'Bank holiday: ' + esc(hol) : hm.format(w.start) + ' to ' + hm.format(w.end) + ' your time') + '</small>'
        : 'Opens ' + (at ? both(at) : '—') + '<small>' + (at ? dayName.format(at) : '') + '</small>';
      row.querySelector('.ct').innerHTML = (at ? hms(at - ms) : '—') + '<small>' + (on ? 'until close' : 'until open') + '</small>';
      row.setAttribute('aria-label', s.name + ', ' + (on ? (hol ? 'open on the clock but a bank holiday, ' + hol : 'open') : 'closed'));

      const bar = $('.tbar[data-k="' + s.key + '"]');
      let nl = bar.querySelector('.nowline');
      if (!nl) { nl = document.createElement('div'); nl.className = 'nowline'; bar.appendChild(nl); }
      nl.style.left = (frac * 100) + '%';
    });
    const mineBar = $('.tbar[data-k="mine"]');
    if (mineBar) {
      let nl = mineBar.querySelector('.nowline');
      if (!nl) { nl = document.createElement('div'); nl.className = 'nowline'; mineBar.appendChild(nl); }
      nl.style.left = (frac * 100) + '%';
    }

    // ---- the answer
    const a = assess(ms, cal.data, S.newsCcy);
    const wn = windowNow(S.windows, ms);
    const ans = $('#answer');
    if (ans.dataset.level !== a.level) ans.dataset.level = a.level;
    setHTML($('#a-label'), esc(beginner() ? a.label : a.word));
    setHTML($('#a-tag'), rich(a.tag));
    setHTML($('#a-reason'), rich(a.reason + (a.nextOpen ? ' ' + a.nextOpen.s.name + ' opens ' + both(a.nextOpen.at) + '.' : '')));
    setHTML($('#a-meaning'), rich(a.meaning));

    const g = beginner()
      ? [['How busy', a.plain.busy], ['Costs (spread)', a.plain.cost], ['Price movement', a.plain.move]]
      : [['Liquidity', a.tech.liq], ['Spread', a.tech.spr], ['Volatility', a.tech.vol]];
    setHTML($('#gauges'), g.map(([k, v]) => `<div><dt>${rich(k)}</dt><dd>${esc(v)}</dd></div>`).join(''));

    $('#scale').querySelectorAll('span').forEach(sp => sp.classList.toggle('on', sp.dataset.l === a.level));
    $('#scale').setAttribute('aria-label', 'Level: ' + a.word + '. The scale runs ' + LEVEL_ORDER.join(', ') + '.');

    // ---- the clock says one thing; is today actually behaving that way?
    const hk = headKey(a), la = hk ? liveAct[hk] : null, hs = hk && sessionByKey(hk);
    let liveHtml = '';
    if (hs) {
      const k1 = beginner() ? 'By the clock' : 'Scheduled', k2 = beginner() ? 'Today so far' : 'Live activity';
      let v2;
      if (!S.apiKey) v2 = '<button type="button" class="linklike" id="live-settings">Turn on price data</button>';
      else if (F(hk).error) v2 = 'Unavailable';
      else if (!F(hk).at) v2 = 'Checking…';
      else if (!la) v2 = 'Not enough data yet';
      else v2 = { more: 'Busier than usual', less: 'Quieter than usual', same: 'About usual' }[la.label];
      const detail = la ? (beginner()
        ? 'Bigger range than ' + la.smaller + ' of the last ' + la.n + ' ' + hs.name + ' sessions at this point.'
        : la.pairs + ' pairs · larger than ' + la.smaller + ' of ' + la.n + ' ' + hs.name + ' sessions') : '';
      liveHtml = `<div><span class="k">${k1}</span><span class="v">${esc(beginner() ? a.label : a.word)}</span></div>
        <div><span class="k">${k2}</span><span class="v">${v2}</span></div>${detail ? `<p class="hint">${esc(detail)}</p>` : ''}`;
    }
    setHTML($('#a-live'), liveHtml);

    const extra = [];
    if (la && (a.level === 'peak' || a.level === 'good') && la.label === 'less')
      extra.push({ warn: true, text: 'Busy on the clock, but today is running quieter than usual for this point in the session. Expect smaller moves than the label suggests.' });
    if (la && (a.level === 'steady' || a.level === 'quiet') && la.label === 'more')
      extra.push({ warn: true, text: 'Quiet on the clock, but today is busier than usual for this point in the session. Something may be moving the market, so check the news.' });
    if (wn.inside && (a.level === 'quiet' || a.level === 'closed'))
      extra.push({ warn: false, text: 'You are inside your trading window (' + wn.inside.w.name + '), but the market is ' + (a.level === 'closed' ? 'closed' : 'quiet') + '.' });
    const all = a.notes.concat(extra).sort((x, y) => (y.warn ? 1 : 0) - (x.warn ? 1 : 0));   // cautions first
    setHTML($('#a-notes'), all.map(n => `<li class="${n.warn ? 'warn' : ''}">${rich(n.text)}</li>`).join(''));
    if (fewer()) renderCompactPairs(ms);

    // ---- coming up
    if (!ov || ms >= (ov.active ? ov.end : ov.start)) ov = overlapWindow(ms, 'lon', 'nyc');
    ov && (ov.active = ms >= ov.start && ms < ov.end);
    const win = ov
      ? `<div><span class="k">${beginner() ? 'Busiest time of day' : 'London + New York overlap'}</span><span class="v">${ov.active
          ? 'Now, until ' + both(ov.end) + ' · ' + span(ov.end - ms) + ' left'
          : both(ov.start) + ' to ' + hm.format(ov.end) + ' · in ' + span(ov.start - ms)}</span></div>` : '';
    let week = '';
    if (S.broker === 'exness') {
      const w = marketWeek(ms);
      week = `<div><span class="k">Exness forex week</span><span class="v">${w.openNow
        ? 'Closes ' + dayName.format(w.nextClose) + ' ' + both(w.nextClose) + ' · in ' + hms(w.nextClose - ms).replace(/:\d\d$/, '')
        : 'Reopens ' + dayName.format(w.nextOpen) + ' ' + both(w.nextOpen) + ' · in ' + hms(w.nextOpen - ms).replace(/:\d\d$/, '')}</span></div>`;
    }
    const dayLabel = ymd => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const hols = upcomingHolidays(ms, 7).slice(0, 4).map(h =>
      `<div><span class="k">${rich('Bank holiday')} · ${h.today ? 'today' : dayLabel(h.date)}</span><span class="v">${esc(h.country)}: ${esc(h.name)}</span></div>`).join('');
    setHTML($('#coming'), win + week + hols);

    // ---- once a minute: overview progress, key times, first-run banner
    const minute = Math.floor(ms / 60000);
    checkNewsAlerts(ms);
    renderNews();
    renderMyWindow(ms, wn);
    checkWindowAlert(ms, wn);
    if (S.pairsOpen) renderPairsOutlook(ms);
    if (minute !== lastMinute) { lastMinute = minute; refreshLive(); renderOverview(); paintCalStatus(); }
    if (S.apiKey && !document.hidden) { if (S.selected) fetchFeed(S.selected, false); if (hk) fetchFeed(hk, false); }

    document.title = a.word + ' · Session Clock';
  }

  // ---- terms: tap an underlined word for its meaning ---------------------------

  const termSheet = document.getElementById('term-sheet');
  const byId = id => GLOSSARY.find(g => g.id === id);
  let sheetTerm = null;
  function openTerm(id) {
    const g = byId(id); if (!g) return;
    sheetTerm = id;
    termSheet.querySelector('#ts-level').textContent = GLEVELS[g.level] + ' · ' + g.cat;
    termSheet.querySelector('#ts-term').textContent = g.term;
    termSheet.querySelector('#ts-short').textContent = g.short;
    termSheet.querySelector('#ts-long').textContent = g.long;
    const ex = termSheet.querySelector('#ts-ex');
    ex.hidden = !g.example; ex.textContent = g.example ? 'Example: ' + g.example : '';
    if (!termSheet.open) termSheet.showModal();
  }
  termSheet.querySelector('#ts-close').addEventListener('click', () => termSheet.close());
  termSheet.querySelector('#ts-open').addEventListener('click', () => { termSheet.close(); jumpTo(sheetTerm); });
  termSheet.addEventListener('click', e => { if (e.target === termSheet) termSheet.close(); });
  app.addEventListener('click', e => {
    const t = e.target.closest('.term'); if (t) openTerm(t.dataset.t);
    if (e.target.closest('#live-settings')) openSettings();
    if (e.target.closest('#calc-to-journal')) journalFromCalc();
    const go = e.target.closest('[data-go]'); if (go) showTab(go.dataset.go);
    const gj = e.target.closest('[data-g]'); if (gj) jumpTo(gj.dataset.g);
  });

  // ---- glossary ------------------------------------------------------------------

  const G = { q: '', level: 'all', cat: 'all' };
  const START_IDS = ['pip', 'spread', 'lot', 'leverage', 'margin', 'stop-loss-sl', 'bid-and-ask', 'trading-session'];
  const sorted = GLOSSARY.slice().sort((a, b) => a.term.localeCompare(b.term, 'en', { sensitivity: 'base' }));

  $('#gl-levels').innerHTML = [['all', 'All levels'], ['b', 'Basics'], ['i', 'Intermediate'], ['a', 'Advanced']]
    .map(([k, l]) => `<button type="button" data-lv="${k}" aria-pressed="${k === 'all'}">${l}</button>`).join('');
  $('#gl-cat').innerHTML = '<option value="all">All topics</option>' + GCATS.map(c => `<option>${esc(c)}</option>`).join('');
  $('#gl-lead').textContent = 'Plain-English meanings for every term used in this app and on most trading platforms. Each has a one-line answer first, and more detail when you open it.';
  $('#gl-start-list').innerHTML = START_IDS.map(id => `<li><button type="button" data-g="${id}">${esc(byId(id).term)}</button></li>`).join('');

  function renderGlossary() {
    const q = G.q.trim().toLowerCase();
    const items = sorted.filter(g =>
      (G.level === 'all' || g.level === G.level) &&
      (G.cat === 'all' || g.cat === G.cat) &&
      (!q || (g.term + ' ' + g.short + ' ' + g.long).toLowerCase().includes(q)));
    $('#gl-count').textContent = items.length === GLOSSARY.length ? GLOSSARY.length + ' terms' : items.length + ' of ' + GLOSSARY.length + ' terms';
    $('#gl-start').hidden = !beginner() || !!q || G.level !== 'all' || G.cat !== 'all';
    if (!items.length) { $('#gl-list').innerHTML = '<p class="gl-empty">No term matches. Try a shorter word, or clear the filters.</p>'; return; }
    let letter = '', html = '';
    for (const g of items) {
      const L = g.term[0].toUpperCase();
      if (L !== letter) { letter = L; html += `<h3 class="gl-letter">${L}</h3>`; }
      html += `<details class="gterm" id="g-${g.id}">
        <summary><span class="gt">${esc(g.term)}</span><span class="gl-tag ${g.level}">${GLEVELS[g.level]}</span><span class="gs">${esc(g.short)}</span></summary>
        <div class="gbody"><p>${esc(g.long)}</p>
          ${g.example ? `<p class="ex"><b>Example.</b> ${esc(g.example)}</p>` : ''}
          <div class="see"><span>${esc(g.cat)}</span>${g.see.map(id => byId(id) ? `<button type="button" data-g="${id}">${esc(byId(id).term)}</button>` : '').join('')}</div>
        </div></details>`;
    }
    $('#gl-list').innerHTML = html;
  }
  $('#gl-q').addEventListener('input', e => { G.q = e.target.value; renderGlossary(); });
  $('#gl-cat').addEventListener('change', e => { G.cat = e.target.value; renderGlossary(); });
  $('#gl-levels').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    G.level = b.dataset.lv;
    $('#gl-levels').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderGlossary();
  });

  function jumpTo(id) {
    if (!byId(id)) return;
    G.q = ''; G.level = 'all'; G.cat = 'all';
    $('#gl-q').value = ''; $('#gl-cat').value = 'all';
    $('#gl-levels').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.lv === 'all')));
    renderGlossary();
    showTab('glossary', id);
    const el = $('#g-' + id);
    if (el) {
      el.open = true; el.classList.add('flash');
      el.scrollIntoView({ block: 'start' });
      setTimeout(() => el.classList.remove('flash'), 1600);
    }
  }

  // ---- tabs and the level switch ----------------------------------------------------

  const TABS = ['now', 'calc', 'journal', 'start', 'glossary'];
  function showTab(name, termId) {
    if (!TABS.includes(name)) name = 'now';
    if (fewer()) name = 'now';
    TABS.forEach(t => {
      const on = t === name;
      $('#tab-' + t).hidden = !on;
      $('#t-' + t).setAttribute('aria-selected', String(on));
      $('#t-' + t).tabIndex = on ? 0 : -1;
    });
    try { history.replaceState(null, '', '#' + name + (termId ? '/' + termId : '')); } catch (e) {}
    $('#t-' + name).scrollIntoView({ block: 'nearest', inline: 'nearest' });   // on a narrow screen the row scrolls; keep the active tab visible
    if (name !== 'now') window.scrollTo(0, 0);
  }
  app.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });
  app.querySelector('.tabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const cur = TABS.findIndex(t => $('#t-' + t).getAttribute('aria-selected') === 'true');
    const nxt = TABS[(cur + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    showTab(nxt); $('#t-' + nxt).focus();
  });

  function applyLevel() {
    app.classList.toggle('level-beginner', beginner());
    app.classList.toggle('level-experienced', !beginner());
    app.querySelectorAll('.seg [data-level]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.level === S.level)));
    $('#firstrun').hidden = !(beginner() && !S.firstDismissed);
    renderGlossary(); renderOverview();
    if (calcReady) calcRender();
    if (journalReady) renderJournal();
    if (typeof tick === 'function' && window.__started) { tick(); }
  }
  app.querySelector('.seg').addEventListener('click', e => {
    const b = e.target.closest('[data-level]'); if (!b) return;
    S.level = b.dataset.level; save(); applyLevel();
  });
  $('#firstrun-x').addEventListener('click', () => { S.firstDismissed = true; save(); $('#firstrun').hidden = true; });
  $('#news-more').addEventListener('click', () => { newsShowAll = !newsShowAll; renderNews(); });
  $('#news-imp').addEventListener('click', e => {
    const b = e.target.closest('[data-imp]'); if (!b) return;
    S.newsImpact = b.dataset.imp; save(); renderNews();
  });

  // ---- settings dialog -----------------------------------------------------------

  const dlg = document.getElementById('settings');
  const dq = id => dlg.querySelector(id);

  // Offsets people actually meet, plus every whole hour, so the list is complete but short.
  const OFFSETS = [];
  for (let m = -12 * 60; m <= 14 * 60; m += 60) OFFSETS.push(m);
  [-210, 330, 345, 570].forEach(m => OFFSETS.push(m));
  OFFSETS.sort((a, b) => a - b);
  dq('#s-offset').innerHTML = '<option value="device">Same as my device</option>' +
    OFFSETS.map(m => `<option value="${m}">${offsetLabel(m)}</option>`).join('');
  dq('#s-alerts').innerHTML = SESSIONS.map(s =>
    `<label class="check"><input type="checkbox" data-k="${s.key}"> ${s.name}</label>`).join('');

  function paintNotifyHint() {
    const h = dq('#s-notify-hint');
    if (!canNotify) h.textContent = 'This browser cannot show notifications.';
    else if (Notification.permission === 'denied') h.textContent = 'Notifications are blocked. Allow them for this site in your browser settings, then reload.';
    else h.textContent = '';
    dq('#s-notify').disabled = !canNotify || Notification.permission === 'denied';
  }
  function fillSettings() {
    dq('#s-sound').checked = S.sound;
    dq('#s-notify').checked = S.notify && canNotify && Notification.permission === 'granted';
    dq('#s-heads').value = String(S.headsUp);
    dq('#s-offset').value = String(S.chartOffset);
    dq('#s-broker').value = S.broker;
    dq('#s-key').value = S.apiKey;
    dlg.querySelectorAll('#s-alerts input').forEach(i => { i.checked = !!S.alerts[i.dataset.k]; });
    dq('#s-newslead').value = String(S.newsLead);
    dq('#s-winlead').value = String(S.winLead);
    dq('#s-mypairs').querySelectorAll('input').forEach(i => { i.checked = (S.myPairs || []).includes(i.dataset.p); });
    dq('#s-calurl').value = S.calUrl || 'calendar.json';
    dlg.querySelectorAll('#s-newsccy input').forEach(i => { i.checked = !S.newsCcy || S.newsCcy.includes(i.dataset.c); });
    paintNotifyHint(); paintBroker(); paintCalStatus();
    if (!S.apiKey) dq('#s-keystatus').textContent = 'No key added.';
  }
  function paintBroker() {
    const ex = S.broker === 'exness';
    dq('#s-offset-wrap').hidden = ex;
    dq('#s-broker-hint').textContent = ex
      ? 'Exness says its MT4 and MT5 platforms run on GMT+0 and that this cannot be changed. The app uses that for chart time. In TradingView, right-click the time axis and choose UTC to match.'
      : 'Charts often use a different clock from your device, and a wrong offset is an easy way to trade at the wrong hour. Check what your chart shows, then set it here. It appears next to your time.';
  }

  // Test the key against Twelve Data and say plainly what happened.
  const keyStatus = (msg, cls) => { const el = dq('#s-keystatus'); el.textContent = msg; el.className = 'keystatus ' + (cls || ''); };
  async function testKey() {
    const key = dq('#s-key').value.trim();
    if (!key) return keyStatus('Paste a key first.', 'bad');
    keyStatus('Checking with Twelve Data…', 'wait');
    try {
      const k = encodeURIComponent(key);
      const j = await (await fetch('https://api.twelvedata.com/time_series?symbol=EUR%2FUSD&interval=15min&outputsize=1&timezone=UTC&apikey=' + k)).json();
      if (j.status === 'error') {
        const m = String(j.message || '');
        return keyStatus(j.code === 401 || /api ?key/i.test(m)
          ? 'Twelve Data does not accept this key. Check that it was copied in full, with no spaces.'
          : j.code === 429 ? 'Twelve Data says you have hit a limit. Wait a minute and test again.'
          : 'Twelve Data replied: ' + m, 'bad');
      }
      const v = j.values && j.values[0];
      if (!v) return keyStatus('The key is accepted, but no EUR/USD price came back.', 'bad');
      let msg = 'Working. Latest EUR/USD price ' + (+v.close).toFixed(5) + ' at ' + hm.format(Date.parse(v.datetime.replace(' ', 'T') + 'Z')) + ' your time.';
      try {   // usage is a bonus: if this call fails the key is still fine
        const u = await (await fetch('https://api.twelvedata.com/api_usage?apikey=' + k)).json();
        if (u && u.plan_daily_limit) msg += ' Used ' + u.daily_usage + ' of ' + u.plan_daily_limit + ' daily credits.';
      } catch (e) {}
      keyStatus(msg, 'ok');
    } catch (e) {
      keyStatus('Could not reach Twelve Data. Check your internet connection.', 'bad');
    }
  }
  dq('#s-keytest').addEventListener('click', testKey);
  dq('#s-keyclear').addEventListener('click', () => {
    dq('#s-key').value = ''; dq('#s-key').dispatchEvent(new Event('change')); keyStatus('Key removed.', '');
  });
  dq('#s-broker').addEventListener('change', e => {
    S.broker = e.target.value === 'other' ? 'other' : 'exness'; save(); paintBroker(); tick();
  });
  function openSettings() { fillSettings(); if (!dlg.open) dlg.showModal(); }
  $('#btn-settings').addEventListener('click', openSettings);

  dq('#s-sound').addEventListener('change', e => {
    S.sound = e.target.checked; save();
    if (S.sound) { ensureAudio(); chime(PITCH.lon); }
  });
  dq('#s-test').addEventListener('click', () => { ensureAudio(); chime(PITCH.lon); });
  dq('#s-notify').addEventListener('change', async e => {
    if (e.target.checked && Notification.permission === 'default') {
      S.notify = (await Notification.requestPermission()) === 'granted';
    } else S.notify = e.target.checked && Notification.permission === 'granted';
    e.target.checked = S.notify; save(); paintNotifyHint();
  });
  dq('#s-heads').addEventListener('change', e => { S.headsUp = +e.target.value; save(); });
  dq('#s-newslead').addEventListener('change', e => { S.newsLead = +e.target.value; save(); });
  dq('#s-winlead').addEventListener('change', e => { S.winLead = +e.target.value; save(); });
  dq('#s-mypairs').innerHTML = Object.keys(PAIRS).map(p => `<label class="check"><input type="checkbox" data-p="${p}"> ${p}</label>`).join('');
  dq('#s-mypairs').addEventListener('change', () => {
    S.myPairs = [...dq('#s-mypairs').querySelectorAll('input:checked')].map(i => i.dataset.p); save(); poKey = ''; renderPairsOutlook(Date.now());
  });
  dq('#s-newsccy').innerHTML = MAJOR_CCY.map(c => `<label class="check"><input type="checkbox" data-c="${c}"> ${c}</label>`).join('');
  dq('#s-newsccy').addEventListener('change', () => {
    const on = [...dlg.querySelectorAll('#s-newsccy input:checked')].map(i => i.dataset.c);
    S.newsCcy = on.length && on.length < MAJOR_CCY.length ? on : null;          // none or all means every currency
    if (!on.length) dlg.querySelectorAll('#s-newsccy input').forEach(i => { i.checked = true; });
    save(); renderNews(); tick();
  });
  dq('#s-calurl').addEventListener('change', e => { S.calUrl = e.target.value.trim() || 'calendar.json'; save(); loadCalendar(); });
  dq('#s-calreload').addEventListener('click', () => { dq('#s-calstatus').textContent = 'Reloading…'; loadCalendar(); });
  dq('#s-offset').addEventListener('change', e => {
    S.chartOffset = e.target.value === 'device' ? 'device' : +e.target.value; save(); tick();
  });
  dq('#s-key').addEventListener('change', e => {
    S.apiKey = e.target.value.trim(); save();
    Object.keys(feeds).forEach(k => delete feeds[k]);
    SESSIONS.forEach(s => { try { localStorage.removeItem(cacheKey(s.key)); } catch (x) {} });
    renderOverview(); if (S.apiKey && S.selected) fetchFeed(S.selected, true);
    if (S.apiKey) testKey();   // tell the user straight away whether it works
  });
  dlg.querySelectorAll('#s-alerts input').forEach(i => i.addEventListener('change', () => {
    S.alerts[i.dataset.k] = i.checked; save();
  }));
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });   // click the backdrop to close

  // ---- compact mode, floating window, install -----------------------------------------

  function applyCompact() {
    const compact = S.compact || app.classList.contains('pip');
    app.classList.toggle('compact', compact);
    $('#btn-compact').setAttribute('aria-pressed', String(S.compact));
    $('#btn-compact').textContent = S.compact ? 'Full view' : 'Compact';
    if (compact) showTab('now');
  }
  $('#btn-compact').addEventListener('click', () => { S.compact = !S.compact; save(); applyCompact(); tick(); });

  // Document Picture-in-Picture (Chrome and Edge on desktop): a small window that stays above others.
  if ('documentPictureInPicture' in window) {
    const fb = $('#btn-float'); fb.hidden = false;
    fb.addEventListener('click', async () => {
      try {
        const pip = await window.documentPictureInPicture.requestWindow({ width: 380, height: 460 });
        for (const ss of document.styleSheets) {
          try {
            const st = document.createElement('style');
            st.textContent = [...ss.cssRules].map(r => r.cssText).join('\n');
            pip.document.head.append(st);
          } catch (e) {
            if (ss.href) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = ss.href; pip.document.head.append(l); }
          }
        }
        app.classList.add('pip'); applyCompact();
        pip.document.body.append(app);
        document.getElementById('floating-note').hidden = false;
        pip.addEventListener('pagehide', () => {
          app.classList.remove('pip'); applyCompact();
          document.body.prepend(app);
          document.getElementById('floating-note').hidden = true;
          tick();
        });
        tick();
      } catch (e) { /* the user dismissed it, or the browser refused */ }
    });
  }

  let installEvent = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; $('#btn-install').hidden = false; });
  $('#btn-install').addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt(); await installEvent.userChoice; installEvent = null; $('#btn-install').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#btn-install').hidden = true; });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // ---- go --------------------------------------------------------------------------------

  if (!sessionByKey(S.selected)) {
    const first = SESSIONS.find(s => isOpen(s, Date.now()));
    S.selected = (first || sessionByKey('lon')).key;
  }
  SESSIONS.forEach(s => rowOf(s.key).setAttribute('aria-pressed', String(s.key === S.selected)));
  applyLevel();
  applyCompact();
  calcInit(); calcReady = true;
  jInit(); journalReady = true;
  winInit();
  poInit();
  tick();
  window.__started = true;
  fetchFeed(S.selected, false);
  loadCalendar();
  setInterval(loadCalendar, 10 * 60000);
  setInterval(tick, 1000);

  // Open the section named in the address, for example #glossary/spread.
  const [hashTab, hashTerm] = location.hash.slice(1).split('/');
  if (TABS.includes(hashTab)) hashTerm && byId(hashTerm) ? jumpTo(hashTerm) : showTab(hashTab);
  window.addEventListener('hashchange', () => {
    const [t, id] = location.hash.slice(1).split('/');
    if (TABS.includes(t)) id && byId(id) ? jumpTo(id) : showTab(t);
  });
})();
