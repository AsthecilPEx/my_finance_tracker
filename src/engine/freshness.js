import { BANK_FORMATS } from './csv.js';
import { daysBetween } from './dates.js';

/**
 * Banks whose statements are imported by hand (CSV / watched folder) and are getting stale.
 * A bank counts once it has been imported at least once; it's stale after `settings.statementReminderDays`
 * days (default 7). Monzo is skipped while it's connected live.
 */
export function staleStatements(state, today) {
  const every = Number(state.settings?.statementReminderDays ?? 7);
  if (!every || every <= 0) return [];
  const out = [];
  for (const [bank, info] of Object.entries(state.bankImports || {})) {
    if (bank === 'monzo' && state.settings?.monzo?.connected) continue;
    const days = daysBetween(info.at.slice(0, 10), today);
    if (days < every) continue;
    out.push({ bank, name: BANK_FORMATS[bank]?.name || bank, days, latest: info.latest, howTo: BANK_FORMATS[bank]?.howTo || '' });
  }
  return out.sort((a, b) => b.days - a.days);
}
