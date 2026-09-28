// Split bills: you pay for something shared (e.g. the house shop) and some of it comes back.
// Only your share counts as your spending. Incoming repayments can be linked to one or more
// splits, including partial payments, and are kept out of "money in".
import { round2, sum } from './money.js';

/** The part of a transaction that is really yours (negative = money out). */
export function myAmount(t) {
  if (t.amount < 0 && t.split?.owed > 0) return round2(Math.min(0, t.amount + t.split.owed));
  return t.amount;
}

/** How much has been paid back against each split, from repayment allocations. */
export function settledBySplit(state) {
  const out = new Map();
  for (const t of state.transactions) {
    for (const a of t.settles || []) out.set(a.txnId, round2((out.get(a.txnId) || 0) + (+a.amount || 0)));
  }
  return out;
}

export function openSplits(state, today) {
  const settled = settledBySplit(state);
  return state.transactions
    .filter((t) => t.split?.owed > 0)
    .map((t) => {
      const paid = settled.get(t.id) || 0;
      const outstanding = round2(Math.max(0, t.split.owed - paid) - (t.split.writtenOff || 0));
      return { txn: t, owed: t.split.owed, paid, outstanding: Math.max(0, outstanding), overdue: !!(t.split.expectedBy && today && t.split.expectedBy < today && outstanding > 0.005) };
    });
}

export function splitTotals(state, today) {
  const list = openSplits(state, today);
  return { owedToYou: round2(sum(list, (s) => s.outstanding)), open: list.filter((s) => s.outstanding > 0.005).length, overdue: list.filter((s) => s.overdue).length };
}
