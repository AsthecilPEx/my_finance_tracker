// "Bring your own AI": export a prompt that describes the user's finances plus a strict
// JSON contract (Pulse Plan v1). Any assistant can fill it in; the app validates the reply,
// shows a change-by-change preview, and applies only what the user ticks (with undo).
import { categoryMap } from './categories.js';
import { profileSummary, describeSchedule } from './income.js';
import { monthlyEquivalent } from './recurring.js';
import { monthSummary } from './summary.js';
import { basketAnalytics, TIERS, SECTIONS } from './receipts.js';
import { CAP_PERIODS } from './caps.js';
import { lastMonths, parseISO } from './dates.js';
import { categoryTotalsByMonth } from './summary.js';
import { round2 } from './money.js';

export const PLAN_VERSION = 1;
const MAX_AMOUNT = 1_000_000;

export function planSchemaExample(state) {
  return {
    pulsePlanVersion: 1,
    title: 'Short name for the plan',
    strategy: 'e.g. zero-based budget, 50/30/20, debt avalanche, irregular-income buffer',
    summary: 'Two or three sentences the user will read in the app.',
    budgets: [{ category: 'groceries', monthly: 320 }],
    caps: [{ name: 'Treats cap', scope: 'tier', tier: 'low', section: 'groceries', amount: 30, period: 'month', alertAt: 0.8 }],
    capsMode: 'merge',
    goals: [{ name: 'Emergency fund', icon: '🛟', target: 1500, saved: 0, targetDate: '2027-06-30', perMonth: 125 }],
    debtPlan: { strategy: 'avalanche', extraPerMonth: 100 },
    pauseRecurring: ['Disney+'],
    billPot: { enabled: true },
    tips: ['One concrete action per line.'],
  };
}

function snapshot(state, today) {
  const cats = categoryMap(state.categories);
  const t = parseISO(today);
  const prof = profileSummary(state);
  const totals = categoryTotalsByMonth(state.transactions);
  const months = lastMonths(t.getFullYear(), t.getMonth(), 4).slice(0, 3);
  const avg = (id) => round2(months.reduce((s, m) => s + Math.max(0, totals[m.key]?.[id] || 0), 0) / 3);
  const cur = monthSummary(state, t.getFullYear(), t.getMonth(), today);
  const basket = basketAnalytics(state, today);
  return {
    currency: state.settings.currency,
    region: state.profile?.region === 'scotland' ? 'Scotland' : 'England/Wales/NI',
    income: {
      monthlyTakeHome: prof.monthly,
      variablePay: prof.variable,
      sources: prof.sources.map((s) => ({ name: s.inc.name, pattern: describeSchedule(s.inc.schedule), takeHomePerPay: s.plannedPerPay, paysPerYear: s.periods, grossAnnual: s.th.gross, taxBand: s.th.band })),
    },
    recurringBills: (state.recurring || []).filter((r) => r.active !== false && r.direction === 'out').map((r) => ({ name: r.name, amount: r.amount, frequency: r.frequency, monthlyCost: round2(monthlyEquivalent(r.amount, r.frequency)), compulsory: !!r.compulsory, category: r.categoryId })),
    debts: (state.debts || []).filter((d) => d.balance > 0).map((d) => ({ name: d.name, balance: d.balance, apr: d.apr, minPayment: d.minPayment })),
    categories: state.categories.filter((c) => c.type !== 'income' && c.type !== 'transfer').map((c) => ({ id: c.id, name: c.name, type: c.type, budget: c.budget || 0, avgMonthlySpend3m: avg(c.id) })).filter((c) => c.budget || c.avgMonthlySpend3m),
    thisMonth: { income: cur.income, spent: cur.spent, billsStillToPay: cur.committedPending, leftToSpend: cur.leftToSpend },
    itemisedShopping: basket.receiptsCount ? { avgMonthlyByImportance: basket.avgByTier, topNotSoImportantItems: basket.lowItems.slice(0, 5).map((i) => ({ name: i.name, perMonth: i.perMonth })) } : 'not enough receipts yet',
    currentCaps: (state.caps || []).map((c) => ({ name: c.name, scope: c.scope, category: c.categoryId, tier: c.tier, section: c.section, amount: c.amount, period: c.period })),
    currentGoals: (state.goals || []).map((g) => ({ name: g.name, target: g.target, saved: g.saved, targetDate: g.targetDate, perMonth: g.perMonth })),
    validCategoryIds: Object.keys(cats).filter((id) => !['salary', 'income_other', 'transfer'].includes(id)),
  };
}

