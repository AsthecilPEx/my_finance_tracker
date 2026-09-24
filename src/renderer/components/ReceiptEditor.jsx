import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api, isDesktop } from '../api.js';
import Modal from './Modal.jsx';
import { TIERS, SECTIONS, parseReceiptText, suggestTier, receiptSectionFor, normaliseItem } from '../../engine/receipts.js';
import { newId } from '../../engine/state.js';
import { shortDate } from '../../engine/dates.js';

export function TierPicker({ value, onChange }) {
  return (
    <div className="tier-picker" role="radiogroup" aria-label="Importance">
      {Object.entries(TIERS).map(([k, t]) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} title={t.label} className={value === k ? 'on' : ''} style={{ '--c': t.color }} onClick={() => onChange(k)}>
          <i aria-hidden>{t.icon}</i>{k === 'essential' ? 'Essential' : k === 'moderate' ? 'Moderate' : 'Not so'}
        </button>
      ))}
    </div>
  );
}

export default function ReceiptEditor({ txn, onClose }) {
  const { state, dispatch, fmt, notify } = useApp();
  const existing = (state.receipts || []).find((r) => r.txnId === txn.id);
  const section = existing?.section || receiptSectionFor(txn);
  const [items, setItems] = useState(existing?.items || []);
  const [image, setImage] = useState(existing?.image || null);
  const [preview, setPreview] = useState(null);
  const [quick, setQuick] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (image && !preview && isDesktop) api.receipts.image(image).then(setPreview).catch(() => {});
  }, [image, preview]);

  const withRules = (list) => list.map((it) => {
    const rule = state.itemRules?.[normaliseItem(it.name)];
    return { id: newId(), qty: 1, ...it, tier: it.tier || suggestTier(it.name, state.itemRules), section: rule?.section || section };
  });

  const addParsed = (text) => {
    const parsed = parseReceiptText(text);
    const found = parsed.items.filter((i) => i.name);
    setItems((cur) => [...cur, ...withRules(found)]);
    return found.length;
  };

  const photo = async () => {
    const f = await api.receipts.pickImage();
    if (!f) return;
    setImage(f.file);
    setPreview(f.dataUrl);
    if (!isDesktop) return;
    setBusy('Reading your receipt…');
    try {
      const text = await api.receipts.ocr(f.file);
      const n = addParsed(text);
      notify(n ? `Found ${n} item${n === 1 ? '' : 's'}. Check them below.` : "Couldn't read items. Type them below instead.", n ? 'good' : 'info');
    } catch (e) {
      notify(e.message, 'critical');
    } finally {
      setBusy('');
    }
  };

  const upd = (id, patch) => setItems((cur) => cur.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const total = -txn.amount;
  const itemsTotal = Math.round(items.reduce((s, i) => s + (+i.price || 0), 0) * 100) / 100;
  const gap = Math.round((total - itemsTotal) * 100) / 100;

  const save = async () => {
    const clean = items.filter((i) => i.name && +i.price).map((i) => ({ ...i, price: +i.price, qty: +i.qty || 1 }));
    await dispatch({ type: 'receipt/save', payload: { id: existing?.id || newId(), txnId: txn.id, date: txn.date, merchant: txn.description, total, section, image, items: clean } });
    notify(`Saved ${clean.length} item${clean.length === 1 ? '' : 's'} from ${txn.description}`, 'good');
    onClose();
  };

  return (
    <Modal title={`🧾 ${txn.description}`} wide onClose={onClose}>
      <div className="receipt-top">
        <div>
          <div className="muted sm">{shortDate(txn.date)} · {SECTIONS[section]?.label}</div>
          <div className="receipt-total">{fmt(total)}</div>
        </div>
        <div className="receipt-photo">
          {preview ? <img src={preview} alt="Receipt" /> : <div className="photo-placeholder">No photo</div>}
          <button className="btn ghost sm" onClick={photo} disabled={!!busy}>📷 {image ? 'Replace photo' : 'Add receipt photo'}</button>
          {!isDesktop && <small className="muted">Photo reading works in the desktop app</small>}
        </div>
      </div>
      {busy && <div className="scanning"><span className="spinner" />{busy}</div>}

      <div className="quick-add">
        <textarea rows={3} value={quick} onChange={(e) => setQuick(e.target.value)} placeholder={'Type or paste items, one per line:\nmilk 1.45\n2 x chicken @ 2.85'} />
        <button className="btn ghost" disabled={!quick.trim()} onClick={() => { const n = addParsed(quick); if (n) setQuick(''); else notify('Add a price at the end of each line, e.g. "bread 0.95"', 'info'); }}>Add lines</button>
      </div>

      <table className="table items-table">
        <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th>Importance</th><th>Section</th><th /></tr></thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id}>
              <td><input value={it.name} onChange={(e) => upd(it.id, { name: e.target.value })} /></td>
              <td className="num"><input className="qty" type="number" min="1" value={it.qty} onChange={(e) => upd(it.id, { qty: e.target.value })} /></td>
              <td className="num"><input className="price" type="number" step="0.01" value={it.price} onChange={(e) => upd(it.id, { price: e.target.value })} /></td>
              <td><TierPicker value={it.tier} onChange={(tier) => upd(it.id, { tier })} /></td>
              <td>
                <select value={it.section} onChange={(e) => upd(it.id, { section: e.target.value })}>
                  {Object.entries(SECTIONS).map(([k, s]) => <option key={k} value={k}>{s.icon} {s.label}</option>)}
                </select>
              </td>
              <td><button className="icon-btn danger" aria-label="Remove item" onClick={() => setItems((cur) => cur.filter((x) => x.id !== it.id))}>✕</button></td>
            </tr>
          ))}
          {!items.length && <tr><td colSpan={6} className="muted">No items yet. Add a photo, type lines above, or add a row.</td></tr>}
        </tbody>
      </table>
      <div className="inline-row wrap">
        <button className="btn ghost sm" onClick={() => setItems((cur) => [...cur, ...withRules([{ name: '', price: '' }])])}>+ Add row</button>
        <span className="grow" />
        <span className={Math.abs(gap) < 0.01 ? 'pos' : 'muted'}>Items {fmt(itemsTotal)} of {fmt(total)}{Math.abs(gap) >= 0.01 ? ` · ${fmt(Math.abs(gap))} ${gap > 0 ? 'not itemised' : 'over'}` : ' ✓ matches'}</span>
        {gap >= 0.01 && <button className="btn ghost sm" onClick={() => setItems((cur) => [...cur, { id: newId(), name: 'Other items', qty: 1, price: gap, tier: 'moderate', section }])}>Add remainder</button>}
      </div>
      <div className="form-actions">
        {!existing && <button className="btn ghost" onClick={() => { dispatch({ type: 'receipt/skip', payload: { txnId: txn.id } }); onClose(); }}>Don't ask for this one</button>}
        <span className="grow" />
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={!items.length}>Save receipt</button>
      </div>
    </Modal>
  );
}
