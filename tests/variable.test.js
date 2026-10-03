import { describe, it, expect } from 'vitest';
import { createEmptyState, reduce } from '../src/engine/state.js';
import { buildOccurrences, monthSummary, debtPayment } from '../src/engine/summary.js';
import { estimateAmount, detectRecurring } from '../src/engine/recurring.js';
import { billsNeedingAmounts, reviewQueue } from '../src/engine/review.js';

const TODAY = '2026-10-10';
const txn = (id, date, amount, description, extra = {}) => ({ id, date, amount, description, categoryId: 'utilities', source: 'csv', ...extra });

function base() {
  const s = createEmptyState();
  s.settings.onboarded = true;
  s.recurring = [{ id: 'energy', name: 'Octopus Energy', match: 'octopus', amount: 80, direction: 'out', kind: 'bill', categoryId: 'utilities', frequency: 'monthly', dayOfMonth: 14, startDate: '2026-01-01', adjust: 'none', compulsory: true, variable: true, active: true }];
  s.transactions = [
    txn('t1', '2026-07-14', -60, 'OCTOPUS ENERGY'),
    txn('t2', '2026-08-14', -90, 'OCTOPUS ENERGY'),
    txn('t3', '2026-09-14', -120, 'OCTOPUS ENERGY'),
    txn('t0', '2026-06-14', -500, 'OCTOPUS ENERGY'), // older than the last three: ignored
  ];
  return s;
}

describe('bills whose amount varies', () => {
  it('plans with the average of the last three payments', () => {
    const s = base();
    expect(estimateAmount(s.recurring[0], s.transactions)).toBe(90);
    const occ = buildOccurrences(s, '2026-10-01', '2026-10-31').find((o) => o.sourceId === 'energy');
    expect(occ).toMatchObject({ amount: -90, variable: true, estimated: true, date: '2026-10-14' });
  });

  it('ticks the bill off whatever the real amount was', () => {
    const s = base();
    s.transactions.push(txn('t4', '2026-10-14', -140, 'OCTOPUS ENERGY'));
    const sum = monthSummary(s, 2026, 9, '2026-10-20');
    const occ = sum.occurrences.find((o) => o.sourceId === 'energy');
    expect(occ.matchedTxnId).toBe('t4');
    expect(occ.status).toBe('done');
  });

  it('a typed real amount replaces the estimate', () => {
    let s = base();
    s = reduce(s, { type: 'occ/override', payload: { key: 'energy:2026-10-14', amount: 133.5 } });
    const occ = buildOccurrences(s, '2026-10-01', '2026-10-31').find((o) => o.sourceId === 'energy');
    expect(occ).toMatchObject({ amount: -133.5, estimated: false });
  });

  it('asks for the amount from 5 days before it is due, until paid or entered', () => {
    const s = base();
    expect(billsNeedingAmounts(s, '2026-10-08')).toEqual([]);
    expect(billsNeedingAmounts(s, TODAY).map((o) => o.key)).toEqual(['energy:2026-10-14']);
    const q = reviewQueue(s, TODAY);
    expect(q.items.find((i) => i.kind === 'bill-amount')).toMatchObject({ occKey: 'energy:2026-10-14', estimate: 90 });
    const entered = reduce(s, { type: 'occ/override', payload: { key: 'energy:2026-10-14', amount: 101 } });
    expect(billsNeedingAmounts(entered, TODAY)).toEqual([]);
    const paid = { ...s, transactions: [...s.transactions, txn('t5', '2026-10-13', -77, 'OCTOPUS ENERGY')] };
    expect(billsNeedingAmounts(paid, '2026-10-13')).toEqual([]);
  });

  it('suggests a usage-based bill as "amount varies" instead of ignoring it', () => {
    const s = base();
    s.recurring = [];
    s.transactions.push(txn('t6', '2026-10-14', -75, 'OCTOPUS ENERGY'));
    const sug = detectRecurring(s.transactions, [], []).find((x) => x.match.includes('octopus'));
    expect(sug).toMatchObject({ variable: true, frequency: 'monthly', compulsory: true });
    expect(sug.amount).toBe(95); // (90 + 120 + 75) / 3
  });

  it('wildly varying shopping is still not treated as a bill', () => {
    const t = [1, 2, 3, 4].map((m) => ({ id: `s${m}`, date: `2026-0${m + 4}-03`, amount: -(m % 2 ? 20 : 200), description: 'AMAZON', categoryId: 'shopping' }));
    expect(detectRecurring(t, [], []).find((x) => x.match.includes('amazon'))).toBeUndefined();
  });
});

describe('credit card payment styles', () => {
  const card = { id: 'bc', name: 'Barclaycard', type: 'credit-card', balance: 600, minPayment: 25, apr: 24.9, dueDay: 20, statementDay: 28 };

  it('minimum, fixed and full balance', () => {
    expect(debtPayment(card)).toEqual({ amount: 25, variable: false });
    expect(debtPayment({ ...card, payMode: 'fixed', fixedPayment: 150 })).toEqual({ amount: 150, variable: false });
    expect(debtPayment({ ...card, payMode: 'full' })).toEqual({ amount: 600, variable: true });
    const paid = [txn('p1', '2026-08-20', -310, 'BARCLAYCARD', { categoryId: 'debt' }), txn('p2', '2026-09-20', -290, 'BARCLAYCARD', { categoryId: 'debt' })];
    expect(debtPayment({ ...card, payMode: 'full' }, paid)).toEqual({ amount: 300, variable: true });
    // Paying in full with nothing owed today still keeps the monthly card payment on the calendar.
    expect(debtPayment({ ...card, balance: 0, payMode: 'full' }, paid).amount).toBe(300);
    expect(debtPayment({ ...card, balance: 0 })).toBe(null);
  });

  it('asks for the statement amount from the statement date', () => {
    const s = createEmptyState();
    s.debts = [{ ...card, payMode: 'full' }];
    expect(billsNeedingAmounts(s, '2026-09-27')).toEqual([]);
    const due = billsNeedingAmounts(s, '2026-09-28');
    expect(due.map((o) => [o.key, o.opensOn])).toEqual([['bc:2026-10-20', '2026-09-28']]);
    expect(reviewQueue(s, '2026-09-28').items[0]).toMatchObject({ kind: 'bill-amount', title: 'Barclaycard statement: how much is due?' });
  });
});
