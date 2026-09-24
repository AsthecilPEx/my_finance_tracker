import { describe, it, expect } from 'vitest';
import { takeHome, parseTaxCode } from '../src/engine/payroll.js';
import { incomeItems, newIncome, profileSummary } from '../src/engine/income.js';
import { occurrencesBetween } from '../src/engine/recurring.js';
import { parseReceiptText, suggestTier, receiptInbox, basketAnalytics } from '../src/engine/receipts.js';
import { evaluateCaps } from '../src/engine/caps.js';
import { payPlan, bonusPaydayMonths, payWindow, incomeVariability } from '../src/engine/planner.js';
import { buildPrompt, parsePlan, diffPlan } from '../src/engine/aiplan.js';
import { createEmptyState, reduce, migrate } from '../src/engine/state.js';
import { createDemoState } from '../src/engine/demo.js';
import { monthSummary } from '../src/engine/summary.js';

const T = '2026-09-24';

describe('UK take-home pay', () => {
  it('matches HMRC figures for a £30k salary', () => {
    const r = takeHome({ payType: 'salary', annual: 30000, schedule: { frequency: 'monthly' } });
    expect(r.netPerPay).toBeCloseTo(2093.45, 2);
    expect(r.band).toBe('Basic rate');
  });
  it('tapers the personal allowance above £100k', () => {
    const r = takeHome({ payType: 'salary', annual: 120000, schedule: { frequency: 'monthly' } });
    expect(r.lines.find((l) => l.name === 'Income tax').amount).toBeCloseTo(39428.4, 0);
  });
  it('handles Scottish bands, student loans, salary sacrifice and flat codes', () => {
    const scot = takeHome({ payType: 'salary', annual: 40000, schedule: { frequency: 'monthly' } }, 'scotland');
    const ruk = takeHome({ payType: 'salary', annual: 40000, schedule: { frequency: 'monthly' } }, 'ruk');
    expect(scot.net).toBeLessThan(ruk.net);
    const sl = takeHome({ payType: 'salary', annual: 38470, studentLoans: ['plan2'], schedule: { frequency: 'monthly' } });
    expect(sl.lines.find((l) => l.name.includes('Plan 2')).amount).toBeCloseTo(900, 0);
    const sac = takeHome({ payType: 'salary', annual: 40000, pensionPct: 10, pensionType: 'salary-sacrifice', schedule: { frequency: 'monthly' } });
    const net = takeHome({ payType: 'salary', annual: 40000, pensionPct: 10, pensionType: 'net-pay', schedule: { frequency: 'monthly' } });
    expect(sac.net).toBeGreaterThan(net.net); // sacrifice also saves NI
    expect(parseTaxCode('S1257L').scottish).toBe(true);
    expect(parseTaxCode('K475').allowance).toBe(-4750);
    const br = takeHome({ payType: 'hourly', hourlyRate: 12.6, hoursPerWeek: 10, taxCode: 'BR', schedule: { frequency: 'weekly' } });
    expect(br.netPerPay).toBeCloseTo(100.8, 2);
  });
});

describe('pay patterns', () => {
  it('turns a weekly-every-Friday job into Friday paydays', () => {
    const st = { profile: { incomes: [newIncome({ payType: 'net', netPerPay: 400, schedule: { frequency: 'weekly', weekday: 5 } })] } };
    const [item] = incomeItems(st);
    const days = occurrencesBetween(item, '2026-10-01', '2026-10-31');
    expect(days).toEqual(['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']);
    expect(profileSummary(st).monthly).toBeCloseTo((400 * 52) / 12, 1);
  });
  it('supports last Friday of the month and irregular paydays', () => {
    const st = { profile: { incomes: [
      newIncome({ id: 'a', payType: 'net', netPerPay: 1000, schedule: { frequency: 'last-weekday', weekday: 5 } }),
      newIncome({ id: 'b', payType: 'net', netPerPay: 300, schedule: { frequency: 'irregular' }, irregularDates: [{ date: '2026-10-07', amount: 250 }] }),
    ] } };
    const items = incomeItems(st);
    expect(occurrencesBetween(items[0], '2026-10-01', '2026-10-31')).toEqual(['2026-10-30']);
    expect(items[1].amount).toBe(250);
  });
  it('plans variable earners on their lowest typical pay', () => {
    const st = { profile: { incomes: [newIncome({ payType: 'hourly', hourlyRate: 15, hoursPerWeek: 20, variable: true, lowestNet: 180, schedule: { frequency: 'weekly', weekday: 5 } })] } };
    expect(incomeItems(st)[0].amount).toBe(180);
  });
});

