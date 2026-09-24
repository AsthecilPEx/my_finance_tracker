import { addDays, addMonths, parseISO, toISO } from './dates.js';
import { occurrencesBetween } from './recurring.js';
import { createEmptyState, mergeRows, newId } from './state.js';

function rng(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A realistic UK profile with ~5 months of history so every screen has something to show. */
export function createDemoState(today) {
  const r = rng(42);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const between = (lo, hi) => Math.round((lo + r() * (hi - lo)) * 100) / 100;
  const start = toISO(new Date(parseISO(today).getFullYear(), parseISO(today).getMonth() - 5, 1));

  const state = createEmptyState();
  state.settings.onboarded = true;
  state.settings.name = 'Demo';
  state.settings.demo = true;
  const setBudget = { groceries: 380, eating_out: 150, coffee: 45, shopping: 200, transport: 180, entertainment: 60 };
  state.categories = state.categories.map((c) => (setBudget[c.id] ? { ...c, budget: setBudget[c.id] } : c));

  const rec = (o) => ({ id: newId(), active: true, adjust: 'none', startDate: start, frequency: 'monthly', ...o });
  state.recurring = [
    rec({ name: 'Salary – Acme Ltd', match: 'acme', amount: 3450, direction: 'in', kind: 'salary', categoryId: 'salary', dayOfMonth: 25, adjust: 'previous-working' }),
    rec({ name: 'Rent', match: 'openrent', amount: 1050, direction: 'out', kind: 'bill', categoryId: 'housing', dayOfMonth: 1, compulsory: true }),
    rec({ name: 'Council Tax', match: 'council tax', amount: 148, direction: 'out', kind: 'bill', categoryId: 'utilities', dayOfMonth: 1, compulsory: true }),
    rec({ name: 'Octopus Energy', match: 'octopus', amount: 96, direction: 'out', kind: 'bill', categoryId: 'utilities', dayOfMonth: 5, compulsory: true }),
    rec({ name: 'Admiral Car Insurance', match: 'admiral', amount: 58, direction: 'out', kind: 'bill', categoryId: 'insurance', dayOfMonth: 10, compulsory: true }),
    rec({ name: 'Thames Water', match: 'thames water', amount: 38, direction: 'out', kind: 'bill', categoryId: 'utilities', dayOfMonth: 12, compulsory: true }),
    rec({ name: 'Vodafone', match: 'vodafone', amount: 22, direction: 'out', kind: 'bill', categoryId: 'utilities', dayOfMonth: 18, compulsory: true }),
    rec({ name: 'Virgin Media Broadband', match: 'virgin media', amount: 45, direction: 'out', kind: 'bill', categoryId: 'utilities', dayOfMonth: 20, compulsory: true }),
    rec({ name: 'PureGym', match: 'puregym', amount: 27.99, direction: 'out', kind: 'subscription', categoryId: 'health', dayOfMonth: 3, compulsory: false }),
    rec({ name: 'Netflix', match: 'netflix', amount: 10.99, direction: 'out', kind: 'subscription', categoryId: 'subscriptions', dayOfMonth: 8, compulsory: false }),
    rec({ name: 'Spotify', match: 'spotify', amount: 11.99, direction: 'out', kind: 'subscription', categoryId: 'subscriptions', dayOfMonth: 14, compulsory: false }),
    rec({ name: 'Disney+', match: 'disney', amount: 7.99, direction: 'out', kind: 'subscription', categoryId: 'subscriptions', dayOfMonth: 22, compulsory: false }),
    rec({ name: 'Moneybox savings', match: 'moneybox', amount: 200, direction: 'out', kind: 'savings', categoryId: 'savings', dayOfMonth: 26, compulsory: false }),
  ];
  state.debts = [
    { id: newId(), name: 'Barclaycard', type: 'credit-card', lender: 'Barclaycard', match: 'barclaycard', balance: 2340, originalBalance: 3100, apr: 24.9, minPayment: 70, dueDay: 15 },
    { id: newId(), name: 'Car finance', type: 'car-finance', lender: 'Black Horse', match: 'black horse', balance: 6800, originalBalance: 11500, apr: 7.9, minPayment: 245, dueDay: 28 },
    { id: newId(), name: 'Klarna – sofa', type: 'bnpl', lender: 'Klarna', match: 'klarna', balance: 180, originalBalance: 360, apr: 0, minPayment: 60, dueDay: 9 },
  ];

  const rows = [];
  const add = (date, amount, description) => { if (date <= today) rows.push({ date, amount, description }); };
  const descFor = {
    acme: 'ACME LTD SALARY BGC', openrent: 'OPENRENT RENT SO', 'council tax': 'LB CAMDEN COUNCIL TAX DD', octopus: 'OCTOPUS ENERGY DD',
    admiral: 'ADMIRAL INSURANCE DD', 'thames water': 'THAMES WATER DD', vodafone: 'VODAFONE LTD DD', 'virgin media': 'VIRGIN MEDIA DD',
    puregym: 'PUREGYM LTD', netflix: 'NETFLIX.COM', spotify: 'SPOTIFY UK', disney: 'DISNEY PLUS', moneybox: 'MONEYBOX SAVINGS',
  };
  for (const item of state.recurring) {
    for (const d of occurrencesBetween(item, start, today)) {
      let amt = item.amount;
      if (item.match === 'spotify' && d < addMonths(today, -1)) amt = 10.99; // price rise
      if (item.match === 'octopus') amt = between(88, 104);
      add(d, item.direction === 'in' ? amt : -amt, descFor[item.match]);
    }
  }
  for (const debt of state.debts) {
    for (const d of occurrencesBetween({ frequency: 'monthly', dayOfMonth: debt.dueDay, startDate: start }, start, today)) {
      add(d, -debt.minPayment, `${debt.lender.toUpperCase()} PAYMENT`);
    }
  }

  const monthStartOfToday = today.slice(0, 8) + '01';
  const paydays = new Set(rows.filter((x) => x.description.includes('SALARY')).map((x) => x.date));
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const dow = parseISO(d).getDay();
    const thisMonth = d >= monthStartOfToday;
    const afterPayday = [0, 1, 2].some((i) => paydays.has(addDays(d, -i)));
    if (dow === 6 || (dow === 3 && r() < 0.7)) add(d, -between(32, 88), pick(['TESCO STORES 2841', 'SAINSBURYS S/MKTS', 'ALDI 71', 'LIDL GB LONDON', 'M&S SIMPLY FOOD']));
    if (dow >= 1 && dow <= 5 && r() < (thisMonth ? 0.75 : 0.45)) add(d, -between(2.9, 5.6), pick(['COSTA COFFEE', 'PRET A MANGER', 'CAFFE NERO']));
    if (dow >= 1 && dow <= 5 && r() < 0.55) add(d, -between(2.8, 8.5), 'TFL TRAVEL CH');
    if (r() < (thisMonth ? 0.22 : 0.12) || (afterPayday && r() < 0.8)) add(d, -between(14, 42), pick(['DELIVEROO', 'NANDOS CAMDEN', 'UBER EATS', 'WAGAMAMA', 'DISHOOM']));
    if (r() < 0.06) add(d, -between(12, 70), pick(['AMAZON.CO.UK', 'AMZN MKTP UK', 'ASOS.COM', 'PRIMARK', 'ARGOS']));
    if (r() < 0.07) add(d, -between(6, 22), 'BOOTS 1142');
    if (dow === 0 && r() < 0.5) add(d, -between(48, 62), pick(['SHELL CAMDEN', 'BP CONNECT', 'ESSO']));
    if (r() < 0.035) add(d, -between(11, 28), pick(['ODEON CINEMAS', 'VUE CINEMA', 'TICKETMASTER']));
  }
  // A big one-off this month so the "unusual purchase" insight has something to show.
  add(addDays(monthStartOfToday, 2), -449, 'CURRYS PC WORLD');
  return mergeRows(state, rows, 'demo').state;
}
