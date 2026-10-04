import { describe, it, expect } from 'vitest';
import { createEmptyState, reduce } from '../src/engine/state.js';
import { statementFor, cardBill, cardOutstanding, emiStatus, instalmentFor, unclassifiedAccounts, dueAfter, closesBetween, paymentFor } from '../src/engine/cards.js';
import { buildOccurrences, monthSummary } from '../src/engine/summary.js';
import { financialView } from '../src/engine/view.js';
import { monthlyCommitments } from '../src/engine/planner.js';

const row = (date, amount, description, account) => ({ date, amount, description, account, bank: undefined });

function withCard(extra = {}) {
  let s = createEmptyState();
  s.settings.onboarded = true;
  s = reduce(s, { type: 'txn/import', payload: { source: 'csv', rows: [
    row('2026-07-02', -50, 'TESCO', 'Barclaycard'),
    row('2026-07-10', -1200, 'CURRYS PC WORLD', 'Barclaycard'),
    row('2026-07-15', -30, 'PRET A MANGER', 'Barclaycard'),
    row('2026-07-20', 10, 'TESCO REFUND', 'Barclaycard'),
    row('2026-08-05', -40, 'AMAZON', 'Barclaycard'),
  ] } });
  return reduce(s, { type: 'card/save', payload: { cardAccount: 'Barclaycard', name: 'Barclaycard', statementDay: 28, dueDay: 20, payMode: 'full', apr: 24.9, match: 'barclaycard', ...extra } });
}
const card = (s) => s.debts.find((d) => d.cardAccount);

