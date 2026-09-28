// Calendar event styling. Every type has a colour AND an icon + label, so meaning never relies on colour alone.
export const EVENT_TYPES = {
  payday: { label: 'Payday', icon: '💼', color: '#0ca30c' },
  income: { label: 'Money in', icon: '↓', color: '#12a578' },
  bill: { label: 'Bill', icon: '🧾', color: '#ee6428' },
  subscription: { label: 'Subscription', icon: '↻', color: '#8f7cf0' },
  debt: { label: 'Debt payment', icon: '💳', color: '#e8558f' },
  savings: { label: 'Savings', icon: '🏦', color: '#3a86ee' },
};

export function compactMoney(n, currency = 'GBP') {
  const sym = currency === 'EUR' ? '€' : '£';
  const a = Math.abs(n);
  if (a >= 1000) return `${sym}${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}k`;
  return `${sym}${a >= 100 ? Math.round(a) : a.toFixed(a % 1 ? 2 : 0)}`;
}
