import { DEFAULT_CATEGORIES, categorise, merchantKey } from './categories.js';
import { round2 } from './money.js';
import { daysBetween } from './dates.js';
import { normaliseItem } from './receipts.js';
import { applyPlan, undoPlan } from './aiplan.js';
import { toBase, baseCurrency, rateFor } from './fx.js';

export const STATE_VERSION = 2;

export function createEmptyState() {
  return {
    version: STATE_VERSION,
    settings: {
      currency: 'GBP',
      name: '',
      onboarded: false,
      minimizeToTray: true,
      launchAtLogin: false,
      notifications: true,
      watchFolder: '',
      watchEnabled: false,
      widget: { pinned: true, opacity: 0.96 },
      bank: { provider: 'enablebanking', connected: false, institutionId: '', institutionName: '', sessionId: '', accounts: [], lastSync: null, autoSync: true },
      billPot: { enabled: true, balance: 0 },
      debtPlan: { strategy: 'avalanche', extra: 100 },
      receiptPrompts: true,
      extraHolidays: [],
    },
    profile: { name: '', region: 'ruk', incomes: [] },
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    transactions: [],
    recurring: [],
    debts: [],
    rules: [],
    accounts: [],
    imports: [],
    receipts: [],
    receiptSkips: [],
    itemRules: {},
    caps: [],
    goals: [],
    planHistory: [],
    // Reserved for V3 (brokerage, crypto, SIP/SWP connectors). Kept in the schema so data
    // written by later versions survives a round trip through this one.
    portfolio: { holdings: [], connectors: [] },
    fx: null,
    potLog: [],
    reviewDismissed: [],
  };
}

/** Bring older / partial saved state up to the current shape. */
export function migrate(state) {
  const base = createEmptyState();
  if (!state || typeof state !== 'object') return base;
  const merged = { ...base, ...state, settings: { ...base.settings, ...(state.settings || {}) } };
  merged.settings.widget = { ...base.settings.widget, ...(state.settings?.widget || {}) };
  merged.settings.bank = { ...base.settings.bank, ...(state.settings?.bank || {}) };
  merged.settings.billPot = { ...base.settings.billPot, ...(state.settings?.billPot || {}) };
  merged.profile = { ...base.profile, ...(state.profile || {}) };
  if (!merged.profile.name && state.settings?.name) merged.profile.name = state.settings.name;
  // v1 -> v2: older GoCardless connections can't be resumed (the service is closing).
  if (state.settings?.bank && state.settings.bank.provider !== 'enablebanking') merged.settings.bank = { ...base.settings.bank };
  const have = new Set((merged.categories || []).map((c) => c.id));
  merged.categories = [...(merged.categories || []), ...base.categories.filter((c) => !have.has(c.id))];
  merged.version = STATE_VERSION;
  return merged;
}

export const newId = () =>
  (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);

function importKey(row) {
  return `${row.date}|${round2(row.amount).toFixed(2)}|${String(row.description).toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

/**
 * Merge statement rows into the transaction list without creating duplicates.
 * Identical rows on the same day (e.g. two coffees) are kept apart by an occurrence counter,
 * so re-importing an overlapping statement never double-counts.
 * Bank-synced rows carry an externalId and are de-duplicated by that instead.
 * The same payment arriving from a different source (e.g. a CSV and then the bank feed,
 * which word descriptions differently) is matched on amount and date within a day.
 */
export function mergeRows(state, rows, source, { fileName } = {}) {
  const existing = new Set(state.transactions.map((t) => t.importKey).filter(Boolean));
  const external = new Set(state.transactions.map((t) => t.externalId).filter(Boolean));
  const byAmount = new Map();
  for (const t of state.transactions) {
    if (t.source === source) continue;
    const k = round2(t.amount).toFixed(2);
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k).push(t);
  }
  const claimed = new Set();
  const crossSourceMatch = (row) => {
    const candidates = byAmount.get(round2(row.amount).toFixed(2)) || [];
    const hit = candidates.find((t) => !claimed.has(t.id) && Math.abs(daysBetween(t.date, row.date)) <= 1);
    if (hit) claimed.add(hit.id);
    return hit;
  };
  const seen = new Map();
  const added = [];
  let duplicates = 0;
  const base = baseCurrency(state);
  for (let row of rows) {
    if (row.externalId && external.has(row.externalId)) { duplicates++; continue; }
    if (row.currency && row.currency !== base) row = foreignRow(state, row);
    const base = importKey(row);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const key = `${base}#${n}`;
    if (existing.has(key) || crossSourceMatch(row)) { duplicates++; continue; }
    added.push({
      id: newId(),
      date: row.date,
      amount: round2(row.amount),
      description: row.description,
      categoryId: row.categoryId || categorise(row.description, row.amount, state.rules),
      source,
      account: row.account || '',
      importKey: key,
      externalId: row.externalId,
      ...(row.original ? { original: row.original } : {}),
      createdAt: new Date().toISOString(),
    });
  }
  const transactions = [...state.transactions, ...added].sort((a, b) => b.date.localeCompare(a.date));
  const imports = [
    { id: newId(), at: new Date().toISOString(), source, fileName: fileName || '', added: added.length, duplicates },
    ...(state.imports || []),
  ].slice(0, 50);
  return { state: { ...state, transactions, imports }, added: added.length, duplicates };
}

