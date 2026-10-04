import { todayISO } from '../src/engine/dates.js';
import { upcoming } from '../src/engine/summary.js';
import { evaluateCaps } from '../src/engine/caps.js';
import { payPlan } from '../src/engine/planner.js';
import { formatMoney } from '../src/engine/money.js';
import { staleStatements } from '../src/engine/freshness.js';
import { billsNeedingAmounts } from '../src/engine/review.js';

/** Desktop notifications: bills, payday routine, spend caps and bank consent expiry. Each fires once. */
export function startReminders({ getState, notify, sent }) {
  const check = () => {
    const state = getState();
    if (!state.settings.notifications || !state.settings.onboarded) return;
    const today = todayISO();
    const log = sent.get('keys') || {};
    const once = (key, title, body, page) => {
      if (log[key]) return;
      log[key] = today;
      notify(title, body, page);
    };
    const fmt = (n) => formatMoney(n, state.settings.currency);
    const plan = state.settings.billPot?.enabled !== false ? payPlan(state, today, 1) : null;
    for (const e of upcoming(state, today, 1)) {
      if (e.type === 'payday' && e.inDays === 0) {
        const pot = plan?.billsShare ? ` Move ${fmt(e.amount * plan.billsShare)} to your bills pot.` : '';
        once(e.key, `💼 Payday: ${e.name}`, `${fmt(e.amount)} should land today.${pot}`, 'planner');
      }
      if (e.amount < 0 && e.inDays === 1) once(e.key, `Due tomorrow: ${e.name}`, `${fmt(-e.amount)}${e.compulsory ? ' (compulsory)' : ''}. Make sure there's enough in your account.`, 'bills');
    }
    for (const c of evaluateCaps(state, today)) {
      if (c.status === 'ok') continue;
      const key = `cap:${c.cap.id}:${c.status}:${c.window.from}`;
      if (c.status === 'near') once(key, `◐ Nearing your cap: ${c.label}`, `${fmt(c.spent)} of ${fmt(c.cap.amount)} ${c.window.label}. ${fmt(c.remaining)} left for ${c.daysLeft} more day${c.daysLeft === 1 ? '' : 's'}.`, 'budgets');
      else once(key, `⚠ Cap reached: ${c.label}`, `${fmt(c.spent)} spent against a ${fmt(c.cap.amount)} cap ${c.window.label}.`, 'budgets');
    }
    const exp = state.settings.bank?.expires;
    if (state.settings.bank?.connected && exp && exp - Date.now() < 7 * 86400000) {
      once(`bank-expiry-${exp}`, 'Bank connection expires soon', 'Reconnect in Bank Sync to keep transactions flowing in automatically.', 'connect');
    }
    for (const o of billsNeedingAmounts(state, today)) {
      const card = o.source === 'debt';
      once(`amount:${o.key}`, card ? `💳 ${o.name} statement is out` : `🧾 Is your ${o.name} bill out?`, `Due ${o.date}. Pulse is planning ≈ ${fmt(-o.amount)}. Enter the real amount under "Needs your attention" so your plan stays accurate.`, 'dashboard');
    }
    const mz = state.settings.monzo;
    if (mz?.connected && mz.approvedAt && !mz.needsReconnect) {
      const left = 90 - Math.floor((Date.now() - Date.parse(mz.approvedAt)) / 86400000);
      if (left <= 7 && left >= 0) once(`monzo-renew-${mz.approvedAt}`, 'Monzo access renews soon', `Monzo asks you to re-approve Pulse every 90 days (${left} day${left === 1 ? '' : 's'} left). Open Bank Sync → Monzo → Reconnect.`, 'connect');
    }
    for (const s of staleStatements(state, today)) {
      // Once per bank per week of staleness.
      once(`stale:${s.bank}:${Math.floor(s.days / 7)}`, `📄 Time for a new ${s.name} statement`, `Last imported ${s.days} days ago. ${s.howTo}`, 'connect');
    }
    for (const [k, d] of Object.entries(log)) if ((Date.parse(today) - Date.parse(d)) / 86400000 > 60) delete log[k];
    sent.set('keys', log);
  };
  setTimeout(check, 10_000);
  const timer = setInterval(check, 30 * 60 * 1000);
  return { timer, check };
}