export function buildPrompt(state, today, situation = '') {
  const example = JSON.stringify(planSchemaExample(state), null, 2);
  const data = JSON.stringify(snapshot(state, today), null, 2);
  return `You are a careful personal finance coach. I use a budgeting app called Pulse that can import a plan in a strict JSON format. Please analyse my situation and produce a plan the app can load.

## My situation, in my words
${situation.trim() || '(Not described. Base the plan on the data below.)'}

## My data (exported by the app, amounts in ${state.settings.currency})
\`\`\`json
${data}
\`\`\`

## How to respond
1. If something important is unclear, ask me up to 3 short questions first and wait for my answers.
2. Then explain your reasoning in plain language (short).
3. Finish with ONE fenced \`\`\`json code block containing the plan, matching this contract exactly:

\`\`\`json
${example}
\`\`\`

## Rules for the JSON
- "pulsePlanVersion" must be 1. Numbers are plain numbers (no currency symbols). Dates are "YYYY-MM-DD".
- "budgets[].category" must be one of validCategoryIds. "monthly" is the new monthly budget (0 removes it).
- "caps[].scope" is one of: "category" (needs "category"), "tier" (needs "tier": ${Object.keys(TIERS).map((t) => `"${t}"`).join(' | ')}; optional "section": ${Object.keys(SECTIONS).map((s) => `"${s}"`).join(' | ')}), "section" (needs "section"), "total".
- "caps[].period" is one of: ${Object.keys(CAP_PERIODS).map((p) => `"${p}"`).join(' | ')}. "alertAt" is 0.5–1 (warn at that fraction).
- "capsMode": "merge" adds/updates caps by name; "replace" removes caps not in your list.
- "goals": savings goals with target, optional saved-so-far, optional targetDate and a monthly contribution "perMonth".
- "debtPlan.strategy": "avalanche" or "snowball". "pauseRecurring": exact names of recurring payments to pause (e.g. subscriptions to cancel).
- Omit any section you don't want to change. Keep the plan realistic: total budgets + bills + goals must not exceed monthly take-home pay.
- Do not include investment or trading instructions (not supported yet).`;
}

