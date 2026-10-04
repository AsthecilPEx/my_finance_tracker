import { describe, it, expect } from 'vitest';
import { createEmptyState, reduce } from '../src/engine/state.js';
import { statementFor, cardBill, cardOutstanding, unclassifiedAccounts, purchasesAwaitingPlan, planApr, emiStatus } from '../src/engine/cards.js';
import { buildOccurrences } from '../src/engine/summary.js';

const r = (date, amount, description) => ({ date, amount, description, account: 'Monzo Flex' });

function flex(rows, extra = {}) {
  let s = createEmptyState();
  s = reduce(s, { type: 'txn/import', payload: { source: 'monzo', rows } });
  return reduce(s, { type: 'card/save', payload: { cardAccount: 'Monzo Flex', name: 'Monzo Flex', statementDay: 27, dueDay: 10, payMode: 'full', spread: { months: 3, apr: 0 }, match: 'monzo flex', ...extra } });
}
const ROWS = [r('2026-07-05', -90, 'CURRYS'), r('2026-08-10', -60, 'ASOS'), r('2026-09-15', -150, 'IKEA'), r('2026-09-30', -9.6, 'PRET')];
const card = (s) => s.debts.find((d) => d.cardAccount);

describe('Flex-style cards (every purchase split into monthly payments)', () => {
  it('bills a third of each of the last three months of purchases', () => {
    const s = flex(ROWS);
    const st = statementFor(s, card(s), '2026-09-27');
    expect(st).toMatchObject({ start: '2026-08-28', from: '2026-06-28', spread: 100, total: 100 });
    expect(st.lines.map((l) => [l.description, l.amount, l.k, l.n, l.original])).toEqual([
      ['CURRYS', 30, 3, 3, 90],
      ['ASOS', 20, 2, 3, 60],
      ['IKEA', 50, 1, 3, 150],
    ]);
    const bill = cardBill(s, card(s), '2026-09-27');
    expect(bill).toMatchObject({ due: '2026-10-10', payment: 100, estimated: false });
    // Pulse's Flex history starts on 5 Jul, after this bill's window opens (28 Jun): it says so.
    expect(bill).toMatchObject({ historyGap: true, historyFrom: '2026-07-05' });
    expect(cardBill(flex([r('2026-06-20', -3, 'OLD'), ...ROWS]), card(flex(ROWS)), '2026-09-27').historyGap).toBe(false);
    expect(cardOutstanding(s, card(s), '2026-10-04')).toBe(229.6);
  });

  it('a purchase paid in full is a one-month plan', () => {
    let s = flex(ROWS);
    const ikea = s.transactions.find((t) => t.description === 'IKEA');
    s = reduce(s, { type: 'emi/save', payload: { txnId: ikea.id, tenure: 1, apr: 0, firstClose: '2026-09-27' } });
    expect(statementFor(s, card(s), '2026-09-27').total).toBe(200);
    expect(statementFor(s, card(s), '2026-10-27').total).toBe(20 + 3.2);
  });

  it('flags a bill that may include purchases older than Pulse has', () => {
    const s = flex(ROWS.slice(1));
    expect(cardBill(s, card(s), '2026-09-27')).toMatchObject({ historyGap: true, historyFrom: '2026-08-10', total: 70 });
  });

  it('the real bill amount you type in wins everywhere', () => {
    let s = flex(ROWS.slice(1));
    s = reduce(s, { type: 'occ/override', payload: { key: `${card(s).id}:2026-10-10`, amount: 176.35 } });
    expect(cardBill(s, card(s), '2026-09-27')).toMatchObject({ payment: 176.35, entered: true, calculated: 70 });
    const occ = buildOccurrences(s, '2026-10-01', '2026-10-31').find((o) => o.cardBill);
    expect(occ).toMatchObject({ date: '2026-10-10', amount: -176.35 });
  });

  it('a normal card is unchanged by the spread option being off', () => {
    const s = flex(ROWS, { spread: null });
    expect(statementFor(s, card(s), '2026-09-27')).toMatchObject({ purchases: 150, spread: 0, total: 150 });
    expect(card(s).plan).toEqual({ mode: 'full' });
  });

  it('suggests Flex presets in the new-account question', () => {
    let s = createEmptyState();
    s = reduce(s, { type: 'txn/import', payload: { source: 'monzo', rows: ROWS } });
    expect(unclassifiedAccounts(s)[0]).toMatchObject({ account: 'Monzo Flex', likelyCard: true, flex: true });
  });

  describe('Monzo Flex default payment options', () => {
    const FLEX = { mode: 'full', freeMonths: 3, apr: 39, maxMonths: 24, minInstalment: 5 };

    it('"Pay in full on 10th": every purchase on the next bill, 0% interest', () => {
      const s = flex(ROWS, { spread: null, plan: { ...FLEX, mode: 'full' } });
      expect(statementFor(s, card(s), '2026-09-27').total).toBe(150);
      expect(cardBill(s, card(s), '2026-09-27').due).toBe('2026-10-10');
    });

    it('"Choose for every purchase": asks about each new purchase, plans use the right rate', () => {
      let s = flex(ROWS, { spread: null, plan: { ...FLEX, mode: 'choose' } });
      const waiting = purchasesAwaitingPlan(s, '2026-10-04').map((x) => x.txn.description);
      expect(waiting).toEqual(['PRET', 'IKEA']);
      expect(statementFor(s, card(s), '2026-09-27').total).toBe(150); // in full until chosen
      expect(planApr(card(s), 3)).toBe(0);
      expect(planApr(card(s), 6)).toBe(39);
      const ikea = s.transactions.find((t) => t.description === 'IKEA');
      s = reduce(s, { type: 'emi/save', payload: { txnId: ikea.id, tenure: 6, apr: planApr(card(s), 6), firstClose: '2026-09-27' } });
      expect(purchasesAwaitingPlan(s, '2026-10-04').map((x) => x.txn.description)).toEqual(['PRET']);
      const plan = s.debts.find((d) => d.type === 'card-emi');
      expect(plan).toMatchObject({ tenure: 6, apr: 39 });
      expect(statementFor(s, card(s), '2026-09-27').total).toBe(emiStatus(plan, card(s), '2026-09-30').rows[0].amount);
    });

    it('"Minimum monthly payment": up to 24 months at 39%, fewer for small purchases', () => {
      const s = flex([r('2026-09-15', -600, 'SOFA'), r('2026-09-16', -40, 'SHOES'), r('2026-09-17', -4, 'COFFEE')], { spread: null, plan: { ...FLEX, mode: 'minimum' } });
      const lines = statementFor(s, card(s), '2026-09-27').lines;
      const by = Object.fromEntries(lines.map((l) => [l.description, l]));
      expect(by.SOFA.n).toBe(24);
      expect(by.SHOES.n).toBe(8); // £40 at a £5 minimum
      expect(by.COFFEE).toMatchObject({ kind: 'purchase', amount: 4 }); // too small to split
      expect(by.SOFA.amount).toBeCloseTo(600 * (0.39 / 12) / (1 - (1 + 0.39 / 12) ** -24), 1);
    });
  });
});

