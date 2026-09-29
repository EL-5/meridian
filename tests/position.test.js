// Run: node tests/position.test.js
// Expected values are worked out by hand in the comments, not produced by the code under test.
const FX = require('../logic.js');
let fails = 0;
const ok = (label, cond, extra) => { if (!cond) fails++; console.log((cond ? 'PASS ' : 'FAIL ') + label + (cond && !extra ? '' : '  ' + (extra || ''))); };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const base = { sym: 'EUR/USD', balance: 1000, ccy: 'USD', riskPct: 1, stop: 25, minLot: 0.01, lotStep: 0.01 };
const P = o => FX.positionSize({ ...base, ...o });

// ---- 1. the textbook case: one pip of EUR/USD is $10 per standard lot
let r = P({});
// risk $10, stop 25 pips at $10/pip/lot: 10 / 250 = 0.04 lots
ok('EUR/USD $1,000, 1%, 25 pips -> 0.04 lots', r.ok && near(r.lots, 0.04) && near(r.pipValue, 10) && near(r.risk, 10) && near(r.units, 4000), JSON.stringify({ lots: r.lots, risk: r.risk }));

// ---- 2. a yen pair: pip is 0.01, worth 1000 JPY per lot, converted at the entry price
r = P({ sym: 'USD/JPY', entry: 150, stop: 20 });
// pip value = 1000 / 150 = 6.6667 USD. 10 / (20 * 6.6667) = 0.075 -> rounds DOWN to 0.07; real risk 0.07 * 20 * 6.6667 = 9.3333
ok('USD/JPY at 150, 20 pips -> 0.07 lots (rounded down from 0.075)', r.ok && near(r.lots, 0.07) && near(r.pipValue, 1000 / 150) && near(r.risk, 9.33333, 1e-4), JSON.stringify({ lots: r.lots, pv: r.pipValue, risk: r.risk }));
ok('...a small rounding gap (93% of plan) is not worth a warning', !r.warnings.some(w => /Rounded down/.test(w.text)));
// $190 at 1% = $1.90; stop 10 pips: 1.90 / 100 = 0.019 lots -> 0.01; real risk $1.00 is only 53% of the plan
ok('...but a big one (53% of plan) is', P({ balance: 190, stop: 10 }).warnings.some(w => /Rounded down to the lot step, so you risk 1\.00 USD, less than the 1\.90 USD planned/.test(w.text)));

// ---- 3. a cross needs a conversion rate: EUR/GBP with a USD account
r = P({ sym: 'EUR/GBP', balance: 2000, stop: 20 });
ok('EUR/GBP asks for a GBP->USD rate instead of guessing', !r.ok && r.needRate && r.needRate.from === 'GBP' && r.needRate.to === 'USD');
r = P({ sym: 'EUR/GBP', balance: 2000, stop: 20, rate: 1.30 });
// pip value = 10 GBP * 1.30 = 13 USD. risk $20: 20 / (20 * 13) = 0.0769 -> 0.07; real risk 0.07 * 20 * 13 = 18.20
ok('EUR/GBP with rate 1.30 -> 0.07 lots, risk $18.20', r.ok && near(r.pipValue, 13) && near(r.lots, 0.07) && near(r.risk, 18.2), JSON.stringify({ lots: r.lots, risk: r.risk }));

// ---- 4. account currency is the BASE currency: the entry price does the conversion
r = P({ ccy: 'EUR', balance: 5000, riskPct: 2, stop: 30, entry: 1.10 });
// pip value = 10 USD / 1.10 = 9.0909 EUR. risk 100 EUR: 100 / (30 * 9.0909) = 0.3667 -> 0.36; real risk 0.36 * 30 * 9.0909 = 98.18
ok('EUR account trading EUR/USD -> 0.36 lots', r.ok && near(r.pipValue, 10 / 1.1) && near(r.lots, 0.36) && near(r.risk, 98.1818, 1e-3), JSON.stringify({ pv: r.pipValue, lots: r.lots }));
r = P({ ccy: 'EUR', balance: 5000, stop: 30 });
ok('EUR account without an entry price cannot guess the rate', !r.ok && r.needRate && r.needRate.from === 'USD' && r.needRate.to === 'EUR');

