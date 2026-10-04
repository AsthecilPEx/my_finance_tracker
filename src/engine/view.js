// The "financial view": the state as the maths should see it.
//  - bills and debts in other currencies are converted to the base currency at today's rate
//  - split transactions count only your share (the part you're paid back is not your spending)
// Every engine entry point runs on this view, so an exchange-rate update or a new split flows
// through all totals, meters, forecasts, caps and insights without special cases.
import { toBase, baseCurrency } from './fx.js';
import { myAmount } from './split.js';
import { isCardDebt, isCardEmi, cardOutstanding, currentBill, emiStatus, emiSchedule } from './cards.js';
import { todayISO } from './dates.js';

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
  // Tracked credit cards and their EMI plans: balances and payments come from the card's transactions.
  if ((state.debts || []).some((d) => isCardDebt(d) || isCardEmi(d))) {
    const today = todayISO();
    const cards = Object.fromEntries(view.debts.filter(isCardDebt).map((d) => [d.id, d]));
    view.debts = view.debts.map((d) => {
      if (isCardDebt(d)) {
        const bill = currentBill(state, d, today);
        return { ...d, balance: cardOutstanding(state, d, today), minPayment: bill.payment, nextBill: bill };
      }
      if (isCardEmi(d)) {
        const st = emiStatus(d, cards[d.viaCard], today);
        return { ...d, balance: st.remaining, originalBalance: d.principal, minPayment: st.done ? 0 : st.instalment, emi: st };
      }
      return d;
    });
    // An EMI'd purchase isn't one big spend: each billed instalment counts in its own month instead.
    // (A one-month plan just means "pay this one in full": its spending stays on the purchase date.)
    const plans = view.debts.filter((d) => isCardEmi(d) && (d.tenure || 1) > 1);
    const byTxn = new Map(plans.map((p) => [p.txnId, p]));
    const extra = [];
    view.transactions = view.transactions.map((t) => (t.emiId && byTxn.has(t.id) ? { ...t, categoryId: 'transfer', emiConverted: true } : t));
    for (const p of plans) {
      const src = (state.transactions || []).find((t) => t.id === p.txnId);
      for (const r of emiSchedule(p, cards[p.viaCard])) {
        if (r.date > today) break;
        extra.push({ id: `emi:${p.id}:${r.k}`, date: r.date, amount: -r.amount, description: `${p.name} (instalment ${r.k}/${p.tenure})`, categoryId: src?.categoryId || 'debt', account: cards[p.viaCard]?.cardAccount || '', source: 'emi', virtual: true });
      }
    }
    if (extra.length) view.transactions = [...view.transactions, ...extra].sort((a, b) => b.date.localeCompare(a.date));
  }
  cache.set(state, view);
  return view;
}

