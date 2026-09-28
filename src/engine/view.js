// The "financial view": the state as the maths should see it.
//  - bills and debts in other currencies are converted to the base currency at today's rate
//  - split transactions count only your share (the part you're paid back is not your spending)
// Every engine entry point runs on this view, so an exchange-rate update or a new split flows
// through all totals, meters, forecasts, caps and insights without special cases.
import { toBase, baseCurrency } from './fx.js';
import { myAmount } from './split.js';

const cache = new WeakMap();

export function financialView(state) {
  if (!state || state.__view) return state;
  const hit = cache.get(state);
  if (hit) return hit;
  const base = baseCurrency(state);
  const foreign = (c) => c && c !== base;
  const view = {
    ...state,
    __view: true,
    recurring: (state.recurring || []).map((r) => (foreign(r.currency) ? { ...r, amount: toBase(r.amount, r.currency, state), native: { amount: r.amount, currency: r.currency } } : r)),
    debts: (state.debts || []).map((d) => (foreign(d.currency)
      ? { ...d, balance: toBase(d.balance, d.currency, state), minPayment: toBase(d.minPayment || 0, d.currency, state), originalBalance: toBase(d.originalBalance || d.balance, d.currency, state), native: { balance: d.balance, minPayment: d.minPayment, currency: d.currency } }
      : d)),
    transactions: (state.transactions || []).map((t) => (t.amount < 0 && t.split?.owed > 0 ? { ...t, amount: myAmount(t), rawAmount: t.amount } : t)),
  };
  cache.set(state, view);
  return view;
}
