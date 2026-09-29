// Trading journal maths: pure functions, no DOM, so they can be tested. The page in app.js only draws them.
// Money results are whatever the broker reported, in one account currency. R is result divided by planned risk.
(function (g) {
  'use strict';

  // "-12.50", "−5" (a typographic minus), "+3", "1,250.50" -> number; anything else -> NaN.
  function parseSigned(text, parseNum) {
    let s = String(text == null ? '' : text).trim().replace(/[−–]/g, '-');
    let sign = 1;
    if (s[0] === '-') { sign = -1; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
    const n = parseNum(s);
    return Number.isNaN(n) ? NaN : sign * n;
  }

  // 95% Wilson score interval for a win rate. Far more honest than the raw percentage on a small sample.
  function wilson(wins, n, z = 1.96) {
    if (!n) return null;
    const p = wins / n, z2 = z * z, d = 1 + z2 / n;
    const c = (p + z2 / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / d;
    return { lo: Math.max(0, c - h), hi: Math.min(1, c + h) };
  }

  // How much weight a group of trades deserves.
  const sampleLabel = n => n < 10 ? 'too few to judge' : n < 30 ? 'early' : 'more reliable';

  const closed = trades => trades.filter(t => t.status === 'closed' && Number.isFinite(t.result));
  const rOf = t => (t.status === 'closed' && Number.isFinite(t.result) && t.risk > 0) ? t.result / t.risk : null;
  const byClose = (a, b) => (a.closedAt || a.openedAt) - (b.closedAt || b.openedAt);

  // The account currency the money totals are in: the most common one. Trades in another currency are
  // left out of money totals (adding dollars to euros would be wrong), but still count for R and win rate.
  function dominantCcy(trades) {
    const c = {};
    closed(trades).forEach(t => { c[t.ccy] = (c[t.ccy] || 0) + 1; });
    return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || null;
  }

  function stats(trades) {
    const all = closed(trades).sort(byClose);
    const ccy = dominantCcy(all);
    const money = all.filter(t => t.ccy === ccy);
    const n = all.length;
    const wins = all.filter(t => t.result > 0).length, losses = all.filter(t => t.result < 0).length;
    const mWins = money.filter(t => t.result > 0), mLoss = money.filter(t => t.result < 0);
    const grossWin = mWins.reduce((a, t) => a + t.result, 0), grossLoss = -mLoss.reduce((a, t) => a + t.result, 0);
    const net = money.reduce((a, t) => a + t.result, 0);

    // Equity curve, drawdown and streaks, in the order trades were closed.
    let eq = 0, peak = 0, maxDd = 0, curve = [], winRun = 0, loseRun = 0, maxWinRun = 0, maxLoseRun = 0;
    for (const t of money) {
      eq += t.result; peak = Math.max(peak, eq); maxDd = Math.max(maxDd, peak - eq);
      curve.push({ at: t.closedAt || t.openedAt, equity: eq });
    }
    for (const t of all) {                                         // streaks: a break-even trade ends both
      if (t.result > 0) { winRun++; loseRun = 0; } else if (t.result < 0) { loseRun++; winRun = 0; } else { winRun = 0; loseRun = 0; }
      maxWinRun = Math.max(maxWinRun, winRun); maxLoseRun = Math.max(maxLoseRun, loseRun);
    }
    const rs = all.map(rOf).filter(x => x !== null);
    return {
      n, wins, losses, breakeven: n - wins - losses, winRate: n ? wins / n : null, winInterval: wilson(wins, n),
      ccy, moneyN: money.length, otherCcy: n - money.length, net,
      avgWin: mWins.length ? grossWin / mWins.length : null, avgLoss: mLoss.length ? -grossLoss / mLoss.length : null,
      payoff: mWins.length && mLoss.length ? (grossWin / mWins.length) / (grossLoss / mLoss.length) : null,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
      expectancy: money.length ? net / money.length : null,
      avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null, rN: rs.length,
      maxDrawdown: maxDd, maxWinRun, maxLoseRun, curve, label: sampleLabel(n),
    };
  }

  // Stats per group, biggest group first. `keyOf` returns the group name for a trade (or null to skip).
  function groupStats(trades, keyOf) {
    const groups = new Map();
    closed(trades).forEach(t => { const k = keyOf(t); if (k == null) return; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); });
    return [...groups].map(([key, ts]) => ({ key, ...stats(ts) })).sort((a, b) => b.n - a.n || String(a.key).localeCompare(String(b.key)));
  }

  // Short factual observations, only from groups big enough to say anything, always with the caveat.
  function observations(groups, what) {
    const usable = groups.filter(x => x.n >= 10 && (x.avgR !== null || x.expectancy !== null));
    if (usable.length < 2) return [];
    const score = x => x.avgR !== null ? x.avgR : x.expectancy;
    const fmt = x => x.avgR !== null ? (x.avgR >= 0 ? '+' : '') + x.avgR.toFixed(2) + 'R per trade' : (x.expectancy >= 0 ? '+' : '') + x.expectancy.toFixed(2) + ' ' + x.ccy + ' per trade';
    const sorted = usable.slice().sort((a, b) => score(b) - score(a));
    const best = sorted[0], worst = sorted[sorted.length - 1];
    const caveat = Math.min(best.n, worst.n) < 30 ? ' This is early: with under 30 trades in a group, luck can look like skill.' : '';
    return [`${what}: ${best.key} has done best so far (${fmt(best)}, ${best.n} trades) and ${worst.key} worst (${fmt(worst)}, ${worst.n} trades).${caveat}`];
  }

  // ---- export and backup --------------------------------------------------------------------
  // A spreadsheet treats a cell starting with = + - @ as a formula. Text the user typed is prefixed so it stays text.
  function cell(v, isText) {
    let s = v == null ? '' : String(v);
    if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  const iso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : '');
  const COLS = ['id', 'opened_utc', 'closed_utc', 'status', 'pair', 'direction', 'lots', 'entry', 'stop', 'exit', 'result', 'currency', 'planned_risk', 'r_multiple', 'pips', 'followed_plan', 'setup', 'session_at_open', 'news_near_open', 'in_my_window', 'notes'];
  function toCsv(trades) {
    const rows = trades.slice().sort((a, b) => a.openedAt - b.openedAt).map(t => {
      const r = rOf(t);
      return [cell(t.id, true), iso(t.openedAt), iso(t.closedAt), t.status, cell(t.pair, true), t.dir, t.lots ?? '', t.entry ?? '', t.stop ?? '', t.exit ?? '',
        t.result ?? '', t.ccy, t.risk ?? '', r === null ? '' : r.toFixed(3), t.pips ?? '', t.plan || '', cell(t.setup, true), cell(t.session, true),
        t.news === true ? 'yes' : t.news === false ? 'no' : 'unknown', t.inWindow === true ? 'yes' : t.inWindow === false ? 'no' : 'not set', cell(t.notes, true)].join(',');
    });
    return [COLS.join(','), ...rows].join('\r\n') + '\r\n';
  }

  // Clean one trade from untrusted input (an imported file). Returns null if it is not usable.
  function cleanTrade(t) {
    if (!t || typeof t !== 'object') return null;
    const num = v => (v === null || v === undefined || v === '') ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
    const openedAt = Number(t.openedAt);
    if (!Number.isFinite(openedAt) || !/^[A-Z]{3}\/[A-Z]{3}$/.test(String(t.pair || ''))) return null;
    const status = t.status === 'open' ? 'open' : 'closed';
    const result = num(t.result);
    if (status === 'closed' && result === null) return null;
    return { id: String(t.id || '').slice(0, 40) || null, pair: t.pair, dir: t.dir === 'sell' ? 'sell' : 'buy', openedAt,
      closedAt: status === 'closed' && Number.isFinite(Number(t.closedAt)) ? Number(t.closedAt) : null, status,
      lots: num(t.lots), entry: num(t.entry), stop: num(t.stop), exit: num(t.exit), result: status === 'closed' ? result : null,
      ccy: /^[A-Z]{3}$/.test(String(t.ccy || '')) ? t.ccy : 'USD', risk: num(t.risk) > 0 ? num(t.risk) : null, pips: num(t.pips),
      plan: ['yes', 'no', 'partly'].includes(t.plan) ? t.plan : '', setup: String(t.setup || '').slice(0, 60), notes: String(t.notes || '').slice(0, 2000),
      session: String(t.session || '').slice(0, 60), news: t.news === true ? true : t.news === false ? false : null,
      inWindow: t.inWindow === true ? true : t.inWindow === false ? false : null,
      createdAt: Number(t.createdAt) || Date.now(), updatedAt: Number(t.updatedAt) || Date.now() };
  }
  // Merge a backup into the current journal. Trades with an id already present are skipped.
  function mergeBackup(current, json, newId) {
    if (!json || json.app !== 'session-clock-journal' || !Array.isArray(json.trades)) return { error: 'This is not a Meridian journal backup.' };
    const ids = new Set(current.map(t => t.id));
    const added = [];
    let skipped = 0, rejected = 0;
    for (const raw of json.trades) {
      const t = cleanTrade(raw);
      if (!t) { rejected++; continue; }
      if (t.id && ids.has(t.id)) { skipped++; continue; }
      t.id = t.id || newId(); ids.add(t.id); added.push(t);
    }
    return { trades: current.concat(added), added: added.length, skipped, rejected };
  }

  // Was a high-impact release for either currency within 30 minutes of the open? null when the calendar
  // does not cover that moment (it only holds this week), because "unknown" is not the same as "no".
  function newsNear(cal, ms, pair) {
    if (!cal || !cal.events || !cal.events.length) return null;
    if (ms < cal.events[0].at || ms > cal.events[cal.events.length - 1].at) return null;
    const ccys = pair.split('/');
    return cal.events.some(e => e.impact === 'high' && ccys.includes(e.ccy) && Math.abs(e.at - ms) <= 30 * 60000);
  }

  g.FXJ = { parseSigned, wilson, sampleLabel, rOf, stats, groupStats, observations, toCsv, cleanTrade, mergeBackup, newsNear, cell, COLS };
  if (typeof module !== 'undefined') module.exports = g.FXJ;
})(typeof window !== 'undefined' ? window : globalThis);
