import {
  addDays, daysBetween, daysInMonth, parseISO, toISO, previousWorkingDay, nextWorkingDay, UK_BANK_HOLIDAYS,
} from './dates.js';
import { merchantKey, categorise } from './categories.js';
import { median, round2 } from './money.js';

export const FREQUENCIES = {
  monthly: 'Monthly',
  'last-working-day': 'Last working day of month',
  weekly: 'Weekly',
  fortnightly: 'Every 2 weeks',
  'four-weekly': 'Every 4 weeks',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  once: 'One-off',
};

export const KINDS = {
  salary: 'Salary / payday',
  income: 'Other income',
  bill: 'Bill',
  subscription: 'Subscription',
  savings: 'Savings transfer',
  other: 'Other',
};

function holidaySet(extra) {
  if (!extra?.length) return UK_BANK_HOLIDAYS;
  return new Set([...UK_BANK_HOLIDAYS, ...extra]);
}

function adjust(iso, mode, holidays) {
  if (mode === 'previous-working') return previousWorkingDay(iso, holidays);
  if (mode === 'next-working') return nextWorkingDay(iso, holidays);
  return iso;
}

/**
 * All dates on which a recurring item occurs within [from, to] (inclusive ISO strings).
 * item: { frequency, dayOfMonth, startDate, endDate, adjust }
 */
export function occurrencesBetween(item, from, to, extraHolidays) {
  const holidays = holidaySet(extraHolidays);
  const start = item.startDate || '2000-01-01';
  const end = item.endDate && item.endDate < to ? item.endDate : to;
  const lo = from > start ? from : start;
  if (lo > end) return [];
  const out = [];
  const push = (iso) => {
    const d = adjust(iso, item.adjust, holidays);
    if (d >= lo && d <= end && d >= start) out.push(d);
  };

  switch (item.frequency) {
    case 'once':
      push(start);
      break;
    case 'monthly':
    case 'quarterly':
    case 'last-working-day': {
      const step = item.frequency === 'quarterly' ? 3 : 1;
      const s = parseISO(start);
      // Start a month early so an adjusted date that moves back across a month boundary is caught.
      let y = parseISO(lo).getFullYear();
      let m = parseISO(lo).getMonth() - 1;
      const endD = parseISO(end);
      while (new Date(y, m, 1) <= new Date(endD.getFullYear(), endD.getMonth() + 1, 1)) {
        const monthsFromStart = (y - s.getFullYear()) * 12 + (m - s.getMonth());
        if (monthsFromStart >= 0 && monthsFromStart % step === 0) {
          const dim = daysInMonth(y, m);
          if (item.frequency === 'last-working-day') {
            out.push(previousWorkingDay(toISO(new Date(y, m, dim)), holidays));
          } else {
            const day = Math.min(item.dayOfMonth || s.getDate(), dim);
            push(toISO(new Date(y, m, day)));
          }
        }
        m++;
        if (m > 11) { m = 0; y++; }
      }
      break;
    }
    case 'weekly':
    case 'fortnightly':
    case 'four-weekly': {
      const step = { weekly: 7, fortnightly: 14, 'four-weekly': 28 }[item.frequency];
      let d = start;
      const gap = daysBetween(start, lo);
      if (gap > 0) d = addDays(start, Math.floor(gap / step) * step);
      while (d <= end) {
        push(d);
        d = addDays(d, step);
      }
      break;
    }
    case 'yearly': {
      const s = parseISO(start);
      for (let y = parseISO(lo).getFullYear() - 1; y <= parseISO(end).getFullYear(); y++) {
        const day = Math.min(s.getDate(), daysInMonth(y, s.getMonth()));
        push(toISO(new Date(y, s.getMonth(), day)));
      }
      break;
    }
    default:
      break;
  }
  return [...new Set(out)].filter((d) => d >= lo && d <= end).sort();
}

/** Monthly-equivalent amount, used for budgeting and "annual cost" insights. */
export function monthlyEquivalent(amount, frequency) {
  const f = { weekly: 52 / 12, fortnightly: 26 / 12, 'four-weekly': 13 / 12, quarterly: 1 / 3, yearly: 1 / 12, once: 0 }[frequency];
  return f === undefined ? amount : amount * f;
}

/** Next occurrence on or after `from`. */
export function nextOccurrence(item, from, extraHolidays) {
  return occurrencesBetween(item, from, addDays(from, 400), extraHolidays)[0] || null;
}

/**
 * Match expected occurrences to real transactions so the app knows what has
 * actually been paid / received. Each transaction is used at most once.
 */