/** A row in another currency: store the base-currency amount at today's rate and keep the original. */
function foreignRow(state, row) {
  const rate = rateFor(state.fx, row.currency, baseCurrency(state));
  return { ...row, amount: toBase(row.amount, row.currency, state), original: { amount: row.amount, currency: row.currency, rate: rate || null } };
}

const upsert = (list, item) => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [...list, { ...item, id: item.id || newId() }];
  const copy = [...list];
  copy[i] = { ...copy[i], ...item };
  return copy;
};

/** Single entry point for every change to app data. Pure: returns new state. */
export function reduce(state, action) {
  const p = action.payload;
  switch (action.type) {
    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...p, widget: { ...state.settings.widget, ...(p.widget || {}) }, bank: { ...state.settings.bank, ...(p.bank || {}) } } };

    case 'txn/add': {
      const { currency, ...rest } = p;
      const fx = currency && currency !== baseCurrency(state) ? foreignRow(state, { ...rest, currency }) : rest;
      const t = { id: newId(), source: 'manual', createdAt: new Date().toISOString(), ...fx, amount: round2(fx.amount) };
      if (!t.categoryId) t.categoryId = categorise(t.description, t.amount, state.rules);
      return { ...state, transactions: [t, ...state.transactions].sort((a, b) => b.date.localeCompare(a.date)) };
    }
    case 'txn/update': {
      const { learn, ...changes } = p;
      const before = state.transactions.find((t) => t.id === p.id);
      if (!before) return state;
      const recategorised = changes.categoryId && changes.categoryId !== before.categoryId;
      let rules = state.rules;
      let transactions = state.transactions.map((t) => (t.id === p.id
        ? { ...t, ...changes, amount: changes.amount !== undefined ? round2(changes.amount) : t.amount, manualCategory: t.manualCategory || !!recategorised }
        : t));
      // Learn from re-categorisation: remember the merchant and re-file its other auto-categorised rows.
      if (learn && recategorised) {
        const merchant = merchantKey(before.description);
        rules = [{ id: newId(), merchant, categoryId: changes.categoryId }, ...rules.filter((r) => r.merchant !== merchant)];
        transactions = transactions.map((t) => (!t.manualCategory && merchantKey(t.description) === merchant ? { ...t, categoryId: changes.categoryId } : t));
      }
      return { ...state, rules, transactions };
    }
    case 'txn/delete':
      return { ...state, transactions: state.transactions.filter((t) => !(p.ids || [p.id]).includes(t.id)) };
    case 'txn/import':
      return mergeRows(state, p.rows, p.source || 'csv', { fileName: p.fileName }).state;
    case 'txn/recategoriseAll':
      return { ...state, transactions: state.transactions.map((t) => (t.manualCategory ? t : { ...t, categoryId: categorise(t.description, t.amount, state.rules) })) };

    case 'recurring/save':
      return { ...state, recurring: upsert(state.recurring, { active: true, ...p, amount: Math.abs(round2(p.amount)) }) };
    case 'recurring/delete':
      return { ...state, recurring: state.recurring.filter((r) => r.id !== p.id) };

    case 'debt/save':
      return { ...state, debts: upsert(state.debts, { ...p, balance: round2(+p.balance || 0), originalBalance: p.originalBalance || +p.balance || 0 }) };
    case 'debt/delete':
      return { ...state, debts: state.debts.filter((d) => d.id !== p.id) };

    case 'category/save':
      return { ...state, categories: upsert(state.categories, p) };
    case 'category/delete':
      return {
        ...state,
        categories: state.categories.filter((c) => c.id !== p.id),
        transactions: state.transactions.map((t) => (t.categoryId === p.id ? { ...t, categoryId: 'other' } : t)),
      };
    case 'rule/delete':
      return { ...state, rules: state.rules.filter((r) => r.id !== p.id) };

    // ---- split bills
    case 'txn/split':
      return { ...state, transactions: state.transactions.map((t) => (t.id === p.id ? (p.split ? { ...t, split: { ...p.split, owed: round2(Math.min(-t.amount, Math.max(0, +p.split.owed || 0))) } } : (({ split, ...rest }) => rest)(t)) : t)) };
    case 'split/settle':
      return { ...state, transactions: state.transactions.map((t) => (t.id === p.incomingId ? { ...t, settles: (p.allocations || []).filter((a) => a.amount > 0).map((a) => ({ txnId: a.txnId, amount: round2(+a.amount) })), categoryId: 'split_back', reviewed: true, manualCategory: true } : t)) };
    case 'split/unsettle':
      return { ...state, transactions: state.transactions.map((t) => (t.id === p.incomingId ? (({ settles, ...rest }) => ({ ...rest, categoryId: categorise(t.description, t.amount, state.rules), manualCategory: false }))(t) : t)) };
    case 'split/writeOff':
      return { ...state, transactions: state.transactions.map((t) => (t.id === p.id && t.split ? { ...t, split: { ...t.split, writtenOff: round2(+p.amount || 0) } } : t)) };

    // ---- review queue ("needs your attention")
    case 'txn/review': {
      const ids = new Set(p.ids);
      return { ...state, transactions: state.transactions.map((t) => (ids.has(t.id) ? { ...t, reviewed: true, ...(p.categoryId ? { categoryId: p.categoryId, manualCategory: true } : {}) } : t)) };
    }
    case 'review/dismiss':
      return { ...state, reviewDismissed: [...new Set([...(state.reviewDismissed || []), p.key])].slice(-1000) };

    // ---- currencies and pots
    case 'fx/set':
      return { ...state, fx: p };
    case 'pot/move': {
      const balance = round2((+state.settings.billPot?.balance || 0) + (+p.amount || 0));
      return { ...state, settings: { ...state.settings, billPot: { ...state.settings.billPot, balance } }, potLog: [{ id: newId(), at: new Date().toISOString(), amount: round2(+p.amount), note: p.note || '', balance }, ...(state.potLog || [])].slice(0, 200) };
    }

    case 'profile/update':
      return { ...state, profile: { ...state.profile, ...p } };
    case 'income/save':
      return { ...state, profile: { ...state.profile, incomes: upsert(state.profile.incomes || [], p) } };
    case 'income/delete':
      return { ...state, profile: { ...state.profile, incomes: (state.profile.incomes || []).filter((i) => i.id !== p.id) } };

    case 'receipt/save': {
      // Remember how the user rated each item so the next receipt is pre-filled.
      const itemRules = { ...(state.itemRules || {}) };
      for (const it of p.items || []) if (it.name && it.tier) itemRules[normaliseItem(it.name)] = { tier: it.tier, section: it.section };
      return { ...state, itemRules, receipts: upsert(state.receipts || [], { createdAt: new Date().toISOString(), ...p }) };
    }
    case 'receipt/delete':
      return { ...state, receipts: (state.receipts || []).filter((r) => r.id !== p.id) };
    case 'receipt/skip':
      return { ...state, receiptSkips: [...new Set([...(state.receiptSkips || []), ...(p.ids || [p.txnId])])].slice(-2000) };

    case 'cap/save':
      return { ...state, caps: upsert(state.caps || [], { active: true, alertAt: 0.8, period: 'month', ...p, amount: round2(+p.amount || 0) }) };
    case 'cap/delete':
      return { ...state, caps: (state.caps || []).filter((c) => c.id !== p.id) };
    case 'goal/save':
      return { ...state, goals: upsert(state.goals || [], { active: true, saved: 0, ...p }) };
    case 'goal/delete':
      return { ...state, goals: (state.goals || []).filter((g) => g.id !== p.id) };
    case 'goal/contribute':
      return { ...state, goals: (state.goals || []).map((g) => (g.id === p.id ? { ...g, saved: round2((g.saved || 0) + (+p.amount || 0)) } : g)) };

    case 'plan/apply':
      return applyPlan(state, p.plan, p.selected, newId);
    case 'plan/undo':
      return undoPlan(state, p.id);

    case 'accounts/set':
      return { ...state, accounts: p };
    case 'data/replace':
      return migrate(p);
    case 'data/reset':
      return { ...createEmptyState(), settings: { ...createEmptyState().settings, onboarded: true, currency: state.settings.currency } };
    default:
      return state;
  }
}
