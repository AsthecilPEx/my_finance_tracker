import { addDays, daysBetween, daysInMonth, lastMonths, monthLabel, parseISO } from './dates.js';
import { categoryMap, merchantKey, SPENDING_TYPES } from './categories.js';
import { categoryTotalsByMonth } from './summary.js';
import { detectRecurring, monthlyEquivalent, prettyName } from './recurring.js';
import { simulatePayoff } from './debt.js';
import { formatMoney, median, round2, sum } from './money.js';

const STREAMING = ['netflix', 'disney', 'prime video', 'amazon prime', 'now tv', 'nowtv', 'paramount', 'apple tv', 'dazn', 'britbox', 'discovery+'];

/**
 * Classify each outflow as compulsory (must pay), recurring-optional (subscriptions
 * you could cancel) or discretionary (day-to-day choices).
 */
export function classifyOutflow(t, cat, recurringWords) {
  const desc = (t.description || '').toLowerCase();
  const rec = recurringWords.find(({ w }) => w && desc.includes(w));
  if (cat?.type === 'debt' || cat?.type === 'essential') return 'compulsory';
  if (rec?.compulsory) return 'compulsory';
  if (rec || cat?.id === 'subscriptions') return 'recurring';
  return 'discretionary';
}

export function recurringWordList(state) {
  const list = [];
  for (const r of state.recurring || []) {
    if (r.direction !== 'out') continue;
    for (const w of (r.match || r.name || '').toLowerCase().split(/[,|]/)) list.push({ w: w.trim(), compulsory: !!r.compulsory });
  }
  for (const d of state.debts || []) list.push({ w: (d.match || d.lender || d.name || '').toLowerCase(), compulsory: true });
  return list.filter((x) => x.w);
}

