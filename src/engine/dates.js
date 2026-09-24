// Date helpers. All dates in the app are stored as local ISO strings 'YYYY-MM-DD'
// so they never shift with time zones or DST.

const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISO(s) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO() {
  return toISO(new Date());
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function addMonths(iso, n) {
  const d = parseISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  return toISO(d);
}

export function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 86400000);
}

/** month is 0-based */
export function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

export function monthKey(iso) {
  return iso.slice(0, 7);
}

export function monthStart(year, month) {
  return toISO(new Date(year, month, 1));
}

export function monthEnd(year, month) {
  return toISO(new Date(year, month, daysInMonth(year, month)));
}

/** Returns [{year, month, key}] for the n months ending with (year, month), oldest first. */
export function lastMonths(year, month, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(year, month - i, 1);
    out.push({ year: d.getFullYear(), month: d.getMonth(), key: toISO(d).slice(0, 7) });
  }
  return out;
}

export function monthLabel(year, month, style = 'long') {
  return new Date(year, month, 1).toLocaleDateString('en-GB', { month: style, year: 'numeric' });
}

export function shortDate(iso) {
  return parseISO(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function weekdayShort(iso) {
  return parseISO(iso).toLocaleDateString('en-GB', { weekday: 'short' });
}

// England & Wales bank holidays (gov.uk). Used to shift paydays/bills that fall on
// non-working days. Extend via settings.extraHolidays for other regions.
export const UK_BANK_HOLIDAYS = new Set([
  '2025-01-01', '2025-04-18', '2025-04-21', '2025-05-05', '2025-05-26', '2025-08-25', '2025-12-25', '2025-12-26',
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
]);

export function isWorkingDay(iso, holidays = UK_BANK_HOLIDAYS) {
  const dow = parseISO(iso).getDay();
  return dow !== 0 && dow !== 6 && !holidays.has(iso);
}

export function previousWorkingDay(iso, holidays) {
  let d = iso;
  while (!isWorkingDay(d, holidays)) d = addDays(d, -1);
  return d;
}

export function nextWorkingDay(iso, holidays) {
  let d = iso;
  while (!isWorkingDay(d, holidays)) d = addDays(d, 1);
  return d;
}
