import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { reviewQueue } from '../../engine/review.js';
import { openSplits } from '../../engine/split.js';
import { CategorySelect } from './Forms.jsx';
import { SettleModal } from './Split.jsx';

/** Dashboard panel: questions about your transactions that only you can answer. */
export default function ReviewPanel() {
  const { state, today, fmt, dispatch, notify } = useApp();
  const { items, total } = useMemo(() => reviewQueue(state, today), [state, today]);
  const [settle, setSettle] = useState(null);
  const byId = (id) => state.transactions.find((t) => t.id === id);
  const review = (ids, categoryId, msg) => { dispatch({ type: 'txn/review', payload: { ids, categoryId } }); if (msg) notify(msg, 'good'); };
  const later = (key) => dispatch({ type: 'review/dismiss', payload: { key } });

  return (
    <div className="card review">
      <div className="card-head">
        <h3>🔔 Needs your attention {total > 0 && <span className="count-badge">{total}</span>}</h3>
        <span className="muted sm">Quick questions so your numbers stay accurate</span>
      </div>
      {items.length === 0 ? <p className="empty">✓ All clear. Nothing needs checking right now.</p> : (
        <ul className="review-list">
          {items.map((it) => (
            <li key={it.key} className={`review-item ${it.kind}`}>
              <span className="review-icon" aria-hidden>{it.icon}</span>
              <div className="grow">
                <div className="review-title"><b>{it.title}</b><b className={it.kind === 'money-in' ? 'pos' : ''}>{fmt(it.amount)}</b></div>
                <div className="muted sm">{it.detail}</div>
                <div className="review-actions">
                  {it.kind === 'transfer' && (
                    <>
                      <button className="btn primary sm" onClick={() => review(it.txnIds, 'transfer', 'Marked as a transfer. Not counted as money in or spending.')}>Yes, it's a transfer</button>
                      <button className="btn ghost sm" onClick={() => review(it.txnIds)}>No</button>
                    </>
                  )}
                  {it.kind === 'money-in' && (
                    <>
                      <button className={`btn sm ${it.suggestTransfer ? 'primary' : 'ghost'}`} onClick={() => review(it.txnIds, 'transfer', 'Marked as a transfer between your accounts')}>Transfer from my account</button>
                      {it.canSplit && <button className={`btn sm ${!it.suggestTransfer ? 'primary' : 'ghost'}`} onClick={() => setSettle(byId(it.txnIds[0]))}>🤝 Split repayment…</button>}
                      <button className="btn ghost sm" onClick={() => review(it.txnIds, 'income_other', 'Counted as income')}>It's income</button>
                      <button className="btn ghost sm" onClick={() => review(it.txnIds, 'income_other', 'Counted as a refund')}>Refund</button>
                    </>
                  )}
                  {it.kind === 'categorise' && (
                    <div className="inline-row">
                      <CategorySelect value="" onChange={(c) => { dispatch({ type: 'txn/update', payload: { id: it.txnIds[0], categoryId: c, learn: true } }); review(it.txnIds, c, 'Category saved. Similar payments will follow it.'); }} filter={(c) => c.type !== 'income'} />
                    </div>
                  )}
                  {it.kind === 'split-overdue' && <SplitOverdueActions it={it} />}
                  {it.kind === 'bill-amount' && <BillAmount it={it} />}
                  <button className="linkish muted sm" onClick={() => later(it.key)}>Not now</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {total > items.length && <p className="muted sm">+{total - items.length} more. Answer these first.</p>}
      {settle && <SettleModal incoming={settle} onClose={() => setSettle(null)} />}
    </div>
  );
}

function SplitOverdueActions({ it }) {
  const { state, today, dispatch, notify, fmt } = useApp();
  const s = openSplits(state, today).find((x) => x.txn.id === it.txnIds[0]);
  if (!s) return null;
  return (
    <>
      <button className="btn ghost sm" onClick={() => { dispatch({ type: 'split/writeOff', payload: { id: s.txn.id, amount: s.outstanding + (s.txn.split.writtenOff || 0) } }); notify('Marked as paid back', 'good'); }}>Paid back in cash / elsewhere</button>
      <button className="btn ghost sm" onClick={() => { dispatch({ type: 'txn/split', payload: { id: s.txn.id, split: { ...s.txn.split, owed: s.paid } } }); notify(`${fmt(s.outstanding)} now counts as your spending`, 'info'); }}>They won't pay: count it as mine</button>
    </>
  );
}

function BillAmount({ it }) {
  const { dispatch, notify, fmt } = useApp();
  const [amount, setAmount] = useState('');
  const save = (e) => {
    e.preventDefault();
    const n = parseFloat(amount);
    if (!(n >= 0)) return;
    dispatch({ type: 'occ/override', payload: { key: it.occKey, amount: n } });
    notify(`Saved: ${fmt(n)} due ${it.date}. Your plan is updated.`, 'good');
  };
  return (
    <form className="inline-row" onSubmit={save}>
      <input type="number" step="0.01" min="0" inputMode="decimal" className="amount-sm" placeholder={it.estimate.toFixed(2)} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Real amount" />
      <button className="btn primary sm" disabled={amount === ''}>Save amount</button>
      <button type="button" className="btn ghost sm" onClick={() => { dispatch({ type: 'occ/override', payload: { key: it.occKey, amount: it.estimate } }); notify('Using the estimate', 'info'); }}>Estimate is right</button>
    </form>
  );
}
