import { useMemo } from 'react';
import { useApp } from '../store.jsx';
import { generateInsights } from '../../engine/insights.js';
import { GroupedBars, SparkBars, SplitBar } from '../components/Charts.jsx';

const KIND = {
  critical: { label: 'Needs attention', icon: '⚠' },
  warning: { label: 'Watch', icon: '◐' },
  saving: { label: 'Saving opportunity', icon: '£' },
  info: { label: 'Good to know', icon: 'i' },
  good: { label: 'Doing well', icon: '✓' },
};

export default function Insights() {
  const { state, today, currency, fmt } = useApp();
  const ins = useMemo(() => generateInsights(state, today, currency), [state, today, currency]);
  const money0 = (v, axis) => (axis && v >= 1000 ? `${currency === 'EUR' ? '€' : '£'}${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : fmt(v, { decimals: 0 }));
  const labels = ins.monthly.map((m) => m.label);

  if (!state.transactions.length) {
    return (
      <div className="page">
        <header className="page-head"><div><h1>Insights</h1></div></header>
        <div className="card"><p className="empty">Insights appear once there's some history. Import a bank statement or add a few weeks of transactions.</p></div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Insights</h1><p className="muted">What your spending says, and where you can cut back.</p></div>
        {ins.potential > 0 && (
          <div className="potential"><span className="muted sm">Possible savings</span><b>{fmt(ins.potential, { decimals: 0 })}<small>/month</small></b></div>
        )}
      </header>

      <div className="insight-grid">
        {ins.cards.map((c) => (
          <article key={c.id} className={`insight ${c.kind}`}>
            <div className="insight-top">
              <span className="insight-icon" aria-hidden>{c.icon}</span>
              <span className={`kind-pill ${c.kind}`}><i aria-hidden>{KIND[c.kind].icon}</i>{KIND[c.kind].label}</span>
            </div>
            <h4>{c.title}</h4>
            <p>{c.detail}</p>
            {c.saving > 0 && (c.kind === 'saving' || c.kind === 'warning') && <div className="insight-save">Save up to {fmt(c.saving)} / month</div>}
          </article>
        ))}
        {ins.cards.length === 0 && <div className="card"><p className="empty">Nothing stands out right now. Your spending is in line with your usual.</p></div>}
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head"><h3>Money in vs money out</h3></div>
          <GroupedBars
            rows={ins.monthly}
            series={[{ key: 'income', name: 'Income', color: '#12a578' }, { key: 'spent', name: 'Spending', color: '#ee6428' }]}
            format={money0}
          />
        </div>
        <div className="card">
          <div className="card-head"><h3>Compulsory vs optional</h3><span className="muted sm">monthly average, last 90 days</span></div>
          <SplitBar
            format={(v) => fmt(v, { decimals: 0 })}
            parts={[
              { key: 'c', label: 'Compulsory', value: ins.split.compulsory, color: '#3a86ee', hint: 'Rent, bills, insurance, groceries, debt' },
              { key: 'r', label: 'Recurring optional', value: ins.split.recurring, color: '#8f7cf0', hint: 'Subscriptions and memberships you could cancel' },
              { key: 'd', label: 'Discretionary', value: ins.split.discretionary, color: '#ee6428', hint: 'Day-to-day choices: your best place to cut' },
            ]}
          />
          <div className="subs-box">
            <div className="card-head"><h4>Subscriptions</h4><b>{fmt(ins.subscriptions.monthly)}/mo · {fmt(ins.subscriptions.monthly * 12, { decimals: 0 })}/yr</b></div>
            <ul className="list compact">
              {ins.subscriptions.list.map((r) => <li key={r.id} className="list-row"><span className="grow">{r.name}</span><span className="muted">{fmt(r.amount)}</span></li>)}
              {!ins.subscriptions.list.length && <li className="muted">No subscriptions tracked yet.</li>}
            </ul>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Category trends</h3><span className="muted sm">last 6 months · change is this month's pace vs your 3-month average</span></div>
        <div className="trend-grid">
          {ins.trends.map((c) => (
            <div key={c.id} className="trend">
              <div className="trend-head"><span aria-hidden>{c.icon}</span><span className="grow">{c.name}</span>
                {c.change !== null && Math.abs(c.change) >= 0.05 && (
                  <span className={`delta ${c.change > 0 ? 'up' : 'down'}`}>{c.change > 0 ? '▲' : '▼'} {Math.abs(Math.round(c.change * 100))}%</span>
                )}
              </div>
              <SparkBars values={c.series} color={c.color} labels={labels} format={(v) => fmt(v)} />
              <div className="trend-foot"><b>{fmt(c.current, { decimals: 0 })}</b><span className="muted"> this month · usual {fmt(c.avg3, { decimals: 0 })}</span></div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Where your money goes</h3><span className="muted sm">top merchants, last 90 days</span></div>
        <table className="table">
          <thead><tr><th>Merchant</th><th>Category</th><th className="num">Visits</th><th className="num">Total</th><th className="num">Per month</th></tr></thead>
          <tbody>
            {ins.topMerchants.map((m) => (
              <tr key={m.name}>
                <td>{m.name}</td>
                <td className="muted">{state.categories.find((c) => c.id === m.categoryId)?.name}</td>
                <td className="num">{m.count}</td>
                <td className="num">{fmt(m.total)}</td>
                <td className="num">{fmt(m.total / 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
