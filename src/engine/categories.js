// Category palette: validated for CVD separation and contrast on the dark surface.
export const PALETTE = ['#3a86ee', '#ee6428', '#12a578', '#c08800', '#e8558f', '#35a835', '#8f7cf0', '#ec4f4f'];

// type: essential   -> compulsory living cost (counts as "must pay")
//       lifestyle   -> discretionary, where cutting back is possible
//       debt        -> loan / card repayments
//       savings     -> money moved to savings/investments
//       transfer    -> movements between own accounts (excluded from spending)
//       income
export const DEFAULT_CATEGORIES = [
  { id: 'housing', name: 'Housing', icon: '🏠', color: PALETTE[0], type: 'essential', budget: 0 },
  { id: 'utilities', name: 'Bills & Utilities', icon: '💡', color: PALETTE[3], type: 'essential', budget: 0 },
  { id: 'groceries', name: 'Groceries', icon: '🛒', color: PALETTE[2], type: 'essential', budget: 0 },
  { id: 'transport', name: 'Transport', icon: '🚆', color: PALETTE[6], type: 'essential', budget: 0 },
  { id: 'insurance', name: 'Insurance', icon: '🛡️', color: PALETTE[5], type: 'essential', budget: 0 },
  { id: 'health', name: 'Health & Fitness', icon: '💪', color: PALETTE[5], type: 'lifestyle', budget: 0 },
  { id: 'eating_out', name: 'Eating Out', icon: '🍔', color: PALETTE[1], type: 'lifestyle', budget: 0 },
  { id: 'coffee', name: 'Coffee & Snacks', icon: '☕', color: PALETTE[3], type: 'lifestyle', budget: 0 },
  { id: 'shopping', name: 'Shopping', icon: '🛍️', color: PALETTE[4], type: 'lifestyle', budget: 0 },
  { id: 'subscriptions', name: 'Subscriptions', icon: '📺', color: PALETTE[6], type: 'lifestyle', budget: 0 },
  { id: 'entertainment', name: 'Entertainment', icon: '🎟️', color: PALETTE[7], type: 'lifestyle', budget: 0 },
  { id: 'personal', name: 'Personal Care', icon: '💇', color: PALETTE[4], type: 'lifestyle', budget: 0 },
  { id: 'travel', name: 'Travel & Holidays', icon: '✈️', color: PALETTE[0], type: 'lifestyle', budget: 0 },
  { id: 'gifts', name: 'Gifts & Charity', icon: '🎁', color: PALETTE[7], type: 'lifestyle', budget: 0 },
  { id: 'education', name: 'Education', icon: '📚', color: PALETTE[2], type: 'essential', budget: 0 },
  { id: 'debt', name: 'Debt Repayments', icon: '💳', color: PALETTE[7], type: 'debt', budget: 0 },
  { id: 'savings', name: 'Savings & Investing', icon: '🏦', color: PALETTE[5], type: 'savings', budget: 0 },
  { id: 'cash', name: 'Cash Withdrawals', icon: '💷', color: PALETTE[3], type: 'lifestyle', budget: 0 },
  { id: 'other', name: 'Other', icon: '📦', color: '#8a8a94', type: 'lifestyle', budget: 0 },
  { id: 'transfer', name: 'Transfers', icon: '🔁', color: '#8a8a94', type: 'transfer', budget: 0 },
  { id: 'salary', name: 'Salary', icon: '💼', color: PALETTE[2], type: 'income', budget: 0 },
  { id: 'income_other', name: 'Other Income', icon: '💰', color: PALETTE[2], type: 'income', budget: 0 },
];

