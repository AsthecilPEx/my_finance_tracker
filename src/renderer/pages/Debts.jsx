import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import Modal from '../components/Modal.jsx';
import { DebtForm } from '../components/Forms.jsx';
import { DEBT_TYPES, simulatePayoff, monthlyInterest } from '../../engine/debt.js';
import { addMonths, ordinal, parseISO } from '../../engine/dates.js';

function payoffDate(today, months) {
  if (!isFinite(months)) return 'Never at this rate';
  return parseISO(addMonths(today, months)).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

export default function Debts() {
  const { state, dispatch, fmt, today } = useApp();
  const [edit, setEdit] = useState(null);
  const [extra, setExtra] = useState(state.settings.debtPlan?.extra ?? 100);
  const chosen = state.settings.debtPlan?.strategy || 'avalanche';
  const debts = state.debts.filter((d) => d.balance > 0);
  const total = debts.reduce((s, d) => s + d.balance, 0);
  const minTotal = debts.reduce((s, d) => s + (d.minPayment || 0), 0);
  const plans = useMemo(() => ({
    minimum: simulatePayoff(debts, { extra: 0 }),
    avalanche: simulatePayoff(debts, { extra, strategy: 'avalanche' }),
    snowball: simulatePayoff(debts, { extra, strategy: 'snowball' }),
  }), [debts, extra]);
  const order = (strategy) => [...debts].sort((a, b) => (strategy === 'snowball' ? a.balance - b.balance : b.apr - a.apr));

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Debts & Loans</h1><p className="muted">Everything you owe, and the fastest way to clear it.</p></div>
        <button className="btn primary" onClick={() => setEdit({})}>+ Add debt</button>
      </header>

      <div className="kpis">
        <div className="kpi"><span>Total owed</span><b>{fmt(total, { decimals: 0 })}</b></div>
        <div className="kpi"><span>Monthly payments</span><b>{fmt(minTotal, { decimals: 0 })}</b></div>
        <div className="kpi"><span>Interest this month</span><b className="neg">{fmt(monthlyInterest(debts))}</b></div>
        <div className="kpi"><span>Debt-free (minimums only)</span><b>{payoffDate(today, plans.minimum.months)}</b></div>
      </div>

      {state.debts.length === 0 ? (
        <div className="card"><p className="empty">No debts added. Add credit cards, loans, car finance, BNPL or money owed to friends to plan a payoff.</p></div>
      ) : (
        <div className="debt-grid">
          {state.debts.map((d) => {
            const paid = d.originalBalance > 0 ? Math.min(1, 1 - d.balance / d.originalBalance) : 0;
            return (
              <div key={d.id} className="card debt">
                <div className="card-head">
                  <div><h3>{d.name}</h3><span className="muted sm">{DEBT_TYPES[d.type] || d.type}{d.dueDay ? ` · due on the ${ordinal(d.dueDay)}` : ''}</span></div>
                  <div className="row-actions">
                    <button className="icon-btn" aria-label="Edit" onClick={() => setEdit(d)}>✎</button>
                    <button className="icon-btn danger" aria-label="Delete" onClick={() => dispatch({ type: 'debt/delete', payload: { id: d.id } })}>🗑</button>
                  </div>
                </div>
                <div className="debt-bal">{fmt(d.balance, { decimals: 0 })}</div>
                <div className="progress" aria-label={`${Math.round(paid * 100)}% paid off`}><span style={{ width: `${paid * 100}%` }} /></div>
                <div className="debt-meta">
                  <span>{Math.round(paid * 100)}% paid off</span>
                  <span className={d.apr >= 15 ? 'neg' : ''}>{d.apr || 0}% APR</span>
                  <span>{fmt(d.minPayment || 0)}/mo</span>
                </div>
                <div className="muted sm">Cleared {payoffDate(today, plans.avalanche.payoffMonth[d.id] ?? Infinity)} on the plan below</div>
              </div>
            );
          })}
        </div>
      )}

      {debts.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Payoff plan</h3></div>
          <label className="slider">
            <span>Extra per month on top of minimums: <b>{fmt(extra, { decimals: 0 })}</b></span>
            <input type="range" min="0" max="1000" step="10" value={extra} onChange={(e) => setExtra(+e.target.value)} />
          </label>
          <div className="plans">
            {[
              { key: 'avalanche', name: 'Avalanche', desc: 'Highest interest first. Pays the least interest overall.' },
              { key: 'snowball', name: 'Snowball', desc: 'Smallest balance first. Clears debts sooner for quick wins.' },
            ].map((p) => {
              const r = plans[p.key];
              const best = plans.avalanche.totalInterest <= plans.snowball.totalInterest ? 'avalanche' : 'snowball';
              return (
                <div key={p.key} className={`plan ${best === p.key ? 'best' : ''}`}>
                  <div className="plan-head"><h4>{p.name}</h4><span>{best === p.key && <span className="badge done">✓ Cheapest</span>} {chosen === p.key ? <span className="badge must">Your plan</span> : <button className="btn ghost sm" onClick={() => dispatch({ type: 'settings/update', payload: { debtPlan: { strategy: p.key, extra } } })}>Use this</button>}</span></div>
                  <p className="muted sm">{p.desc}</p>
                  <div className="plan-stats">
                    <div><span>Debt-free</span><b>{payoffDate(today, r.months)}</b></div>
                    <div><span>Total interest</span><b>{fmt(r.totalInterest, { decimals: 0 })}</b></div>
                    <div><span>Saved vs minimums</span><b className="pos">{fmt(Math.max(0, plans.minimum.totalInterest - r.totalInterest), { decimals: 0 })}</b></div>
                  </div>
                  <ol className="order">{order(p.key).map((d) => <li key={d.id}>{d.name} <span className="muted">· {fmt(d.balance, { decimals: 0 })} at {d.apr || 0}%</span></li>)}</ol>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {edit && <Modal title={edit.id ? `Edit ${edit.name}` : 'Add debt'} onClose={() => setEdit(null)}><DebtForm initial={edit.id ? edit : null} onDone={() => setEdit(null)} /></Modal>}
    </div>
  );
}