// ---- 5. gold: distances are dollars per ounce, one lot is 100 oz (editable)
r = P({ sym: 'XAU/USD', balance: 5000, stop: 5, entry: 2000, leverage: 100 });
// pip value = 100 oz * $1 = $100 per lot. risk $50: 50 / (5 * 100) = 0.10 lots = 10 oz. margin = 10 * 2000 / 100 = $200
ok('Gold: $5 stop, $50 risk -> 0.10 lots, margin $200', r.ok && near(r.lots, 0.1) && near(r.units, 10) && near(r.margin, 200) && near(r.risk, 50), JSON.stringify({ lots: r.lots, margin: r.margin }));
r = P({ sym: 'XAU/USD', balance: 5000, stop: 5, goldContract: 50 });
ok('Gold contract size can be changed (50 oz -> 0.20 lots)', r.ok && near(r.lots, 0.2), r.lots);

// ---- 6. the account is too small for the smallest lot
r = P({ balance: 100, stop: 50 });
// risk $1; 0.002 lots is below 0.01. The minimum lot would risk 0.01 * 50 * 10 = $5 = 5%
ok('Too small for the minimum lot: says so, recommends 0 lots, shows the real cost', r.ok && r.tooSmall && r.lots === 0 && near(r.minLotRisk, 5) && r.warnings.some(w => w.warn && /5\.00% of your account/.test(w.text)), r.warnings.map(w => w.text).join(' | ').slice(0, 160));

// ---- 7. spread is part of the risk
r = P({ stop: 20, spread: 2 });
// effective stop 22 pips: 10 / (22 * 10) = 0.04545 -> 0.04; real risk 0.04 * 22 * 10 = 8.80
ok('Spread widens the effective stop (0.04 lots, risk $8.80)', r.ok && near(r.effStop, 22) && near(r.lots, 0.04) && near(r.risk, 8.8));
ok('A big spread is called out', P({ stop: 5, spread: 2 }).warnings.some(w => w.warn && /spread is 40%/.test(w.text)));

// ---- 8. margin
r = P({ stop: 25, entry: 1.10, leverage: 100 });
ok('Margin: 4000 units * 1.10 / 100 = $44', near(r.margin, 44), r.margin);
r = P({ ccy: 'EUR', stop: 25, entry: 1.10, leverage: 100 });
ok('EUR account, EUR/USD: margin is units / leverage in EUR', r.ok && near(r.margin, r.units / 100, 1e-6), r.margin + ' vs ' + r.units / 100);
ok('Margin above half the balance is a warning', P({ balance: 1000, riskPct: 5, stop: 10, entry: 1.10, leverage: 100 }).warnings.some(w => w.warn && /of your balance as margin/.test(w.text)));
ok('No margin shown without an entry price', P({}).margin === null);

// ---- 9. levels and reward
r = P({ entry: 1.1000, stop: 25, tp: 50, dir: 'buy' });
ok('Buy: stop 1.0975, target 1.1050', near(r.stopPrice, 1.0975, 1e-9) && near(r.tpPrice, 1.1050, 1e-9), r.stopPrice + ' / ' + r.tpPrice);
r = P({ entry: 1.1000, stop: 25, tp: 50, dir: 'sell' });
ok('Sell: stop 1.1025, target 1.0950', near(r.stopPrice, 1.1025, 1e-9) && near(r.tpPrice, 1.0950, 1e-9));
r = P({ sym: 'USD/JPY', entry: 150, stop: 20, dir: 'buy' });
ok('Yen buy: 20 pips is 0.20, stop 149.80', near(r.stopPrice, 149.8, 1e-9), r.stopPrice);
r = P({ stop: 20, tp: 40 });
ok('Reward:risk 2 when target is twice the stop', near(r.rr, 2) && near(r.reward, 0.05 * 40 * 10));
r = P({ stop: 20, tp: 40, spread: 2 });
// target net 38 against effective stop 22
ok('Spread lowers reward:risk (38/22 = 1.727)', near(r.rr, 38 / 22, 1e-9), r.rr);
ok('Reward smaller than risk is noted', P({ stop: 40, tp: 20 }).warnings.some(w => /reward is smaller than the risk/i.test(w.text)));
ok('A target inside the spread is flagged', P({ stop: 20, tp: 1, spread: 2 }).warnings.some(w => w.warn && /no bigger than the spread/.test(w.text)));

