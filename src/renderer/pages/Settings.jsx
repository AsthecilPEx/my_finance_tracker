import { useState } from 'react';
import { useApp } from '../store.jsx';
import { api, isDesktop } from '../api.js';
import { createDemoState } from '../../engine/demo.js';
import { newIncome, profileSummary, describeSchedule } from '../../engine/income.js';
import { Field } from '../components/Forms.jsx';
import Modal from '../components/Modal.jsx';
import IncomeEditor from '../components/IncomeEditor.jsx';

export default function Settings() {
  const { state, dispatch, notify, today, fmt } = useApp();
  const st = state.settings;
  const profile = state.profile;
  const set = (patch) => dispatch({ type: 'settings/update', payload: patch });
  const prof = profileSummary(state);
  const [editing, setEditing] = useState(null);

  const restore = async () => {
    const data = await api.importBackup();
    if (!data) return;
    if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) return notify('That file is not a Pulse backup', 'critical');
    await dispatch({ type: 'data/replace', payload: data });
    notify('Backup restored', 'good');
  };

  const saveIncome = async () => {
    await dispatch({ type: 'income/save', payload: editing });
    notify(`${editing.name} saved. Your calendar is updated.`, 'good');
    setEditing(null);
  };

  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>Settings</h1><p className="muted">Change anything here and the calendar, planner and insights update straight away.</p></div></header>

      <div className="card" id="profile">
        <div className="card-head"><h3>👤 Profile & Pay</h3><span className="muted sm">≈ {fmt(prof.monthly, { decimals: 0 })} a month take-home</span></div>
        <div className="row3">
          <Field label="Your name"><input defaultValue={profile.name} onBlur={(e) => dispatch({ type: 'profile/update', payload: { name: e.target.value.trim() } })} /></Field>
          <Field label="Tax region">
            <select value={profile.region} onChange={(e) => dispatch({ type: 'profile/update', payload: { region: e.target.value } })}>
              <option value="ruk">England, Wales or NI</option>
              <option value="scotland">Scotland</option>
            </select>
          </Field>
          <Field label="Currency">
            <select value={st.currency} onChange={(e) => set({ currency: e.target.value })}>
              <option value="GBP">£ Pound sterling</option>
              <option value="EUR">€ Euro</option>
            </select>
          </Field>
        </div>
        <ul className="list">
          {prof.sources.map((s) => (
            <li key={s.inc.id} className="list-row">
              <span aria-hidden>💼</span>
              <span className="grow"><b>{s.inc.name}</b><small className="muted"> · {describeSchedule(s.inc.schedule)}{s.th.band ? ` · ${s.th.band}` : ''}{s.inc.variable ? ' · variable' : ''}</small></span>
              <span className="muted">{fmt(s.plannedPerPay)} per pay</span>
              <b>{fmt(s.monthly, { decimals: 0 })}/mo</b>
              <button className="icon-btn" aria-label={`Edit ${s.inc.name}`} onClick={() => setEditing(s.inc)}>✎</button>
            </li>
          ))}
          {!prof.sources.length && <li className="muted">No income added yet. Add one so paydays appear on your calendar.</li>}
        </ul>
        <button className="btn ghost" onClick={() => setEditing(newIncome({ name: prof.sources.length ? 'Second income' : 'Main job', taxCode: prof.sources.length ? 'BR' : '1257L' }))}>+ Add income</button>
      </div>

      <div className="card">
        <h3>🪣 Bills pot & safety net</h3>
        <Toggle label="Tell me how much to set aside for bills each payday" checked={st.billPot?.enabled} onChange={(v) => set({ billPot: { ...st.billPot, enabled: v } })} />
        <Field label="Money already in your bills pot / buffer" hint="Used by the Pay Planner to tell you whether your buffer is big enough">
          <input type="number" min="0" step="1" defaultValue={st.billPot?.balance || ''} onBlur={(e) => set({ billPot: { ...st.billPot, balance: +e.target.value || 0 } })} />
        </Field>
        <Toggle label="Ask me to itemise supermarket and shopping receipts" checked={st.receiptPrompts !== false} onChange={(v) => set({ receiptPrompts: v })} />
      </div>

      {isDesktop && (
        <div className="card">
          <h3>🖥️ Desktop</h3>
          <Toggle label="Start Pulse when Windows starts" checked={st.launchAtLogin} onChange={(v) => set({ launchAtLogin: v })} />
          <Toggle label="Closing the window keeps Pulse running in the tray (for syncing and reminders)" checked={st.minimizeToTray} onChange={(v) => set({ minimizeToTray: v })} />
          <Toggle label="Reminders: bills due tomorrow, payday, spend caps, receipts" checked={st.notifications} onChange={(v) => set({ notifications: v })} />
          <Toggle label="Keep the desktop widget on top of other windows" checked={st.widget.pinned} onChange={(v) => { set({ widget: { pinned: v } }); api.setWidgetPinned(v); }} />
          <Field label={`Widget opacity: ${Math.round(st.widget.opacity * 100)}%`}>
            <input type="range" min="0.6" max="1" step="0.02" value={st.widget.opacity} onChange={(e) => set({ widget: { opacity: +e.target.value } })} />
          </Field>
          <button className="btn ghost" onClick={() => api.toggleWidget()}>Show / hide widget</button>
        </div>
      )}

      <div className="card">
        <h3>💾 Your data</h3>
        <p className="muted">Everything is stored locally on this computer{isDesktop ? ' with automatic daily backups' : ''}. Nothing is uploaded anywhere.</p>
        <div className="inline-row wrap">
          <button className="btn ghost" onClick={() => api.exportBackup(state)}>Export backup</button>
          <button className="btn ghost" onClick={restore}>Restore backup</button>
          <button className="btn ghost" onClick={() => { dispatch({ type: 'txn/recategoriseAll' }); notify('Re-categorised using the latest rules', 'good'); }}>Re-run auto-categorisation</button>
          <button className="btn ghost" onClick={() => set({ onboarded: false })}>Run the setup wizard again</button>
        </div>
        <div className="inline-row wrap danger-zone">
          <button className="btn ghost" onClick={() => { if (confirm('Replace all data with demo data?')) dispatch({ type: 'data/replace', payload: createDemoState(today) }); }}>Load demo data</button>
          <button className="btn danger" onClick={() => { if (confirm('Delete ALL transactions, bills, debts, receipts and settings? This cannot be undone.')) dispatch({ type: 'data/reset' }); }}>Erase everything</button>
        </div>
      </div>
      <p className="muted sm">Pulse Finance · Bank holidays: England & Wales · Tax estimates are a guide; your payslip is the final word.</p>

      {editing && (
        <Modal title={editing.name || 'Income'} wide onClose={() => setEditing(null)}>
          <IncomeEditor value={editing} region={profile.region} onChange={setEditing} />
          <div className="form-actions">
            {profile.incomes.some((i) => i.id === editing.id) && <button className="btn ghost danger" onClick={() => { dispatch({ type: 'income/delete', payload: { id: editing.id } }); setEditing(null); }}>Delete</button>}
            <span className="grow" />
            <button className="btn ghost" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn primary" onClick={saveIncome}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="toggle-row">
      <span>{label}</span>
      <span className="switch"><input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} /><span /></span>
    </label>
  );
}
