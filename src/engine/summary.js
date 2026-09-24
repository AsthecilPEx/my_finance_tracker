import { addDays, daysBetween, daysInMonth, lastMonths, monthEnd, monthStart, parseISO, toISO } from './dates.js';
import { occurrencesBetween, matchOccurrences, nextOccurrence } from './recurring.js';
import { categoryMap, SPENDING_TYPES } from './categories.js';
import { round2, sum } from './money.js';
import { monthlyInterest } from './debt.js';

const KIND_TO_TYPE = { salary: 'payday', income: 'income', bill: 'bill', subscription: 'subscription', savings: 'savings', other: 'bill' };

/** Expected money events (paydays, bills, subscriptions, debt payments) between two dates. */
export function buildOccurrences(state, from, to) {
  const holidays = state.settings?.extraHolidays;
  const out = [];
  for (const r of state.recurring || []) {
    if (r.active === false) continue;
    for (const date of occurrencesBetween(r, from, to, holidays)) {
      out.push({
        key: `${r.id}:${date}`,
        sourceId: r.id,
        source: 'recurring',
        type: r.direction === 'in' ? (r.kind === 'salary' ? 'payday' : 'income') : KIND_TO_TYPE[r.kind] || 'bill',
        date,
        name: r.name,
        amount: r.direction === 'in' ? Math.abs(r.amount) : -Math.abs(r.amount),
        categoryId: r.categoryId,
        compulsory: r.direction === 'out' && !!r.compulsory,
        match: r.match,
      });
    }
  }
  for (const d of state.debts || []) {
    if (!(d.balance > 0) || !(d.minPayment > 0) || !d.dueDay) continue;
    const item = { frequency: 'monthly', dayOfMonth: d.dueDay, startDate: d.startDate || '2000-01-01', adjust: 'none' };
    for (const date of occurrencesBetween(item, from, to, holidays)) {
      out.push({
        key: `${d.id}:${date}`,
        sourceId: d.id,
        source: 'debt',
        type: 'debt',
        date,
        name: d.name,
        amount: -Math.abs(d.minPayment),
        categoryId: 'debt',
        compulsory: true,
        match: d.match || d.lender || d.name,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
}

/** Net spend per category per month: { 'YYYY-MM': { catId: amount } } (positive = money out). */
export function categoryTotalsByMonth(transactions) {
  const out = {};
  for (const t of transactions) {
    const k = t.date.slice(0, 7);
    out[k] ||= {};
    out[k][t.categoryId] = (out[k][t.categoryId] || 0) - t.amount;
  }
  return out;
}

export function isSpendingCategory(cat) {
  return !!cat && SPENDING_TYPES.has(cat.type);
}

export function monthSummary(state, year, month, today) {
  const cats = categoryMap(state.categories);
  const from = monthStart(year, month);
  const to = monthEnd(year, month);
  const dim = daysInMonth(year, month);
  const txns = state.transactions.filter((t) => t.date >= from && t.date <= to);
  const nearby = state.transactions.filter((t) => t.date >= addDays(from, -6) && t.date <= addDays(to, 6));
  const occurrences = matchOccurrences(buildOccurrences(state, from, to), nearby);
  for (const o of occurrences) {
    o.status = o.matchedTxnId ? 'done' : o.date < today ? 'assumed' : 'upcoming';
  }

  const typeOf = (t) => cats[t.categoryId]?.type || (t.amount > 0 ? 'income' : 'lifestyle');
  const incomeActual = sum(txns.filter((t) => typeOf(t) === 'income' && t.amount > 0), (t) => t.amount);
  const unmatched = occurrences.filter((o) => !o.matchedTxnId);
  const incomeExpected = sum(unmatched.filter((o) => o.amount > 0), (o) => o.amount);
  const committedPending = sum(unmatched.filter((o) => o.amount < 0), (o) => -o.amount);
  const committedUpcoming = sum(unmatched.filter((o) => o.amount < 0 && o.status === 'upcoming'), (o) => -o.amount);

  const totals = categoryTotalsByMonth(txns)[from.slice(0, 7)] || {};
  const spent = sum(Object.entries(totals).filter(([id]) => isSpendingCategory(cats[id])), ([, v]) => v);
  const saved = sum(Object.entries(totals).filter(([id]) => cats[id]?.type === 'savings'), ([, v]) => v);
  const income = incomeActual + incomeExpected;
  const leftToSpend = income - spent - saved - committedPending;

  // 3-month history for each category (the "usual" line on meters).
  const history = categoryTotalsByMonth(state.transactions);
  const prev = lastMonths(year, month, 4).slice(0, 3).map((m) => history[m.key] || {});
  const monthsWithData = prev.filter((m) => Object.keys(m).length).length || 1;

  const byCategory = state.categories
    .filter((c) => SPENDING_TYPES.has(c.type) || c.type === 'savings')
    .map((c) => {
      const catSpent = Math.max(0, totals[c.id] || 0);
      const pending = sum(unmatched.filter((o) => o.amount < 0 && o.categoryId === c.id), (o) => -o.amount);
      const avg3 = sum(prev, (m) => Math.max(0, m[c.id] || 0)) / monthsWithData;
      const target = c.budget > 0 ? c.budget : avg3;
      return {
        ...c,
        spent: round2(catSpent),
        pending: round2(pending),
        avg3: round2(avg3),
        target: round2(target),
        pct: target > 0 ? catSpent / target : catSpent > 0 ? 1 : 0,
        over: c.budget > 0 && catSpent > c.budget,
      };
    })
    .filter((c) => c.spent > 0 || c.budget > 0 || c.pending > 0)
    .sort((a, b) => b.spent + b.pending - (a.spent + a.pending));

  const days = {};
  // flex = day-to-day spending, excluding bills/debt payments already shown as calendar events.
  const billTxns = new Set(occurrences.map((o) => o.matchedTxnId).filter(Boolean));
  for (let d = 1; d <= dim; d++) days[toISO(new Date(year, month, d))] = { spend: 0, flex: 0, income: 0, events: [], txns: [] };
  for (const t of txns) {
    const day = days[t.date];
    if (!day) continue;
    day.txns.push(t);
    const type = typeOf(t);
    if (type === 'transfer') continue;
    if (t.amount < 0) {
      day.spend += -t.amount;
      if (!billTxns.has(t.id) && type !== 'savings') day.flex += -t.amount;
    } else if (type === 'income') day.income += t.amount;
  }
  for (const o of occurrences) days[o.date]?.events.push(o);

  const salaryItems = (state.recurring || []).filter((r) => r.active !== false && r.kind === 'salary');
  const paydays = salaryItems.map((r) => ({ r, date: nextOccurrence(r, today, state.settings?.extraHolidays) })).filter((p) => p.date);
  paydays.sort((a, b) => a.date.localeCompare(b.date));
  const nextPayday = paydays[0] ? { date: paydays[0].date, name: paydays[0].r.name, amount: paydays[0].r.amount, inDays: daysBetween(today, paydays[0].date) } : null;

  const isCurrent = today >= from && today <= to;
  let safePerDay = null;
  let safeBasis = null;
  const balances = (state.accounts || []).filter((a) => typeof a.balance === 'number');
  if (isCurrent) {
    if (balances.length && nextPayday) {
      // Live bank balance: what's in the account minus bills due before the next payday.
      const bal = sum(balances, (a) => a.balance);
      const billsBefore = sum(unmatched.filter((o) => o.amount < 0 && o.date >= today && o.date < nextPayday.date), (o) => -o.amount);
      const days = Math.max(1, nextPayday.inDays);
      safePerDay = round2(Math.max(0, bal - billsBefore) / days);
      safeBasis = 'balance';
    } else {
      safePerDay = round2(Math.max(0, leftToSpend) / Math.max(1, daysBetween(today, to) + 1));
      safeBasis = 'month';
    }
  }

  return {
    year, month, from, to, isCurrent,
    income: round2(income),
    incomeActual: round2(incomeActual),
    incomeExpected: round2(incomeExpected),
    spent: round2(spent),
    saved: round2(saved),
    committedPending: round2(committedPending),
    committedUpcoming: round2(committedUpcoming),
    leftToSpend: round2(leftToSpend),
    byCategory,
    occurrences,
    days,
    nextPayday,
    safePerDay,
    safeBasis,
    balance: balances.length ? round2(sum(balances, (a) => a.balance)) : null,
    debtTotal: round2(sum(state.debts || [], (d) => d.balance || 0)),
    debtInterest: monthlyInterest(state.debts || []),
  };
}

/** Unpaid money events in the next `days` days (for the "coming up" list and the widget). */
export function upcoming(state, today, days = 14) {
  const to = addDays(today, days);
  const recent = state.transactions.filter((t) => t.date >= addDays(today, -6));
  return matchOccurrences(buildOccurrences(state, today, to), recent)
    .filter((o) => !o.matchedTxnId)
    .map((o) => ({ ...o, inDays: daysBetween(today, o.date) }));
}

export function dayOfMonth(iso) {
  return parseISO(iso).getDate();
}
