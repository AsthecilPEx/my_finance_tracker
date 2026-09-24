import { useState } from 'react';
import { useApp } from '../store.jsx';
import { FREQUENCIES, KINDS } from '../../engine/recurring.js';
import { DEBT_TYPES } from '../../engine/debt.js';
import { categorise } from '../../engine/categories.js';

export function Field({ label, children, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function CategorySelect({ value, onChange, filter }) {
  const { state } = useApp();
  const list = state.categories.filter(filter || (() => true));
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      {list.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
    </select>
  );
}

export function TxnForm({ initial, onDone }) {
  const { state, dispatch, today, notify } = useApp();
  const [f, setF] = useState(() => initial
    ? { ...initial, amount: Math.abs(initial.amount), direction: initial.amount < 0 ? 'out' : 'in' }
    : { date: today, description: '', amount: '', direction: 'out', categoryId: '' });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const guessed = f.description ? categorise(f.description, f.direction === 'out' ? -1 : 1, state.rules) : 'other';

  const submit = async (e) => {
    e.preventDefault();
    const amount = (f.direction === 'out' ? -1 : 1) * Math.abs(parseFloat(f.amount));
    if (!amount || !f.date) return;
    const payload = { date: f.date, description: f.description || 'Manual entry', amount, categoryId: f.categoryId || guessed, notes: f.notes || '' };
    if (initial) await dispatch({ type: 'txn/update', payload: { id: initial.id, ...payload, learn: true } });
    else await dispatch({ type: 'txn/add', payload });
    notify(initial ? 'Transaction updated' : 'Transaction added', 'good');
    onDone();
  };

  return (
    <form onSubmit={submit} className="form">
      <div className="seg">
        <button type="button" className={f.direction === 'out' ? 'on out' : ''} onClick={() => set('direction')('out')}>Money out</button>
        <button type="button" className={f.direction === 'in' ? 'on in' : ''} onClick={() => set('direction')('in')}>Money in</button>
      </div>
      <Field label="Amount">
        <input className="big-input" type="number" step="0.01" min="0" inputMode="decimal" autoFocus required value={f.amount} onChange={set('amount')} placeholder="0.00" />
      </Field>
      <Field label="Description" hint={!f.categoryId && f.description ? `Auto-category: ${state.categories.find((c) => c.id === guessed)?.name}` : null}>
        <input value={f.description} onChange={set('description')} placeholder="e.g. Tesco, Costa, Rent" />
      </Field>
      <div className="row2">
        <Field label="Date"><input type="date" required value={f.date} onChange={set('date')} /></Field>
        <Field label="Category"><CategorySelect value={f.categoryId || guessed} onChange={set('categoryId')} /></Field>
      </div>
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
        <button className="btn primary">{initial ? 'Save' : 'Add transaction'}</button>
      </div>
    </form>
  );
}

export function RecurringForm({ initial, onDone }) {
  const { dispatch, today, notify } = useApp();
  const [f, setF] = useState(() => ({
    name: '', match: '', amount: '', direction: 'out', kind: 'bill', categoryId: 'utilities', frequency: 'monthly',
    dayOfMonth: new Date().getDate(), startDate: today, endDate: '', adjust: 'none', compulsory: true, ...initial,
  }));
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }));
  const isIn = f.direction === 'in';
  const byDay = f.frequency === 'monthly' || f.frequency === 'quarterly';

  const submit = async (e) => {
    e.preventDefault();
    // Day-of-month schedules count from the start of this month, so a bill already paid this month still shows.
    const monthStart = `${today.slice(0, 8)}01`;
    const startDate = (byDay || f.frequency === 'last-working-day') && f.startDate > monthStart ? monthStart : f.startDate;
    await dispatch({
      type: 'recurring/save',
      payload: { ...f, startDate, amount: parseFloat(f.amount), dayOfMonth: parseInt(f.dayOfMonth, 10) || 1, endDate: f.endDate || null, match: (f.match || f.name).toLowerCase(), compulsory: !isIn && f.compulsory },
    });
    notify('Saved', 'good');
    onDone();
  };

  return (
    <form onSubmit={submit} className="form">
      <div className="seg">
        <button type="button" className={!isIn ? 'on out' : ''} onClick={() => setF((x) => ({ ...x, direction: 'out', kind: 'bill', categoryId: 'utilities' }))}>Payment out</button>
        <button type="button" className={isIn ? 'on in' : ''} onClick={() => setF((x) => ({ ...x, direction: 'in', kind: 'salary', categoryId: 'salary', adjust: 'previous-working' }))}>Income / payday</button>
      </div>
      <div className="row2">
        <Field label="Name"><input required value={f.name} onChange={set('name')} placeholder={isIn ? 'Salary' : 'e.g. Council Tax'} /></Field>
        <Field label="Amount"><input type="number" step="0.01" min="0" required value={f.amount} onChange={set('amount')} /></Field>
      </div>
      <div className="row2">
        <Field label="Type">
          <select value={f.kind} onChange={set('kind')}>
            {Object.entries(KINDS).filter(([k]) => (isIn ? ['salary', 'income'] : ['bill', 'subscription', 'savings', 'other']).includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Category"><CategorySelect value={f.categoryId} onChange={set('categoryId')} filter={(c) => (isIn ? c.type === 'income' : c.type !== 'income')} /></Field>
      </div>
      <div className="row2">
        <Field label="How often">
          <select value={f.frequency} onChange={set('frequency')}>
            {Object.entries(FREQUENCIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {byDay ? (
          <Field label="Day of month"><input type="number" min="1" max="31" value={f.dayOfMonth} onChange={set('dayOfMonth')} /></Field>
        ) : (
          <Field label={f.frequency === 'once' ? 'Date' : 'First / next date'}><input type="date" value={f.startDate} onChange={set('startDate')} /></Field>
        )}
      </div>
      <div className="row2">
        <Field label="If it lands on a weekend or bank holiday">
          <select value={f.adjust} onChange={set('adjust')}>
            <option value="none">Keep the date</option>
            <option value="previous-working">Move to previous working day</option>
            <option value="next-working">Move to next working day</option>
          </select>
        </Field>
        <Field label="Ends (optional)"><input type="date" value={f.endDate || ''} onChange={set('endDate')} /></Field>
      </div>
      <Field label="Statement keyword" hint="Text that appears on your bank statement. Used to tick this off automatically when it's paid.">
        <input value={f.match} onChange={set('match')} placeholder={f.name.toLowerCase() || 'e.g. octopus'} />
      </Field>
      {!isIn && (
        <label className="check">
          <input type="checkbox" checked={!!f.compulsory} onChange={set('compulsory')} />
          <span><b>Compulsory</b>: must be paid (rent, council tax, utilities). Untick for things you could cancel.</span>
        </label>
      )}
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
        <button className="btn primary">Save</button>
      </div>
    </form>
  );
}

export function DebtForm({ initial, onDone }) {
  const { dispatch, notify } = useApp();
  const [f, setF] = useState(() => ({ name: '', type: 'credit-card', lender: '', balance: '', apr: '', minPayment: '', dueDay: 1, ...initial }));
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    await dispatch({
      type: 'debt/save',
      payload: { ...f, balance: parseFloat(f.balance), apr: parseFloat(f.apr) || 0, minPayment: parseFloat(f.minPayment) || 0, dueDay: parseInt(f.dueDay, 10) || 1, match: (f.lender || f.name).toLowerCase() },
    });
    notify('Debt saved', 'good');
    onDone();
  };
  return (
    <form onSubmit={submit} className="form">
      <div className="row2">
        <Field label="Name"><input required value={f.name} onChange={set('name')} placeholder="e.g. Barclaycard" /></Field>
        <Field label="Type">
          <select value={f.type} onChange={set('type')}>{Object.entries(DEBT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        </Field>
      </div>
      <div className="row2">
        <Field label="Balance owed"><input type="number" step="0.01" min="0" required value={f.balance} onChange={set('balance')} /></Field>
        <Field label="Interest rate (APR %)"><input type="number" step="0.01" min="0" value={f.apr} onChange={set('apr')} /></Field>
      </div>
      <div className="row2">
        <Field label="Monthly payment"><input type="number" step="0.01" min="0" value={f.minPayment} onChange={set('minPayment')} /></Field>
        <Field label="Due day of month"><input type="number" min="1" max="31" value={f.dueDay} onChange={set('dueDay')} /></Field>
      </div>
      <Field label="Lender / statement keyword" hint="Payments containing this text are matched automatically."><input value={f.lender} onChange={set('lender')} placeholder="e.g. Barclaycard" /></Field>
      <div className="form-actions">
        <button type="button" className="btn ghost" onClick={onDone}>Cancel</button>
        <button className="btn primary">Save</button>
      </div>
    </form>
  );
}
