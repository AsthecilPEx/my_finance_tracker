// Spend caps: limits on a category, an importance tier (from receipts) or total spending,
// per month, week or pay period, with an early-warning threshold.
import { addDays, daysBetween, monthEnd, monthStart, parseISO, toISO } from './dates.js';
import { categoryMap, SPENDING_TYPES } from './categories.js';
import { receiptLines, TIERS, SECTIONS } from './receipts.js';
import { payWindow } from './planner.js';
import { round2, sum } from './money.js';

export const CAP_PERIODS = { month: 'per month', week: 'per week', payperiod: 'per pay period' };

export function capWindow(period, today, state) {
  const t = parseISO(today);
  if (period === 'week') {
    const from = addDays(today, -((t.getDay() + 6) % 7));
    return { from, to: addDays(from, 6), label: 'this week' };
  }
  if (period === 'payperiod') {
    const w = payWindow(state, today);
    if (w) return { ...w, label: 'this pay period' };
  }
  return { from: monthStart(t.getFullYear(), t.getMonth()), to: monthEnd(t.getFullYear(), t.getMonth()), label: 'this month' };
}

export function describeCap(cap, cats) {
  if (cap.scope === 'category') return `${cats[cap.categoryId]?.name || cap.categoryId}`;
  if (cap.scope === 'tier') return `${TIERS[cap.tier]?.short || cap.tier} items${cap.section ? ` · ${SECTIONS[cap.section]?.label}` : ''}`;
  if (cap.scope === 'section') return `${SECTIONS[cap.section]?.label || cap.section} (itemised)`;
  return 'All spending';
}

export function evaluateCaps(state, today) {
  const cats = categoryMap(state.categories);
  const lines = (state.caps || []).some((c) => c.scope === 'tier' || c.scope === 'section') ? receiptLines(state) : [];
  return (state.caps || []).filter((c) => c.active !== false && c.amount > 0).map((cap) => {
    const w = capWindow(cap.period, today, state);
    let spent = 0;
    if (cap.scope === 'category' || cap.scope === 'total') {
      spent = -sum(state.transactions.filter((t) => t.date >= w.from && t.date <= w.to && (cap.scope === 'total' ? SPENDING_TYPES.has(cats[t.categoryId]?.type) : t.categoryId === cap.categoryId)), (t) => t.amount);
    } else {
      spent = sum(lines.filter((l) => l.date >= w.from && l.date <= w.to && (cap.scope === 'section' || l.tier === cap.tier) && (!cap.section || l.section === cap.section)), (l) => l.price);
    }
    spent = Math.max(0, spent);
    const pct = spent / cap.amount;
    const days = daysBetween(w.from, w.to) + 1;
    const elapsed = Math.min(days, Math.max(1, daysBetween(w.from, today) + 1));
    const alertAt = cap.alertAt ?? 0.8;
    return {
      cap,
      label: cap.name || describeCap(cap, cats),
      scopeLabel: describeCap(cap, cats),
      window: w,
      spent: round2(spent),
      remaining: round2(cap.amount - spent),
      pct,
      pace: pct / (elapsed / days),
      status: pct >= 1 ? 'over' : pct >= alertAt ? 'near' : 'ok',
      daysLeft: days - elapsed,
    };
  });
}

export { toISO };