describe('Plan options follow each card’s own setting', () => {
  const two = () => {
    let s = createEmptyState();
    s = reduce(s, { type: 'txn/import', payload: { source: 'csv', rows: [
      { date: '2026-09-20', amount: -40, description: 'ASOS', account: 'Monzo Flex' },
      { date: '2026-09-21', amount: -25, description: 'TESCO', account: 'Barclaycard' },
    ] } });
    s = reduce(s, { type: 'card/save', payload: { cardAccount: 'Monzo Flex', name: 'Monzo Flex', statementDay: 27, dueDay: 10, payMode: 'full', plan: { mode: 'choose', options: '3, 6, 12, 24' } } });
    return reduce(s, { type: 'card/save', payload: { cardAccount: 'Barclaycard', name: 'Barclaycard', statementDay: 5, dueDay: 25, payMode: 'full', plan: { mode: 'full' } } });
  };

  it('only asks about purchases on cards set to "I choose"', () => {
    const asked = purchasesAwaitingPlan(two(), '2026-09-25');
    expect(asked.map((a) => a.txn.description)).toEqual(['ASOS']);
  });

  it('keeps each card’s own plan lengths', () => {
    const s = two();
    let c = s.debts.find((d) => d.cardAccount === 'Monzo Flex');
    expect(c.plan.options).toEqual([3, 6, 12, 24]);
    const s2 = reduce(s, { type: 'card/save', payload: { ...c, plan: { ...c.plan, options: '6 12' } } });
    c = s2.debts.find((d) => d.cardAccount === 'Monzo Flex');
    expect(c.plan.options).toEqual([6, 12]);
  });
});
