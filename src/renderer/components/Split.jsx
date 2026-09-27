import { useMemo, useState } from 'react';
import { useApp } from '../store.jsx';
import { api } from '../api.js';
import Modal from './Modal.jsx';
import { Field } from './Forms.jsx';
import { openSplits } from '../../engine/split.js';
import { shortDate } from '../../engine/dates.js';

/** "Split" a payment: say how much of it will be paid back to you. */
export function SplitModal({ txn, onClose }) {
  const { dispatch, fmt, notify } = useApp();
  const total = -txn.amount;
  const cur = txn.split || {};
  const [people, setPeople] = useState(cur.people || 2);
  const [mode, setMode] = useState(cur.mode || 'equal');
  const [owed, setOwed] = useState(cur.owed ?? Math.round((total * (1 - 1 / 2)) * 100) / 100);
  const [who, setWho] = useState(cur.who || '');
  const [expectedBy, setExpectedBy] = useState(cur.expectedBy || '');
  const [tracked, setTracked] = useState(!!cur.trackedElsewhere);
  const [note, setNote] = useState(cur.note || '');
  const value = mode === 'equal' ? Math.round(total * (1 - 1 / Math.max(1, people)) * 100) / 100 : Math.min(total, Math.max(0, +owed || 0));

  const save = async () => {
    await dispatch({ type: 'txn/split', payload: { id: txn.id, split: { owed: value, who: who.trim(), expectedBy: expectedBy || null, trackedElsewhere: tracked, note: note.trim(), mode, people } } });
    notify(`Split saved. Your share is ${fmt(total - value)}${tracked ? '' : '. Remember to add it to Splitwise'}`, 'good');
    onClose();
  };
  const remove = async () => {
    await dispatch({ type: 'txn/split', payload: { id: txn.id, split: null } });
    onClose();
  };

  return (
    <Modal title="🤝 Split this payment" onClose={onClose}>
      <div className="split-head"><b>{txn.description}</b><span className="muted">{shortDate(txn.date)} · you paid {fmt(total)}</span></div>
      <div className="seg">
        <button type="button" className={mode === 'equal' ? 'on in' : ''} onClick={() => setMode('equal')}>Split equally</button>
        <button type="button" className={mode === 'amount' ? 'on in' : ''} onClick={() => setMode('amount')}>Exact amount back</button>
      </div>
      <div className="form">
        {mode === 'equal' ? (
          <Field label="How many people is it shared between (including you)?"><input type="number" min="2" max="20" value={people} onChange={(e) => setPeople(+e.target.value || 2)} /></Field>
        ) : (
          <Field label="How much is being paid back to you?"><input type="number" min="0" max={total} step="0.01" value={owed} onChange={(e) => setOwed(e.target.value)} /></Field>
        )}
        <div className="split-summary">
          <div><span>Paid back to you</span><b className="pos">{fmt(value)}</b></div>
          <div><span>Your share (counts as your spending)</span><b>{fmt(total - value)}</b></div>
        </div>
        <div className="row2">
          <Field label="Who owes you? (optional)"><input value={who} onChange={(e) => setWho(e.target.value)} placeholder="e.g. Flatmates, Jay" /></Field>
          <Field label="Expected back by (optional)" hint="Leave blank if you're not sure. It doesn't affect the maths."><input type="date" value={expectedBy} onChange={(e) => setExpectedBy(e.target.value)} /></Field>
        </div>
        <Field label="Note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. House shop, split 3 ways" /></Field>
        <label className="check">
          <input type="checkbox" checked={tracked} onChange={(e) => setTracked(e.target.checked)} />
          <span><b>Is the owed money accounted for on Splitwise or through other methods?</b></span>
        </label>
        {!tracked && (
          <div className="callout">
            💡 Add it to Splitwise so everyone sees what they owe.{' '}
            <button type="button" className="linkish" onClick={() => api.openExternal('https://secure.splitwise.com/')}>Open Splitwise ↗</button>
          </div>
        )}
        <div className="form-actions">
          {txn.split && <button type="button" className="btn ghost danger" onClick={remove}>Remove split</button>}
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save} disabled={!(value > 0)}>Save split</button>
        </div>
      </div>
    </Modal>
  );
}

