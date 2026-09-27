import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import Modal from '../components/Modal.jsx';
import { TxnForm } from '../components/Forms.jsx';
import { shortDate } from '../../engine/dates.js';
import ReceiptEditor from '../components/ReceiptEditor.jsx';
import { ITEMISABLE } from '../../engine/receipts.js';
import { SplitModal, SettleModal } from '../components/Split.jsx';
import { myAmount, openSplits } from '../../engine/split.js';
import { formatMoney } from '../../engine/money.js';

const PAGE = 100;

export default function Transactions({ go }) {
  const { state, dispatch, fmt, cats, notify } = useApp();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [month, setMonth] = useState('');
  const [edit, setEdit] = useState(null);
  const [limit, setLimit] = useState(PAGE);
  const [receipt, setReceipt] = useState(null);
  const [splitTxn, setSplitTxn] = useState(null);
  const [settleTxn, setSettleTxn] = useState(null);
  const hasOpenSplits = useMemo(() => openSplits(state).some((s) => s.outstanding > 0.005), [state]);
  const itemised = useMemo(() => new Map((state.receipts || []).map((r) => [r.txnId, r.items.length])), [state.receipts]);

  const months = useMemo(() => [...new Set(state.transactions.map((t) => t.date.slice(0, 7)))].sort().reverse(), [state.transactions]);
  const list = useMemo(() => {
    const needle = q.toLowerCase();
    return state.transactions.filter((t) => (!cat || t.categoryId === cat) && (!month || t.date.startsWith(month)) && (!needle || t.description.toLowerCase().includes(needle)));
  }, [state.transactions, q, cat, month]);
  const totalOut = list.filter((t) => t.amount < 0).reduce((s, t) => s - t.amount, 0);
  const totalIn = list.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);

  const recategorise = async (t, categoryId) => {
    await dispatch({ type: 'txn/update', payload: { id: t.id, categoryId, learn: true } });
    notify(`Got it. Future "${t.description.slice(0, 24)}" payments will go to ${cats[categoryId].name}`, 'good');
  };

  return (
    <div className="page">
      <header className="page-head">
        <div><h1>Transactions</h1><p className="muted">{list.length} shown · in {fmt(totalIn)} · out {fmt(totalOut)}</p></div>
        <div className="head-actions">
          <button className="btn ghost" onClick={() => go('connect')}>Import statement</button>
          <button className="btn primary" onClick={() => setEdit({})}>+ Add</button>
        </div>
      </header>
      <div className="filters">
        <input type="search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {state.categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(e.target.value)}>
          <option value="">All months</option>
          {months.map((m) => <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</option>)}
        </select>
      </div>
      <div className="card flush">
        {list.length === 0 ? <p className="empty">No transactions match.</p> : (
          <table className="table txns">
            <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="num">Amount</th><th className="center" title="Shared payment: part of it will be paid back to you">Split</th><th /></tr></thead>
            <tbody>
              {list.slice(0, limit).map((t) => (
                <tr key={t.id}>
                  <td className="muted nowrap">{shortDate(t.date)}</td>
                  <td>
                    <button className="linkish" onClick={() => setEdit(t)}>{t.description}</button>
                    {t.source !== 'manual' && <span className="src">{t.source === 'bank' ? 'bank' : t.source === 'demo' ? 'demo' : 'csv'}</span>}
                    {t.amount < 0 && ITEMISABLE[t.categoryId] && (
                      <button className={`receipt-btn ${itemised.has(t.id) ? 'done' : ''}`} onClick={() => setReceipt(t)} title={itemised.has(t.id) ? 'Edit receipt items' : 'Add receipt items'}>🧾 {itemised.has(t.id) ? `${itemised.get(t.id)} items` : 'Itemise'}</button>
                    )}
                  </td>
                  <td>
                    <select className="cat-select" style={{ '--c': cats[t.categoryId]?.color }} value={t.categoryId} onChange={(e) => recategorise(t, e.target.value)} aria-label="Category">
                      {state.categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
                    </select>
                  </td>
                  <td className={`num ${t.amount > 0 ? 'pos' : ''}`}>
                    {t.split?.owed > 0 ? (
                      <><span className="struck">{fmt(t.amount)}</span><div className="share">your share {fmt(myAmount(t))}</div></>
                    ) : fmt(t.amount, { sign: true })}
                    {t.original && <div className="muted xs">{formatMoney(t.original.amount, t.original.currency)}</div>}
                  </td>
                  <td className="center">
                    {t.amount < 0 ? (
                      <label className="switch sm" title={t.split ? 'Edit split' : 'Mark as a shared payment'}>
                        <input type="checkbox" checked={!!t.split} onChange={() => setSplitTxn(t)} aria-label="Split" />
                        <span />
                      </label>
                    ) : (t.settles || hasOpenSplits) ? (
                      <button className={`receipt-btn ${t.settles ? 'done' : ''}`} onClick={() => setSettleTxn(t)} title="Link this money to split payments it pays back">🤝 {t.settles ? 'Linked' : 'Link'}</button>
                    ) : null}
                  </td>
                  <td className="num"><button className="icon-btn danger" title="Delete" aria-label="Delete" onClick={() => dispatch({ type: 'txn/delete', payload: { id: t.id } })}>🗑</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {list.length > limit && <div className="more-row"><button className="btn ghost" onClick={() => setLimit((l) => l + PAGE)}>Show more ({list.length - limit} left)</button></div>}
      </div>
      {splitTxn && <SplitModal txn={splitTxn} onClose={() => setSplitTxn(null)} />}
      {settleTxn && <SettleModal incoming={settleTxn} onClose={() => setSettleTxn(null)} />}
      {receipt && <ReceiptEditor txn={receipt} onClose={() => setReceipt(null)} />}
      {edit && <Modal title={edit.id ? 'Edit transaction' : 'Add transaction'} onClose={() => setEdit(null)}><TxnForm initial={edit.id ? edit : null} onDone={() => setEdit(null)} /></Modal>}
    </div>
  );
}
