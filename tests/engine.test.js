import { describe, it, expect } from 'vitest';
import { occurrencesBetween, detectRecurring, matchOccurrences } from '../src/engine/recurring.js';
import { parseStatement, parseStatementDate, parseAmount } from '../src/engine/csv.js';
import { categorise, merchantKey } from '../src/engine/categories.js';
import { simulatePayoff } from '../src/engine/debt.js';
import { createEmptyState, mergeRows, reduce } from '../src/engine/state.js';
import { monthSummary, upcoming } from '../src/engine/summary.js';
import { generateInsights } from '../src/engine/insights.js';
import { createDemoState } from '../src/engine/demo.js';
import { addDays } from '../src/engine/dates.js';

describe('schedules', () => {
  it('moves a weekend payday to the previous working day', () => {
    // 25 Oct 2026 is a Sunday -> Friday 23rd
    const item = { frequency: 'monthly', dayOfMonth: 25, adjust: 'previous-working', startDate: '2026-01-01' };
    expect(occurrencesBetween(item, '2026-10-01', '2026-10-31')).toEqual(['2026-10-23']);
  });

  it('handles last working day with bank holidays', () => {
    // 31 Aug 2026 is the summer bank holiday (Monday) -> Friday 28th
    const item = { frequency: 'last-working-day', startDate: '2026-01-01' };
    expect(occurrencesBetween(item, '2026-08-01', '2026-08-31')).toEqual(['2026-08-28']);
  });

  it('clamps day 31 to short months and respects fortnightly anchors', () => {
    expect(occurrencesBetween({ frequency: 'monthly', dayOfMonth: 31, startDate: '2026-01-01' }, '2026-02-01', '2026-02-28')).toEqual(['2026-02-28']);
    expect(occurrencesBetween({ frequency: 'fortnightly', startDate: '2026-09-04' }, '2026-09-10', '2026-10-10')).toEqual(['2026-09-18', '2026-10-02']);
  });

  it('catches an adjusted date that crosses into the previous month', () => {
    // 1 Nov 2026 is a Sunday; paid on the previous working day, which is Fri 30 Oct
    const item = { frequency: 'monthly', dayOfMonth: 1, adjust: 'previous-working', startDate: '2026-01-01' };
    expect(occurrencesBetween(item, '2026-10-01', '2026-10-31')).toEqual(['2026-10-01', '2026-10-30']);
  });
});

describe('statement import', () => {
  it('parses UK dates and amounts', () => {
    expect(parseStatementDate('05/03/2026')).toBe('2026-03-05');
    expect(parseStatementDate('05 Mar 2026')).toBe('2026-03-05');
    expect(parseStatementDate('2026-03-05 10:22:01')).toBe('2026-03-05');
    expect(parseAmount('£1,234.56')).toBe(1234.56);
    expect(parseAmount('(12.00)')).toBe(-12);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('-4,50')).toBe(-4.5);
  });

  it('reads a Nationwide style file with preamble and paid in/out columns', () => {
    const csv = `"Account Name:","FlexAccount ****1234"\n"Account Balance:","£1,000.00"\n\n"Date","Transaction type","Description","Paid out","Paid in","Balance"\n"02 Sep 2026","Contactless","TESCO STORES","£23.40","","£976.60"\n"25 Sep 2026","Bank credit","ACME LTD SALARY","","£2,850.00","£3,826.60"`;
    const { rows, bank } = parseStatement(csv);
    expect(bank).toBe('nationwide');
    expect(rows).toEqual([
      { date: '2026-09-02', amount: -23.4, description: 'TESCO STORES', account: 'Nationwide', bank: 'nationwide' },
      { date: '2026-09-25', amount: 2850, description: 'ACME LTD SALARY', account: 'Nationwide', bank: 'nationwide' },
    ]);
  });

  it('prefers the merchant name in Monzo exports', () => {
    const csv = 'Transaction ID,Date,Time,Type,Name,Emoji,Category,Amount,Currency,Description\ntx_1,01/09/2026,10:00,Card payment,Pret A Manger,☕,Eating out,-4.20,GBP,PRET A MANGER LONDON GBR';
    expect(parseStatement(csv).rows[0]).toEqual({ date: '2026-09-01', amount: -4.2, description: 'Pret A Manger' });
  });

  it('never double-imports overlapping statements but keeps same-day identical purchases', () => {
    let s = createEmptyState();
    const rows = [
      { date: '2026-09-01', amount: -3.5, description: 'COSTA' },
      { date: '2026-09-01', amount: -3.5, description: 'COSTA' },
      { date: '2026-09-02', amount: -40, description: 'TESCO' },
    ];
    const first = mergeRows(s, rows, 'csv');
    expect(first.added).toBe(3);
    const second = mergeRows(first.state, [...rows, { date: '2026-09-03', amount: -9, description: 'BOOTS' }], 'csv');
    expect(second.added).toBe(1);
    expect(second.duplicates).toBe(3);
  });
});

