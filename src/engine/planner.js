// Pay planner: bridges pay that arrives weekly / fortnightly / irregularly with bills that are
// mostly monthly. Core idea: a "bills pot". Each payday puts in a share of the year's bills in
// proportion to its size; bills are paid out of the pot when due. We simulate the pot forward to
// find the smallest starting buffer that keeps it from ever going negative.
import { addDays, addMonths, daysBetween, parseISO, toISO, monthLabel } from './dates.js';
import { buildOccurrences, scheduleItems } from './summary.js';
import { monthlyEquivalent, occurrencesBetween } from './recurring.js';
import { profileSummary, paysPerYear } from './income.js';
import { round2, sum } from './money.js';
import { financialView } from './view.js';

function paydayEvents(state, from, to) {
  return buildOccurrences(state, from, to).filter((o) => o.amount > 0 && (o.type === 'payday' || o.type === 'income'));
}

/** The pay period containing `today`, based on the main (largest) income source. */
export function payWindow(state, today) {
  state = financialView(state);
  const all = paydayEvents(state, addDays(today, -62), addDays(today, 62));
  if (!all.length) return null;
  const totals = new Map();
  for (const p of all) totals.set(p.sourceId, (totals.get(p.sourceId) || 0) + p.amount);
  const main = [...totals.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const back = all.filter((p) => p.sourceId === main && p.date <= today);
  const fwd = all.filter((p) => p.sourceId === main && p.date > today);
  if (!back.length || !fwd.length) return null;
  return { from: back[back.length - 1].date, to: addDays(fwd[0].date, -1) };
}

/** Monthly cost of everything that must be paid regularly (bills, subscriptions, debt minimums). */
export function monthlyCommitments(state) {
  state = financialView(state);
  const bills = sum((state.recurring || []).filter((r) => r.active !== false && r.direction === 'out' && !['savings', 'investment'].includes(r.kind)), (r) => monthlyEquivalent(r.amount, r.frequency));
  const debts = sum((state.debts || []).filter((d) => d.balance > 0), (d) => d.minPayment || 0);
  return round2(bills + debts);
}

export function goalsPerMonth(state) {
  return round2(sum((state.goals || []).filter((g) => g.active !== false && (g.saved || 0) < g.target), (g) => +g.perMonth || 0));
}

export function payPlan(state, today, count = 8) {
  state = financialView(state);
  const horizon = addDays(today, 200);
  const pays = paydayEvents(state, addDays(today, 1), horizon);
  // Merge same-day paydays (e.g. two jobs paying on the same Friday).
  const byDate = [];
  for (const p of pays) {
    const last = byDate[byDate.length - 1];
    if (last && last.date === p.date) { last.amount += p.amount; last.names.push(p.name); } else byDate.push({ date: p.date, amount: p.amount, names: [p.name] });
  }
  const annualIncome = sum(profileSummary(state).sources, (s) => s.plannedPerPay * s.periods) || sum(scheduleItems(state).filter((r) => r.kind === 'salary' && r.active !== false), (r) => monthlyEquivalent(r.amount, r.frequency) * 12);
  const commitmentsMonthly = monthlyCommitments(state);
  const goalsMonthly = goalsPerMonth(state);
  const billsShare = annualIncome > 0 ? (commitmentsMonthly * 12) / annualIncome : 0;
  const goalsShare = annualIncome > 0 ? (goalsMonthly * 12) / annualIncome : 0;

  const bills = buildOccurrences(state, today, horizon).filter((o) => o.amount < 0 && !['savings'].includes(o.type));
  // Steady allowance: spend the same every day no matter when pay lands (income smoothing).
  const spendableMonthly = Math.max(0, annualIncome / 12 - commitmentsMonthly - goalsMonthly);
  const allowancePerDay = round2(spendableMonthly / (365 / 12));
  const periods = [];
  // Period 0: from today until the first payday, funded by whatever you have now.
  const starts = [{ date: today, amount: 0, names: [], current: true }, ...byDate];
  for (let i = 0; i < starts.length - 1 && periods.length < count + 1; i++) {
    const from = starts[i].date;
    const to = addDays(starts[i + 1].date, -1);
    if (to < from) continue;
    const due = bills.filter((b) => b.date >= from && b.date <= to);
    const income = starts[i].amount;
    const toPot = round2(income * billsShare);
    const toGoals = round2(income * goalsShare);
    const days = daysBetween(from, to) + 1;
    const billsTotal = round2(sum(due, (b) => -b.amount));
    periods.push({
      from, to, days, current: !!starts[i].current, payday: starts[i].current ? null : from,
      names: starts[i].names, income: round2(income), bills: due, billsTotal,
      toPot, toGoals, toSpending: round2(income - toPot - toGoals), allowance: round2(allowancePerDay * days),
      shortWithoutPot: round2(Math.max(0, billsTotal - income)),
    });
  }
  // Simulate both pots to find the starting buffer that keeps each from going negative.
  let bills$ = 0, minBills = 0, spend$ = 0, minSpend = 0;
  for (const p of periods) {
    bills$ += p.toPot - p.billsTotal;
    spend$ += p.toSpending - p.allowance;
    p.potAfter = bills$;
    p.spendPotAfter = spend$;
    minBills = Math.min(minBills, bills$);
    minSpend = Math.min(minSpend, spend$);
  }
  const billsBuffer = round2(-minBills);
  const spendBuffer = round2(-minSpend);
  for (const p of periods) {
    p.potAfter = round2(p.potAfter + billsBuffer);
    p.spendPotAfter = round2(p.spendPotAfter + spendBuffer);
  }
  const potBalance = +state.settings?.billPot?.balance || 0;
  return {
    periods,
    billsShare,
    goalsShare,
    commitmentsMonthly,
    goalsMonthly,
    spendableMonthly: round2(spendableMonthly),
    allowancePerDay,
    annualIncome: round2(annualIncome),
    billsBuffer,
    spendBuffer,
    startingBuffer: round2(billsBuffer + spendBuffer),
    bufferGap: round2(Math.max(0, billsBuffer + spendBuffer - potBalance)),
    potBalance,
  };
}

/** Months with an extra payday (e.g. 5 Fridays, or 3 fortnightly paydays). */
export function bonusPaydayMonths(state, today, months = 12) {
  state = financialView(state);
  const out = [];
  const incomes = scheduleItems(state).filter((r) => r.kind === 'salary' && r.active !== false && ['weekly', 'fortnightly', 'four-weekly'].includes(r.frequency));
  for (const inc of incomes) {
    const usual = { weekly: 4, fortnightly: 2, 'four-weekly': 1 }[inc.frequency];
    for (let i = 0; i < months; i++) {
      const first = addMonths(`${today.slice(0, 8)}01`, i);
      const d = parseISO(first);
      const last = toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      const dates = occurrencesBetween(inc, first, last);
      if (dates.length > usual) out.push({ key: first.slice(0, 7), label: monthLabel(d.getFullYear(), d.getMonth()), name: inc.name, extra: dates.length - usual, amount: round2((dates.length - usual) * inc.amount), dates });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** How variable has actual pay been? Uses salary-category transactions from the last 6 months. */
export function incomeVariability(state, today) {
  state = financialView(state);
  const since = addDays(today, -183);
  const months = new Map();
  for (const t of state.transactions) {
    if (t.categoryId !== 'salary' || t.amount <= 0 || t.date < since || t.date > today) continue;
    const k = t.date.slice(0, 7);
    months.set(k, (months.get(k) || 0) + t.amount);
  }
  // Only complete months: skip the current month and the partly-covered first one.
  const vals = [...months.entries()].filter(([k]) => k < today.slice(0, 7) && k > since.slice(0, 7)).map(([, v]) => v);
  if (vals.length < 3) return null;
  const mean = sum(vals) / vals.length;
  const sd = Math.sqrt(sum(vals, (v) => (v - mean) ** 2) / vals.length);
  return { mean: round2(mean), min: round2(Math.min(...vals)), max: round2(Math.max(...vals)), cv: mean ? sd / mean : 0, months: vals.length };
}

export { paysPerYear };