/** Link money you received to the split(s) it pays back (partial and multi-split payments allowed). */
export function SettleModal({ incoming, onClose }) {
  const { state, dispatch, fmt, today, notify } = useApp();
  const splits = useMemo(() => openSplits(state, today)
    .map((s) => {
      // Don't count this payment's own existing allocation as already paid when editing it.
      const mine = (incoming.settles || []).find((a) => a.txnId === s.txn.id)?.amount || 0;
      return { ...s, outstanding: Math.round((s.outstanding + mine) * 100) / 100 };
    })
    .filter((s) => s.outstanding > 0.005)
    .sort((a, b) => b.txn.date.localeCompare(a.txn.date)), [state, today, incoming]);
  const [alloc, setAlloc] = useState(() => Object.fromEntries((incoming.settles || []).map((a) => [a.txnId, a.amount])));
  const allocated = Math.round(Object.values(alloc).reduce((s, v) => s + (+v || 0), 0) * 100) / 100;
  const left = Math.round((incoming.amount - allocated) * 100) / 100;

  const autoFill = () => {
    let rest = incoming.amount;
    const next = {};
    for (const s of [...splits].reverse()) {
      if (rest <= 0) break;
      const take = Math.min(rest, s.outstanding);
      next[s.txn.id] = Math.round(take * 100) / 100;
      rest -= take;
    }
    setAlloc(next);
  };
  const save = async () => {
    await dispatch({ type: 'split/settle', payload: { incomingId: incoming.id, allocations: Object.entries(alloc).map(([txnId, amount]) => ({ txnId, amount: +amount || 0 })) } });
    notify(`Linked ${fmt(allocated)} to ${Object.values(alloc).filter((v) => +v > 0).length} split(s). It won't count as income.`, 'good');
    onClose();
  };

  return (
    <Modal title="🤝 Link a repayment" wide onClose={onClose}>
      <div className="split-head"><b>{incoming.description}</b><span className="muted">{shortDate(incoming.date)} · received <b className="pos">{fmt(incoming.amount)}</b></span></div>
      {splits.length === 0 ? <p className="empty">You have no split payments waiting to be paid back. Mark a payment as "Split" first.</p> : (
        <>
          <p className="muted sm">Tick which shared payments this money is paying back. One payment can cover several splits, or part of one.</p>
          <table className="table">
            <thead><tr><th /><th>Shared payment</th><th>Who</th><th className="num">Still owed</th><th className="num">From this payment</th></tr></thead>
            <tbody>
              {splits.map((s) => {
                const on = +alloc[s.txn.id] > 0;
                return (
                  <tr key={s.txn.id}>
                    <td><input type="checkbox" checked={on} onChange={(e) => setAlloc({ ...alloc, [s.txn.id]: e.target.checked ? Math.min(s.outstanding, Math.max(0, left)) || s.outstanding : 0 })} aria-label="Link" /></td>
                    <td>{s.txn.description}<small className="muted"> · {shortDate(s.txn.date)}{s.overdue ? ' · overdue' : ''}</small></td>
                    <td className="muted">{s.txn.split.who || '–'}</td>
                    <td className="num">{fmt(s.outstanding)}</td>
                    <td className="num"><input className="price" type="number" min="0" step="0.01" max={s.outstanding} value={alloc[s.txn.id] || ''} onChange={(e) => setAlloc({ ...alloc, [s.txn.id]: e.target.value })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="inline-row wrap">
            <button className="btn ghost sm" onClick={autoFill}>Fill oldest first</button>
            <span className="grow" />
            <span className={left < -0.005 ? 'error' : 'muted'}>{left < -0.005 ? `${fmt(-left)} more than you received` : left > 0.005 ? `${fmt(left)} not linked (stays as a repayment)` : '✓ Fully linked'}</span>
          </div>
        </>
      )}
      <div className="form-actions">
        {incoming.settles && <button className="btn ghost danger" onClick={() => { dispatch({ type: 'split/unsettle', payload: { incomingId: incoming.id } }); onClose(); }}>Unlink</button>}
        <span className="grow" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!allocated || left < -0.005} onClick={save}>Link {fmt(allocated)}</button>
      </div>
    </Modal>
  );
}