export function matchOccurrences(occurrences, transactions) {
  const used = new Set();
  for (const occ of occurrences) {
    const words = (occ.match || occ.name || '').toLowerCase().split(/[,|]/).map((w) => w.trim()).filter(Boolean);
    let best = null;
    let bestGap = Infinity;
    for (const t of transactions) {
      if (used.has(t.id)) continue;
      if (Math.sign(t.amount) !== Math.sign(occ.amount)) continue;
      const gap = Math.abs(daysBetween(occ.date, t.date));
      if (gap > 5) continue;
      const tolerance = Math.max(1, Math.abs(occ.amount) * 0.15);
      const amountOk = Math.abs(Math.abs(t.amount) - Math.abs(occ.amount)) <= tolerance;
      const desc = (t.description || '').toLowerCase();
      const textOk = t.recurringId === occ.sourceId || words.some((w) => desc.includes(w));
      if (!textOk || (!amountOk && t.recurringId !== occ.sourceId)) continue;
      if (gap < bestGap) { best = t; bestGap = gap; }
    }
    if (best) {
      used.add(best.id);
      occ.matchedTxnId = best.id;
      occ.actualAmount = best.amount;
    }
  }
  return occurrences;
}

const INTERVALS = [
  { frequency: 'weekly', min: 6, max: 8 },
  { frequency: 'fortnightly', min: 13, max: 15 },
  { frequency: 'four-weekly', min: 27.5, max: 28.5, strict: true },
  { frequency: 'monthly', min: 26, max: 35 },
  { frequency: 'quarterly', min: 85, max: 97 },
  { frequency: 'yearly', min: 355, max: 375 },
];

const OPTIONAL_CATEGORIES = new Set(['subscriptions', 'health', 'entertainment', 'coffee', 'eating_out', 'shopping', 'personal']);

/**
 * Scan history for payments that repeat on a regular schedule with a steady amount
 * (subscriptions, direct debits, salary). Returns suggestions not already tracked.
 */
export function detectRecurring(transactions, existing = [], userRules = []) {
  const groups = new Map();
  for (const t of transactions) {
    if (t.categoryId === 'transfer') continue;
    const key = `${merchantKey(t.description)}|${t.amount < 0 ? 'out' : 'in'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const tracked = existing.map((r) => (r.match || r.name || '').toLowerCase()).filter(Boolean);
  const suggestions = [];
  for (const [key, txns] of groups) {
    if (txns.length < 3) continue;
    txns.sort((a, b) => a.date.localeCompare(b.date));
    const gaps = [];
    for (let i = 1; i < txns.length; i++) gaps.push(daysBetween(txns[i - 1].date, txns[i].date));
    const med = median(gaps);
    const interval = INTERVALS.find((iv) => med >= iv.min && med <= iv.max);
    if (!interval) continue;
    const regular = gaps.filter((g) => Math.abs(g - med) <= (interval.frequency === 'weekly' ? 1.5 : 4)).length / gaps.length;
    if (regular < 0.7) continue;
    const amounts = txns.map((t) => Math.abs(t.amount));
    const medAmt = median(amounts);
    const spread = Math.max(...amounts.map((a) => Math.abs(a - medAmt))) / medAmt;
    if (spread > 0.25) continue;
    const merchant = key.split('|')[0];
    if (tracked.some((w) => merchant.includes(w) || w.includes(merchant))) continue;

    const last = txns[txns.length - 1];
    const direction = last.amount < 0 ? 'out' : 'in';
    const categoryId = last.categoryId || categorise(last.description, last.amount, userRules);
    const days = txns.map((t) => parseISO(t.date).getDate());
    const dayOfMonth = Math.round(median(days));
    // A price change only means something for fixed-price payments (not metered bills like energy).
    const earlier = amounts.slice(0, -1);
    const fixedBefore = Math.max(...earlier) - Math.min(...earlier) <= 0.01 * medAmt;
    const lastAmt = amounts[amounts.length - 1];
    const amountChanged = fixedBefore && Math.abs(lastAmt - earlier[earlier.length - 1]) >= 0.02 * medAmt
      ? { from: earlier[earlier.length - 1], to: lastAmt } : null;
    suggestions.push({
      name: prettyName(last.description),
      match: merchant,
      amount: round2(amounts[amounts.length - 1]),
      direction,
      frequency: interval.frequency,
      dayOfMonth,
      startDate: txns[0].date,
      lastDate: last.date,
      count: txns.length,
      categoryId,
      kind: direction === 'in' ? (categoryId === 'salary' ? 'salary' : 'income') : categoryId === 'subscriptions' ? 'subscription' : 'bill',
      compulsory: direction === 'out' && !OPTIONAL_CATEGORIES.has(categoryId),
      confidence: round2(Math.min(1, regular * (1 - spread) * Math.min(1, txns.length / 5))),
      amountChanged,
    });
  }
  return suggestions.sort((a, b) => b.confidence - a.confidence || b.amount - a.amount);
}

export function prettyName(desc) {
  const key = merchantKey(desc);
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}
