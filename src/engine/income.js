// The user's pay profile -> expected paydays. Income sources live in state.profile.incomes and
// are turned into schedule items on the fly, so editing pay in Settings instantly updates the
// calendar, the planner and every forecast.
import { addDays, parseISO, toISO, todayISO } from './dates.js';
import { plannedNetPerPay, takeHome, PERIODS_PER_YEAR } from './payroll.js';
import { round2 } from './money.js';

export const PAY_PATTERNS = {
  monthly: 'Monthly on a set date',
  'last-working-day': 'Last working day of the month',
  'last-weekday': 'Last (e.g. Friday) of the month',
  weekly: 'Weekly',
  fortnightly: 'Every 2 weeks',
  'four-weekly': 'Every 4 weeks',
  irregular: 'Irregular / varies',
};

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function newIncome(overrides = {}) {
  return {
    id: `inc-${Math.random().toString(36).slice(2, 9)}`,
    name: 'Main job',
    employer: '',
    payType: 'salary',
    annual: '',
    hourlyRate: '',
    hoursPerWeek: '',
    netPerPay: '',
    variable: false,
    lowestNet: '',
    taxCode: '1257L',
    pensionPct: 5,
    pensionType: 'net-pay',
    studentLoans: [],
    deductions: [],
    schedule: { frequency: 'monthly', dayOfMonth: 25, weekday: 5, anchorDate: '', adjust: 'previous-working' },
    irregularDates: [],
    ...overrides,
  };
}

/** A date that falls on the given weekday (on or after `from`). */
export function nextWeekday(weekday, from = todayISO()) {
  const d = parseISO(from);
  d.setDate(d.getDate() + ((weekday - d.getDay() + 7) % 7));
  return toISO(d);
}

/** Schedule items (same shape as recurring bills) for every income source in the profile. */
export function incomeItems(state) {
  const profile = state.profile;
  if (!profile?.incomes?.length) return [];
  const region = profile.region || 'ruk';
  const items = [];
  for (const inc of profile.incomes) {
    if (inc.active === false) continue;
    const s = inc.schedule || {};
    const base = {
      id: `income:${inc.id}`,
      incomeId: inc.id,
      name: inc.name || 'Pay',
      match: (inc.employer || inc.name || 'salary').toLowerCase(),
      direction: 'in',
      kind: 'salary',
      categoryId: 'salary',
      amount: round2(plannedNetPerPay(inc, region)),
      adjust: s.adjust || 'none',
      active: true,
    };
    if (s.frequency === 'irregular') {
      for (const p of inc.irregularDates || []) {
        if (p.date) items.push({ ...base, id: `income:${inc.id}:${p.date}`, frequency: 'once', startDate: p.date, amount: round2(+p.amount || base.amount), adjust: 'none' });
      }
      continue;
    }
    const anchor = s.anchorDate || (s.frequency === 'weekly' ? nextWeekday(s.weekday ?? 5, '2020-01-01') : '2020-01-01');
    items.push({
      ...base,
      frequency: s.frequency || 'monthly',
      dayOfMonth: +s.dayOfMonth || 25,
      weekday: s.weekday ?? 5,
      startDate: ['weekly', 'fortnightly', 'four-weekly'].includes(s.frequency) ? anchor : '2020-01-01',
    });
  }
  return items;
}

/** Profile-level summary: take-home per source, per month and per year. */
export function profileSummary(state) {
  const region = state.profile?.region || 'ruk';
  const sources = (state.profile?.incomes || []).filter((i) => i.active !== false).map((inc) => {
    const th = takeHome(inc, region);
    const periods = paysPerYear(inc);
    const planned = plannedNetPerPay(inc, region);
    return { inc, th, periods, plannedPerPay: planned, monthly: round2((planned * periods) / 12) };
  });
  const monthly = round2(sources.reduce((s, x) => s + x.monthly, 0));
  return { sources, monthly, annual: round2(monthly * 12), variable: sources.some((s) => s.inc.variable || s.inc.schedule?.frequency === 'irregular') };
}

export function paysPerYear(inc) {
  if (inc.schedule?.frequency === 'irregular') return 12 * (+inc.paymentsPerMonth || 1);
  return PERIODS_PER_YEAR[inc.schedule?.frequency] || 12;
}

export function describeSchedule(s = {}) {
  const wd = WEEKDAYS[s.weekday ?? 5];
  switch (s.frequency) {
    case 'monthly': return `Monthly on the ${s.dayOfMonth}${suffix(s.dayOfMonth)}${s.adjust === 'previous-working' ? ' (earlier if weekend/holiday)' : ''}`;
    case 'last-working-day': return 'Last working day of each month';
    case 'last-weekday': return `Last ${wd} of each month`;
    case 'weekly': return `Every ${wd}`;
    case 'fortnightly': return `Every other ${wd}`;
    case 'four-weekly': return `Every 4 weeks`;
    case 'irregular': return 'Irregular paydays';
    default: return '';
  }
}

function suffix(n) {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th';
}

export { addDays };