// ---- 10. lot step and minimum
r = P({ balance: 3600, riskPct: 1, stop: 10, lotStep: 0.1, minLot: 0.1 });
// risk $36; 36 / (10 * 10) = 0.36 -> step 0.1 -> 0.3
ok('Lot step 0.1: 0.36 rounds down to 0.3', r.ok && near(r.lots, 0.3), r.lots);
r = P({ balance: 400, riskPct: 1, stop: 10, lotStep: 0.1, minLot: 0.1 });
ok('Lot step 0.1: 0.04 is below the 0.1 minimum', r.tooSmall && r.lots === 0);
ok('Rounds down, never up: 0.0799 -> 0.07', P({ balance: 799, riskPct: 1, stop: 10 }).lots === 0.07);
ok('An exact multiple is kept (0.08 stays 0.08)', P({ balance: 800, riskPct: 1, stop: 10 }).lots === 0.08);

// ---- 11. risk warnings
ok('3% is information', P({ riskPct: 3 }).warnings.some(w => !w.warn && /1 to 2 percent/.test(w.text)));
ok('6% is a warning', P({ riskPct: 6 }).warnings.some(w => w.warn && /very aggressive/.test(w.text)));
ok('1% has no risk warning', !P({ riskPct: 1 }).warnings.some(w => /aggressive|1 to 2 percent/.test(w.text)));

// ---- 12. bad input is named, never turned into a number
for (const [label, o, field] of [['no balance', { balance: 0 }, 'balance'], ['negative stop', { stop: -5 }, 'stop'], ['zero stop', { stop: 0 }, 'stop'],
  ['150% risk', { riskPct: 150 }, 'risk'], ['zero risk', { riskPct: 0 }, 'risk'], ['bad currency', { ccy: 'US' }, 'ccy'], ['NaN stop', { stop: NaN }, 'stop'], ['bad entry', { entry: 0 }, 'entry']]) {
  const x = P(o); ok('rejects ' + label, !x.ok && x.errors.includes(field), JSON.stringify(x.errors));
}

// ---- 13. number parsing
const pn = FX.parseNum;
ok('parseNum: plain and thousands', pn('1.5') === 1.5 && pn('1,000') === 1000 && pn('12,345,678') === 12345678 && pn('1,000.50') === 1000.5 && pn('1 000.5') === 1000.5);
ok('parseNum: decimal comma', pn('0,5') === 0.5 && pn('1,5') === 1.5 && pn('2,25') === 2.25);
ok('parseNum: edges', pn('.5') === 0.5 && pn('5.') === 5 && isNaN(pn('')) && isNaN(pn('abc')) && isNaN(pn('1.2.3')) && isNaN(pn('-5')) && isNaN(pn(null)));

// ---- 14. the property that matters: the plan never risks more than the budget
let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const syms = ['EUR/USD', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'USD/CAD', 'AUD/USD', 'XAU/USD'];
let worst = 0, checked = 0, bad = 0;
for (let i = 0; i < 5000; i++) {
  const sym = syms[Math.floor(rnd() * syms.length)];
  const step = [0.01, 0.1, 0.001][Math.floor(rnd() * 3)];
  const o = { sym, ccy: 'USD', balance: 50 + rnd() * 100000, riskPct: 0.1 + rnd() * 5, stop: sym === 'XAU/USD' ? 0.5 + rnd() * 30 : 3 + rnd() * 200,
    spread: rnd() < 0.5 ? rnd() * 3 : undefined, entry: sym === 'USD/JPY' ? 100 + rnd() * 80 : sym === 'XAU/USD' ? 1500 + rnd() * 1500 : 0.6 + rnd() * 1.2, lotStep: step, minLot: step };
  const x = FX.positionSize(o);
  if (!x.ok) { bad++; continue; }
  checked++;
  worst = Math.max(worst, x.risk / x.riskBudget);
  if (x.risk > x.riskBudget * (1 + 1e-9)) { fails++; console.log('FAIL over budget', JSON.stringify(o), x.risk, x.riskBudget); break; }
  const k = x.lots / step; if (Math.abs(k - Math.round(k)) > 1e-6) { fails++; console.log('FAIL not on the lot step', x.lots, step); break; }
}
ok('5,000 random plans: risk never exceeds the budget, lots always on the step', bad === 0 && checked === 5000, `worst risk/budget = ${worst.toFixed(6)}`);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
