// Receipts: turn a shop into line items, rate each item's importance and track the
// "small stuff" that quietly adds up. Tiers: essential / moderate / low ("not so important").
import { addDays, lastMonths, monthLabel, parseISO } from './dates.js';
import { round2, sum } from './money.js';
import { merchantKey } from './categories.js';

export const TIERS = {
  essential: { label: 'Essential', short: 'Essential', color: '#3a86ee', icon: '●' },
  moderate: { label: 'Moderately important', short: 'Moderate', color: '#c08800', icon: '◐' },
  low: { label: 'Not so important', short: 'Not so important', color: '#e8558f', icon: '○' },
};

export const SECTIONS = {
  groceries: { label: 'Groceries', icon: '🛒' },
  general: { label: 'General / household', icon: '🧺' },
  food: { label: 'Food out & takeaway', icon: '🍔' },
};

// Categories the app actively asks you to itemise (supermarkets, shops, bigger food bills).
export const PROMPT_CATEGORIES = { groceries: 0, shopping: 8, eating_out: 12 };

// Categories whose purchases can be itemised, and the section they default to.
export const ITEMISABLE = { groceries: 'groceries', shopping: 'general', eating_out: 'food', coffee: 'food', health: 'general', personal: 'general' };

const ESSENTIAL = ['milk', 'bread', 'egg', 'rice', 'pasta', 'flour', 'chicken', 'beef', 'mince', 'pork', 'fish', 'salmon', 'tuna', 'lentil', 'beans', 'chickpea', 'oats', 'porridge', 'cereal', 'potato', 'onion', 'carrot', 'tomato', 'banana', 'apples', 'oranges', 'veg', 'fruit', 'salad', 'lettuce', 'cucumber', 'pepper', 'broccoli', 'spinach', 'butter', 'cheese', 'yoghurt', 'yogurt', 'oil', 'salt', 'sugar', 'tea bags', 'nappies', 'nappy', 'formula', 'baby', 'toilet', 'loo roll', 'kitchen roll', 'toothpaste', 'toothbrush', 'soap', 'shampoo', 'deodorant', 'detergent', 'washing', 'bin bag', 'bleach', 'paracetamol', 'ibuprofen', 'medicine', 'tampons', 'sanitary', 'water 5l', 'frozen veg', 'tinned', 'garlic', 'ginger'];
const LOW = ['crisps', 'chocolate', 'choc', 'sweets', 'candy', 'haribo', 'cake', 'biscuit', 'cookie', 'donut', 'doughnut', 'ice cream', 'dessert', 'cola', 'coke', 'pepsi', 'fanta', 'sprite', 'fizzy', 'energy drink', 'red bull', 'monster', 'beer', 'lager', 'ale', 'cider', 'wine', 'prosecco', 'champagne', 'vodka', 'gin', 'whisky', 'rum', 'spirits', 'cigarettes', 'tobacco', 'vape', 'lottery', 'scratchcard', 'magazine', 'popcorn', 'pringles', 'dip', 'snack', 'cheesecake', 'muffin', 'brownie', 'milkshake', 'frappe', 'toy', 'gift', 'candle', 'decoration'];