describe('tracked credit cards', () => {
  it('finds new accounts in imports and guesses cards', () => {
    let s = createEmptyState();
    s = reduce(s, { type: 'txn/import', payload: { source: 'csv', rows: [row('2026-07-02', 50, 'TESCO', 'Amex Gold'), row('2026-07-03', 20, 'PRET', 'Amex Gold'), row('2026-07-04', 9, 'NETFLIX', 'Amex Gold'), row('2026-07-04', -9, 'NETFLIX', 'Lloyds')] } });
    const found = unclassifiedAccounts(s);
    expect(found.find((a) => a.account === 'Amex Gold')).toMatchObject({ likelyCard: true, looksFlipped: true, count: 3 });
    expect(found.find((a) => a.account === 'Lloyds')).toMatchObject({ likelyCard: false });
    s = reduce(s, { type: 'account/classify', payload: { account: 'Lloyds', kind: 'bank' } });
    expect(unclassifiedAccounts(s).map((a) => a.account)).toEqual(['Amex Gold']);
    // Saying it's a card whose export lists purchases as positive flips them.
    s = reduce(s, { type: 'card/save', payload: { cardAccount: 'Amex Gold', name: 'Amex', statementDay: 5, dueDay: 28, flipSign: true } });
    expect(s.transactions.filter((t) => t.account === 'Amex Gold').map((t) => t.amount).sort()).toEqual([-20, -50, -9]);
    expect(unclassifiedAccounts(s)).toEqual([]);
    // A later overlapping export is flipped the same way and not duplicated.
    const n = s.transactions.length;
    s = reduce(s, { type: 'txn/import', payload: { source: 'csv', rows: [row('2026-07-02', 50, 'TESCO', 'Amex Gold'), row('2026-07-09', 15, 'UBER', 'Amex Gold')] } });
    expect(s.transactions.length).toBe(n + 1);
    expect(s.transactions.find((t) => t.description === 'UBER').amount).toBe(-15);
  });

  it('works out the statement and the payment by pay mode', () => {
    const s = withCard();
    const c = card(s);
    expect(closesBetween(c, '2026-07-01', '2026-08-31')).toEqual(['2026-07-28', '2026-08-28']);
    expect(dueAfter(c, '2026-07-28')).toBe('2026-08-20');
    expect(dueAfter({ dueDay: 30 }, '2026-07-28')).toBe('2026-07-30');
    const st = statementFor(s, c, '2026-07-28');
    expect(st).toMatchObject({ start: '2026-06-29', purchases: 1280, refunds: 10, total: 1270 });
    expect(paymentFor(c, 1270)).toBe(1270);
    expect(paymentFor({ payMode: 'minimum' }, 1270)).toBe(38.1);
    expect(paymentFor({ payMode: 'minimum' }, 100)).toBe(25);
    expect(paymentFor({ payMode: 'minimum' }, 10)).toBe(10);
    expect(paymentFor({ payMode: 'fixed', fixedPayment: 200 }, 1270)).toBe(200);
    // Last statement has full data; the August one doesn't yet (latest card transaction is 5 Aug).
    expect(cardBill(s, c, '2026-07-28').estimated).toBe(false);
    expect(cardBill(s, c, '2026-08-28').estimated).toBe(true);
  });

  it('converting a purchase to EMI moves it out of the bill and into instalments', () => {
    let s = withCard();
    const currys = s.transactions.find((t) => t.description === 'CURRYS PC WORLD');
    s = reduce(s, { type: 'emi/save', payload: { txnId: currys.id, tenure: 6, apr: 0, fee: 0, firstClose: '2026-07-28' } });
    const c = card(s);
    const plan = s.debts.find((d) => d.type === 'card-emi');
    expect(plan).toMatchObject({ viaCard: c.id, principal: 1200, instalment: 200, tenure: 6 });
    expect(s.transactions.find((t) => t.id === currys.id).emiId).toBe(plan.id);
    expect(statementFor(s, c, '2026-07-28')).toMatchObject({ purchases: 80, emi: 200, total: 270 });
    expect(statementFor(s, c, '2026-08-28')).toMatchObject({ purchases: 40, emi: 200, total: 240 });
    expect(emiStatus(plan, c, '2026-09-30')).toMatchObject({ billed: 3, remaining: 600, done: false });
    expect(emiStatus(plan, c, '2027-01-31')).toMatchObject({ billed: 6, remaining: 0, done: true });

    // Spending: instalments count in their month; the £1,200 purchase doesn't count as one spend.
    const v = financialView(s);
    expect(v.transactions.find((t) => t.id === currys.id).categoryId).toBe('transfer');
    const inst = v.transactions.filter((t) => t.virtual && t.date <= '2026-08-31').map((t) => [t.date, t.amount]);
    expect(inst).toEqual([['2026-08-28', -200], ['2026-07-28', -200]]);
    const vplan = v.debts.find((d) => d.type === 'card-emi');
    expect(vplan.originalBalance).toBe(1200);

    // Removing the plan restores the purchase.
    s = reduce(s, { type: 'debt/delete', payload: { id: plan.id } });
    expect(s.transactions.find((t) => t.id === currys.id).emiId).toBeUndefined();
    expect(statementFor(s, card(s), '2026-07-28').total).toBe(1270);
  });

  it('interest-bearing EMI uses a proper loan schedule with the fee on the first instalment', () => {
    expect(instalmentFor(1200, 12, 12)).toBe(106.62);
    const st = emiStatus({ principal: 1200, apr: 12, tenure: 12, fee: 25, firstClose: '2026-01-28' }, { statementDay: 28 }, '2026-01-30');
    expect(st.rows[0].amount).toBe(131.62);
    expect(st.rows[11].balance).toBe(0);
    expect(st.totalInterest).toBeCloseTo(79.4, 0);
  });

  it('card bill payments are transfers and the bill sits on the calendar without double counting', () => {
    let s = withCard();
    const currys = s.transactions.find((t) => t.description === 'CURRYS PC WORLD');
    s = reduce(s, { type: 'emi/save', payload: { txnId: currys.id, tenure: 6, apr: 0, firstClose: '2026-07-28' } });
    s = reduce(s, { type: 'txn/import', payload: { source: 'csv', rows: [row('2026-08-20', -270, 'BARCLAYCARD DD', 'Lloyds'), row('2026-08-20', 270, 'PAYMENT RECEIVED - THANK YOU', 'Barclaycard')] } });
    expect(s.transactions.filter((t) => t.date === '2026-08-20').map((t) => t.categoryId)).toEqual(['transfer', 'transfer']);
    const occ = buildOccurrences(s, '2026-08-01', '2026-08-31').filter((o) => o.cardBill);
    expect(occ.map((o) => [o.date, o.amount, o.statementDate])).toEqual([['2026-08-20', -270, '2026-07-28']]);
    const aug = monthSummary(s, 2026, 7, '2026-08-25');
    expect(aug.occurrences.find((o) => o.cardBill).matchedTxnId).toBeTruthy();
    expect(cardOutstanding(s, card(s), '2026-08-25')).toBe(40);
    expect(monthlyCommitments(s)).toBe(0); // the card and its EMI are paid from card spending, not extra commitments
  });

  it('an opening balance anchors what is owed', () => {
    const s = withCard({ balanceAsOf: { amount: 500, date: '2026-07-31' } });
    expect(cardOutstanding(s, card(s), '2026-08-10')).toBe(540);
  });

  it('ignores vague payment keywords and live current accounts', () => {
    let s = createEmptyState();
    s = reduce(s, { type: 'accounts/set', payload: { source: 'monzo', accounts: [{ id: 'm1', name: 'Monzo Current', kind: 'current', balance: 10 }, { id: 'm2', name: 'Monzo Flex', kind: 'credit', balance: -5 }] } });
    s = reduce(s, { type: 'txn/import', payload: { source: 'monzo', rows: [row('2026-07-02', -5, 'CARD SHOP', 'Monzo Current'), row('2026-07-02', -9, 'CURRYS', 'Monzo Flex')] } });
    expect(unclassifiedAccounts(s).map((a) => a.account)).toEqual(['Monzo Flex']);
    s = reduce(s, { type: 'card/save', payload: { cardAccount: 'Monzo Flex', name: 'Flex', match: 'mf', statementDay: 1, dueDay: 1 } });
    expect(s.transactions.find((t) => t.description === 'CARD SHOP').categoryId).not.toBe('transfer');
    // No spending on a card in a month: no £0 bill on the calendar.
    const empty = reduce(createEmptyState(), { type: 'card/save', payload: { cardAccount: 'Amex', name: 'Amex', statementDay: 5, dueDay: 25 } });
    expect(buildOccurrences(empty, '2026-07-01', '2026-09-30').filter((o) => o.cardBill)).toEqual([]);
  });
});
