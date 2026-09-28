import { describe, it, expect } from 'vitest';
import { createDemoState } from '../src/engine/demo.js';
import { reduce, createEmptyState, mergeRows } from '../src/engine/state.js';
import { monthSummary } from '../src/engine/summary.js';
import { reviewQueue } from '../src/engine/review.js';
import { openSplits, myAmount } from '../src/engine/split.js';
import { toBase, parseFrankfurter, parseErApi, mergeRates, fxDrift } from '../src/engine/fx.js';
import { formatMoney } from '../src/engine/money.js';
import { parsePlan, diffPlan, buildPrompt } from '../src/engine/aiplan.js';
import { financialView } from '../src/engine/view.js';

const T = '2026-09-27';

describe('split bills', () => {
  it('counts only my share and settles across several splits with partial payments', () => {
    let s = mergeRows(createEmptyState(), [
      { date: '2026-09-01', amount: -90, description: 'TESCO', account: 'A' },
      { date: '2026-09-08', amount: -60, description: 'ALDI', account: 'A' },
      { date: '2026-09-12', amount: 70, description: 'J PATEL', account: 'A' },
    ], 'csv').state;
    const [pay, aldi, tesco] = s.transactions; // newest first
    s = reduce(s, { type: 'txn/split', payload: { id: tesco.id, split: { owed: 60, who: 'Jay' } } });
    s = reduce(s, { type: 'txn/split', payload: { id: aldi.id, split: { owed: 40, who: 'Jay' } } });
    expect(myAmount(s.transactions.find((t) => t.id === tesco.id))).toBe(-30);
    const m = monthSummary(s, 2026, 8, T);
    expect(m.byCategory.find((c) => c.id === 'groceries').spent).toBe(50); // 30 + 20
    s = reduce(s, { type: 'split/settle', payload: { incomingId: pay.id, allocations: [{ txnId: tesco.id, amount: 60 }, { txnId: aldi.id, amount: 10 }] } });
    const open = openSplits(s, T);
    expect(open.find((o) => o.txn.id === tesco.id).outstanding).toBe(0);
    expect(open.find((o) => o.txn.id === aldi.id).outstanding).toBe(30);
    expect(monthSummary(s, 2026, 8, T).incomeActual).toBe(0); // repayment isn't income
  });
  it("can't owe more than was paid", () => {
    let s = mergeRows(createEmptyState(), [{ date: '2026-09-01', amount: -20, description: 'X' }], 'csv').state;
    s = reduce(s, { type: 'txn/split', payload: { id: s.transactions[0].id, split: { owed: 50 } } });
    expect(s.transactions[0].split.owed).toBe(20);
  });
});

