// UK take-home pay estimator (PAYE, annualised). Rates live in one table so a new tax
// year is a one-line change. rUK income tax thresholds and NI are frozen, so the
// 2025/26 figures also hold for 2026/27; Scottish bands and student loan thresholds
// are the 2025/26 values and should be checked each April.
import { round2 } from './money.js';

export const TAX_YEAR = {
  label: '2026/27',
  personalAllowance: 12570,
  taperStart: 100000,
  bands: {
    ruk: [
      { name: 'Basic', upTo: 37700, rate: 0.2 },
      { name: 'Higher', upTo: 125140, rate: 0.4 },
      { name: 'Additional', upTo: Infinity, rate: 0.45 },
    ],
    scotland: [
      { name: 'Starter', upTo: 2827, rate: 0.19 },
      { name: 'Basic', upTo: 14921, rate: 0.2 },
      { name: 'Intermediate', upTo: 31092, rate: 0.21 },
      { name: 'Higher', upTo: 62430, rate: 0.42 },
      { name: 'Advanced', upTo: 125140, rate: 0.45 },
      { name: 'Top', upTo: Infinity, rate: 0.48 },
    ],
  },
  ni: { primaryThreshold: 12570, upperLimit: 50270, main: 0.08, upper: 0.02 },
  studentLoans: {
    plan1: { label: 'Plan 1', threshold: 26065, rate: 0.09 },
    plan2: { label: 'Plan 2', threshold: 28470, rate: 0.09 },
    plan4: { label: 'Plan 4 (Scotland)', threshold: 32745, rate: 0.09 },
    plan5: { label: 'Plan 5', threshold: 25000, rate: 0.09 },
    pg: { label: 'Postgraduate', threshold: 21000, rate: 0.06 },
  },
};

export const PERIODS_PER_YEAR = { weekly: 52, fortnightly: 26, 'four-weekly': 13, monthly: 12, 'last-working-day': 12, 'last-weekday': 12, irregular: 12 };

/** Parse a UK tax code such as 1257L, S1257L, K475, BR, D0, NT, 0T, 1257L W1. */
export function parseTaxCode(raw = '1257L') {
  const code = String(raw).toUpperCase().replace(/\s+/g, '').replace(/(W1|M1|X)$/, '');
  const scottish = code.startsWith('S');
  const body = code.replace(/^[SC]/, '');
  if (body === 'NT') return { code, scottish, noTax: true };
  if (['BR', 'D0', 'D1', 'D2'].includes(body)) return { code, scottish, flat: body };
  const k = body.match(/^K(\d+)$/);
  if (k) return { code, scottish, allowance: -Number(k[1]) * 10 };
  const m = body.match(/^(\d+)[LMNTPY]?$/);
  if (m) return { code, scottish, allowance: Number(m[1]) === 0 ? 0 : Number(m[1]) * 10 + 9, standard: body === '1257L' };
  return { code, scottish, allowance: TAX_YEAR.personalAllowance + 9, standard: true, invalid: true };
}

function incomeTax(taxablePay, { region, taxCode }) {
  const tc = parseTaxCode(taxCode);
  const scottish = region === 'scotland' || tc.scottish;
  const bands = TAX_YEAR.bands[scottish ? 'scotland' : 'ruk'];
  if (tc.noTax) return { tax: 0, band: 'No tax' };
  if (tc.flat) {
    const pick = { BR: scottish ? 1 : 0, D0: scottish ? 3 : 1, D1: scottish ? 4 : 2, D2: 5 }[tc.flat];
    const b = bands[Math.min(pick, bands.length - 1)];
    return { tax: Math.max(0, taxablePay) * b.rate, band: `${b.name} rate (flat)` };
  }
  let allowance = tc.allowance;
  // The standard code assumes the full allowance; above £100k it tapers away (£1 per £2).
  if (tc.standard && taxablePay > TAX_YEAR.taperStart) allowance = Math.max(0, allowance - (taxablePay - TAX_YEAR.taperStart) / 2);
  let remaining = Math.max(0, taxablePay - allowance);
  let tax = 0;
  let band = 'Below the tax threshold';
  let prev = 0;
  for (const b of bands) {
    if (remaining <= 0) break;
    const width = b.upTo - prev;
    const slice = Math.min(remaining, width);
    tax += slice * b.rate;
    remaining -= slice;
    band = `${b.name} rate`;
    prev = b.upTo;
  }
  return { tax, band, scottish };
}

