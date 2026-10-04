// Credit cards tracked from their own transactions (statement CSVs, Open Banking, Monzo Flex).
//
// A tracked card is a debt with `cardAccount` (the account name its transactions arrive under).
// Pulse works out each monthly statement from those transactions:
//   statement = purchases − refunds + EMI instalments billed in the cycle
// and the payment due from it (full balance, minimum, or a fixed amount).
//
// Money rules, so nothing is counted twice:
//   - a card purchase is spending when it happens;
//   - paying the card bill from a bank account is a transfer, and the payment landing on the
//     card is a transfer too;
//   - a purchase converted to EMI stops counting as one big spend; each instalment counts as
//     spending in the month it's billed, and the plan is tracked on the Debts page.
import { addDays, todayISO } from './dates.js';
import { round2 } from './money.js';

const PAYMENT_WORDS = /\b(payment|thank you|thankyou|direct debit|repayment|received|pymt|autopay)\b/i;

export const isCardDebt = (d) => !!d?.cardAccount;
export const isCardEmi = (d) => d?.type === 'card-emi';
export const cardDebts = (state) => (state.debts || []).filter(isCardDebt);

const pad = (n) => String(n).padStart(2, '0');
const dim = (y, m) => new Date(y, m, 0).getDate(); // m is 1-12

/** The statement date in a given month (clamped to the month's last day). */
export function closeIn(year, month, day) {
  return `${year}-${pad(month)}-${pad(Math.min(day, dim(year, month)))}`;
}

