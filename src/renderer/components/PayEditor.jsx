import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import Modal from './Modal.jsx';
import { Field } from './Forms.jsx';
import { netForHours, paysPerYear } from '../../engine/income.js';
import { shortDate, weekdayShort } from '../../engine/dates.js';

export const PAY_REASONS = {
  absence: 'Absence / sickness / unpaid leave',
  overtime: 'Overtime / extra shifts',
  bonus: 'Bonus / commission',
  deduction: 'One-off deduction',
  tax: 'Tax code or NI change',
  holiday: 'Holiday pay',
  backpay: 'Back pay / correction',
  other: 'Other',
};
const BILL_REASONS = { higher: 'Higher than usual', lower: 'Lower than usual', discount: 'Discount / refund', other: 'Other' };

/**
 * Edit ONE payday (or one bill) without touching its regular schedule: a different amount,
 * a different date, or skipped entirely. Every total, forecast and plan uses the edited value.
 */
export default function PayEditor({ occ, onClose }) {
  const { state, dispatch, fmt, notify } = useApp();
  const isPay = occ.amount > 0;
  const existing = state.overrides?.[occ.key] || {};
  const normal = Math.abs(occ.scheduledAmount ?? occ.amount);
  const scheduledDate = occ.scheduledDate || occ.date;
  const inc = useMemo(() => (state.profile?.incomes || []).find((i) => i.id === occ.incomeId), [state.profile, occ.incomeId]);
  const [amount, setAmount] = useState(existing.amount ?? Math.abs(occ.amount));
  const [date, setDate] = useState(existing.date || scheduledDate);
  const [skipped, setSkipped] = useState(!!existing.skipped);
  const [reason, setReason] = useState(existing.reason || (isPay ? 'absence' : 'higher'));
  const [note, setNote] = useState(existing.note || '');
  const [hours, setHours] = useState(existing.hours ?? '');
  const [deduction, setDeduction] = useState('');
  const diff = Math.round(((+amount || 0) - normal) * 100) / 100;

  const useHours = (h) => {
    setHours(h);
    if (inc && +h >= 0 && h !== '') setAmount(netForHours(inc, state.profile.region, +h));
  };
  const save = async () => {
    await dispatch({ type: 'occ/override', payload: { key: occ.key, amount: skipped ? undefined : +amount, date: date !== scheduledDate ? date : undefined, skipped, reason, note: note.trim(), hours: hours === '' ? undefined : +hours } });
    notify(skipped ? `${occ.name} on ${shortDate(scheduledDate)} marked as not happening` : `${occ.name} updated to ${fmt(+amount)}. Your plans are recalculated.`, 'good');
    onClose();
  };
  const reset = async () => {
    await dispatch({ type: 'occ/reset', payload: { key: occ.key } });
    notify(`${occ.name} back to normal (${fmt(normal)})`, 'good');
    onClose();
  };

  return (
    <Modal title={isPay ? `✎ Edit this payday` : `✎ Edit this payment`} onClose={onClose}>
      <div className="split-head">
        <b>{occ.name}</b>
        <span className="muted">{weekdayShort(scheduledDate)} {shortDate(scheduledDate)} · normally {fmt(normal)}</span>
      </div>
      <p className="muted sm" style={{ marginTop: 0 }}>Changes only this one {isPay ? 'payday' : 'payment'}. Your regular {isPay ? 'pay' : 'bill'} stays as it is.</p>
      <div className="form">
        <label className="check"><input type="checkbox" checked={skipped} onChange={(e) => setSkipped(e.target.checked)} /><span>{isPay ? 'Not paid this time' : "Not paying this one (skipped / cancelled)"}</span></label>
        {!skipped && (
          <>
            <div className="row2">
              <Field label={isPay ? 'Amount you will actually receive' : 'Amount this time'}>
                <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
              </Field>
              <Field label="Date" hint={date !== scheduledDate ? `Moved from ${shortDate(scheduledDate)}` : 'Change if it lands on a different day'}>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value || scheduledDate)} />
              </Field>
            </div>
            {isPay && (
              <div className="helpers">
                {inc?.payType === 'hourly' && (
                  <Field label={`Hours worked this pay (normally ${Math.round(((inc.hoursPerWeek || 0) * 52) / paysPerYear(inc) * 10) / 10})`} hint="Take-home is recalculated with tax and NI">
                    <input type="number" min="0" step="0.25" value={hours} onChange={(e) => useHours(e.target.value)} placeholder="e.g. 22.5" />
                  </Field>
                )}
                <Field label="Or: one-off deduction from normal pay" hint="e.g. absence, advance repayment, equipment">
                  <div className="inline-row">
                    <input type="number" min="0" step="0.01" value={deduction} onChange={(e) => setDeduction(e.target.value)} placeholder="£" />
                    <button type="button" className="btn ghost sm" disabled={!(+deduction > 0)} onClick={() => { setAmount(Math.max(0, Math.round((normal - +deduction) * 100) / 100)); setReason('deduction'); }}>Apply</button>
                  </div>
                </Field>
              </div>
            )}
            <div className={`diff ${diff < 0 ? 'neg' : diff > 0 ? 'pos' : 'muted'}`}>
              {diff === 0 ? 'Same as normal' : `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))} vs normal`}
            </div>
          </>
        )}
        <div className="row2">
          <Field label="Reason">
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              {Object.entries(isPay ? PAY_REASONS : BILL_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={isPay ? 'e.g. 2 days sick' : 'e.g. winter energy bill'} /></Field>
        </div>
        <div className="form-actions">
          {occ.override && <button type="button" className="btn ghost" onClick={reset}>Reset to normal</button>}
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save} disabled={!skipped && !(+amount >= 0 && amount !== '')}>Save</button>
        </div>
      </div>
    </Modal>
  );
}