/** Gross annual pay for an income source (salary, hourly, or known take-home). */
export function grossAnnual(inc) {
  if (inc.payType === 'hourly') return (+inc.hourlyRate || 0) * (+inc.hoursPerWeek || 0) * 52;
  if (inc.payType === 'salary') return +inc.annual || 0;
  return null;
}

/**
 * Full breakdown of take-home pay for one income source.
 * inc: { payType, annual, hourlyRate, hoursPerWeek, netPerPay, schedule.frequency, taxCode,
 *        pensionPct, pensionType ('net-pay' | 'salary-sacrifice' | 'relief-at-source'),
 *        studentLoans: ['plan2', 'pg'], deductions: [{ name, amount, per: 'pay'|'month'|'year', beforeTax }] }
 */
export function takeHome(inc, region = 'ruk') {
  const periods = inc.schedule?.frequency === 'irregular' ? 12 * (+inc.paymentsPerMonth || 1) : PERIODS_PER_YEAR[inc.schedule?.frequency] || 12;
  if (inc.payType === 'net') {
    const net = (+inc.netPerPay || 0) * periods;
    return { periods, gross: null, net: round2(net), netPerPay: round2(+inc.netPerPay || 0), lines: [], band: null, knownNet: true };
  }
  const gross = grossAnnual(inc);
  const pensionPct = (+inc.pensionPct || 0) / 100;
  const pensionType = inc.pensionType || 'net-pay';
  const pension = gross * pensionPct;
  const perYear = (d) => (+d.amount || 0) * (d.per === 'year' ? 1 : d.per === 'month' ? 12 : periods);
  const preTaxOther = (inc.deductions || []).filter((d) => d.beforeTax).reduce((s, d) => s + perYear(d), 0);
  const postTaxOther = (inc.deductions || []).filter((d) => !d.beforeTax).reduce((s, d) => s + perYear(d), 0);

  const niable = pensionType === 'salary-sacrifice' ? gross - pension : gross;
  const taxable = gross - (pensionType === 'relief-at-source' ? 0 : pension) - preTaxOther;
  const { tax, band } = incomeTax(taxable, { region, taxCode: inc.taxCode || '1257L' });
  const { primaryThreshold: pt, upperLimit: uel, main, upper } = TAX_YEAR.ni;
  const ni = Math.max(0, Math.min(niable, uel) - pt) * main + Math.max(0, niable - uel) * upper;
  const slBase = pensionType === 'salary-sacrifice' ? gross - pension : gross;
  const loans = (inc.studentLoans || []).map((p) => {
    const cfg = TAX_YEAR.studentLoans[p];
    return cfg ? { name: `Student loan (${cfg.label})`, amount: Math.max(0, slBase - cfg.threshold) * cfg.rate } : null;
  }).filter(Boolean);
  // Relief at source: you pay 80%, the pension provider claims the 20% from HMRC.
  const pensionPaid = pensionType === 'relief-at-source' ? pension * 0.8 : pension;
  const net = gross - pensionPaid - tax - ni - preTaxOther - postTaxOther - loans.reduce((s, l) => s + l.amount, 0);
  const lines = [
    { name: 'Income tax', amount: tax },
    { name: 'National Insurance', amount: ni },
    ...(pension ? [{ name: `Pension (${Math.round(pensionPct * 1000) / 10}%${pensionType === 'relief-at-source' ? ', after 20% relief' : ''})`, amount: pensionPaid }] : []),
    ...loans,
    ...(inc.deductions || []).map((d) => ({ name: d.name || 'Deduction', amount: perYear(d) })),
  ].map((l) => ({ ...l, amount: round2(l.amount), perPay: round2(l.amount / periods) }));
  return { periods, gross: round2(gross), grossPerPay: round2(gross / periods), net: round2(net), netPerPay: round2(net / periods), lines, band, effectiveRate: gross ? (gross - net) / gross : 0 };
}

/** Net amount each pay for an income source; variable earners plan on their lowest typical pay. */
export function plannedNetPerPay(inc, region) {
  if (inc.variable && +inc.lowestNet > 0) return +inc.lowestNet;
  return takeHome(inc, region).netPerPay;
}
