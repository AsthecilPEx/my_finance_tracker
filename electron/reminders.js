import { todayISO } from '../src/engine/dates.js';
import { upcoming } from '../src/engine/summary.js';
import { formatMoney } from '../src/engine/money.js';

/** Desktop notifications: bills due tomorrow, payday, and Open Banking consent about to expire. */
export function startReminders({ getState, notify, sent }) {
  const check = () => {
    const state = getState();
    if (!state.settings.notifications || !state.settings.onboarded) return;
    const today = todayISO();
    const log = sent.get('keys') || {};
    const once = (key, title, body) => {
      if (log[key]) return;
      log[key] = today;
      notify(title, body);
    };
    const fmt = (n) => formatMoney(n, state.settings.currency);
    for (const e of upcoming(state, today, 1)) {
      if (e.type === 'payday' && e.inDays === 0) once(`${e.key}`, '💼 It\'s payday!', `${e.name}: ${fmt(e.amount)} is due in today.`);
      if (e.amount < 0 && e.inDays === 1) once(`${e.key}`, `Due tomorrow: ${e.name}`, `${fmt(-e.amount)}${e.compulsory ? ' (compulsory)' : ''}. Make sure there's enough in your account.`);
    }
    const exp = state.settings.bank?.expires;
    if (state.settings.bank?.connected && exp && exp - Date.now() < 7 * 86400000) {
      once(`bank-expiry-${exp}`, 'Bank connection expires soon', 'Reconnect in Import & Sync to keep transactions flowing in automatically.');
    }
    // Forget entries older than ~60 days.
    for (const [k, d] of Object.entries(log)) if ((Date.parse(today) - Date.parse(d)) / 86400000 > 60) delete log[k];
    sent.set('keys', log);
  };
  setTimeout(check, 10_000);
  return setInterval(check, 30 * 60 * 1000);
}