/** Pull the JSON object out of an AI reply (fenced block or raw) and validate it. */
export function parsePlan(text, state) {
  const errors = [];
  const warnings = [];
  const blocks = [...String(text).matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1]);
  const candidates = blocks.length ? blocks.reverse() : [String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1)];
  let raw = null;
  for (const c of candidates) {
    try {
      const obj = JSON.parse(c.trim());
      if (obj && typeof obj === 'object' && 'pulsePlanVersion' in obj) { raw = obj; break; }
    } catch { /* try next block */ }
  }
  if (!raw) return { plan: null, errors: ['No Pulse plan found. Paste the AI reply including the ```json block.'], warnings };
  if (raw.pulsePlanVersion !== PLAN_VERSION) errors.push(`Unsupported plan version ${raw.pulsePlanVersion}.`);

  const cats = categoryMap(state.categories);
  const byName = Object.fromEntries(state.categories.map((c) => [c.name.toLowerCase(), c.id]));
  const catId = (v) => (cats[v] ? v : byName[String(v || '').toLowerCase()] || null);
  const num = (v, label, { min = 0, max = MAX_AMOUNT } = {}) => {
    const n = typeof v === 'string' ? parseFloat(v.replace(/[£€,]/g, '')) : v;
    if (typeof n !== 'number' || !isFinite(n) || n < min || n > max) { warnings.push(`Ignored ${label}: "${v}" is not a valid amount.`); return null; }
    return round2(n);
  };
  const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) ? v : null);
  const str = (v, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const plan = { title: str(raw.title, 80) || 'AI plan', strategy: str(raw.strategy, 120), summary: str(raw.summary, 1200), budgets: [], caps: [], goals: [], pauseRecurring: [], tips: [], capsMode: raw.capsMode === 'replace' ? 'replace' : 'merge' };

  for (const b of Array.isArray(raw.budgets) ? raw.budgets : []) {
    const id = catId(b?.category);
    const amt = num(b?.monthly, `budget for ${b?.category}`);
    if (!id) warnings.push(`Unknown category "${b?.category}" skipped.`);
    else if (amt !== null) plan.budgets.push({ categoryId: id, monthly: amt });
  }
  for (const c of Array.isArray(raw.caps) ? raw.caps : []) {
    const scope = ['category', 'tier', 'section', 'total'].includes(c?.scope) ? c.scope : null;
    const amt = num(c?.amount, `cap "${c?.name}"`);
    if (!scope || amt === null) { if (!scope) warnings.push(`Cap "${c?.name}" has an unknown scope.`); continue; }
    const cap = { name: str(c.name, 60) || '', scope, amount: amt, period: CAP_PERIODS[c.period] ? c.period : 'month', alertAt: Math.min(1, Math.max(0.5, +c.alertAt || 0.8)) };
    if (scope === 'category') { cap.categoryId = catId(c.category); if (!cap.categoryId) { warnings.push(`Cap "${c.name}": unknown category.`); continue; } }
    if (scope === 'tier') { if (!TIERS[c.tier]) { warnings.push(`Cap "${c.name}": unknown tier.`); continue; } cap.tier = c.tier; }
    if (scope === 'tier' || scope === 'section') { if (c.section && SECTIONS[c.section]) cap.section = c.section; else if (scope === 'section') { warnings.push(`Cap "${c.name}": unknown section.`); continue; } }
    plan.caps.push(cap);
  }
  for (const g of Array.isArray(raw.goals) ? raw.goals : []) {
    const target = num(g?.target, `goal "${g?.name}" target`, { min: 1 });
    if (!str(g?.name) || target === null) continue;
    plan.goals.push({ name: str(g.name, 60), icon: str(g.icon, 4) || '🎯', target, saved: num(g.saved ?? 0, 'goal saved') || 0, targetDate: date(g.targetDate), perMonth: num(g.perMonth ?? 0, `goal "${g.name}" monthly amount`) || 0 });
  }
  if (raw.debtPlan) {
    const strategy = raw.debtPlan.strategy === 'snowball' ? 'snowball' : 'avalanche';
    const extra = num(raw.debtPlan.extraPerMonth ?? 0, 'extra debt payment');
    plan.debtPlan = { strategy, extra: extra ?? 0 };
  }
  const recNames = (state.recurring || []).map((r) => r.name.toLowerCase());
  for (const n of Array.isArray(raw.pauseRecurring) ? raw.pauseRecurring : []) {
    if (recNames.includes(String(n).toLowerCase())) plan.pauseRecurring.push(String(n));
    else warnings.push(`No recurring payment called "${n}".`);
  }
  if (raw.billPot && typeof raw.billPot.enabled === 'boolean') plan.billPot = { enabled: raw.billPot.enabled };
  plan.tips = (Array.isArray(raw.tips) ? raw.tips : []).map((t) => str(t, 300)).filter(Boolean).slice(0, 12);
  if (raw.investments || raw.portfolio) warnings.push('Investment instructions are not supported yet and were ignored.');
  if (!plan.budgets.length && !plan.caps.length && !plan.goals.length && !plan.debtPlan && !plan.pauseRecurring.length && !plan.billPot) errors.push('The plan contains no changes the app can apply.');
  return { plan: errors.length ? null : plan, errors, warnings };
}

