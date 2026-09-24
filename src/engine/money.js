export const CURRENCIES = {
  GBP: { symbol: '£', locale: 'en-GB' },
  EUR: { symbol: '€', locale: 'en-IE' },
};

export function formatMoney(amount, currency = 'GBP', { sign = false, decimals } = {}) {
  const cfg = CURRENCIES[currency] || CURRENCIES.GBP;
  const abs = Math.abs(amount || 0);
  const digits = decimals ?? (abs >= 1000 ? 0 : 2);
  const body = new Intl.NumberFormat(cfg.locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(abs);
  if (amount < 0) return `−${body}`;
  if (sign && amount > 0) return `+${body}`;
  return body;
}

export const round2 = (n) => Math.round(n * 100) / 100;

export function sum(list, fn = (x) => x) {
  return list.reduce((acc, x) => acc + fn(x), 0);
}

export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
