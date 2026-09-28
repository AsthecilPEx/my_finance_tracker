import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import ReceiptEditor from '../components/ReceiptEditor.jsx';
import { GroupedBars } from '../components/Charts.jsx';
import { basketAnalytics, receiptInbox, TIERS, SECTIONS } from '../../engine/receipts.js';
import { shortDate } from '../../engine/dates.js';

export default function Receipts() {
  const { state, today, fmt, currency, dispatch, cats } = useApp();
  const [open, setOpen] = useState(null);
  const [section, setSection] = useState('all');
  const inbox = useMemo(() => receiptInbox(state, today), [state, today]);
  const b = useMemo(() => basketAnalytics(state, today), [state, today]);
  const money0 = (v, axis) => (axis && v >= 1000 ? `${currency === 'EUR' ? '€' : '£'}${(v / 1000).toFixed(1)}k` : fmt(v, { decimals: 0 }));
  const rows = b.monthly.map((m, i) => ({
    label: m.label,
    partial: i === b.monthly.length - 1,
    ...(section === 'all' ? m.byTier : m.bySection[section]),
  }));
  const recent = [...(state.receipts || [])].sort((a, c) => c.date.localeCompare(a.date)).slice(0, 12);

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Receipts</h1><p className="muted">Small things add up. Itemise your shops to see what's essential and what's not so important.</p></div>
        {b.halveLowSaving > 0 && <div className="potential"><span className="muted sm">Halve "not so important" items</span><b>{fmt(b.halveLowSaving, { decimals: 0 })}<small>/month saved</small></b></div>}
      </header>

      <div className="kpis">
        {Object.entries(TIERS).map(([k, t]) => (
          <div key={k} className="kpi"><span><span className="swatch" style={{ background: t.color }} />{t.label}</span><b>{fmt(b.avgByTier[k], { decimals: 0 })}<small>/mo avg</small></b></div>
        ))}
        <div className="kpi"><span>Receipts itemised</span><b>{b.receiptsCount}</b></div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>📥 To itemise {inbox.length > 0 && <span className="count-badge">{inbox.length}</span>}</h3>
          {inbox.length > 3 && <button className="btn ghost sm" onClick={() => dispatch({ type: 'receipt/skip', payload: { ids: inbox.map((t) => t.id) } })}>Skip all</button>}
        </div>
        {inbox.length === 0 ? <p className="empty">All caught up! New supermarket and shopping payments will appear here.</p> : (
          <ul className="list">
            {inbox.slice(0, 8).map((t) => (
              <li key={t.id} className="list-row">
                <span aria-hidden>{cats[t.categoryId]?.icon}</span>
                <span className="grow"><b>{t.description}</b><small className="muted"> · {shortDate(t.date)} · {cats[t.categoryId]?.name}</small></span>
                <b>{fmt(-t.amount)}</b>
                <button className="btn primary sm" onClick={() => setOpen(t)}>🧾 Itemise</button>
                <button className="icon-btn" aria-label="Skip" title="Don't ask for this one" onClick={() => dispatch({ type: 'receipt/skip', payload: { txnId: t.id } })}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <h3>Spending by importance</h3>
            <div className="seg compact">
              {[['all', 'All'], ...Object.entries(SECTIONS).map(([k, s]) => [k, s.label.split(' ')[0]])].map(([k, l]) => <button key={k} className={section === k ? 'on in' : ''} onClick={() => setSection(k)}>{l}</button>)}
            </div>
          </div>
          {b.receiptsCount === 0 ? <p className="empty">Trends appear after a few itemised receipts.</p> : rows.every((r) => !(r.essential || r.moderate || r.low)) ? (
            <p className="empty">No itemised {SECTIONS[section]?.label.toLowerCase()} purchases yet. When you itemise a receipt, set its section to "{SECTIONS[section]?.label}" and the trend appears here.</p>
          ) : (
            <GroupedBars rows={rows} series={Object.entries(TIERS).map(([k, t]) => ({ key: k, name: t.label, color: t.color }))} format={money0} />
          )}
        </div>
        <div className="card">
          <div className="card-head"><h3>Top "not so important" buys</h3><span className="muted sm">last 90 days</span></div>
          {b.lowItems.length === 0 ? <p className="empty">Nothing yet.</p> : (
            <table className="table">
              <thead><tr><th>Item</th><th className="num">Times</th><th className="num">Total</th><th className="num">Per month</th></tr></thead>
              <tbody>{b.lowItems.map((i) => <tr key={i.name}><td>{i.name}</td><td className="num">{i.count}</td><td className="num">{fmt(i.total)}</td><td className="num">{fmt(i.perMonth)}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Recent receipts</h3></div>
        {recent.length === 0 ? <p className="empty">No receipts yet.</p> : (
          <ul className="list">
            {recent.map((r) => {
              const t = state.transactions.find((x) => x.id === r.txnId);
              const split = Object.keys(TIERS).map((k) => ({ k, v: r.items.filter((i) => i.tier === k).reduce((s, i) => s + (+i.price || 0), 0) }));
              return (
                <li key={r.id} className="list-row">
                  <span className="muted nowrap">{shortDate(r.date)}</span>
                  <span className="grow"><b>{r.merchant}</b><small className="muted"> · {r.items.length} items{r.image ? ' · 📷' : ''}</small></span>
                  <span className="mini-split" aria-label="Importance split">{split.filter((s) => s.v > 0).map((s) => <span key={s.k} style={{ flex: s.v, background: TIERS[s.k].color }} title={`${TIERS[s.k].label}: ${fmt(s.v)}`} />)}</span>
                  <b>{fmt(r.total)}</b>
                  {t && <button className="icon-btn" aria-label="Edit receipt" onClick={() => setOpen(t)}>✎</button>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {open && <ReceiptEditor txn={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
