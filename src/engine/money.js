// Currencies offered in pickers. Any ISO 4217 code also formats correctly via Intl.
export const CURRENCIES = {
  GBP: { symbol: '£', name: 'British pound' },
  EUR: { symbol: '€', name: 'Euro' },
  INR: { symbol: '₹', name: 'Indian rupee' },
  USD: { symbol: '$', name: 'US dollar' },
  AED: { symbol: 'د.إ', name: 'UAE dirham' },
  AUD: { symbol: 'A$', name: 'Australian dollar' },
  CAD: { symbol: 'C$', name: 'Canadian dollar' },
  CHF: { symbol: 'CHF', name: 'Swiss franc' },
  PLN: { symbol: 'zł', name: 'Polish złoty' },
  PKR: { symbol: 'Rs', name: 'Pakistani rupee' },
  BDT: { symbol: '৳', name: 'Bangladeshi taka' },
  LKR: { symbol: 'Rs', name: 'Sri Lankan rupee' },
  NGN: { symbol: '₦', name: 'Nigerian naira' },
  PHP: { symbol: '₱', name: 'Philippine peso' },
  SGD: { symbol: 'S$', name: 'Singapore dollar' },
  ZAR: { symbol: 'R', name: 'South African rand' },
};

export function formatMoney(amount, currency = 'GBP', { sign = false, decimals } = {}) {
  const abs = Math.abs(amount || 0);
  const digits = decimals ?? (abs >= 1000 || Number.isInteger(Math.round(abs * 100) / 100) ? 0 : 2);
  let body;
  try {
    body = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-GB', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(abs);
  } catch {
    body = `${currency} ${abs.toFixed(digits)}`;
  }
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
