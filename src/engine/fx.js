// Currency conversion. Rates are stored as "units of X per 1 base" (e.g. base GBP, INR: 110.2)
// and refreshed daily by the desktop app. Everything that isn't in the base currency (bills,
// debts, EMIs abroad, foreign transactions) is converted on the fly, so a rate change ripples
// through every total, meter, forecast and insight automatically.
import { addDays } from './dates.js';
import { round2 } from './money.js';

export const baseCurrency = (state) => state?.settings?.currency || 'GBP';

/** Rate for 1 unit of base in `cur`, or null if unknown. */
export function rateFor(fx, cur, base) {
  if (!cur || cur === base) return 1;
  if (!fx || fx.base !== base) return null;
  return fx.rates?.[cur] ?? null;
}

/** Convert an amount in `from` to the base currency (returns the input unchanged if no rate). */
export function toBase(amount, from, state) {
  const base = baseCurrency(state);
  if (!from || from === base) return amount;
  const r = rateFor(state.fx, from, base);
  return r ? round2(amount / r) : amount;
}

export function fromBase(amount, to, state) {
  const base = baseCurrency(state);
  if (!to || to === base) return amount;
  const r = rateFor(state.fx, to, base);
  return r ? round2(amount * r) : amount;
}

export function hasRate(state, cur) {
  return !cur || cur === baseCurrency(state) || !!rateFor(state.fx, cur, baseCurrency(state));
}

/** Currencies the user actually uses (bills, debts, foreign transactions). */
export function currenciesInUse(state, { includeWatched = true } = {}) {
  const base = baseCurrency(state);
  const set = new Set();
  for (const r of state.recurring || []) if (r.currency && r.currency !== base) set.add(r.currency);
  for (const d of state.debts || []) if (d.currency && d.currency !== base) set.add(d.currency);
  for (const t of state.transactions || []) if (t.original?.currency && t.original.currency !== base) set.add(t.original.currency);
  if (includeWatched) for (const c of state.settings?.watchCurrencies || []) if (c !== base) set.add(c);
  return [...set];
}

/** Parse https://api.frankfurter.dev/v1/latest?base=GBP (ECB reference rates). */
export function parseFrankfurter(json) {
  if (!json || typeof json !== 'object' || typeof json.base !== 'string' || typeof json.rates !== 'object') throw new Error('Unexpected rate data');
  return { base: json.base, date: String(json.date || '').slice(0, 10), rates: cleanRates(json.rates), source: 'ECB via Frankfurter' };
}

/** Parse https://open.er-api.com/v6/latest/GBP (fallback provider). */
export function parseErApi(json) {
  if (!json || json.result !== 'success' || typeof json.rates !== 'object') throw new Error('Unexpected rate data');
  const date = json.time_last_update_unix ? new Date(json.time_last_update_unix * 1000).toISOString().slice(0, 10) : '';
  return { base: json.base_code, date, rates: cleanRates(json.rates), source: 'ExchangeRate-API' };
}

// Only accept sane positive numbers for 3-letter codes; anything else from the network is dropped.
function cleanRates(rates) {
  const out = {};
  for (const [k, v] of Object.entries(rates)) if (/^[A-Z]{3}$/.test(k) && typeof v === 'number' && isFinite(v) && v > 0 && v < 1e7) out[k] = v;
  return out;
}

/** Merge a fresh rate set into state.fx, keeping ~120 days of history for the currencies in use. */
export function mergeRates(fx, fresh, keep = []) {
  const history = { ...(fx?.base === fresh.base ? fx.history : {}) };
  const pick = Object.fromEntries(Object.entries(fresh.rates).filter(([k]) => keep.includes(k)));
  if (fresh.date) history[fresh.date] = { ...(history[fresh.date] || {}), ...pick };
  const dates = Object.keys(history).sort();
  for (const d of dates.slice(0, Math.max(0, dates.length - 120))) delete history[d];
  return { base: fresh.base, date: fresh.date, rates: fresh.rates, source: fresh.source, fetchedAt: new Date().toISOString(), history };
}

/** Rate on or just before a date from history (falls back to the current rate). */
export function historicalRate(fx, cur, date) {
  const dates = Object.keys(fx?.history || {}).filter((d) => d <= date && fx.history[d][cur]).sort();
  return dates.length ? fx.history[dates[dates.length - 1]][cur] : fx?.rates?.[cur] ?? null;
}

/**
 * How much more/less each foreign-currency bill or debt payment costs today than ~30 days ago.
 * e.g. a ₹25,000 EMI costing £3.10 more because the rupee strengthened.
 */
export function fxDrift(state, today, days = 30) {
  const base = baseCurrency(state);
  const fx = state.fx;
  if (!fx?.rates || fx.base !== base) return [];
  const past = addDays(today, -days);
  const items = [
    ...(state.recurring || []).filter((r) => r.active !== false && r.currency && r.currency !== base).map((r) => ({ name: r.name, amount: r.amount, currency: r.currency })),
    ...(state.debts || []).filter((d) => d.balance > 0 && d.currency && d.currency !== base).map((d) => ({ name: d.name, amount: d.minPayment, currency: d.currency })),
  ];
  return items.map((it) => {
    const now = fx.rates[it.currency];
    const then = historicalRate(fx, it.currency, past);
    if (!now || !then) return null;
    const costNow = it.amount / now;
    const costThen = it.amount / then;
    return { ...it, costNow: round2(costNow), costThen: round2(costThen), change: round2(costNow - costThen), pct: (costNow - costThen) / costThen, rateNow: now, rateThen: then };
  }).filter(Boolean);
}
