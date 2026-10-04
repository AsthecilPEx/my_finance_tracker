import { useMemo } from 'react';
import { useApp } from '../store.jsx';
import { monthSummary } from '../../engine/summary.js';
import { parseISO } from '../../engine/dates.js';
import { PALETTE } from '../../engine/categories.js';
import { CapList } from '../components/Caps.jsx';

const TYPES = { essential: 'Essential', lifestyle: 'Lifestyle', debt: 'Debt', savings: 'Savings', transfer: 'Transfer (ignored)', income: 'Income' };

export default function Budgets() {
  const { state, dispatch, fmt, today, notify } = useApp();
  const t = parseISO(today);
  const s = useMemo(() => monthSummary(state, t.getFullYear(), t.getMonth(), today), [state, today]);
  const stats = Object.fromEntries(s.byCategory.map((c) => [c.id, c]));
  const avgFor = (id) => stats[id]?.avg3 || 0;
  const totalBudget = state.categories.reduce((a, c) => a + (c.budget || 0), 0);
  const save = (c, patch) => dispatch({ type: 'category/save', payload: { ...c, ...patch } });

  const useAverages = async () => {
    for (const c of state.categories) {
      const avg = avgFor(c.id);
      if (!c.budget && avg > 0 && c.type === 'lifestyle') await save(c, { budget: Math.ceil(avg / 5) * 5 });
    }
    notify('Budgets set from your 3-month averages', 'good');
  };

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Budgets & Caps</h1><p className="muted">Caps warn you before you overspend. Budgets set the category meters.</p></div>
        <button className="btn ghost" onClick={useAverages}>Fill empty budgets from averages</button>
      </header>
      <div className="card"><CapList /></div>
      <div className="kpis">
        <div className="kpi"><span>Total monthly budgets</span><b>{fmt(totalBudget, { decimals: 0 })}</b></div>
        <div className="kpi"><span>Expected income</span><b className="pos">{fmt(s.income, { decimals: 0 })}</b></div>
        <div className="kpi"><span>Unbudgeted</span><b>{fmt(s.income - totalBudget, { decimals: 0 })}</b></div>
      </div>
      <div className="card flush">
        <table className="table">
          <thead><tr><th>Category</th><th>Type</th><th>Colour</th><th className="num">This month</th><th className="num">3-mo average</th><th className="num">Monthly budget</th></tr></thead>
          <tbody>
            {state.categories.map((c) => (
              <tr key={c.id}>
                <td><span className="cat-name"><span aria-hidden>{c.icon}</span>{c.name}</span></td>
                <td>
                  <select value={c.type} onChange={(e) => save(c, { type: e.target.value })}>
                    {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td>
                  <div className="swatches">
                    {PALETTE.map((p) => <button key={p} className={`swatch-btn ${c.color === p ? 'on' : ''}`} style={{ background: p }} aria-label={`Colour ${p}`} onClick={() => save(c, { color: p })} />)}
                  </div>
                </td>
                <td className="num">{stats[c.id] ? fmt(stats[c.id].spent) : '–'}</td>
                <td className="num muted">{avgFor(c.id) ? fmt(avgFor(c.id)) : '–'}</td>
                <td className="num">
                  {c.type !== 'income' && c.type !== 'transfer' ? (
                    <input key={c.budget || 0} className="budget-input" type="number" min="0" step="5" defaultValue={c.budget || ''} placeholder="–" onBlur={(e) => +e.target.value !== (c.budget || 0) && save(c, { budget: +e.target.value || 0 })} />
                  ) : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {state.rules.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Learned rules</h3><span className="muted sm">Created when you re-categorise a transaction</span></div>
          <ul className="list compact">
            {state.rules.map((r) => (
              <li key={r.id} className="list-row">
                <span className="grow">"{r.merchant || r.pattern}" → {state.categories.find((c) => c.id === r.categoryId)?.name}</span>
                <button className="icon-btn danger" aria-label="Delete rule" onClick={() => dispatch({ type: 'rule/delete', payload: { id: r.id } })}>✕</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