export function normaliseItem(name = '') {
  return String(name).toLowerCase().replace(/[^a-z0-9 &]+/g, ' ').replace(/\b\d+(g|kg|ml|l|pk|pack|x|pt|cl)?\b/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Suggest a tier for an item: learned choices first, then keyword lists, else "moderate". */
export function suggestTier(name, itemRules = {}) {
  const key = normaliseItem(name);
  if (itemRules[key]?.tier) return itemRules[key].tier;
  const text = ` ${key} `;
  const has = (words) => words.some((w) => text.includes(` ${w}`));
  if (has(LOW)) return 'low';
  if (has(ESSENTIAL)) return 'essential';
  return 'moderate';
}

const SKIP = /^(sub ?total|total|balance|card|visa|mastercard|debit|credit|contactless|cash|change|vat|tax|amount|payment|auth|merchant|terminal|clubcard|nectar|points|savings|you saved|tel|www|thank|receipt|store|till|op |cashier|items|qty|price\s*$|date|time|ref|aid|pan|approved|\*+)/i;

/**
 * Parse OCR'd receipt text into items. Handles "NAME   1.25", "2 X NAME @ 0.85" followed by
 * the line total on the next line, discounts ("PRICE CUT -0.50") and noise characters.
 */
export function parseReceiptText(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.replace(/[~|_]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const items = [];
  let total = null;
  let pendingName = null;
  let pendingQty = 1;
  const merchant = lines[0] && !/\d{2}[./]\d{2}/.test(lines[0]) ? lines[0] : '';
  for (const line of lines) {
    const totalMatch = line.match(/^(?:balance due|total(?: to pay)?|amount due)\b.*?(-?\d+[.,]\d{2})\s*$/i);
    if (totalMatch) { total = parseFloat(totalMatch[1].replace(',', '.')); pendingName = null; continue; }
    if (SKIP.test(line)) { pendingName = null; continue; }
    const qtyAt = line.match(/^(\d+)\s*[xX*]\s+(.+?)\s*@\s*£?(\d+[.,]\d{2})\s*(-?\d+[.,]\d{2})?\s*[A-Z]?$/);
    if (qtyAt) {
      const qty = +qtyAt[1];
      if (qtyAt[4]) items.push({ name: tidy(qtyAt[2]), qty, price: parseFloat(qtyAt[4].replace(',', '.')) });
      else { pendingName = tidy(qtyAt[2]); pendingQty = qty; }
      continue;
    }
    const m = line.match(/^(.*?[A-Za-z].*?)\s+£?(-?\d{1,4}[.,]\d{2})\s*-?\s*[A-Z*]?$/);
    if (m) {
      const price = parseFloat(m[2].replace(',', '.'));
      const name = tidy(m[1]);
      if (/(price ?cut|discount|offer|saving|reduced|coupon|voucher|promo)/i.test(name) || price < 0) {
        items.push({ name, qty: 1, price: -Math.abs(price), discount: true });
      } else items.push({ name, qty: 1, price });
      pendingName = null;
      continue;
    }
    const lone = line.match(/^£?(\d{1,4}[.,]\d{2})$/);
    if (lone && pendingName) {
      items.push({ name: pendingName, qty: pendingQty, price: parseFloat(lone[1].replace(',', '.')) });
      pendingName = null;
    }
  }
  return { merchant, items, total, itemsTotal: round2(sum(items, (i) => i.price)) };
}

function tidy(s) {
  return s.replace(/\s+[A-Z]$/, '').replace(/[.,:;]+$/, '').trim().replace(/\b([A-Z])([A-Z]+)\b/g, (_, a, b) => a + b.toLowerCase());
}

/** Transactions that could be itemised and haven't been yet (newest first). */
export function receiptInbox(state, today, days = 45) {
  const done = new Set((state.receipts || []).map((r) => r.txnId));
  const skipped = new Set(state.receiptSkips || []);
  return state.transactions
    .filter((t) => t.amount < 0 && t.categoryId in PROMPT_CATEGORIES && -t.amount >= Math.max(3, PROMPT_CATEGORIES[t.categoryId]) && t.date > addDays(today, -days) && t.date <= today && !done.has(t.id) && !skipped.has(t.id))
    .slice(0, 50);
}

/** Every itemised line with its date and section, for analytics. */
export function receiptLines(state) {
  const out = [];
  for (const r of state.receipts || []) {
    for (const it of r.items || []) {
      if (!(it.price > 0)) continue;
      out.push({ date: r.date, merchant: r.merchant, name: it.name, key: normaliseItem(it.name), price: +it.price, tier: it.tier || 'moderate', section: it.section || r.section || 'groceries' });
    }
  }
  return out;
}

/** Tier x section spending by month, top "not so important" items and what trimming them would save. */
export function basketAnalytics(state, today, months = 6) {
  const t = parseISO(today);
  const range = lastMonths(t.getFullYear(), t.getMonth(), months);
  const lines = receiptLines(state);
  const monthly = range.map((m) => {
    const inMonth = lines.filter((l) => l.date.startsWith(m.key));
    const bySection = {};
    for (const s of Object.keys(SECTIONS)) {
      bySection[s] = Object.fromEntries(Object.keys(TIERS).map((tier) => [tier, round2(sum(inMonth.filter((l) => l.section === s && l.tier === tier), (l) => l.price))]));
    }
    const byTier = Object.fromEntries(Object.keys(TIERS).map((tier) => [tier, round2(sum(inMonth.filter((l) => l.tier === tier), (l) => l.price))]));
    return { key: m.key, label: monthLabel(m.year, m.month, 'short'), bySection, byTier, total: round2(sum(inMonth, (l) => l.price)) };
  });
  const recent = lines.filter((l) => l.date > addDays(today, -90));
  const byItem = new Map();
  for (const l of recent) {
    const x = byItem.get(l.key) || { name: l.name, tier: l.tier, section: l.section, total: 0, count: 0 };
    x.total += l.price;
    x.count++;
    byItem.set(l.key, x);
  }
  const items = [...byItem.values()].map((x) => ({ ...x, total: round2(x.total), perMonth: round2(x.total / 3) }));
  const lowItems = items.filter((x) => x.tier === 'low').sort((a, b) => b.total - a.total).slice(0, 10);
  const monthsWithData = monthly.slice(0, -1).filter((m) => m.total > 0);
  const avg = (tier) => (monthsWithData.length ? sum(monthsWithData, (m) => m.byTier[tier]) / monthsWithData.length : 0);
  return {
    monthly,
    lowItems,
    topItems: items.sort((a, b) => b.total - a.total).slice(0, 10),
    avgByTier: Object.fromEntries(Object.keys(TIERS).map((k) => [k, round2(avg(k))])),
    receiptsCount: (state.receipts || []).length,
    monthsWithData: monthsWithData.length,
    halveLowSaving: round2(avg('low') / 2),
  };
}

export function receiptSectionFor(txn) {
  return ITEMISABLE[txn.categoryId] || 'general';
}

export { merchantKey };
