import { describe, it, expect } from 'vitest';
import { createDemoState } from '../src/engine/demo.js';
import { reduce } from '../src/engine/state.js';
import { monthSummary, buildOccurrences } from '../src/engine/summary.js';
import { payPlan } from '../src/engine/planner.js';
import { netForHours, newIncome } from '../src/engine/income.js';
import { takeHome } from '../src/engine/payroll.js';

const T = '2026-09-27';
const OCT = [2026, 9];
const salaryKey = 'income:inc-main:2026-10-23';

describe('editing a single payday', () => {
  const base = createDemoState(T);
  const before = monthSummary(base, ...OCT, T);

  it('changes the amount and everything that depends on it', () => {
    const s = reduce(base, { type: 'occ/override', payload: { key: salaryKey, amount: 2500, reason: 'absence', note: '3 days sick' } });
    const m = monthSummary(s, ...OCT, T);
    const pay = m.occurrences.find((o) => o.key === salaryKey);
    expect(pay.amount).toBe(2500);
    expect(pay.scheduledAmount).toBeGreaterThan(3000);
    expect(pay.override.note).toBe('3 days sick');
    expect(m.income).toBeCloseTo(before.income - (pay.scheduledAmount - 2500), 2);
    expect(m.leftToSpend).toBeCloseTo(before.leftToSpend - (pay.scheduledAmount - 2500), 2);
    const plan = payPlan(s, T, 8);
    expect(plan.periods.find((p) => p.from === '2026-10-23').income).toBeCloseTo(2500 + 85, 2); // + Friday bar shift
  });

  it('skips a payday entirely', () => {
    const s = reduce(base, { type: 'occ/override', payload: { key: salaryKey, skipped: true } });
    expect(monthSummary(s, ...OCT, T).occurrences.some((o) => o.key === salaryKey)).toBe(false);
  });

  it('moves a payday into another month', () => {
    const s = reduce(base, { type: 'occ/override', payload: { key: salaryKey, date: '2026-11-02' } });
    expect(monthSummary(s, ...OCT, T).occurrences.some((o) => o.key === salaryKey)).toBe(false);
    const nov = buildOccurrences(s, '2026-11-01', '2026-11-30').find((o) => o.key === salaryKey);
    expect(nov.date).toBe('2026-11-02');
    expect(nov.scheduledDate).toBe('2026-10-23');
  });

  it('updates the next payday shown on the dashboard, and resets', () => {
    const next = monthSummary(base, 2026, 8, T).nextPayday;
    let s = reduce(base, { type: 'occ/override', payload: { key: next.key, amount: 50 } });
    expect(monthSummary(s, 2026, 8, T).nextPayday).toMatchObject({ amount: 50, edited: true });
    s = reduce(s, { type: 'occ/reset', payload: { key: next.key } });
    expect(monthSummary(s, 2026, 8, T).nextPayday.amount).toBe(next.amount);
  });

  it('works for a single bill too', () => {
    const rent = monthSummary(base, ...OCT, T).occurrences.find((o) => o.name === 'Rent');
    const s = reduce(base, { type: 'occ/override', payload: { key: rent.key, amount: 1200 } });
    expect(monthSummary(s, ...OCT, T).occurrences.find((o) => o.key === rent.key).amount).toBe(-1200);
  });

  it('recalculates hourly pay for the hours actually worked, including tax and NI', () => {
    const inc = newIncome({ payType: 'hourly', hourlyRate: 15, hoursPerWeek: 40, schedule: { frequency: 'weekly', weekday: 5 } });
    expect(netForHours(inc, 'ruk', 40)).toBeCloseTo(takeHome(inc, 'ruk').netPerPay, 2);
    const short = netForHours(inc, 'ruk', 20);
    expect(short).toBeLessThan(takeHome(inc, 'ruk').netPerPay * 0.6);
    expect(short).toBeGreaterThan(takeHome(inc, 'ruk').netPerPay / 2); // less tax/NI on lower pay
  });
});