describe('currencies', () => {
  const fx = { base: 'GBP', rates: { INR: 110, EUR: 1.2 }, history: {} };
  it('converts bills and debts to the base currency everywhere', () => {
    const s = { ...createEmptyState(), fx, recurring: [{ id: 'r', name: 'EMI', amount: 22000, currency: 'INR', direction: 'out', kind: 'bill', categoryId: 'debt', frequency: 'monthly', dayOfMonth: 5, startDate: '2026-01-01', active: true }], debts: [{ id: 'd', name: 'Loan', balance: 1100000, currency: 'INR', apr: 9, minPayment: 22000, dueDay: 10 }] };
    const m = monthSummary(s, 2026, 9, T);
    expect(m.occurrences.find((o) => o.sourceId === 'r').amount).toBe(-200);
    expect(m.occurrences.find((o) => o.sourceId === 'd').amount).toBe(-200);
    expect(m.debtTotal).toBe(10000);
    expect(financialView(s).debts[0].native.currency).toBe('INR');
    expect(toBase(120, 'EUR', s)).toBe(100);
  });
  it('stores foreign transactions in base with the original kept', () => {
    const s = reduce({ ...createEmptyState(), fx }, { type: 'txn/add', payload: { date: T, amount: -11000, currency: 'INR', description: 'Transfer home' } });
    expect(s.transactions[0]).toMatchObject({ amount: -100, original: { amount: -11000, currency: 'INR', rate: 110 } });
  });
  it('parses both rate providers and rejects junk', () => {
    expect(parseFrankfurter({ amount: 1, base: 'GBP', date: '2026-09-26', rates: { INR: 112.3, BAD: -1, xx: 3 } })).toMatchObject({ base: 'GBP', rates: { INR: 112.3 } });
    expect(parseErApi({ result: 'success', base_code: 'GBP', time_last_update_unix: 1790000000, rates: { INR: 112 } }).rates.INR).toBe(112);
    expect(() => parseFrankfurter('<html>')).toThrow();
    const merged = mergeRates(null, { base: 'GBP', date: '2026-09-26', rates: { INR: 112, USD: 1.3 } }, ['INR']);
    expect(merged.history['2026-09-26']).toEqual({ INR: 112 });
  });
  it('flags exchange-rate drift on foreign bills and formats rupees', () => {
    const s = createDemoState(T);
    const d = fxDrift(s, T)[0];
    expect(d.currency).toBe('INR');
    expect(d.change).toBeGreaterThan(0);
    expect(formatMoney(2500000, 'INR')).toBe('₹25,00,000');
  });
});

describe('review queue', () => {
  it('asks about transfers, unknown money in and overdue splits, and forgets answered ones', () => {
    let s = createDemoState(T);
    const q = reviewQueue(s, T);
    const kinds = q.items.map((i) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['transfer', 'money-in', 'split-overdue']));
    const tr = q.items.find((i) => i.kind === 'transfer');
    s = reduce(s, { type: 'txn/review', payload: { ids: tr.txnIds, categoryId: 'transfer' } });
    const m = monthSummary(s, 2026, 8, T);
    expect(m.days[tr.date].income).toBe(0);
    expect(reviewQueue(s, T).items.some((i) => i.kind === 'transfer')).toBe(false);
    s = reduce(s, { type: 'review/dismiss', payload: { key: q.items.find((i) => i.kind === 'split-overdue').key } });
    expect(reviewQueue(s, T).items.some((i) => i.kind === 'split-overdue')).toBe(false);
  });
});

describe('AI plans update rather than duplicate', () => {
  it('matches caps and goals by id or loose name, and replaces a plan with the same title', () => {
    let s = createDemoState(T);
    const cap = s.caps[0];
    const goal = s.goals[0];
    expect(buildPrompt(s, T)).toContain(cap.id);
    const reply = (extra) => '```json\n' + JSON.stringify({ pulsePlanVersion: 1, title: 'Rent-week rescue', caps: [{ id: cap.id, name: 'Weekly shop treats', scope: 'tier', tier: 'low', section: 'groceries', amount: 25, period: 'month' }], goals: [{ name: '🛟 emergency FUND!', target: 3000, perMonth: 200 }], ...extra }) + '\n```';
    let { plan } = parsePlan(reply(), s);
    expect(diffPlan(s, plan).map((c) => c.text).join(' ')).toMatch(/Update cap.*Update goal/s);
    s = reduce(s, { type: 'plan/apply', payload: { plan, selected: diffPlan(s, plan).map((c) => c.id) } });
    expect(s.caps).toHaveLength(3);
    expect(s.caps.find((c) => c.id === cap.id)).toMatchObject({ amount: 25, name: 'Weekly shop treats' });
    expect(s.goals).toHaveLength(2);
    expect(s.goals.find((g) => g.id === goal.id)).toMatchObject({ target: 3000, saved: 650 });
    ({ plan } = parsePlan(reply(), s));
    s = reduce(s, { type: 'plan/apply', payload: { plan, selected: diffPlan(s, plan).map((c) => c.id) } });
    expect(s.planHistory.filter((h) => !h.superseded)).toHaveLength(1);
  });
});