/** Statement dates (monthly on `statementDay`) between two dates, inclusive. */
export function closesBetween(card, from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  m -= 1;
  if (m < 1) { m = 12; y -= 1; }
  for (let i = 0; i < 1200; i++) {
    const c = closeIn(y, m, card.statementDay || 1);
    if (c > to) break;
    if (c >= from) out.push(c);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** The statement date before `close` (one month earlier). */
export function previousClose(card, close) {
  const [y, m] = close.split('-').map(Number);
  return m === 1 ? closeIn(y - 1, 12, card.statementDay || 1) : closeIn(y, m - 1, card.statementDay || 1);
}

/** The statement date after `close` (one month later). */
export function nextClose(card, close) {
  const [y, m] = close.split('-').map(Number);
  return m === 12 ? closeIn(y + 1, 1, card.statementDay || 1) : closeIn(y, m + 1, card.statementDay || 1);
}

/** The bill you're waiting on today: last statement if its due date hasn't passed, otherwise the next one. */
export function currentBill(state, card, today = todayISO()) {
  const close = closeOnOrBefore(card, today);
  return cardBill(state, card, dueAfter(card, close) >= today ? close : nextClose(card, close));
}

/** The latest statement date on or before `date`. */
export function closeOnOrBefore(card, date) {
  const [y, m] = date.split('-').map(Number);
  const c = closeIn(y, m, card.statementDay || 1);
  return c <= date ? c : previousClose(card, c);
}

/** Payment due date for a statement: the next due day after the statement date. */
export function dueAfter(card, close) {
  const [y, m] = close.split('-').map(Number);
  const same = closeIn(y, m, card.dueDay || 1);
  if (same > close) return same;
  return m === 12 ? closeIn(y + 1, 1, card.dueDay || 1) : closeIn(y, m + 1, card.dueDay || 1);
}

/** The card's bill-payment keyword, if it's specific enough to trust (at least 4 letters). */
export function usableMatch(card) {
  const m = String(card?.match || '').toLowerCase().trim();
  return m.replace(/[^a-z]/g, '').length >= 4 ? m : '';
}

export function isCardPayment(t) {
  return t.amount > 0 && (t.categoryId === 'transfer' || PAYMENT_WORDS.test(t.description || ''));
}

// ---------------- EMI ----------------

/** Monthly instalment for a loan of `principal` over `months` at `apr`% a year (0% = equal parts). */
export function instalmentFor(principal, apr, months) {
  const n = Math.max(1, Math.round(months));
  const r = (Number(apr) || 0) / 100 / 12;
  if (!r) return round2(principal / n);
  return round2((principal * r) / (1 - (1 + r) ** -n));
}

/** Full schedule: one instalment per statement, the fee (if any) on the first. */
export function emiSchedule(plan, card) {
  const n = Math.max(1, Math.round(plan.tenure));
  const pay = instalmentFor(plan.principal, plan.apr, n);
  const r = (Number(plan.apr) || 0) / 100 / 12;
  let balance = plan.principal;
  let close = plan.firstClose;
  const rows = [];
  for (let k = 1; k <= n; k++) {
    const interest = round2(balance * r);
    let principal = round2(pay - interest);
    if (k === n) principal = round2(balance); // last one squares off rounding
    const amount = round2(principal + interest + (k === 1 ? Number(plan.fee) || 0 : 0));
    balance = round2(balance - principal);
    rows.push({ k, date: close, amount, principal, interest, balance: Math.max(0, balance) });
    close = nextClose({ statementDay: card?.statementDay || Number(close.slice(8)) }, close);
  }
  return rows;
}

export function emiPlans(state, card) {
  return (state.debts || []).filter((d) => isCardEmi(d) && d.viaCard === card.id);
}

/** Where an EMI plan stands on `date`: instalments billed, principal left. */
export function emiStatus(plan, card, date = todayISO()) {
  const rows = emiSchedule(plan, card);
  const billed = rows.filter((r) => r.date <= date);
  const last = billed[billed.length - 1];
  return {
    instalment: rows[0] ? round2(rows[Math.min(1, rows.length - 1)].amount) : 0,
    billed: billed.length,
    tenure: rows.length,
    remaining: last ? last.balance : round2(plan.principal),
    totalInterest: round2(rows.reduce((s, r) => s + r.interest, 0)),
    totalCost: round2(rows.reduce((s, r) => s + r.amount, 0)),
    next: rows.find((r) => r.date > date) || null,
    done: billed.length >= rows.length,
    rows,
  };
}

// ---------------- statements ----------------

// Real card transactions only (the financial view also holds generated EMI instalment lines).
const cardTxns = (state, card) => (state.transactions || []).filter((t) => t.account === card.cardAccount && !t.virtual);

/** The statement date that closes the cycle a transaction on `date` falls in. */
export function closeOnOrAfter(card, date) {
  const c = closeOnOrBefore(card, date);
  return c === date ? c : nextClose(card, c);
}

/**
 * How a card turns purchases into bill lines (Monzo Flex's "default payment option", which
 * any card can use):
 *   full     every purchase in full on the next bill (normal credit cards; Flex "Pay in full")
 *   choose   you pick per purchase: in full or 3/6/12/24 months (Flex "Choose for every purchase").
 *            Until you choose, a purchase is billed in full.
 *   split    every purchase over the same number of months
 *   minimum  every purchase over up to `maxMonths` at the card's rate; small purchases get fewer
 *            months so each payment is at least `minInstalment` (Flex "Minimum monthly payment")
 * Plans up to `freeMonths` long are interest-free; longer ones charge `apr`.
 * Any single purchase can be set differently (an explicit plan via emiId always wins).
 */
export const PLAN_OPTIONS = [3, 6, 12, 24];

export function planOf(card) {
  if (!card) return { mode: 'full' };
  if (card.plan?.mode) {
    const p = card.plan;
    return {
      mode: p.mode,
      months: Math.max(2, Math.round(Number(p.months) || 3)),
      apr: Number(p.apr) || 0,
      freeMonths: Math.max(0, Math.round(Number(p.freeMonths ?? 3))),
      maxMonths: Math.max(2, Math.round(Number(p.maxMonths) || 24)),
      minInstalment: Math.max(0, Number(p.minInstalment ?? 5)),
      options: Array.isArray(p.options) && p.options.length ? p.options.map(Number) : PLAN_OPTIONS,
    };
  }
  // Older 0.5.1 setting: { spread: { months, apr } }.
  if (card.spread && Number(card.spread.months) > 1) return { mode: 'split', months: Math.round(Number(card.spread.months)), apr: Number(card.spread.apr) || 0, freeMonths: 0, maxMonths: 24, minInstalment: 0, options: PLAN_OPTIONS };
  return { mode: 'full', months: 3, apr: 0, freeMonths: 3, maxMonths: 24, minInstalment: 5, options: PLAN_OPTIONS };
}

/** The interest rate for a plan of `months` on this card (interest-free up to freeMonths). */
export function planApr(card, months) {
  const p = planOf(card);
  return months <= 1 || months <= p.freeMonths ? 0 : p.apr;
}

/** The card's automatic plan for a purchase (none means: in full on the next bill). */
function autoPlan(card, t) {
  const p = planOf(card);
  const principal = -(t.rawAmount ?? t.amount);
  let tenure = 0;
  if (p.mode === 'split') tenure = p.months;
  if (p.mode === 'minimum') tenure = Math.max(1, Math.min(p.maxMonths, p.minInstalment > 0 ? Math.floor(principal / p.minInstalment) : p.maxMonths));
  if (tenure <= 1) return null;
  return { principal, apr: p.mode === 'split' ? p.apr : planApr(card, tenure), tenure, fee: 0, firstClose: closeOnOrAfter(card, t.date) };
}

/** Back-compat for the 0.5.1 name. */
export const spreadOf = (card) => { const p = planOf(card); return p.mode === 'split' ? { months: p.months, apr: p.apr } : null; };

/**
 * The statement for the cycle ending on `close`, with every line that makes it up:
 * purchases in the cycle (or, on a spreading card, the instalments of recent purchases due on
 * this statement), minus refunds, plus EMI instalments.
 */
export function statementFor(state, card, close) {
  const start = addDays(previousClose(card, close), 1);
  const pl = planOf(card);
  const spreads = pl.mode === 'split' || pl.mode === 'minimum';
  const lines = [];
  let purchases = 0;
  let refunds = 0;
  let payments = 0;
  let spread = 0;
  // A card that spreads purchases bills them from up to `months` cycles back.
  let from = start;
  const back = pl.mode === 'split' ? pl.months : pl.mode === 'minimum' ? pl.maxMonths : 1;
  for (let i = 1; i < back; i++) from = addDays(previousClose(card, addDays(from, -1)), 1);
  for (const t of cardTxns(state, card)) {
    if (t.date < from || t.date > close) continue;
    const amt = t.rawAmount ?? t.amount;
    if (amt < 0) {
      if (t.emiId) continue; // billed through its own EMI plan
      const auto = spreads ? autoPlan(card, t) : null;
      if (auto) {
        const r = emiSchedule(auto, card).find((x) => x.date === close);
        if (r) { spread += r.amount; lines.push({ date: t.date, description: t.description, amount: r.amount, kind: 'instalment', k: r.k, n: auto.tenure, original: round2(-amt) }); }
      } else if (t.date >= start) {
        purchases += -amt;
        lines.push({ date: t.date, description: t.description, amount: round2(-amt), kind: 'purchase' });
      }
    } else if (t.date >= start) {
      if (isCardPayment(t)) payments += amt;
      else { refunds += amt; lines.push({ date: t.date, description: t.description, amount: round2(-amt), kind: 'refund' }); }
    }
  }
  let emi = 0;
  for (const plan of emiPlans(state, card)) {
    for (const r of emiSchedule(plan, card)) {
      if (r.date >= start && r.date <= close) { emi += r.amount; lines.push({ date: r.date, description: plan.name, amount: r.amount, kind: 'emi', k: r.k, n: plan.tenure }); }
    }
  }
  lines.sort((a, b) => a.date.localeCompare(b.date));
  return {
    start, close, from,
    purchases: round2(purchases), spread: round2(spread), refunds: round2(refunds), payments: round2(payments), emi: round2(emi),
    total: round2(Math.max(0, purchases + spread - refunds + emi)),
    lines,
  };
}

/** What you'll pay on a statement of `total`, given how you pay this card. */
export function paymentFor(card, total) {
  const mode = card.payMode || 'full';
  if (total <= 0) return 0;
  if (mode === 'fixed') return round2(Math.min(total, Number(card.fixedPayment) || total));
  if (mode === 'minimum') {
    const pct = Number(card.minPct ?? 3) || 3;
    const floor = Number(card.minFloor ?? 25) || 0;
    return round2(Math.min(total, Math.max((total * pct) / 100, floor)));
  }
  return round2(total);
}

/**
 * The bill for each statement date: the real statement once Pulse has transactions up to that
 * date, otherwise an estimate (spending so far, or the recent average if that's higher).
 * A bill amount you've typed in (from the card or the calendar) always wins.
 * `historyGap` flags a bill that may be missing older purchases Pulse never received.
 */
export function cardBill(state, card, close) {
  const st = statementFor(state, card, close);
  const txns = cardTxns(state, card);
  const latest = txns.reduce((m, t) => (t.date > m ? t.date : m), '');
  const earliest = txns.reduce((m, t) => (!m || t.date < m ? t.date : m), '');
  const complete = !!latest && latest >= close;
  let total = st.total;
  if (!complete) {
    const recent = [1, 2, 3].map((k) => { let c = close; for (let i = 0; i < k; i++) c = previousClose(card, c); return c; })
      .filter((c) => latest && c <= latest)
      .map((c) => statementFor(state, card, c).total);
    const avg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    total = round2(Math.max(st.total, avg));
  }
  const due = dueAfter(card, close);
  const entered = state.overrides?.[`${card.id}:${due}`];
  const historyGap = !!earliest && earliest > st.from;
  if (entered && typeof entered.amount === 'number') {
    return { ...st, total: entered.amount, calculated: total, entered: true, estimated: false, historyGap, historyFrom: earliest, due, payment: round2(entered.amount) };
  }
  return { ...st, total, calculated: total, estimated: !complete, historyGap, historyFrom: earliest, due, payment: paymentFor(card, total) };
}

/** What's owed on the card now (excluding EMI principal not yet billed, which is tracked on its plan). */
export function cardOutstanding(state, card, today = todayISO()) {
  const txns = cardTxns(state, card);
  const pl = planOf(card);
  const instalmentsBetween = (from, to) => emiPlans(state, card).reduce((s, p) => s + emiSchedule(p, card).filter((r) => r.date > from && r.date <= to).reduce((a, r) => a + r.amount, 0), 0);
  if (card.balanceAsOf && card.balanceAsOf.date) {
    const { amount, date } = card.balanceAsOf;
    const moved = txns.filter((t) => t.date > date && !t.emiId).reduce((s, t) => s - (t.rawAmount ?? t.amount), 0);
    return round2(Math.max(0, Number(amount) + moved + instalmentsBetween(date, today)));
  }
  // No opening balance given: the last statement (unless it's been paid), plus everything still
  // to be billed: spending since, and on a spreading card the instalments not billed yet.
  const close = closeOnOrBefore(card, today);
  const last = cardBill(state, card, close);
  const since = txns.filter((t) => t.date > close && t.date <= today);
  const paidSince = since.filter(isCardPayment).reduce((s, t) => s + t.amount, 0);
  const refundsSince = since.filter((t) => t.amount > 0 && !isCardPayment(t)).reduce((s, t) => s + t.amount, 0);
  let toBill;
  if (pl.mode === 'split' || pl.mode === 'minimum') {
    toBill = txns.filter((t) => (t.rawAmount ?? t.amount) < 0 && !t.emiId && t.date <= today).reduce((s, t) => {
      const auto = autoPlan(card, t);
      if (!auto) return t.date > close ? s - (t.rawAmount ?? t.amount) : s;
      return s + emiSchedule(auto, card).filter((r) => r.date > close).reduce((a, r) => a + r.amount, 0);
    }, 0);
  } else {
    toBill = since.filter((t) => (t.rawAmount ?? t.amount) < 0 && !t.emiId).reduce((s, t) => s - (t.rawAmount ?? t.amount), 0);
  }
  return round2(Math.max(0, last.total - paidSince) + Math.max(0, toBill - refundsSince) + instalmentsBetween(close, today));
}

/** "Choose for every purchase" cards: recent purchases still waiting for a choice. */
export function purchasesAwaitingPlan(state, today = todayISO()) {
  const out = [];
  for (const card of cardDebts(state)) {
    if (planOf(card).mode !== 'choose') continue;
    const since = addDays(closeOnOrBefore(card, today), -35);
    for (const t of cardTxns(state, card)) {
      if ((t.rawAmount ?? t.amount) >= 0 || t.emiId || t.date < since || t.categoryId === 'transfer') continue;
      out.push({ card, txn: t });
    }
  }
  return out.sort((a, b) => b.txn.date.localeCompare(a.txn.date));
}

// ---------------- imports ----------------

/** Accounts seen in imported transactions that you haven't told Pulse about yet. */
export function unclassifiedAccounts(state) {
  const known = state.accountTypes || {};
  const tracked = new Set(cardDebts(state).map((d) => d.cardAccount));
  // Live connections already say what each account is (current account vs credit/Flex).
  const live = new Map((state.accounts || []).filter((a) => a.name).map((a) => [a.name, a.kind]));
  const seen = new Map();
  for (const t of state.transactions || []) {
    if (!t.account || ['manual', 'demo'].includes(t.source) || known[t.account] || tracked.has(t.account)) continue;
    if (live.has(t.account) && live.get(t.account) !== 'credit') continue;
    const s = seen.get(t.account) || { account: t.account, count: 0, positive: 0, first: t.date, last: t.date, source: t.source };
    s.count++;
    if (t.amount > 0) s.positive++;
    if (t.date < s.first) s.first = t.date;
    if (t.date > s.last) s.last = t.date;
    seen.set(t.account, s);
  }
  return [...seen.values()].map((s) => ({
    ...s,
    likelyCard: /flex|card|amex|american express|credit|mbna|capital one|vanquis|aqua|zopa/i.test(s.account),
    flex: /\bflex\b/i.test(s.account),
    // Card exports often list purchases as positive numbers.
    looksFlipped: s.count >= 3 && s.positive / s.count > 0.6,
  }));
}

/** Card rules for an incoming row: fix the sign of card exports and mark card bill payments as transfers. */
export function applyCardRules(state, row) {
  const cards = cardDebts(state);
  if (!cards.length) return row;
  const card = cards.find((c) => c.cardAccount === row.account);
  if (card) {
    const amount = card.flipSign ? -row.amount : row.amount;
    const next = { ...row, amount };
    if (amount > 0 && PAYMENT_WORDS.test(row.description || '')) next.categoryId = 'transfer';
    return next;
  }
  const desc = String(row.description || '').toLowerCase();
  if (row.amount < 0 && cards.some((c) => usableMatch(c) && desc.includes(usableMatch(c)))) return { ...row, categoryId: 'transfer' };
  return row;
}
