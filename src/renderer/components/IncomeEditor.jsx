import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { Field } from './Forms.jsx';
import { PAY_PATTERNS, WEEKDAYS, incomeItems, nextWeekday } from '../../engine/income.js';
import { takeHome, TAX_YEAR } from '../../engine/payroll.js';
import { occurrencesBetween } from '../../engine/recurring.js';
import { addDays, parseISO, shortDate, weekdayShort } from '../../engine/dates.js';

/** Edit one income source. Shows the take-home breakdown and upcoming paydays as you type. */
export default function IncomeEditor({ value, onChange, region = 'ruk' }) {
  const { fmt, today } = useApp();
  const [showTax, setShowTax] = useState(value.payType !== 'net');
  const inc = value;
  const set = (patch) => onChange({ ...inc, ...patch });
  const setS = (patch) => onChange({ ...inc, schedule: { ...inc.schedule, ...patch } });
  const s = inc.schedule;
  const th = useMemo(() => takeHome(inc, region), [inc, region]);
  const paydays = useMemo(() => {
    const [item] = incomeItems({ profile: { region, incomes: [{ ...inc, active: true }] } });
    return item ? occurrencesBetween(item, today, addDays(today, 70)).slice(0, 5) : [];
  }, [inc, region, today]);
  const needsAnchor = ['fortnightly', 'four-weekly'].includes(s.frequency);

  return (
    <div className="income-editor">
      <div className="ie-form">
        <div className="row2">
          <Field label="What is this income?"><input value={inc.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Main job, Uber, Freelance" /></Field>
          <Field label="Name on bank statement" hint="Helps tick off paydays automatically"><input value={inc.employer} onChange={(e) => set({ employer: e.target.value })} placeholder="e.g. ACME LTD" /></Field>
        </div>

        <div className="field"><span>How are you paid?</span>
          <div className="seg three">
            {[['salary', 'Yearly salary'], ['hourly', 'Hourly rate'], ['net', 'I know my take-home']].map(([k, l]) => (
              <button key={k} type="button" className={inc.payType === k ? 'on in' : ''} onClick={() => { set({ payType: k }); setShowTax(k !== 'net'); }}>{l}</button>
            ))}
          </div>
        </div>
        {inc.payType === 'salary' && <Field label="Salary before tax (per year)"><input type="number" min="0" step="100" value={inc.annual} onChange={(e) => set({ annual: e.target.value })} placeholder="e.g. 32000" /></Field>}
        {inc.payType === 'hourly' && (
          <div className="row2">
            <Field label="Hourly rate"><input type="number" min="0" step="0.01" value={inc.hourlyRate} onChange={(e) => set({ hourlyRate: e.target.value })} placeholder="e.g. 12.21" /></Field>
            <Field label="Usual hours per week"><input type="number" min="0" step="0.5" value={inc.hoursPerWeek} onChange={(e) => set({ hoursPerWeek: e.target.value })} placeholder="e.g. 30" /></Field>
          </div>
        )}
        {inc.payType === 'net' && <Field label="Take-home per payment"><input type="number" min="0" step="0.01" value={inc.netPerPay} onChange={(e) => set({ netPerPay: e.target.value })} /></Field>}

        <div className="row2">
          <Field label="Pay pattern">
            <select value={s.frequency} onChange={(e) => setS({ frequency: e.target.value, anchorDate: ['fortnightly', 'four-weekly'].includes(e.target.value) ? s.anchorDate || nextWeekday(s.weekday ?? 5, today) : s.anchorDate })}>
              {Object.entries(PAY_PATTERNS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          {s.frequency === 'monthly' && <Field label="Paid on day"><input type="number" min="1" max="31" value={s.dayOfMonth} onChange={(e) => setS({ dayOfMonth: e.target.value })} /></Field>}
          {['weekly', 'last-weekday'].includes(s.frequency) && (
            <Field label={s.frequency === 'weekly' ? 'Every' : 'Last … of the month'}>
              <select value={s.weekday ?? 5} onChange={(e) => setS({ weekday: +e.target.value })}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
            </Field>
          )}
          {needsAnchor && <Field label="Your next payday"><input type="date" value={s.anchorDate || ''} onChange={(e) => setS({ anchorDate: e.target.value, weekday: parseISO(e.target.value).getDay() })} /></Field>}
          {s.frequency === 'irregular' && <Field label="Roughly how many payments a month?"><input type="number" min="1" max="31" value={inc.paymentsPerMonth || 1} onChange={(e) => set({ paymentsPerMonth: e.target.value })} /></Field>}
        </div>
        {s.frequency === 'monthly' && (
          <label className="check"><input type="checkbox" checked={s.adjust === 'previous-working'} onChange={(e) => setS({ adjust: e.target.checked ? 'previous-working' : 'none' })} /><span>If payday falls on a weekend or bank holiday, I'm paid the working day before</span></label>
        )}
        {s.frequency === 'irregular' && <IrregularDates inc={inc} set={set} />}

        <label className="check">
          <input type="checkbox" checked={!!inc.variable} onChange={(e) => set({ variable: e.target.checked })} />
          <span><b>My pay changes each time</b> (shifts, overtime, commission, gig work). Pulse will plan on your <i>lowest</i> typical pay so you're never caught short.</span>
        </label>
        {inc.variable && <Field label="Lowest take-home per payment in a normal month"><input type="number" min="0" step="0.01" value={inc.lowestNet} onChange={(e) => set({ lowestNet: e.target.value })} /></Field>}

        {inc.payType !== 'net' && (
          <div className="collapsible">
            <button type="button" className="linkish muted" onClick={() => setShowTax((x) => !x)}>{showTax ? '▾' : '▸'} Tax code, pension & deductions</button>
            {showTax && (
              <div className="collapsible-body">
                <div className="row2">
                  <Field label="Tax code" hint="On your payslip. Most people: 1257L. Second jobs are often BR."><input value={inc.taxCode} onChange={(e) => set({ taxCode: e.target.value.toUpperCase() })} /></Field>
                  <Field label="Workplace pension %"><input type="number" min="0" max="100" step="0.5" value={inc.pensionPct} onChange={(e) => set({ pensionPct: e.target.value })} /></Field>
                </div>
                <Field label="Pension type">
                  <select value={inc.pensionType} onChange={(e) => set({ pensionType: e.target.value })}>
                    <option value="net-pay">Taken before tax (net pay arrangement)</option>
                    <option value="salary-sacrifice">Salary sacrifice (saves tax and NI)</option>
                    <option value="relief-at-source">Relief at source (taken after tax)</option>
                  </select>
                </Field>
                <div className="field"><span>Student loan</span>
                  <div className="chips-row">
                    {Object.entries(TAX_YEAR.studentLoans).map(([k, v]) => (
                      <label key={k} className={`pill-check ${inc.studentLoans?.includes(k) ? 'on' : ''}`}>
                        <input type="checkbox" checked={inc.studentLoans?.includes(k) || false} onChange={(e) => set({ studentLoans: e.target.checked ? [...(inc.studentLoans || []), k] : inc.studentLoans.filter((x) => x !== k) })} />{v.label}
                      </label>
                    ))}
                  </div>
                </div>
                <Deductions inc={inc} set={set} />
              </div>
            )}
          </div>
        )}
      </div>

      <aside className="ie-preview">
        <div className="muted sm">Estimated take-home</div>
        <div className="ie-net">{fmt(th.netPerPay || 0)}<small> per pay</small></div>
        {inc.variable && +inc.lowestNet > 0 && <div className="muted sm">Planning on {fmt(+inc.lowestNet)} (your lowest)</div>}
        {th.gross !== null && th.gross > 0 && (
          <ul className="ie-lines">
            <li><span>Gross pay</span><b>{fmt(th.grossPerPay)}</b></li>
            {th.lines.filter((l) => l.amount > 0).map((l) => <li key={l.name}><span>− {l.name}</span><b>{fmt(l.perPay)}</b></li>)}
            <li className="total"><span>Take-home</span><b>{fmt(th.netPerPay)}</b></li>
          </ul>
        )}
        {th.band && th.gross > 0 && <div className="band-pill">{th.band} taxpayer · {Math.round(th.effectiveRate * 100)}% deducted</div>}
        <div className="muted sm" style={{ marginTop: 10 }}>Next paydays</div>
        <ul className="ie-dates">
          {paydays.length ? paydays.map((d) => <li key={d}><span className="dot" style={{ background: '#0ca30c' }} />{weekdayShort(d)} {shortDate(d)}</li>) : <li className="muted">Add a date to see paydays</li>}
        </ul>
        <div className="muted xs">Estimate using {TAX_YEAR.label} rates. Your payslip is the final word.</div>
      </aside>
    </div>
  );
}

function IrregularDates({ inc, set }) {
  const rows = inc.irregularDates || [];
  const upd = (i, patch) => set({ irregularDates: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="field"><span>Known upcoming payments (add them as you find out)</span>
      {rows.map((r, i) => (
        <div key={i} className="inline-row">
          <input type="date" value={r.date} onChange={(e) => upd(i, { date: e.target.value })} />
          <input type="number" min="0" step="0.01" placeholder="Amount" value={r.amount} onChange={(e) => upd(i, { amount: e.target.value })} />
          <button type="button" className="icon-btn danger" aria-label="Remove" onClick={() => set({ irregularDates: rows.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={() => set({ irregularDates: [...rows, { date: '', amount: '' }] })}>+ Add a payment date</button>
    </div>
  );
}

function Deductions({ inc, set }) {
  const rows = inc.deductions || [];
  const upd = (i, patch) => set({ deductions: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  return (
    <div className="field"><span>Other deductions (union, cycle-to-work, loans from payroll…)</span>
      {rows.map((r, i) => (
        <div key={i} className="inline-row wrap">
          <input placeholder="Name" value={r.name} onChange={(e) => upd(i, { name: e.target.value })} />
          <input type="number" min="0" step="0.01" placeholder="Amount" value={r.amount} onChange={(e) => upd(i, { amount: e.target.value })} style={{ width: 100 }} />
          <select value={r.per || 'pay'} onChange={(e) => upd(i, { per: e.target.value })}><option value="pay">per pay</option><option value="month">per month</option><option value="year">per year</option></select>
          <label className="check inline"><input type="checkbox" checked={!!r.beforeTax} onChange={(e) => upd(i, { beforeTax: e.target.checked })} /><span>before tax</span></label>
          <button type="button" className="icon-btn danger" aria-label="Remove" onClick={() => set({ deductions: rows.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={() => set({ deductions: [...rows, { name: '', amount: '', per: 'pay', beforeTax: false }] })}>+ Add deduction</button>
    </div>
  );
}