export function generateInsights(state, today, currency = 'GBP') {
  const fmt = (n, o) => formatMoney(n, currency, o);
  const cats = categoryMap(state.categories);
  const t0 = parseISO(today);
  const year = t0.getFullYear();
  const month = t0.getMonth();
  const dom = t0.getDate();
  const dim = daysInMonth(year, month);
  const txns = state.transactions;
  const totals = categoryTotalsByMonth(txns);
  const months = lastMonths(year, month, 6);
  const curKey = months[5].key;
  const prev3 = months.slice(2, 5);
  const prevWithData = prev3.filter((m) => totals[m.key]).length;
  const cards = [];

  // --- Monthly income vs spending (6 months) ---
  const monthly = months.map((m) => {
    const inMonth = txns.filter((t) => t.date.startsWith(m.key));
    const income = sum(inMonth.filter((t) => t.amount > 0 && cats[t.categoryId]?.type === 'income'), (t) => t.amount);
    const spent = sum(inMonth.filter((t) => SPENDING_TYPES.has(cats[t.categoryId]?.type)), (t) => -t.amount);
    const saved = sum(inMonth.filter((t) => cats[t.categoryId]?.type === 'savings'), (t) => -t.amount);
    return { key: m.key, label: monthLabel(m.year, m.month, 'short'), income: round2(income), spent: round2(spent), saved: round2(saved), partial: m.key === curKey };
  });

  // --- Category trends ---
  const trends = state.categories
    .filter((c) => SPENDING_TYPES.has(c.type))
    .map((c) => {
      const series = months.map((m) => round2(Math.max(0, totals[m.key]?.[c.id] || 0)));
      const avg3 = prevWithData ? sum(prev3, (m) => Math.max(0, totals[m.key]?.[c.id] || 0)) / prevWithData : 0;
      const current = series[5];
      // Project month-end spend from the daily pace, but count big one-offs only once.
      const history = txns.filter((t) => t.categoryId === c.id && t.amount < 0 && !t.date.startsWith(curKey)).map((t) => -t.amount);
      const bigLimit = Math.max(100, 3 * median(history));
      const oneOffs = sum(txns.filter((t) => t.categoryId === c.id && t.date.startsWith(curKey) && -t.amount > bigLimit), (t) => -t.amount);
      const projected = dom >= 5 && c.type === 'lifestyle' ? oneOffs + ((current - oneOffs) / dom) * dim : current;
      return { ...c, series, avg3: round2(avg3), current, projected: round2(projected), change: avg3 > 0 ? (projected - avg3) / avg3 : null };
    })
    .filter((c) => c.series.some((v) => v > 0))
    .sort((a, b) => b.avg3 + b.current - (a.avg3 + a.current));

  // 1. Spending pace in discretionary categories
  if (dom >= 5 && prevWithData) {
    for (const c of trends) {
      if (c.type !== 'lifestyle' || c.id === 'other' || c.avg3 < 25 || c.change === null) continue;
      if (c.change > 0.2 && c.projected - c.avg3 > 15) {
        cards.push({
          id: `pace-${c.id}`, kind: 'warning', icon: c.icon,
          title: `${c.name} is running ${Math.round(c.change * 100)}% above usual`,
          detail: `At this pace you'll spend ${fmt(c.projected, { decimals: 0 })} this month vs your usual ${fmt(c.avg3, { decimals: 0 })}. Slowing down for the rest of the month keeps ${fmt(c.projected - c.avg3, { decimals: 0 })} in your pocket.`,
          saving: round2(c.projected - c.avg3),
        });
      } else if (c.change < -0.2 && c.avg3 - c.projected > 15) {
        cards.push({
          id: `down-${c.id}`, kind: 'good', icon: c.icon,
          title: `${c.name} is down ${Math.round(-c.change * 100)}%`,
          detail: `You're on track for ${fmt(c.projected, { decimals: 0 })} vs your usual ${fmt(c.avg3, { decimals: 0 })}. Nice work.`,
        });
      }
    }
  }

  // 2. Budgets
  for (const c of state.categories) {
    if (!(c.budget > 0)) continue;
    const spent = Math.max(0, totals[curKey]?.[c.id] || 0);
    if (spent > c.budget) {
      cards.push({ id: `budget-${c.id}`, kind: 'critical', icon: c.icon, title: `${c.name} is over budget`, detail: `${fmt(spent)} spent of a ${fmt(c.budget)} budget (${fmt(spent - c.budget)} over).`, saving: round2(spent - c.budget) });
    } else if (spent > c.budget * 0.8 && dom < dim * 0.7) {
      cards.push({ id: `budget-near-${c.id}`, kind: 'warning', icon: c.icon, title: `${c.name}: ${Math.round((spent / c.budget) * 100)}% of budget used`, detail: `Only ${fmt(c.budget - spent)} left with ${dim - dom} days to go.` });
    }
  }

  // 3. Small frequent purchases ("latte factor")
  const last30 = txns.filter((t) => t.date > addDays(today, -30) && t.date <= today && t.amount < 0 && t.amount > -15 && cats[t.categoryId]?.type === 'lifestyle');
  const small = new Map();
  for (const t of last30) {
    const k = merchantKey(t.description);
    if (!small.has(k)) small.set(k, []);
    small.get(k).push(t);
  }
  for (const [k, list] of small) {
    if (list.length < 6) continue;
    const total = -sum(list, (t) => t.amount);
    cards.push({
      id: `habit-${k}`, kind: 'saving', icon: cats[list[0].categoryId]?.icon || '☕',
      title: `${list.length} purchases at ${prettyName(list[0].description)} in 30 days`,
      detail: `That's ${fmt(total)} a month, or about ${fmt(total * 12, { decimals: 0 })} a year. Cutting it in half saves ${fmt(total / 2)} a month.`,
      saving: round2(total / 2),
    });
  }

  // 4. Subscriptions
  const subs = (state.recurring || []).filter((r) => r.active !== false && r.direction === 'out' && (r.kind === 'subscription' || r.categoryId === 'subscriptions'));
  const subsMonthly = sum(subs, (r) => monthlyEquivalent(r.amount, r.frequency));
  if (subs.length >= 3) {
    cards.push({
      id: 'subs-total', kind: 'info', icon: '📺',
      title: `${subs.length} subscriptions cost ${fmt(subsMonthly)} a month`,
      detail: `That's ${fmt(subsMonthly * 12, { decimals: 0 })} a year. Cancel any you haven't used in the last month. Most can be restarted at any time.`,
    });
  }
  const streams = subs.filter((r) => STREAMING.some((s) => (r.name + ' ' + (r.match || '')).toLowerCase().includes(s)));
  if (streams.length >= 2) {
    const cheapest = [...streams].sort((a, b) => a.amount - b.amount).slice(0, streams.length - 1);
    const saving = sum(cheapest, (r) => monthlyEquivalent(r.amount, r.frequency));
    cards.push({
      id: 'subs-streaming', kind: 'saving', icon: '🎬',
      title: `You pay for ${streams.length} streaming services`,
      detail: `${streams.map((s) => s.name).join(', ')}. Rotating them (one at a time, switching monthly) saves about ${fmt(saving)} a month.`,
      saving: round2(saving),
    });
  }

  // 5. Price rises on recurring payments
  const detected = detectRecurring(txns.filter((t) => t.date > addDays(today, -400)), []);
  for (const s of detected) {
    if (s.direction !== 'out' || !s.amountChanged || s.amountChanged.to <= s.amountChanged.from) continue;
    if (daysBetween(s.lastDate, today) > 45) continue;
    const diff = s.amountChanged.to - s.amountChanged.from;
    cards.push({
      id: `rise-${s.match}`, kind: 'warning', icon: '📈',
      title: `${s.name} went up by ${fmt(diff)}`,
      detail: `Now ${fmt(s.amountChanged.to)} (was ${fmt(s.amountChanged.from)}), up ${Math.round((diff / s.amountChanged.from) * 100)}%. Worth calling to haggle or switching provider.`,
      saving: round2(diff),
    });
  }

  // 6. Debt interest
  const debts = (state.debts || []).filter((d) => d.balance > 0);
  const worst = [...debts].sort((a, b) => (b.apr || 0) - (a.apr || 0))[0];
  if (worst && worst.apr >= 10) {
    const base = simulatePayoff(debts, { extra: 0 });
    const plus = simulatePayoff(debts, { extra: 100 });
    const interestNow = (worst.balance * worst.apr) / 100 / 12;
    const monthsSooner = base.stuck ? null : base.months - plus.months;
    cards.push({
      id: 'debt-apr', kind: 'saving', icon: '💳',
      title: `${worst.name} costs about ${fmt(interestNow)} a month in interest`,
      detail: base.stuck
        ? `At ${worst.apr}% APR your minimum payments barely cover the interest. Overpaying this one first (the avalanche method) matters most.`
        : `At ${worst.apr}% APR it's your most expensive debt. Overpaying it by ${fmt(100, { decimals: 0 })} a month makes you debt-free ${monthsSooner} months sooner and saves ${fmt(base.totalInterest - plus.totalInterest, { decimals: 0 })} in interest.`,
      saving: round2(interestNow),
    });
  }

  // 7. Savings rate & 50/30/20 split (last 3 complete months)
  const full = monthly.slice(2, 5).filter((m) => m.income > 0);
  if (full.length) {
    const inc = sum(full, (m) => m.income);
    const out = sum(full, (m) => m.spent);
    const rate = (inc - out) / inc;
    if (rate < 0.1) {
      cards.push({ id: 'save-rate', kind: rate < 0 ? 'critical' : 'warning', icon: '🐷', title: rate < 0 ? 'You spent more than you earned' : `You kept ${Math.round(rate * 100)}% of your income`, detail: `Across the last ${full.length} months you earned ${fmt(inc / full.length, { decimals: 0 })} and spent ${fmt(out / full.length, { decimals: 0 })} a month on average. Aim to save at least 10–20%.` });
    } else if (rate >= 0.2) {
      cards.push({ id: 'save-rate', kind: 'good', icon: '🐷', title: `You're keeping ${Math.round(rate * 100)}% of your income`, detail: `That's a great savings rate. Consider moving the surplus to an easy-access saver or ISA straight after payday.` });
    }
  }

  // 8. Payday spending spike
  const salaries = txns.filter((t) => t.categoryId === 'salary' && t.amount > 0 && t.date > addDays(today, -120));
  if (salaries.length >= 2) {
    const window = new Set();
    for (const s of salaries) for (let i = 0; i < 3; i++) window.add(addDays(s.date, i));
    const recent = txns.filter((t) => t.date > addDays(today, -120) && t.amount < 0 && cats[t.categoryId]?.type === 'lifestyle');
    const inWin = sum(recent.filter((t) => window.has(t.date)), (t) => -t.amount) / window.size;
    const otherDays = Math.max(1, 120 - window.size);
    const outWin = sum(recent.filter((t) => !window.has(t.date)), (t) => -t.amount) / otherDays;
    if (outWin > 0 && inWin / outWin > 1.6) {
      cards.push({ id: 'payday-spike', kind: 'info', icon: '🎉', title: `You spend ${(inWin / outWin).toFixed(1)}× more in the 3 days after payday`, detail: 'Try scheduling a savings transfer for payday morning so the money is moved before it gets spent.' });
    }
  }

  // 9. Unusually large one-off purchases this month
  for (const t of txns.filter((x) => x.date.startsWith(curKey) && x.amount < -100 && cats[x.categoryId]?.type === 'lifestyle')) {
    const hist = txns.filter((x) => x.categoryId === t.categoryId && x.amount < 0 && !x.date.startsWith(curKey)).map((x) => -x.amount);
    if (hist.length >= 5 && -t.amount > 3 * median(hist)) {
      cards.push({ id: `big-${t.id}`, kind: 'info', icon: '🔎', title: `Large ${cats[t.categoryId]?.name.toLowerCase()} purchase: ${fmt(-t.amount)}`, detail: `${t.description} on ${t.date}. That's more than 3× your typical ${cats[t.categoryId]?.name.toLowerCase()} purchase.` });
    }
  }

  // --- Compulsory vs optional split (last 90 days, monthly average) ---
  const words = recurringWordList(state);
  const split = { compulsory: 0, recurring: 0, discretionary: 0 };
  const from90 = addDays(today, -90);
  for (const t of txns) {
    if (t.date <= from90 || t.date > today || t.amount >= 0) continue;
    const cat = cats[t.categoryId];
    if (!SPENDING_TYPES.has(cat?.type)) continue;
    split[classifyOutflow(t, cat, words)] += -t.amount / 3;
  }
  for (const k of Object.keys(split)) split[k] = round2(split[k]);
  const avgIncome = full.length ? sum(full, (m) => m.income) / full.length : 0;
  if (avgIncome > 0 && split.discretionary / avgIncome > 0.3) {
    const over = split.discretionary - avgIncome * 0.3;
    cards.push({ id: 'rule-503020', kind: 'saving', icon: '⚖️', title: 'Discretionary spending is above the 30% guideline', detail: `The 50/30/20 rule suggests keeping "wants" to 30% of take-home pay (${fmt(avgIncome * 0.3, { decimals: 0 })}). You're averaging ${fmt(split.discretionary, { decimals: 0 })}.`, saving: round2(over) });
  }

  // --- Top merchants (last 90 days) ---
  const merchants = new Map();
  for (const t of txns) {
    if (t.date <= from90 || t.date > today || t.amount >= 0 || !SPENDING_TYPES.has(cats[t.categoryId]?.type)) continue;
    const k = merchantKey(t.description);
    const m = merchants.get(k) || { name: prettyName(t.description), total: 0, count: 0, categoryId: t.categoryId };
    m.total += -t.amount;
    m.count++;
    merchants.set(k, m);
  }
  const topMerchants = [...merchants.values()].sort((a, b) => b.total - a.total).slice(0, 8).map((m) => ({ ...m, total: round2(m.total) }));

  const order = { critical: 0, warning: 1, saving: 2, info: 3, good: 4 };
  cards.sort((a, b) => order[a.kind] - order[b.kind] || (b.saving || 0) - (a.saving || 0));
  const potential = round2(sum(cards.filter((c) => c.kind === 'saving' || c.kind === 'warning'), (c) => c.saving || 0));

  return { cards, monthly, trends, split, topMerchants, subscriptions: { list: subs, monthly: round2(subsMonthly) }, potential, detected };
}
