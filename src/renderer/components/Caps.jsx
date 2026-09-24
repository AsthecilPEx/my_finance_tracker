import { useState } from 'react';
import { useApp } from '../store.jsx';
import Modal from './Modal.jsx';
import { Field, CategorySelect } from './Forms.jsx';
import { CAP_PERIODS, evaluateCaps } from '../../engine/caps.js';
import { TIERS, SECTIONS } from '../../engine/receipts.js';

const STATUS = {
  ok: { icon: '✓', label: 'On track', color: 'var(--good)' },
  near: { icon: '◐', label: 'Nearing cap', color: 'var(--warning)' },
  over: { icon: '⚠', label: 'Over cap', color: 'var(--critical)' },
};

export function CapList({ compact = false }) {
  const { state, today, fmt } = useApp();
  const [edit, setEdit] = useState(null);
  const caps = evaluateCaps(state, today);
  const list = compact ? caps.filter((c) => c.status !== 'ok') : caps;
  return (
    <>
      {!compact && <div className="card-head"><h3>🚦 Spend caps</h3><button className="btn ghost sm" onClick={() => setEdit({ scope: 'tier', tier: 'low', section: 'groceries', amount: '', period: 'month', alertAt: 0.8, name: '' })}>+ New cap</button></div>}
      {!compact && list.length === 0 && <p className="empty">Caps warn you before you overspend. Try one on "not so important" groceries or eating out.</p>}
      <ul className="caps">
        {list.map((c) => {
          const s = STATUS[c.status];
          return (
            <li key={c.cap.id} className={`cap ${c.status}`}>
              <div className="cap-head">
                <b>{c.label}</b>
                <span className="cap-status" style={{ color: s.color }}><i aria-hidden>{s.icon}</i> {s.label}</span>
                {!compact && <button className="icon-btn" aria-label="Edit cap" onClick={() => setEdit(c.cap)}>✎</button>}
              </div>
              <div className="cap-track"><span style={{ width: `${Math.min(100, c.pct * 100)}%`, background: s.color }} /><i style={{ left: `${(c.cap.alertAt ?? 0.8) * 100}%` }} title="Alert threshold" /></div>
              <div className="cap-meta muted sm">
                <span>{fmt(c.spent)} of {fmt(c.cap.amount)} {c.window.label}</span>
                <span>{c.remaining >= 0 ? `${fmt(c.remaining)} left` : `${fmt(-c.remaining)} over`} · {c.daysLeft} day{c.daysLeft === 1 ? '' : 's'} to go{c.cap.source === 'ai' ? ' · from AI plan' : ''}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {edit && <CapModal cap={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function CapModal({ cap, onClose }) {
  const { dispatch } = useApp();
  const [c, setC] = useState(cap);
  const set = (k) => (e) => setC({ ...c, [k]: e?.target ? e.target.value : e });
  const save = async (e) => {
    e.preventDefault();
    const payload = { ...c, amount: +c.amount, alertAt: +c.alertAt };
    if (c.scope !== 'category') delete payload.categoryId;
    if (c.scope !== 'tier') delete payload.tier;
    if (!['tier', 'section'].includes(c.scope)) delete payload.section;
    await dispatch({ type: 'cap/save', payload });
    onClose();
  };
  return (
    <Modal title={cap.id ? 'Edit spend cap' : 'New spend cap'} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <Field label="Name (optional)"><input value={c.name || ''} onChange={set('name')} placeholder="e.g. Treats in the weekly shop" /></Field>
        <Field label="What should this cap cover?">
          <select value={c.scope} onChange={set('scope')}>
            <option value="tier">Items by importance (from receipts)</option>
            <option value="section">A whole receipt section</option>
            <option value="category">A spending category</option>
            <option value="total">All spending</option>
          </select>
        </Field>
        {c.scope === 'category' && <Field label="Category"><CategorySelect value={c.categoryId || 'eating_out'} onChange={set('categoryId')} filter={(x) => !['income', 'transfer'].includes(x.type)} /></Field>}
        {c.scope === 'tier' && (
          <Field label="Importance">
            <select value={c.tier} onChange={set('tier')}>{Object.entries(TIERS).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select>
          </Field>
        )}
        {['tier', 'section'].includes(c.scope) && (
          <Field label="Section">
            <select value={c.section || ''} onChange={set('section')}>
              {c.scope === 'tier' && <option value="">All sections</option>}
              {Object.entries(SECTIONS).map(([k, s]) => <option key={k} value={k}>{s.icon} {s.label}</option>)}
            </select>
          </Field>
        )}
        <div className="row2">
          <Field label="Cap amount"><input type="number" min="1" step="1" required value={c.amount} onChange={set('amount')} /></Field>
          <Field label="Period"><select value={c.period} onChange={set('period')}>{Object.entries(CAP_PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </div>
        <Field label={`Warn me at ${Math.round(c.alertAt * 100)}% of the cap`}>
          <input type="range" min="0.5" max="1" step="0.05" value={c.alertAt} onChange={set('alertAt')} />
        </Field>
        <div className="form-actions">
          {cap.id && <button type="button" className="btn ghost danger" onClick={() => { dispatch({ type: 'cap/delete', payload: { id: cap.id } }); onClose(); }}>Delete</button>}
          <span className="grow" />
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary">Save cap</button>
        </div>
      </form>
    </Modal>
  );
}
