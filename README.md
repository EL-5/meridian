# Forex Trading Sessions — GMT / Ghana Time

## The app (Meridian)

An installable web app in this folder. It shows which sessions are open, says how busy the market is right now in plain words, warns about bank holidays, rollover and the weekend close, and can show how a session is going.

**Run it on your PC.** Open a terminal in this folder:

```bash
node tools/serve.mjs
```

Then open `http://localhost:5177` in Chrome or Edge, and use **Install app** (top right, or the install icon in the address bar). It gets its own window and a Start menu icon. This small server also keeps the economic calendar fresh (see below), which is why it replaces a plain file server. Add `--lan` to reach it from a tablet on the same Wi-Fi (the page works there, but installing it as an app needs HTTPS).

**Position size calculator.** The Calculator tab works out how many lots to trade so that one stop-loss costs only what you chose to risk. Enter your balance, account currency, risk percent, pair and stop distance. It shows the lot size, units, loss if stopped out, value of a pip, and, if you add them, reward and reward-to-risk, margin, and the stop and target prices. **Show the working** lists every step with numbers so you can check it.
- **It rounds down, never up**, to your lot step, so you never risk more than planned. If your risk budget is smaller than the minimum lot would risk, it says so and shows what the minimum lot really costs.
- **The spread counts as risk** (a stop is hit at a price the spread has already moved) and lowers the reward.
- **Currency conversion is never guessed.** If your account currency is neither currency in the pair and cannot be worked out from the entry price, it asks for the exchange rate (or fetches it if a Twelve Data key is on). Gold is measured in dollars per ounce, since it has no standard pip.
- **Defaults to check in your account** (under "Account details that vary by broker"): leverage, smallest lot (0.01), lot step (0.01), and gold contract size (100 oz). They are common values, not guarantees.
- Your balance, currency, risk and these account details are remembered on this device. Entry and stop are not, because they would go stale.

**Best pairs for the next few hours.** On the Now tab, directly under the headline (open by default; it is the only pairs list, and the compact strip shows its top five as chips), the "Best pairs for the next few hours" card ranks pairs by trading conditions over the next 1, 2 or 4 hours, in your time. It is a guide to conditions, never to direction, and every score comes with the reasons behind it.
- **How the score works** (out of 100, all from schedule and calendar, no price data): 60 × how much of the window both currencies have their home market open, +15 if both are open throughout, plus a cost class (major 25, gold 20, cross 15, exotic 5), minus news (35 if high-impact news lands in the first 30 minutes, 25 if it has just come out, 15 if it lands later). Home markets: USD, CAD and MXN New York; EUR, GBP and CHF London; JPY Tokyo; AUD and NZD Sydney and Tokyo; gold London and New York. Bank holidays count (with the US shut, EUR/USD drops to half its home coverage).
- **Beginner view** shows the top three with their full names and the reasons in plain sentences, and "Show all" lists the rest. **Experienced view** shows one line per pair (home-market coverage, class, news) and the formula.
- **My pairs.** Tick the pairs you trade under Settings, "Pairs I trade", then choose "My pairs" in the card to rank only those.
- The weights are my own judgement, not fitted to data, and they do not know today's volatility. Treat the order as a starting point.

**My trading window.** On the Now tab, set the hours you actually plan to trade (Set my trading hours). Each window has a name, days, and a start and end in your own clock, and can cross midnight (22:00 to 02:00 belongs to the day it starts). Times are wall-clock times, so they stay at the same hour when clocks change. Up to five windows.
- **The card** says whether you are inside a window or outside it, when it ends or the next one starts, and gives an outlook for it: how busy the market is scheduled to be (minutes at each level), which sessions are open, high-impact news inside it, and any bank holiday. If you are inside a window but the market is quiet or closed, the headline says so.
- **A warning before it starts** by sound and notification (Settings, 10 minutes by default, or off), once per window occurrence.
- **A row on the timeline** shows your windows across the day.
- **The journal tags every trade** as inside or outside your windows at the moment it was logged, and shows a breakdown, so you can see whether trading outside your own hours costs you. It stays "not set" if you have no windows, never "outside".
- Two presets fill in today's real London + New York overlap and London's first three hours. They use today's times in your clock, so edit them when clocks change.

