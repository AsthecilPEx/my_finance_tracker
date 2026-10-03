import Papa from 'papaparse';
import { toISO } from './dates.js';

// Column name candidates, in priority order, for the statement formats of
// Monzo, Starling, Revolut, Barclays, HSBC, Lloyds, Halifax, Nationwide,
// Santander, NatWest, Chase UK, Amex UK and most EU banks.
const COLS = {
  date: ['date', 'transaction date', 'completed date', 'booking date', 'posted date', 'posting date', 'value date', 'started date', 'date of transaction', 'buchungstag', 'fecha'],
  description: ['description', 'transaction description', 'name', 'merchant', 'counter party', 'counterparty', 'payee', 'details', 'narrative', 'memo', 'transactions', 'reference', 'beschreibung'],
  amount: ['amount', 'amount (gbp)', 'amount(gbp)', 'amount (eur)', 'value', 'money in/out', 'betrag', 'importe'],
  debit: ['paid out', 'debit', 'debit amount', 'money out', 'withdrawals', 'out', 'spent'],
  credit: ['paid in', 'credit', 'credit amount', 'money in', 'deposits', 'in', 'received'],
};

/**
 * Known UK bank export formats. Each is recognised from its header row (or, for HSBC, its
 * header-less 3-column layout) so imports need no column matching. `row` adjusts a parsed row
 * for bank quirks and may return null to skip it (e.g. Revolut's declined or reverted lines).
 */
export const BANK_FORMATS = {
  lloyds: {
    name: 'Lloyds / Halifax / Bank of Scotland',
    detect: (h) => h.includes('transaction date') && h.includes('transaction description') && h.includes('debit amount') && h.includes('sort code'),
    howTo: 'App or website → your account → "Download transactions" (or "Export") → choose CSV and the date range.',
  },
  hsbc: {
    name: 'HSBC UK',
    // HSBC's CSV has no header row: date, description, signed amount.
    detectRows: (rows) => rows.length > 0 && rows.slice(0, 5).every((r) => r.filter((c) => String(c).trim()).length === 3 && parseStatementDate(r[0]) && parseAmount(r[2]) !== null),
    howTo: 'Online banking (website) → your account → "Download" under the transactions list → choose CSV.',
  },
  barclays: {
    name: 'Barclays',
    detect: (h) => h.includes('memo') && h.includes('subcategory') && h.includes('amount') && h.includes('number'),
    // Memo looks like "TESCO STORES 2041   ON 12 SEP          BCC": keep the payee part.
    row: (row) => ({ ...row, description: cleanBarclaysMemo(row.description) }),
    howTo: 'Online banking (website) → your account → "Export" or "Download transactions" → choose CSV.',
  },
  revolut: {
    name: 'Revolut',
    detect: (h) => h.includes('started date') && h.includes('completed date') && h.includes('state'),
    skip: (get) => String(get('state')).trim().toUpperCase() !== 'COMPLETED', // pending, declined, reverted
    row: (row, get) => {
      const fee = parseAmount(get('fee')) || 0;
      const currency = String(get('currency') || '').trim().toUpperCase();
      return { ...row, amount: Math.round((row.amount - Math.abs(fee)) * 100) / 100, ...(currency ? { currency } : {}), account: `Revolut ${String(get('product') || '').trim()}`.trim() };
    },
    howTo: 'Revolut app → tap your account → ⋯ → "Statement" → choose Excel/CSV and the period → save or share it to your PC.',
  },
  monzo: {
    name: 'Monzo',
    detect: (h) => h.includes('transaction id') && h.includes('emoji') && h.includes('money out'),
    howTo: 'Better: connect Monzo live in Bank Sync. Or: Monzo app → account → "Export transactions" → CSV.',
  },
  starling: {
    name: 'Starling',
    detect: (h) => h.includes('counter party') && h.includes('spending category'),
    howTo: 'Starling app → Account → Statements → "Export" → CSV.',
  },
  nationwide: {
    name: 'Nationwide',
    detect: (h) => h.includes('paid out') && h.includes('paid in') && h.includes('transaction type'),
    howTo: 'Internet banking → your account → "Download transactions" → CSV.',
  },
};

function cleanBarclaysMemo(memo) {
  // Drop the card-payment date stamp ("ON 01 SEP ... BCC/CPM") and squeeze the padding.
  const s = String(memo || '').replace(/\s+ON \d{1,2} [A-Z]{3}\b.*$/i, '').replace(/\s+/g, ' ').trim();
  return s || String(memo || '').trim();
}

