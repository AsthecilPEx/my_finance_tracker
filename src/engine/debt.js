import { round2 } from './money.js';

export const DEBT_TYPES = {
  'credit-card': 'Credit card',
  loan: 'Personal loan',
  'car-finance': 'Car finance',
  mortgage: 'Mortgage',
  bnpl: 'Buy now, pay later',
  overdraft: 'Overdraft',
  student: 'Student loan',
  personal: 'Owed to a person',
};

/**
 * Simulate paying off debts month by month.
 * strategy: 'avalanche' (highest APR first - least interest) or 'snowball' (smallest balance first - quick wins).
 * Freed-up minimum payments roll into the next target debt.
 */
export function simulatePayoff(debts, { extra = 0, strategy = 'avalanche', maxMonths = 600 } = {}) {
  const live = debts
    .filter((d) => d.balance > 0)
    .map((d) => ({ id: d.id, name: d.name, balance: d.balance, apr: d.apr || 0, min: Math.max(d.minPayment || 0, 0) }));
  const budget = live.reduce((s, d) => s + d.min, 0) + extra;
  const payoffMonth = {};
  const timeline = [];
  let totalInterest = 0;
  let month = 0;
  let stuck = false;

  while (live.some((d) => d.balance > 0.005) && month < maxMonths) {
    month++;
    for (const d of live) {
      if (d.balance <= 0) continue;
      const interest = (d.balance * d.apr) / 100 / 12;
      d.balance += interest;
      totalInterest += interest;
    }
    let pool = budget;
    for (const d of live) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.min, d.balance, pool);
      d.balance -= pay;
      pool -= pay;
    }
    const order = live
      .filter((d) => d.balance > 0.005)
      .sort((a, b) => (strategy === 'snowball' ? a.balance - b.balance : b.apr - a.apr || a.balance - b.balance));
    for (const d of order) {
      if (pool <= 0) break;
      const pay = Math.min(pool, d.balance);
      d.balance -= pay;
      pool -= pay;
    }
    for (const d of live) {
      if (d.balance <= 0.005 && !payoffMonth[d.id]) {
        d.balance = 0;
        payoffMonth[d.id] = month;
      }
    }
    const total = live.reduce((s, d) => s + d.balance, 0);
    timeline.push(round2(total));
    // Payments not covering interest: the debt never clears.
    if (month > 24 && timeline[month - 1] >= timeline[month - 13]) { stuck = true; break; }
  }
  return {
    months: stuck ? Infinity : month,
    totalInterest: round2(totalInterest),
    payoffMonth,
    timeline,
    monthlyBudget: round2(budget),
    stuck,
  };
}

export function monthlyInterest(debts) {
  return round2(debts.reduce((s, d) => s + ((d.balance || 0) * (d.apr || 0)) / 100 / 12, 0));
}
