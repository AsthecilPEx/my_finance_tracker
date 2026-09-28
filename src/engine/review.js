// "Needs your attention": questions only you can answer, gathered in one place on the dashboard.
//  - transfers between your own accounts (so they aren't counted as money in/out)
//  - money in that Pulse can't place (income? refund? a split being paid back?)
//  - spending it couldn't categorise
//  - split bills whose repayment is overdue
import { addDays, daysBetween } from './dates.js';
import { categoryMap } from './categories.js';
import { openSplits } from './split.js';
import { round2 } from './money.js';

const TRANSFER_WORDS = /\b(transfer|tfr|trf|to savings|from savings|own account|internal|pot|between accounts|faster payment from|fps from|moved from|moved to)\b/i;

export function reviewQueue(state, today, { days = 45, limit = 12 } = {}) {
  const cats = categoryMap(state.categories);
  const dismissed = new Set(state.reviewDismissed || []);
  const since = addDays(today, -days);
  const recent = state.transactions.filter((t) => t.date >= since && t.date <= today && !t.reviewed);
  const items = [];
  const used = new Set();

  // 1) Transfer pairs: same amount out of one of your accounts and into another within 3 days.
  const outs = recent.filter((t) => t.amount < 0 && t.categoryId !== 'transfer');
  const ins = recent.filter((t) => t.amount > 0 && t.categoryId !== 'transfer' && t.categoryId !== 'split_back');
  for (const o of outs) {
    const match = ins.find((i) => !used.has(i.id) && i.account && o.account && i.account !== o.account && Math.abs(i.amount + o.amount) < 0.005 && Math.abs(daysBetween(o.date, i.date)) <= 3);
    if (!match) continue;
    const key = `transfer:${o.id}:${match.id}`;
    if (dismissed.has(key)) continue;
    used.add(match.id); used.add(o.id);
    items.push({ key, kind: 'transfer', icon: '🔁', txnIds: [o.id, match.id], amount: -o.amount, date: match.date,
      title: `Transfer between your accounts?`, detail: `${o.account} → ${match.account} on ${match.date}. If yes, it won't count as money in or spending.` });
  }

  // 2) Money in that isn't pay and hasn't been placed.
  const splits = openSplits(state, today).filter((s) => s.outstanding > 0.005);
  for (const t of ins) {
    if (used.has(t.id) || cats[t.categoryId]?.id !== 'income_other') continue;
    const key = `in:${t.id}`;
    if (dismissed.has(key)) continue;
    const looksTransfer = TRANSFER_WORDS.test(t.description) || (state.profile?.name && t.description.toLowerCase().includes(state.profile.name.toLowerCase()));
    items.push({ key, kind: 'money-in', icon: '💷', txnIds: [t.id], amount: t.amount, date: t.date, suggestTransfer: looksTransfer, canSplit: splits.length > 0,
      title: `What's this money in?`, detail: `${t.description} · ${t.date}${looksTransfer ? ' · looks like a transfer' : splits.length ? ' · could be a split repayment' : ''}` });
  }

  // 3) Spending Pulse couldn't categorise.
  for (const t of recent) {
    if (t.amount >= 0 || t.categoryId !== 'other' || -t.amount < 5 || used.has(t.id)) continue;
    const key = `cat:${t.id}`;
    if (dismissed.has(key)) continue;
    items.push({ key, kind: 'categorise', icon: '🏷️', txnIds: [t.id], amount: -t.amount, date: t.date, title: 'Which category is this?', detail: `${t.description} · ${t.date}` });
  }

  // 4) Split bills overdue for repayment.
  for (const s of splits.filter((x) => x.overdue)) {
    const key = `split:${s.txn.id}:${s.txn.split.expectedBy}`;
    if (dismissed.has(key)) continue;
    items.push({ key, kind: 'split-overdue', icon: '🤝', txnIds: [s.txn.id], amount: round2(s.outstanding), date: s.txn.date,
      title: `${s.txn.split.who || 'Someone'} still owes you`, detail: `For ${s.txn.description} on ${s.txn.date}. Expected by ${s.txn.split.expectedBy}.${s.txn.split.trackedElsewhere ? '' : ' Not on Splitwise yet.'}` });
  }

  items.sort((a, b) => b.date.localeCompare(a.date));
  return { items: items.slice(0, limit), total: items.length };
}