/** Human-readable list of changes, each with an id the user can untick. */
export function diffPlan(state, plan, fmt = (n) => String(n)) {
  const cats = categoryMap(state.categories);
  const changes = [];
  for (const b of plan.budgets) {
    const before = cats[b.categoryId]?.budget || 0;
    if (before !== b.monthly) changes.push({ id: `budget:${b.categoryId}`, group: 'Budgets', text: `${cats[b.categoryId].icon} ${cats[b.categoryId].name}: ${before ? fmt(before) : 'no budget'} → ${b.monthly ? fmt(b.monthly) : 'no budget'}` });
  }
  const existing = new Map((state.caps || []).map((c) => [(c.name || '').toLowerCase(), c]));
  plan.caps.forEach((c, i) => {
    const prev = c.name && existing.get(c.name.toLowerCase());
    changes.push({ id: `cap:${i}`, group: 'Spend caps', text: `${prev ? 'Update' : 'New'} cap "${c.name || 'Unnamed'}": ${fmt(c.amount)} ${CAP_PERIODS[c.period]}${prev ? ` (was ${fmt(prev.amount)})` : ''}` });
  });
  if (plan.capsMode === 'replace') {
    const keep = new Set(plan.caps.map((c) => (c.name || '').toLowerCase()));
    for (const c of state.caps || []) if (!keep.has((c.name || '').toLowerCase())) changes.push({ id: `capdel:${c.id}`, group: 'Spend caps', text: `Remove cap "${c.name}"` });
  }
  const goals = new Map((state.goals || []).map((g) => [g.name.toLowerCase(), g]));
  plan.goals.forEach((g, i) => changes.push({ id: `goal:${i}`, group: 'Savings goals', text: `${goals.has(g.name.toLowerCase()) ? 'Update' : 'New'} goal ${g.icon} ${g.name}: ${fmt(g.target)}${g.perMonth ? `, saving ${fmt(g.perMonth)}/month` : ''}${g.targetDate ? ` by ${g.targetDate}` : ''}` }));
  if (plan.debtPlan) changes.push({ id: 'debt', group: 'Debts', text: `Debt strategy: ${plan.debtPlan.strategy}${plan.debtPlan.extra ? ` with ${fmt(plan.debtPlan.extra)}/month extra` : ''}` });
  for (const n of plan.pauseRecurring) changes.push({ id: `pause:${n.toLowerCase()}`, group: 'Recurring', text: `Pause "${n}"` });
  if (plan.billPot) changes.push({ id: 'billpot', group: 'Pay planner', text: `${plan.billPot.enabled ? 'Use' : 'Stop using'} a bills pot for each payday` });
  return changes;
}

/** Apply the selected changes. Returns new state with an undo snapshot in planHistory. */
export function applyPlan(state, plan, selectedIds, newId) {
  const sel = new Set(selectedIds);
  const before = { categories: state.categories, caps: state.caps || [], goals: state.goals || [], recurring: state.recurring, planSettings: { debtPlan: state.settings.debtPlan, billPot: state.settings.billPot } };
  let next = { ...state };
  const budgets = new Map(plan.budgets.filter((b) => sel.has(`budget:${b.categoryId}`)).map((b) => [b.categoryId, b.monthly]));
  if (budgets.size) next.categories = next.categories.map((c) => (budgets.has(c.id) ? { ...c, budget: budgets.get(c.id) } : c));

  let caps = [...(state.caps || [])];
  if (plan.capsMode === 'replace') caps = caps.filter((c) => !sel.has(`capdel:${c.id}`));
  plan.caps.forEach((c, i) => {
    if (!sel.has(`cap:${i}`)) return;
    const idx = caps.findIndex((x) => c.name && (x.name || '').toLowerCase() === c.name.toLowerCase());
    if (idx >= 0) caps[idx] = { ...caps[idx], ...c, source: 'ai' };
    else caps.push({ id: newId(), active: true, source: 'ai', ...c });
  });
  next.caps = caps;

  const goals = [...(state.goals || [])];
  plan.goals.forEach((g, i) => {
    if (!sel.has(`goal:${i}`)) return;
    const idx = goals.findIndex((x) => x.name.toLowerCase() === g.name.toLowerCase());
    if (idx >= 0) goals[idx] = { ...goals[idx], ...g };
    else goals.push({ id: newId(), active: true, ...g });
  });
  next.goals = goals;

  if (plan.debtPlan && sel.has('debt')) next.settings = { ...next.settings, debtPlan: plan.debtPlan };
  if (plan.billPot && sel.has('billpot')) next.settings = { ...next.settings, billPot: { ...(next.settings.billPot || {}), enabled: plan.billPot.enabled } };
  const pause = new Set(plan.pauseRecurring.filter((n) => sel.has(`pause:${n.toLowerCase()}`)).map((n) => n.toLowerCase()));
  if (pause.size) next.recurring = next.recurring.map((r) => (pause.has(r.name.toLowerCase()) ? { ...r, active: false } : r));

  next.planHistory = [
    { id: newId(), appliedAt: new Date().toISOString(), title: plan.title, strategy: plan.strategy, summary: plan.summary, tips: plan.tips, changes: selectedIds.length, before },
    ...(state.planHistory || []),
  ].slice(0, 10);
  return next;
}

export function undoPlan(state, historyId) {
  const h = (state.planHistory || []).find((x) => x.id === historyId);
  if (!h?.before) return state;
  const { planSettings, ...rest } = h.before;
  return { ...state, ...rest, settings: { ...state.settings, ...planSettings }, planHistory: state.planHistory.map((x) => (x.id === historyId ? { ...x, undone: true, before: null } : x)) };
}