**Trading journal.** The Journal tab keeps a record of your trades on this device and shows what the record says.
- **Logging.** Pair, buy or sell, when it opened and closed, the result (copy it from your platform, with a minus sign for a loss), and optionally lots, prices, planned risk, pips, whether you followed your plan, a setup name and notes. Trades can be left open and closed later. The Calculator has an **Add this trade to the journal** button that fills in the pair, direction, lots, entry, stop price and planned risk.
- **Tagged automatically.** Each trade records the session it opened in (using the same logic as the headline, so bank holidays count) and whether a high-impact release for either currency was within 30 minutes. If the calendar does not cover that moment it records "unknown", not "no".
- **What it shows.** Trades, win rate with a 95% range, net result, average win and loss, and in the Experienced view expectancy, profit factor, maximum drawdown and streaks. A running-total chart. Breakdowns by session, pair, whether you followed your plan, news, weekday and direction.
- **Honest about small samples.** Every group shows how many trades it rests on and a label: under 10 is "too few to judge", 10 to 29 "early", 30 or more "more reliable". The "What stands out" lines only appear for groups of 10 or more and always carry that caution.
- **R multiples.** With a planned risk on each trade, results are also shown as R (result divided by risk), so trades of different sizes compare fairly.
- **Your data.** It is stored only in this browser. **Back up** saves a JSON file, **Restore** merges one back in (skipping trades already there and ignoring unreadable rows), and **Export CSV** gives a spreadsheet file. Text in the CSV that would be read as a spreadsheet formula is defused. A banner asks you to back up after 10 changes, or after 5 trades if you never have. Clearing site data erases the journal, so the backups matter.
- Money totals use your most common account currency only. Trades in another currency are left out of the totals and the page says how many.

**Economic calendar.** The Now tab lists the next 24 hours of news in your time, with impact (HIGH, MED, LOW), forecast and previous values, and a plain-English line for common releases. High-impact news within an hour appears as a warning under the headline, the pairs it affects are tagged, and you can get a sound and notification 5 to 30 minutes ahead (Settings → Economic calendar). Filter by impact or by currency.
- **Where it comes from.** A public feed (the one behind the Forex Factory calendar). It is unofficial, covers this week and next once published, and could change or stop. The browser cannot call it directly (no CORS, and it rate-limits), so `tools/serve.mjs` fetches it, saves `calendar.json`, and refreshes it in the background when it is older than 20 minutes (never more than once every 5 minutes, even if failing).
- **Is it working?** The line under the news list says: `Calendar: working · updated 11:27 · 141 events · covers until Sat 16:00`. It says *not loaded*, *could not refresh (showing the last saved copy)* or *out of date* (older than 6 hours) when something is wrong. If there is no calendar, the app falls back to its old fixed 08:30 New York reminder and says so.
- **Refresh by hand or on a schedule.** `node tools/update-calendar.mjs` refreshes once and exits with an error code if it fails.
- **When hosted**, `api/calendar.mjs` serves `/calendar.json` live and the host caches it for 15 minutes, so the unofficial feed is asked at most about four times an hour however many people use the app. If the feed fails, the last good copy is served for up to a day.
- **Limits.** Forecast and previous are often blank for minor events. There is no "actual" value in this feed. Times are exact to the minute, but confirm anything important on your broker's own calendar.

**What was removed, and why.** After a full audit these were cut: *Session levels and killzones* (niche, discretionary and unvalidated, needed its own price feed, and touched six places); the *Key times* list (the calendar and the session board already show it, and part of it was guessed); the *Next change* row (each session row has its own countdown); and the old *Most active pairs* list under the headline, which ranked pairs differently from the Best pairs card and could disagree with it. News shows the first six events with a "Show all" button.