describe('cross-source de-duplication', () => {
  it('does not double count a payment imported by CSV and then synced from the bank', () => {
    let s = mergeRows(createEmptyState(), [{ date: '2026-09-02', amount: -23.4, description: 'TESCO STORES 2841' }], 'csv').state;
    const r = mergeRows(s, [
      { date: '2026-09-03', amount: -23.4, description: 'Tesco', externalId: 'b1' },
      { date: '2026-09-03', amount: -9.99, description: 'Boots', externalId: 'b2' },
    ], 'bank');
    expect(r.added).toBe(1);
    expect(r.duplicates).toBe(1);
  });
});

describe('categorisation', () => {
  it('recognises UK merchants', () => {
    expect(categorise('TESCO STORES 2841', -20)).toBe('groceries');
    expect(categorise('TFL TRAVEL CH', -3)).toBe('transport');
    expect(categorise('NETFLIX.COM', -10.99)).toBe('subscriptions');
    expect(categorise('ACME LTD SALARY BGC', 2850)).toBe('salary');
    expect(categorise('BARCLAYCARD PAYMENT', -70)).toBe('debt');
    expect(categorise('Something odd', -5)).toBe('other');
  });

  it('learns from a re-categorisation', () => {
    let s = mergeRows(createEmptyState(), [
      { date: '2026-09-01', amount: -12, description: 'JOES PLACE 123' },
      { date: '2026-09-08', amount: -14, description: 'JOES PLACE 456' },
    ], 'csv').state;
    s = reduce(s, { type: 'txn/update', payload: { id: s.transactions[0].id, categoryId: 'eating_out', learn: true } });
    expect(s.transactions.every((t) => t.categoryId === 'eating_out')).toBe(true);
    expect(merchantKey('JOES PLACE 789')).toBe('joes place');
    expect(categorise('JOES PLACE 789', -9, s.rules)).toBe('eating_out');
  });
});

describe('recurring detection', () => {
  it('finds a monthly subscription and a price rise', () => {
    const txns = ['2026-05-14', '2026-06-14', '2026-07-14', '2026-08-14', '2026-09-14'].map((date, i) => ({
      id: String(i), date, amount: i < 4 ? -10.99 : -11.99, description: `SPOTIFY UK ${i}`, categoryId: 'subscriptions',
    }));
    const [s] = detectRecurring(txns);
    expect(s.frequency).toBe('monthly');
    expect(s.dayOfMonth).toBe(14);
    expect(s.kind).toBe('subscription');
    expect(s.compulsory).toBe(false);
    expect(s.amountChanged).toEqual({ from: 10.99, to: 11.99 });
  });

  it('matches expected bills to real payments', () => {
    const occ = [{ date: '2026-09-05', amount: -96, name: 'Octopus', match: 'octopus', sourceId: 'x' }];
    matchOccurrences(occ, [{ id: 't1', date: '2026-09-06', amount: -99.1, description: 'OCTOPUS ENERGY DD' }]);
    expect(occ[0].matchedTxnId).toBe('t1');
  });
});

describe('debt payoff', () => {
  const debts = [
    { id: 'a', name: 'Card', balance: 2000, apr: 24.9, minPayment: 60 },
    { id: 'b', name: 'Loan', balance: 500, apr: 5, minPayment: 50 },
  ];
  it('avalanche pays less interest than snowball', () => {
    const av = simulatePayoff(debts, { extra: 100, strategy: 'avalanche' });
    const sn = simulatePayoff(debts, { extra: 100, strategy: 'snowball' });
    expect(av.totalInterest).toBeLessThan(sn.totalInterest);
    expect(sn.payoffMonth.b).toBeLessThan(sn.payoffMonth.a);
  });
  it('flags payments that never clear the debt', () => {
    expect(simulatePayoff([{ id: 'x', balance: 5000, apr: 30, minPayment: 100 }]).stuck).toBe(true);
  });
});

describe('dashboard summary with demo data', () => {
  const today = '2026-09-24';
  const state = createDemoState(today);

  it('builds a month summary that adds up', () => {
    const s = monthSummary(state, 2026, 8, today);
    expect(s.income).toBeGreaterThan(3000);
    expect(s.spent).toBeGreaterThan(1000);
    expect(s.leftToSpend).toBeCloseTo(s.income - s.spent - s.saved - s.committedPending, 1);
    expect(s.nextPayday.date).toBe('2026-09-25');
    expect(s.days['2026-09-25'].events.some((e) => e.type === 'payday')).toBe(true);
    // Rent on the 1st was paid and matched to its transaction
    expect(s.occurrences.find((o) => o.name === 'Rent').status).toBe('done');
    expect(s.byCategory[0].spent).toBeGreaterThan(0);
  });

  it('lists upcoming unpaid bills', () => {
    const list = upcoming(state, today, 10);
    expect(list.map((o) => o.name)).toContain('Car finance');
    expect(list.every((o) => o.date >= today && o.date <= addDays(today, 10))).toBe(true);
  });

  it('produces actionable insights', () => {
    const ins = generateInsights(state, today);
    const ids = ins.cards.map((c) => c.id);
    expect(ids).toContain('debt-apr');
    expect(ids).toContain('subs-streaming');
    expect(ids.some((id) => id.startsWith('rise-'))).toBe(true);
    expect(ins.monthly).toHaveLength(6);
    expect(ins.split.compulsory).toBeGreaterThan(0);
  });
});