/** Which known bank produced this statement (by header row), or null. */
export function detectBank(headers, dataRows = []) {
  for (const [id, f] of Object.entries(BANK_FORMATS)) {
    if (f.detect && headers && f.detect(headers)) return id;
  }
  for (const [id, f] of Object.entries(BANK_FORMATS)) {
    if (f.detectRows && f.detectRows(dataRows)) return id;
  }
  return null;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/** Parse a statement date. UK/EU banks are day-first, so DD/MM is assumed over MM/DD. */
export function parseStatementDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return toISO(new Date(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1]);
    return isNaN(d) ? null : toISO(d);
  }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-,]*(\d{2,4})/);
  if (m) {
    const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase().slice(0, 3)];
    if (mon === undefined) return null;
    let y = +m[3];
    if (y < 100) y += 2000;
    return toISO(new Date(y, mon, +m[1]));
  }
  return null;
}

export function parseAmount(raw) {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/\bDR\b/i.test(s)) neg = true;
  s = s.replace(/\b(CR|DR)\b/gi, '');
  if (s.includes('−') || s.startsWith('-') || s.endsWith('-')) neg = true;
  s = s.replace(/[£€$\s−+-]/g, '');
  // European format 1.234,56 -> 1234.56
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(s) || /^\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  s = s.replace(/,/g, '');
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

function findColumn(headers, candidates) {
  for (const c of candidates) {
    const i = headers.indexOf(c);
    if (i !== -1) return i;
  }
  return -1;
}

/**
 * Parse a bank statement CSV into [{date, amount, description}]. Outflows are negative.
 * Returns { rows, mapping, errors }. Throws if no usable columns are found.
 */
export function parseStatement(text, { invertSign = false } = {}) {
  const parsed = Papa.parse(String(text).replace(/^\uFEFF/, ''), { skipEmptyLines: true });
  const data = parsed.data;
  // Some banks (e.g. Nationwide) put account info above the header row.
  let headerIdx = -1;
  let mapping = null;
  for (let i = 0; i < Math.min(data.length, 20); i++) {
    const headers = data[i].map((h) => String(h).trim().toLowerCase());
    const date = findColumn(headers, COLS.date);
    const amount = findColumn(headers, COLS.amount);
    const debit = findColumn(headers, COLS.debit);
    const credit = findColumn(headers, COLS.credit);
    if (date !== -1 && (amount !== -1 || debit !== -1 || credit !== -1)) {
      let description = findColumn(headers, COLS.description);
      // Monzo exports have both "Name" (merchant) and "Description" - prefer the merchant name.
      const name = headers.indexOf('name');
      if (name !== -1 && headers.includes('emoji')) description = name;
      headerIdx = i;
      mapping = { date, amount, debit, credit, description, headers };
      break;
    }
  }
  let bank = mapping ? detectBank(mapping.headers) : null;
  if (!mapping && detectBank(null, data) === 'hsbc') {
    bank = 'hsbc';
    mapping = { date: 0, description: 1, amount: 2, debit: -1, credit: -1, headers: null };
  }
  if (!mapping) throw new Error('Could not find date and amount columns in this file.');
  const format = bank ? BANK_FORMATS[bank] : null;

  const rows = [];
  const errors = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < data.length; i++) {
    const r = data[i];
    const get = (col) => (mapping.headers ? r[mapping.headers.indexOf(col)] : undefined);
    if (format?.skip?.(get)) { skipped++; continue; }
    const date = parseStatementDate(r[mapping.date]);
    let amount = null;
    if (mapping.amount !== -1) amount = parseAmount(r[mapping.amount]);
    else {
      const out = mapping.debit !== -1 ? parseAmount(r[mapping.debit]) : null;
      const inn = mapping.credit !== -1 ? parseAmount(r[mapping.credit]) : null;
      if (out) amount = -Math.abs(out);
      else if (inn) amount = Math.abs(inn);
    }
    if (!date || amount === null || amount === 0) {
      if (r.some((c) => String(c).trim())) errors.push({ line: i + 1, raw: r.join(', ') });
      continue;
    }
    const description = mapping.description !== -1 ? String(r[mapping.description] ?? '').trim() : '';
    let row = { date, amount, description: description || 'Unknown' };
    if (format?.row) row = format.row(row, get);
    if (invertSign) row.amount = -row.amount;
    if (!row.account && format) row.account = format.name.split(' / ')[0];
    if (format) row.bank = bank;
    rows.push(row);
  }
  return { rows, mapping, errors, bank, bankName: format?.name || null, skipped };
}