**Two views, three tabs.** The **View** switch at the top chooses the vocabulary. *Beginner* uses plain words, explains each pair and lets you tap underlined terms for their meaning. *Experienced* shows the same facts as liquidity, spread and volatility levels, overlap times and a key-times list. The tabs are **Now**, **Start here** (a two-minute guide to the five levels) and **Glossary** (87 terms, searchable, filtered by level and topic, each with a one-line answer first).

**Beside Exness or TradingView.** Click **Compact** for a narrow strip. In Chrome or Edge, **Float on top** puts it in a small window that stays above your other windows.

**Run it on your tablet.** Open the published address (see *Hosting* below) on the tablet. On Android, use Chrome's menu, then **Install app**. On an iPad, use Safari's Share button, then **Add to Home Screen**. Installing and notifications need HTTPS, which GitHub Pages provides. On an iPad, notifications work only from the home-screen copy, on iPadOS 16.4 or later.

**Session overview.** Select a session to see its progress, and, with a free [Twelve Data](https://twelvedata.com) key entered in Settings, how three of its main pairs have moved: open to now, net pips, range, and whether that is busier or quieter than usual. "Usual" is exact, not modelled: the app takes the high-to-low range since the session opened and compares it with the range over the same elapsed time in each of the last 10 sessions of that name (skipping sessions with data gaps, and needing at least 5). Busier means larger than at least 70% of them, quieter means larger than at most 30%. Without a key, everything else still works.

**Exness.** Settings → Broker is set to Exness by default. Exness says its MT4 and MT5 platforms run on GMT+0 and that this cannot be changed, so the app pins chart time to UTC+0 and shows "same as your time" when your device is also on UTC+0. The Now tab also shows when the Exness forex week closes on Friday and reopens on Sunday (21:05 open and 20:59 close GMT in northern summer, an hour later in winter), taken from Exness's published schedule. I could not open the Exness help pages directly, so treat those times as a summary and confirm them in your Exness account. For TradingView, right-click the time axis and choose UTC to match.

**Checking the Twelve Data key.** Paste the key in Settings → Price data. The app tests it at once and writes one of three plain results under the box: *Working* (with the latest EUR/USD price and, when available, your daily credits used), *Twelve Data does not accept this key*, or *Could not reach Twelve Data*. After that, pick any session on the Now tab. The overview shows one status line: `Price data: working · updated 10:47 · latest price 10:30 · next refresh 10:57`. It says *not working* with the reason if something is wrong, or *prices look delayed* if the newest price is over 45 minutes old while the session is open. The free plan is rate limited, so the app refreshes at most every 10 minutes; **Refresh now** works once a minute.

**Warnings on the Now tab.** Amber lines appear for: bank holidays in the US, UK, euro area, Japan and Australia (a session that is open on the clock but on a holiday shows HOLIDAY and is left out of the level; when the US, UK and euro area are all shut, the level is capped at Quiet); the daily rollover (from 30 minutes before 5 pm New York until about 17:15, when spreads can widen); Wednesday triple swap; the weekend close (from 3 hours before) and the first hour after Sunday's open. Holidays are computed from each country's rules, so there is no list to update, but confirm your broker's own holiday hours. Where price data is on, the headline also shows **By the clock** next to **Today so far**, and warns when they disagree (for example busiest on the clock but a quiet day).

**Tests.** `node tests/pairs.test.js` checks every part of the score against hand-worked values (home markets, all three kinds of news penalty, holidays, Asian hours, session closes, weekends, filters). `node tests/windows.test.js` checks trading windows (including midnight windows, other time zones and both daylight-saving changes) and the outlook. `node tests/compare-session.test.js` checks the busier/quieter comparison on candles with a known answer. `node tests/journal.test.js` checks the journal statistics against hand-worked numbers (drawdown, streaks, the win-rate range, R), the CSV and the backup restore. `node tests/position.test.js` checks the calculator against hand-worked examples for every kind of pair, plus 5,000 random plans that must never exceed the risk budget. `node tests/calendar.test.mjs` checks the calendar against a real saved week (parsing, filters, the warnings around a release, the failure cases). `node tests/holidays-and-warnings.test.js` checks the holiday dates and every warning window. `node tests/compare-session.test.js` prints the results of the busier/quieter comparison on known data.

**Alerts.** Sound, desktop notification and an optional 5, 10 or 15 minute warning, per session. They work only while the app or tab is open.

## Hosting

The app is a static site plus one small function, and is set up for Vercel (`vercel.json`).
- **What is published.** `tools/build-site.mjs` copies only the app files into `_site/` (not the tests or tools). `vercel.json` publishes that folder and rewrites `/calendar.json` to the function `api/calendar.mjs`.
- **Deploying.** With the repository connected to the host project, every push to `main` publishes automatically. A manual deploy also works: from this folder, `vercel deploy --prod` (the first run asks you to create or link a project).
- **Any other static host** works too, but `/calendar.json` then needs a server-side source. Without one the app runs normally and the news panel says the calendar is not loaded.
- **GitHub Pages** is not used: the calendar needs a server-side fetch, and the feed cannot be called from a browser.
- **Privacy.** The journal, settings and any Twelve Data key are stored only in the browser on each device. The site itself holds no personal data.
- **Third-party data.** The calendar comes from an unofficial feed and is re-published by the function. Its terms are unclear. To stop, delete `api/calendar.mjs` and the rewrite in `vercel.json`, and the app falls back gracefully.

| File | Purpose |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The interface |
| `journal.js` | Journal statistics, CSV export and backup restore (no page code, so it is tested) |
| `logic.js` | Session times, the busy/quiet level, bank holidays, warnings, news windows and the price statistics |
| `tools/serve.mjs`, `tools/calendar-lib.mjs`, `tools/update-calendar.mjs` | Local server and the calendar fetcher |
| `calendar.json` | The current calendar, written by those tools |
| `glossary.js` | The 87 glossary terms. Edit here to add or reword a term |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline use and installation |
| `api/calendar.mjs`, `vercel.json`, `tools/build-site.mjs` | Hosting: the live calendar function and the site build |
| `tools/make-icons.mjs` | Regenerates the icons: `node tools/make-icons.mjs` |

To ship a change, bump `CACHE` in `sw.js` so installed copies refresh.

The rest of this document explains the sessions the app is built on.

---

**Your time zone:** Greenwich Standard Time, UTC+0, no daylight saving.
Ghana local time = UTC = GMT all year, so every time below is **your clock time**, with no conversion.

Forex trades 24 hours a day, Monday to Friday, because four financial centres open and close in a relay: **Sydney → Tokyo → London → New York**.

---

## 1. Session times on your clock

Each centre keeps fixed local hours (about 08:00 to 17:00). Your clock never changes, so the session times shift twice a year when *they* change theirs. There are two tables.

### Northern summer (UK on BST, US on EDT, Sydney on AEST)
Roughly late March to late October.

| Session  | Opens | Closes | Length | Local hours       |
| -------- | ----- | ------ | ------ | ----------------- |
| Sydney   | 21:00 | 06:00  | 9 h    | 07:00–16:00 AEST  |
| Tokyo    | 00:00 | 09:00  | 9 h    | 09:00–18:00 JST   |
| London   | 07:00 | 16:00  | 9 h    | 08:00–17:00 BST   |
| New York | 12:00 | 21:00  | 9 h    | 08:00–17:00 EDT   |

### Northern winter (UK on GMT, US on EST, Sydney on AEDT)
Roughly early November to early April, except the gaps in section 4.

| Session  | Opens | Closes | Length | Local hours       |
| -------- | ----- | ------ | ------ | ----------------- |
| Sydney   | 20:00 | 05:00  | 9 h    | 07:00–16:00 AEDT  |
| Tokyo    | 00:00 | 09:00  | 9 h    | 09:00–18:00 JST   |
| London   | 08:00 | 17:00  | 9 h    | 08:00–17:00 GMT   |
| New York | 13:00 | 22:00  | 9 h    | 08:00–17:00 EST   |

Tokyo never changes because Japan has no daylight saving.
Session hours are a convention, not an official exchange schedule. Brokers and banks trade outside them.

---

## 2. Your 24-hour picture

`██` = session open. Each cell is one hour, 00:00 to 23:59.

**Summer**
```
Hour      00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
Sydney    ██ ██ ██ ██ ██ ██ ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ██ ██ ██
Tokyo     ██ ██ ██ ██ ██ ██ ██ ██ ██ ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ··
London    ·· ·· ·· ·· ·· ·· ·· ██ ██ ██ ██ ██ ██ ██ ██ ██ ·· ·· ·· ·· ·· ·· ·· ··
New York  ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ██ ██ ██ ██ ██ ██ ██ ██ ██ ·· ·· ··
```

**Winter**
```
Hour      00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23
Sydney    ██ ██ ██ ██ ██ ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ██ ██ ██ ██
Tokyo     ██ ██ ██ ██ ██ ██ ██ ██ ██ ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ··
London    ·· ·· ·· ·· ·· ·· ·· ·· ██ ██ ██ ██ ██ ██ ██ ██ ·· ·· ·· ·· ·· ·· ·· ··
New York  ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ·· ██ ██ ██ ██ ██ ██ ██ ██ ██ ·· ··
```

---

## 3. Overlaps — when the market is busiest

More than one centre trading means more volume, tighter spreads and bigger moves.

| Overlap            | Summer        | Winter        | Character                                                      |
| ------------------ | ------------- | ------------- | -------------------------------------------------------------- |
| Sydney + Tokyo     | 00:00–06:00   | 00:00–05:00   | Asia-Pacific. Steady, range-bound. Best for AUD, NZD and JPY.  |
| Tokyo + London     | 07:00–09:00   | 08:00–09:00   | Short and thin. Often the first real breakout of the day.      |
| **London + New York** | **12:00–16:00** | **13:00–17:00** | **Busiest window of the day. Highest volume and volatility.** |
| Dead zone          | 21:00–00:00   | 22:00–00:00   | New York closing, Asia not yet active. Wide spreads, thin.     |

**The London + New York overlap is the one to prioritise.** It carries the most volume of the day and is when most major US economic data lands.

---

## 4. Pairs by session

"Best" means the pairs whose currencies' home markets are open, so they see the most real volume.

### Sydney (quiet, lower liquidity)
| Pair    | Note                        |
| ------- | --------------------------- |
| AUD/USD | Main pair for the session   |
| NZD/USD | Main pair for the session   |
| AUD/NZD | Most active when both open  |
| AUD/JPY | Bridges into Tokyo          |
| NZD/JPY | Bridges into Tokyo          |
| AUD/CAD | Lower volume                |
| AUD/CHF | Lower volume                |

### Tokyo (Asia)
| Pair    | Note                                           |
| ------- | ---------------------------------------------- |
| USD/JPY | Main pair for the session                      |
| EUR/JPY | Yen cross, active into London                  |
| GBP/JPY | Volatile yen cross                             |
| AUD/JPY | Moves with Asian risk sentiment                |
| NZD/JPY | Moves with Asian risk sentiment                |
| CHF/JPY | Yen cross                                      |
| CAD/JPY | Yen cross                                      |
| AUD/USD | Still active from Sydney                       |
| USD/SGD | Asian-hours pair, offered by some brokers      |

### London (Europe, highest overall volume)
| Pair    | Note                                        |
| ------- | ------------------------------------------- |
| EUR/USD | Most traded pair in the world               |
| GBP/USD | Strong moves on UK data                     |
| EUR/GBP | Only truly liquid during London hours       |
| EUR/CHF | Europe-driven                               |
| USD/CHF | Active through London and New York          |
| EUR/JPY | Peaks at the Tokyo/London overlap           |
| GBP/JPY | Peaks at the Tokyo/London overlap           |
| EUR/AUD | Lower volume but tradeable                  |
| XAU/USD | Gold, very active from the London open      |

### New York (Americas)
| Pair    | Note                                                        |
| ------- | ----------------------------------------------------------- |
| EUR/USD | Strongest during the overlap with London                    |
| GBP/USD | Strongest during the overlap with London                    |
| USD/CAD | Main pair for the session, oil-linked                       |
| USD/CHF | Active through the overlap                                  |
| USD/JPY | Reacts to US yields and data                                |
| USD/MXN | Offered by some brokers                                     |
| XAU/USD | Gold, moves hard on US data                                 |

### Quick lookup — which pair, when (your clock, summer)

| Pair    | Best hours (GMT) | Why                                                |
| ------- | ---------------- | -------------------------------------------------- |
| EUR/USD | 12:00–16:00      | London/NY overlap                                  |
| GBP/USD | 12:00–16:00      | London/NY overlap, also strong 07:00–11:00         |
| USD/JPY | 00:00–03:00 and 12:00–16:00 | Tokyo session, then US data          |
| GBP/JPY | 07:00–10:00      | London open on top of Tokyo                        |
| AUD/USD | 00:00–03:00 and 12:30 | Asia hours, and US data                       |
| USD/CAD | 12:00–17:00      | NY session, oil and Canadian data                  |
| XAU/USD | 12:00–16:00      | London/NY overlap                                  |

Add 1 hour to the winter equivalents for pairs tied to London or New York hours.

---

## 5. Timings to know (your clock)

| Event                          | Summer  | Winter  |
| ------------------------------ | ------- | ------- |
| Weekly market open (Sunday)    | ~21:00  | ~22:00  |
| Weekly market close (Friday)   | ~21:00  | ~22:00  |
| Tokyo fixing                   | 00:55   | 00:55   |
| London open                    | 07:00   | 08:00   |
| US economic data (8:30 NY)     | 12:30   | 13:30   |
| NY stock exchange open         | 13:30   | 14:30   |
| London 4pm currency fix        | 15:00   | 16:00   |
| FOMC decision (2:00 pm NY)     | 18:00   | 19:00   |
| New York close (5:00 pm NY)    | 21:00   | 22:00   |

The weekly open and close vary by broker. Check yours.
**Avoid entering trades in the minutes before a major data release**, because spreads widen and price can jump past your stop.

---

## 6. When the clocks change

Your clock stays put. These rules move the session times.

| Region    | Change                                     | 2026 dates                         |
| --------- | ------------------------------------------ | ---------------------------------- |
| Sydney    | Daylight saving starts 1st Sun Oct, ends 1st Sun Apr | **Starts Sun 4 Oct 2026** |
| UK        | Summer time ends last Sun Oct, starts last Sun Mar   | **Ends Sun 25 Oct 2026**  |
| US        | Daylight time ends 1st Sun Nov, starts 2nd Sun Mar   | **Ends Sun 1 Nov 2026**   |
| Japan     | None                                       |                                    |

**Between 25 Oct and 1 Nov the US and UK are out of step**, so the London/NY overlap is 5 hours (12:00–17:00) for a week instead of the usual 4. It happens again in March, when the US moves first. (An earlier version of this file said 3 hours. That was wrong.)

Today is 29 Sep 2026, so the **summer table applies**, with Sydney switching from AEST to AEDT on 4 Oct.

---

## 7. Basic rules of thumb

1. **Trade the pair while its home markets are open.** GBP/USD at 03:00 is thin. AUD/JPY at 03:00 is not.
2. **The London open (07:00/08:00) and the London/NY overlap are the best windows** for most majors.
3. **Sydney and the dead zone (21:00–00:00) have wide spreads and weak follow-through.** Cross pairs are hit hardest.
4. **Friday afternoon is thinner.** Volume fades after London closes, and many traders close positions before the weekend.
5. **Stay out of the market around high-impact news** unless you are trading the news deliberately.
6. **Check your broker's server time.** Many use GMT+2 or GMT+3. Charts, daily candles and spreads follow their clock, not yours.

---

## 8. Caveats

- Session boundaries are a convention. Liquidity fades and builds gradually, not at these exact minutes.
- Volume figures and "best pair" lists are general market structure, not a signal or advice. Nothing here is a recommendation to trade.
- Verify the daylight saving dates each year. Governments change them.
