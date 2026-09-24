import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import Modal from '../components/Modal.jsx';
import { RecurringForm } from '../components/Forms.jsx';
import { detectRecurring, FREQUENCIES, monthlyEquivalent, nextOccurrence } from '../../engine/recurring.js';
import { shortDate, weekdayShort, daysBetween, ordinal } from '../../engine/dates.js';

export default function Bills() {
  const { state, dispatch, fmt, today, cats, notify } = useApp();
  const [edit, setEdit] = useState(null);
  const [dismissed, setDismissed] = useState([]);
  const suggestions = useMemo(
    () => detectRecurring(state.transactions, [...state.recurring, ...state.debts.map((d) => ({ match: d.match || d.lender || d.name }))], state.rules)
      .filter((s) => daysBetween(s.lastDate, today) < 70 && !dismissed.includes(s.match)),
    [state.transactions, state.recurring, state.debts, state.rules, today, dismissed],
  );

  const items = state.recurring.map((r) => ({ ...r, next: nextOccurrence(r, today, state.settings.extraHolidays), monthly: monthlyEquivalent(r.amount, r.frequency) }));
  const groups = [
    { id: 'in', title: 'Income & paydays', items: items.filter((r) => r.direction === 'in') },
    { id: 'must', title: 'Compulsory bills', hint: 'Must be paid: housing, council tax, utilities, insurance', items: items.filter((r) => r.direction === 'out' && r.compulsory) },
    { id: 'optional', title: 'Subscriptions & optional', hint: 'Recurring, but you could cancel or downgrade these', items: items.filter((r) => r.direction === 'out' && !r.compulsory && r.kind !== 'savings') },
    { id: 'save', title: 'Savings transfers', items: items.filter((r) => r.direction === 'out' && r.kind === 'savings') },
  ];
  const active = (r) => r.active !== false;
  const total = (list) => list.filter(active).reduce((s, r) => s + r.monthly, 0);
  const inTotal = total(groups[0].items);
  const mustTotal = total(groups[1].items) + state.debts.filter((d) => d.balance > 0).reduce((s, d) => s + (d.minPayment || 0), 0);
  const optTotal = total(groups[2].items);

  const accept = async (s) => {
    await dispatch({ type: 'recurring/save', payload: { name: s.name, match: s.match, amount: s.amount, direction: s.direction, kind: s.kind, categoryId: s.categoryId, frequency: s.frequency, dayOfMonth: s.dayOfMonth, startDate: s.startDate, adjust: s.kind === 'salary' ? 'previous-working' : 'none', compulsory: s.compulsory } });
    notify(`Now tracking ${s.name}`, 'good');
  };

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Bills & Income</h1><p className="muted">Everything that repeats: paydays, bills and subscriptions.</p></div>
        <button className="btn primary" onClick={() => setEdit({})}>+ Add recurring</button>
      </header>

      <div className="kpis">
        <div className="kpi"><span>Regular income</span><b className="pos">{fmt(inTotal, { decimals: 0 })}<small>/mo</small></b></div>
        <div className="kpi"><span>Compulsory (incl. debt)</span><b>{fmt(mustTotal, { decimals: 0 })}<small>/mo</small></b></div>
        <div className="kpi"><span>Optional recurring</span><b>{fmt(optTotal, { decimals: 0 })}<small>/mo</small></b></div>
        <div className="kpi"><span>Left after fixed costs</span><b>{fmt(inTotal - mustTotal - optTotal, { decimals: 0 })}<small>/mo</small></b></div>
      </div>

      {suggestions.length > 0 && (
        <div className="card suggest">
          <div className="card-head"><h3>✦ Found in your statements</h3><span className="muted sm">These look like regular payments. Track them to see them on your calendar.</span></div>
          <ul className="list">
            {suggestions.slice(0, 8).map((s) => (
              <li key={s.match + s.direction} className="list-row">
                <span aria-hidden>{cats[s.categoryId]?.icon}</span>
                <span className="grow"><b>{s.name}</b><small className="muted"> · {FREQUENCIES[s.frequency]}{s.frequency === 'monthly' ? ` around the ${ordinal(s.dayOfMonth)}` : ''} · seen {s.count}×</small></span>
                <span className={`badge ${s.compulsory ? 'must' : 'opt'}`}>{s.direction === 'in' ? 'Income' : s.compulsory ? 'Compulsory' : 'Optional'}</span>
                <b className={s.direction === 'in' ? 'pos' : ''}>{fmt(s.amount)}</b>
                <button className="btn sm primary" onClick={() => accept(s)}>Track</button>
                <button className="icon-btn" aria-label="Dismiss" onClick={() => setDismissed((d) => [...d, s.match])}>✕</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.id} className="card">
          <div className="card-head"><h3>{g.title}</h3>{g.hint && <span className="muted sm">{g.hint}</span>}</div>
          {g.items.length === 0 ? <p className="empty">Nothing here yet.</p> : (
            <ul className="list">
              {g.items.map((r) => (
                <li key={r.id} className={`list-row ${active(r) ? '' : 'inactive'}`}>
                  <span aria-hidden>{cats[r.categoryId]?.icon}</span>
                  <span className="grow">
                    <b>{r.name}</b>
                    <small className="muted"> · {FREQUENCIES[r.frequency]}{r.frequency === 'monthly' ? ` on the ${ordinal(r.dayOfMonth)}` : ''}{r.next ? ` · next ${weekdayShort(r.next)} ${shortDate(r.next)}` : ''}</small>
                  </span>
                  <b className={r.direction === 'in' ? 'pos' : ''}>{fmt(r.amount)}</b>
                  <label className="switch" title={active(r) ? 'Active' : 'Paused'}>
                    <input type="checkbox" checked={active(r)} onChange={(e) => dispatch({ type: 'recurring/save', payload: { id: r.id, active: e.target.checked, amount: r.amount } })} />
                    <span />
                  </label>
                  <button className="icon-btn" aria-label="Edit" onClick={() => setEdit(r)}>✎</button>
                  <button className="icon-btn danger" aria-label="Delete" onClick={() => dispatch({ type: 'recurring/delete', payload: { id: r.id } })}>🗑</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="muted sm">Loan and credit card repayments are managed on the Debts & Loans page.</p>
      {edit && <Modal title={edit.id ? `Edit ${edit.name}` : 'Add recurring payment'} onClose={() => setEdit(null)}><RecurringForm initial={edit.id ? edit : null} onDone={() => setEdit(null)} /></Modal>}
    </div>
  );
}