describe('receipts', () => {
  const text = 'ALDI STORES\nSEMI SKIMMED MILK 4PT ~~ 1.45\nSALTED CRISPS 6PK 1.29\nPRICE CUT -0.30\n2 X CHICKEN BREAST @ 2.85\n\n5.70\nTOTAL 8.14\nCARD 8.14';
  it('parses items, multi-line quantities, discounts and the total', () => {
    const r = parseReceiptText(text);
    expect(r.items.map((i) => i.price)).toEqual([1.45, 1.29, -0.3, 5.7]);
    expect(r.items[3]).toMatchObject({ qty: 2, name: 'Chicken Breast' });
    expect(r.total).toBe(8.14);
    expect(r.itemsTotal).toBe(8.14);
  });
  it('rates importance and learns from the user', () => {
    expect(suggestTier('Semi Skimmed Milk')).toBe('essential');
    expect(suggestTier('Salted Crisps 6pk')).toBe('low');
    expect(suggestTier('Orange Juice')).toBe('moderate');
    let s = createEmptyState();
    s = reduce(s, { type: 'receipt/save', payload: { txnId: 'x', date: T, items: [{ name: 'Orange Juice 1L', price: 1.5, tier: 'essential', section: 'groceries' }] } });
    expect(suggestTier('ORANGE JUICE 1L', s.itemRules)).toBe('essential');
  });
  it('builds an inbox and basket analytics from demo data', () => {
    const s = createDemoState(T);
    const inbox = receiptInbox(s, T);
    expect(inbox.length).toBeGreaterThan(0);
    expect(inbox.every((t) => ['groceries', 'shopping', 'eating_out'].includes(t.categoryId))).toBe(true);
    const b = basketAnalytics(s, T);
    expect(b.receiptsCount).toBeGreaterThan(10);
    expect(b.avgByTier.essential).toBeGreaterThan(b.avgByTier.low);
    expect(b.lowItems[0].tier).toBe('low');
  });
});

describe('spend caps and pay planner', () => {
  const s = createDemoState(T);
  it('evaluates caps per month, week and pay period', () => {
    const caps = evaluateCaps(s, T);
    expect(caps).toHaveLength(3);
    const pp = caps.find((c) => c.cap.period === 'payperiod');
    expect(pp.window).toMatchObject({ from: '2026-08-25', to: '2026-09-24' }); // main salary, not weekly side job
    const week = caps.find((c) => c.cap.period === 'week');
    expect(week.window).toMatchObject({ from: '2026-09-21', to: '2026-09-27' });
    expect(caps.every((c) => ['ok', 'near', 'over'].includes(c.status))).toBe(true);
  });
  it('smooths monthly bills over irregular paydays with a minimal buffer', () => {
    const plan = payPlan(s, T, 8);
    expect(plan.periods[0].current).toBe(true);
    expect(plan.periods.every((p) => p.potAfter >= -0.01 && p.spendPotAfter >= -0.01)).toBe(true);
    expect(plan.periods.some((p) => Math.abs(p.potAfter) < 0.01)).toBe(true); // buffer is the minimum needed
    expect(plan.allowancePerDay).toBeGreaterThan(0);
    expect(payWindow(s, T).from).toBe('2026-08-25');
  });
  it('measures pay variability on complete months only', () => {
    const v = incomeVariability(s, T);
    expect(v.months).toBeGreaterThanOrEqual(3);
    expect(v.min).toBeGreaterThan(3000); // not the half-finished current month
  });
  it('finds months with an extra weekly payday', () => {
    const bonus = bonusPaydayMonths(s, T);
    expect(bonus[0]).toMatchObject({ key: '2026-10', extra: 1 });
  });
});

