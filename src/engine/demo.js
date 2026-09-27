import { addDays, addMonths, parseISO, toISO } from './dates.js';
import { occurrencesBetween } from './recurring.js';
import { createEmptyState, mergeRows, newId } from './state.js';
import { incomeItems, newIncome } from './income.js';
import { suggestTier } from './receipts.js';

// name, typical price, section
const CATALOG = [
  ['Semi Skimmed Milk 4pt', 1.45], ['Wholemeal Bread', 0.95], ['Free Range Eggs x12', 2.49], ['Basmati Rice 1kg', 1.89], ['Chicken Breast Fillets', 3.49],
  ['Bananas', 0.85], ['Apples 6pk', 1.39], ['Potatoes 2kg', 1.25], ['Onions 1kg', 0.89], ['Cheddar Cheese', 2.79], ['Greek Yoghurt', 1.65], ['Pasta 500g', 0.75],
  ['Chopped Tomatoes', 0.45], ['Broccoli', 0.69], ['Porridge Oats', 0.99], ['Toilet Roll 9pk', 3.99], ['Washing Up Liquid', 1.19], ['Toothpaste', 1.49],
  ['Orange Juice', 1.69], ['Coffee Pods', 3.49], ['Ready Meal Lasagne', 3.25], ['Houmous', 1.15], ['Frozen Pizza', 2.49], ['Granola', 2.29], ['Sparkling Water', 0.89],
  ['Salted Crisps 6pk', 1.29], ['Milk Chocolate Bar', 0.99], ['Prosecco 75cl', 5.49], ['Lager 4pk', 4.75], ['Ice Cream Tub', 2.99], ['Chocolate Biscuits', 1.49], ['Haribo Starmix', 1.25], ['Energy Drink', 1.35],
];

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
  state.profile = {
    name: 'Sam',
    region: 'ruk',
    incomes: [
      newIncome({ id: 'inc-main', name: 'Acme Ltd salary', employer: 'acme', payType: 'salary', annual: 54000, pensionPct: 5, schedule: { frequency: 'monthly', dayOfMonth: 25, weekday: 5, adjust: 'previous-working' } }),
      newIncome({ id: 'inc-bar', name: 'Weekend bar shifts', employer: 'crown', payType: 'hourly', hourlyRate: 12.6, hoursPerWeek: 10, taxCode: 'BR', pensionPct: 0, variable: true, lowestNet: 85, schedule: { frequency: 'weekly', weekday: 5, adjust: 'none' } }),
    ],
  };
  state.settings.demo = true;
  const setBudget = { groceries: 380, eating_out: 150, coffee: 45, shopping: 200, transport: 180, entertainment: 60 };
  state.categories = state.categories.map((c) => (setBudget[c.id] ? { ...c, budget: setBudget[c.id] } : c));

  const rec = (o) => ({ id: newId(), active: true, adjust: 'none', startDate: start, frequency: 'monthly', ...o });
  state.recurring = [
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
    { id: newId(), name: 'HDFC home loan (India)', type: 'mortgage', lender: 'HDFC', match: 'hdfc', currency: 'INR', balance: 1850000, originalBalance: 2500000, apr: 8.75, minPayment: 25000, dueDay: 5 },
    { id: newId(), name: 'Klarna – sofa', type: 'bnpl', lender: 'Klarna', match: 'klarna', balance: 180, originalBalance: 360, apr: 0, minPayment: 60, dueDay: 9 },
  ];

  const rows = [];
  const add = (date, amount, description, account = 'Barclays Current') => { if (date <= today) rows.push({ date, amount, description, account }); };
  const descFor = {
    openrent: 'OPENRENT RENT SO', 'council tax': 'LB CAMDEN COUNCIL TAX DD', octopus: 'OCTOPUS ENERGY DD',
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
  for (const inc of incomeItems(state)) {
    for (const d of occurrencesBetween(inc, start, today)) {
      add(d, inc.match === 'acme' ? inc.amount : between(85, 135), inc.match === 'acme' ? 'ACME LTD SALARY BGC' : 'THE CROWN PUB PAYROLL');
    }
  }
  for (const debt of state.debts) {
    for (const d of occurrencesBetween({ frequency: 'monthly', dayOfMonth: debt.dueDay, startDate: start }, start, today)) {
      // An EMI paid abroad leaves the UK account in pounds, at that day's rate plus a transfer fee.
      if (debt.currency === 'INR') add(d, -(Math.round((debt.minPayment / between(111, 115) + 1.2) * 100) / 100), 'WISE HDFC HOME LOAN EMI');
      else add(d, -debt.minPayment, `${debt.lender.toUpperCase()} PAYMENT`);
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
  // A shared house shop (split with flatmates), a partial repayment and a transfer between own accounts.
  add(addDays(today, -9), -96.4, 'TESCO EXTRA WEMBLEY');
  add(addDays(today, -3), 32.13, 'J PATEL');
  add(addDays(today, -6), -250, 'MONZO S KHAN');
  add(addDays(today, -6), 250, 'BARCLAYS S KHAN', 'Monzo');
  // A big one-off this month so the "unusual purchase" insight has something to show.
  add(addDays(monthStartOfToday, 2), -449, 'CURRYS PC WORLD');
  let out = mergeRows(state, rows, 'demo').state;

  // Itemise most past grocery shops so basket trends have history; leave recent ones in the inbox.
  const receipts = [];
  for (const t of out.transactions) {
    if (t.categoryId !== 'groceries' || t.date > addDays(today, -6) || r() < 0.25) continue;
    const thisMonth = t.date >= monthStartOfToday;
    const items = [];
    let left = -t.amount;
    let guard = 0;
    while (left > 1 && guard++ < 40) {
      const pool = thisMonth && r() < 0.2 ? CATALOG.slice(25) : CATALOG.slice(0, r() < 0.8 ? 25 : CATALOG.length);
      const [name, price] = pick(pool);
      const p = Math.min(left, Math.round(price * (0.9 + r() * 0.3) * 100) / 100);
      items.push({ id: newId(), name, qty: 1, price: p, tier: suggestTier(name), section: 'groceries' });
      left = Math.round((left - p) * 100) / 100;
    }
    if (left > 0 && items.length) items[items.length - 1].price = Math.round((items[items.length - 1].price + left) * 100) / 100;
    receipts.push({ id: newId(), txnId: t.id, date: t.date, merchant: t.description, total: -t.amount, section: 'groceries', items, createdAt: t.date });
  }
  // Itemise some takeaways too so the Food section has history.
  const FOOD = [['Chicken Burger Meal', 9.5], ['Large Fries', 3.2], ['Soft Drink', 2.4], ['Dessert', 4.5], ['Delivery Fee', 2.99], ['Curry', 11.5], ['Naan', 3.2], ['Rice', 3.5]];
  for (const t of out.transactions) {
    if (t.categoryId !== 'eating_out' || t.date > addDays(today, -6) || r() < 0.5) continue;
    const items = [];
    let left = -t.amount;
    while (left > 1) {
      const [name, price] = pick(FOOD);
      const p = Math.min(left, price);
      items.push({ id: newId(), name, qty: 1, price: p, tier: /dessert|drink|fries|fee/i.test(name) ? 'low' : 'moderate', section: 'food' });
      left = Math.round((left - p) * 100) / 100;
    }
    if (left > 0 && items.length) items[items.length - 1].price = Math.round((items[items.length - 1].price + left) * 100) / 100;
    receipts.push({ id: newId(), txnId: t.id, date: t.date, merchant: t.description, total: -t.amount, section: 'food', items, createdAt: t.date });
  }
  out = { ...out, receipts };
  // Demo exchange rates (the desktop app replaces these with live rates on launch).
  const monthAgo = addDays(today, -30);
  out.fx = { base: 'GBP', date: today, rates: { INR: 112.35, EUR: 1.168, USD: 1.342, AED: 4.93, PKR: 377.1 }, source: 'demo rates', fetchedAt: null, history: { [monthAgo]: { INR: 114.2 }, [today]: { INR: 112.35 } } };
  out.settings = { ...out.settings, watchCurrencies: ['INR', 'EUR', 'USD'] };
  const shop = out.transactions.find((t) => t.description === 'TESCO EXTRA WEMBLEY');
  if (shop) shop.split = { owed: 64.27, who: 'Flatmates (Jay & Sara)', expectedBy: addDays(today, -2), trackedElsewhere: true, note: 'House shop, split 3 ways' };
  out.caps = [
    { id: newId(), name: 'Treats in the weekly shop', scope: 'tier', tier: 'low', section: 'groceries', amount: 30, period: 'month', alertAt: 0.8, active: true },
    { id: newId(), name: 'Coffee runs', scope: 'category', categoryId: 'coffee', amount: 15, period: 'week', alertAt: 0.8, active: true },
    { id: newId(), name: 'Eating out this pay period', scope: 'category', categoryId: 'eating_out', amount: 300, period: 'payperiod', alertAt: 0.8, active: true },
  ];
  out.goals = [
    { id: newId(), name: 'Emergency fund', icon: '🛟', target: 2000, saved: 650, perMonth: 150, targetDate: addMonths(today, 9), active: true },
    { id: newId(), name: 'Summer holiday', icon: '🏖️', target: 1200, saved: 300, perMonth: 100, targetDate: addMonths(today, 9), active: true },
  ];
  return out;
}