// Keyword rules for common UK / EU merchants. Order matters: first match wins.
export const KEYWORD_RULES = [
  ['salary', ['salary', 'payroll', 'wages', 'bacs credit', ' pay ', 'hmrc paye']],
  ['income_other', ['refund', 'cashback', 'interest paid', 'dividend', 'hmrc', 'tax rebate']],
  ['transfer', ['transfer to', 'transfer from', 'to pot', 'from pot', 'savings pot', 'internal transfer', 'own account', 'topup', 'top-up', 'top up']],
  ['savings', ['vanguard', 'trading 212', 'freetrade', 'moneybox', 'chip ', 'plum ', 'isa ', 'premium bonds', 'ns&i', 'nutmeg', 'hl.co.uk', 'hargreaves']],
  ['debt', ['barclaycard', 'amex', 'american express', 'capital one', 'mbna', 'credit card', 'loan repayment', 'black horse', 'klarna', 'clearpay', 'paypal credit', 'student loan', 'zopa', 'finance payment', 'car finance', 'novuna', 'tesco bank']],
  ['housing', ['rent', 'mortgage', 'letting', 'landlord', 'openrent', 'service charge', 'ground rent', 'housing association']],
  ['utilities', ['council tax', 'british gas', 'octopus', 'edf', 'e.on', 'eon next', 'ovo', 'scottish power', 'sse ', 'bulb', 'thames water', 'severn trent', 'anglian water', 'united utilities', 'yorkshire water', 'southern water', 'tv licence', 'tv licensing', 'vodafone', ' ee ', 'ee limited', 'o2 ', 'three.co', 'three uk', 'giffgaff', 'bt group', 'btgroup', 'sky digital', 'sky uk', 'virgin media', 'plusnet', 'talktalk', 'hyperoptic', 'community fibre', 'electric', 'energy']],
  ['insurance', ['insurance', 'aviva', 'admiral', 'direct line', 'churchill', 'axa', 'lv=', 'hastings', 'legal & general', 'vitality', 'bupa', 'petplan']],
  ['groceries', ['tesco', 'sainsbury', 'asda', 'aldi', 'lidl', 'morrisons', 'waitrose', 'co-op', 'coop', 'iceland', 'ocado', 'm&s food', 'm&s simply', 'simply food', 'marks & spencer food', 'marks&spencer', 'spar ', 'farmfoods', 'getir', 'gorillas', 'rewe', 'carrefour', 'albert heijn', 'dunnes', 'supervalu']],
  ['coffee', ['costa', 'starbucks', 'pret', 'caffe nero', 'caffè nero', 'greggs', 'gail', 'coffee', 'cafe', 'café']],
  ['eating_out', ['deliveroo', 'just eat', 'uber eats', 'ubereats', 'mcdonald', 'kfc', 'nando', 'burger king', 'wagamama', 'pizza', 'domino', 'five guys', 'itsu', 'leon ', 'wetherspoon', 'pub', 'restaurant', 'dishoom', 'honest burgers', 'subway', 'tortilla', 'bar ']],
  ['transport', ['tfl', 'transport for london', 'trainline', 'national rail', 'lner', 'avanti', 'gwr', 'southern rail', 'uber', 'bolt', 'addison lee', 'shell', 'bp ', 'esso', 'texaco', 'jet ', 'petrol', 'fuel', 'parking', 'ringgo', 'paybyphone', 'dvla', 'congestion', 'ulez', 'zipcar', 'lime ', 'citymapper', 'national express', 'megabus', 'stagecoach', 'arriva']],
  ['subscriptions', ['netflix', 'spotify', 'disney', 'prime video', 'amazon prime', 'apple.com/bill', 'apple music', 'icloud', 'youtube premium', 'google one', 'google storage', 'now tv', 'nowtv', 'paramount', 'audible', 'kindle unlimited', 'xbox', 'playstation', 'nintendo', 'chatgpt', 'openai', 'adobe', 'microsoft 365', 'dropbox', 'patreon', 'duolingo', 'dazn', 'tidal', 'deezer']],
  ['health', ['puregym', 'pure gym', 'the gym', 'david lloyd', 'nuffield', 'virgin active', 'gym', 'boots', 'superdrug', 'pharmacy', 'dentist', 'optician', 'specsavers', 'physio', 'holland & barrett']],
  ['personal', ['barber', 'hair', 'salon', 'nails', 'beauty', 'spa ']],
  ['entertainment', ['cinema', 'odeon', 'vue ', 'cineworld', 'everyman', 'ticketmaster', 'eventbrite', 'see tickets', 'steam', 'theatre', 'bowling', 'museum']],
  ['travel', ['easyjet', 'ryanair', 'british airways', 'jet2', 'wizz', 'airbnb', 'booking.com', 'expedia', 'hotel', 'premier inn', 'travelodge', 'eurostar', 'hostel']],
  ['education', ['udemy', 'coursera', 'university', 'school', 'tuition', 'course']],
  ['gifts', ['charity', 'donation', 'justgiving', 'gofundme', 'oxfam', 'cancer research', 'moonpig', 'funky pigeon', 'interflora']],
  ['cash', ['cash withdrawal', 'atm', 'cashpoint', 'link atm']],
  ['shopping', ['amazon', 'amzn', 'ebay', 'argos', 'asos', 'zara', 'h&m', 'primark', 'next ', 'john lewis', 'currys', 'ikea', 'tk maxx', 'uniqlo', 'jd sports', 'sports direct', 'boohoo', 'shein', 'vinted', 'etsy', 'apple store', 'b&q', 'screwfix', 'wilko', 'the range', 'dunelm', 'superdry', 'marks & spencer', 'selfridges']],
];

export function normaliseDescription(desc = '') {
  return ` ${String(desc).toLowerCase().replace(/[^\p{L}\p{N}&+.'/=]+/gu, ' ').trim()} `;
}

// Keywords match from the start of a word, so "tfl" matches "TFL TRAVEL" but not "NETFLIX".
const hasKeyword = (text, w) => text.includes(` ${w.trimStart()}`);

/** Strip reference numbers, dates and payment-type noise to get a stable merchant key. */
export function merchantKey(desc = '') {
  let s = String(desc).toLowerCase();
  s = s.replace(/\b(card payment to|card payment|payment to|direct debit to|direct debit|dd|so|bgc|fpi|fpo|pos|vis|visa|contactless|debit card|purchase|faster payment|bill payment to|bill payment|ref:?|reference)\b/g, ' ');
  s = s.replace(/on \d{1,2}(st|nd|rd|th)? \w{3}/g, ' ');
  s = s.replace(/[\d#*/\\.,:;_\-()]+/g, ' ');
  s = s.replace(/\b(gb|gbr|uk|london|ltd|limited|plc|www|com|co)\b/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s.split(' ').slice(0, 3).join(' ') || String(desc).toLowerCase().trim();
}

/**
 * Pick a category for a transaction. User-learned rules (from re-categorising)
 * take priority over the built-in keyword list.
 */
export function categorise(desc, amount, userRules = []) {
  const text = normaliseDescription(desc);
  const key = merchantKey(desc);
  for (const r of userRules) {
    if (r.merchant && r.merchant === key) return r.categoryId;
    if (r.pattern && text.includes(r.pattern.toLowerCase())) return r.categoryId;
  }
  for (const [categoryId, words] of KEYWORD_RULES) {
    const isIncomeCat = categoryId === 'salary' || categoryId === 'income_other';
    if (isIncomeCat && amount < 0) continue;
    if (words.some((w) => hasKeyword(text, w))) return categoryId;
  }
  return amount > 0 ? 'income_other' : 'other';
}

export function categoryMap(categories) {
  return Object.fromEntries(categories.map((c) => [c.id, c]));
}

export const SPENDING_TYPES = new Set(['essential', 'lifestyle', 'debt']);