describe('AI plan round trip', () => {
  const s = createDemoState(T);
  it('builds a prompt with the contract and data', () => {
    const p = buildPrompt(s, T, 'I get paid weekly and struggle with rent week.');
    expect(p).toContain('pulsePlanVersion');
    expect(p).toContain('rent week');
    expect(p).toContain('"validCategoryIds"');
    expect(p).not.toContain('Sam'); // no name in the prompt
  });
  it('validates a reply, previews and applies selected changes, then undoes', () => {
    const reply = 'Here is your plan:\n```json\n' + JSON.stringify({
      pulsePlanVersion: 1, title: 'Tighter groceries', budgets: [{ category: 'Groceries', monthly: 300 }, { category: 'unicorns', monthly: 5 }],
      caps: [{ name: 'Treats in the weekly shop', scope: 'tier', tier: 'low', section: 'groceries', amount: 20, period: 'month' }, { name: 'Bad', scope: 'weird', amount: 1 }],
      goals: [{ name: 'Emergency fund', target: 2500, perMonth: 200 }], pauseRecurring: ['Disney+'], debtPlan: { strategy: 'snowball', extraPerMonth: '£50' }, investments: [{ buy: 'BTC' }],
    }) + '\n```';
    const { plan, errors, warnings } = parsePlan(reply, s);
    expect(errors).toEqual([]);
    expect(warnings.length).toBeGreaterThanOrEqual(3);
    expect(plan.budgets).toEqual([{ categoryId: 'groceries', monthly: 300 }]);
    expect(plan.debtPlan).toEqual({ strategy: 'snowball', extra: 50 });
    const changes = diffPlan(s, plan);
    const selected = changes.map((c) => c.id).filter((id) => id !== 'pause:disney+');
    let n = reduce(s, { type: 'plan/apply', payload: { plan, selected } });
    expect(n.categories.find((c) => c.id === 'groceries').budget).toBe(300);
    expect(n.caps.find((c) => c.name === 'Treats in the weekly shop').amount).toBe(20);
    expect(n.caps).toHaveLength(3);
    expect(n.goals.find((g) => g.name === 'Emergency fund').target).toBe(2500);
    expect(n.recurring.find((r) => r.name === 'Disney+').active).toBe(true); // unticked
    expect(n.settings.debtPlan.strategy).toBe('snowball');
    n = reduce(n, { type: 'plan/undo', payload: { id: n.planHistory[0].id } });
    expect(n.categories.find((c) => c.id === 'groceries').budget).toBe(380);
    expect(n.settings.debtPlan.strategy).toBe('avalanche');
  });
  it('rejects replies without a plan', () => {
    expect(parsePlan('Sure! Let me know more.', s).plan).toBeNull();
  });
});

describe('profile-driven calendar', () => {
  it('shows paydays from the pay profile and migrates v1 data', () => {
    const s = createDemoState(T);
    const m = monthSummary(s, 2026, 9, T);
    const paydays = m.occurrences.filter((o) => o.type === 'payday').map((o) => o.date);
    const salary = m.occurrences.filter((o) => o.type === 'payday' && o.sourceId === 'income:inc-main').map((o) => o.date);
    expect(salary).toEqual(['2026-10-23']); // 25 Oct is a Sunday -> Friday 23rd
    expect(paydays).toHaveLength(6); // plus five Fridays of bar shifts
    const old = migrate({ settings: { name: 'Jo', bank: { connected: true, requisitionId: 'x' } }, transactions: [], categories: [] });
    expect(old.profile.name).toBe('Jo');
    expect(old.settings.bank.connected).toBe(false);
  });
});
