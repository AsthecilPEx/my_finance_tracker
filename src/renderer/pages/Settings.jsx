import { useApp } from '../store.jsx';
import { api, isDesktop } from '../api.js';
import { createDemoState } from '../../engine/demo.js';
import { Field } from '../components/Forms.jsx';

export default function Settings() {
  const { state, dispatch, notify, today } = useApp();
  const st = state.settings;
  const set = (patch) => dispatch({ type: 'settings/update', payload: patch });

  const restore = async () => {
    const data = await api.importBackup();
    if (!data) return;
    if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) return notify('That file is not a Pulse backup', 'critical');
    await dispatch({ type: 'data/replace', payload: data });
    notify('Backup restored', 'good');
  };

  return (
    <div className="page narrow">
      <header className="page-head"><div><h1>Settings</h1></div></header>
      <div className="card">
        <h3>General</h3>
        <div className="row2">
          <Field label="Your name"><input defaultValue={st.name} onBlur={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Currency">
            <select value={st.currency} onChange={(e) => set({ currency: e.target.value })}>
              <option value="GBP">£ British pound</option>
              <option value="EUR">€ Euro</option>
            </select>
          </Field>
        </div>
      </div>

      {isDesktop && (
        <div className="card">
          <h3>Desktop</h3>
          <Toggle label="Start Pulse when Windows starts" checked={st.launchAtLogin} onChange={(v) => set({ launchAtLogin: v })} />
          <Toggle label="Closing the window keeps Pulse running in the tray (for syncing and reminders)" checked={st.minimizeToTray} onChange={(v) => set({ minimizeToTray: v })} />
          <Toggle label="Reminders for bills due tomorrow and payday" checked={st.notifications} onChange={(v) => set({ notifications: v })} />
          <Toggle label="Keep the desktop widget on top of other windows" checked={st.widget.pinned} onChange={(v) => { set({ widget: { pinned: v } }); api.setWidgetPinned(v); }} />
          <Field label={`Widget opacity: ${Math.round(st.widget.opacity * 100)}%`}>
            <input type="range" min="0.6" max="1" step="0.02" value={st.widget.opacity} onChange={(e) => set({ widget: { opacity: +e.target.value } })} />
          </Field>
          <button className="btn ghost" onClick={() => api.toggleWidget()}>Show / hide widget</button>
        </div>
      )}

      <div className="card">
        <h3>Your data</h3>
        <p className="muted">Everything is stored locally on this computer{isDesktop ? ' (daily backups are kept automatically)' : ''}. Nothing is uploaded anywhere.</p>
        <div className="inline-row wrap">
          <button className="btn ghost" onClick={() => api.exportBackup(state)}>Export backup</button>
          <button className="btn ghost" onClick={restore}>Restore backup</button>
          <button className="btn ghost" onClick={() => { dispatch({ type: 'txn/recategoriseAll' }); notify('Re-categorised using the latest rules', 'good'); }}>Re-run auto-categorisation</button>
        </div>
        <div className="inline-row wrap danger-zone">
          <button className="btn ghost" onClick={() => { if (confirm('Replace all data with demo data?')) dispatch({ type: 'data/replace', payload: createDemoState(today) }); }}>Load demo data</button>
          <button className="btn danger" onClick={() => { if (confirm('Delete ALL transactions, bills, debts and settings? This cannot be undone.')) dispatch({ type: 'data/reset' }); }}>Erase everything</button>
        </div>
      </div>
      <p className="muted sm">Pulse Finance · Bank holidays: England & Wales</p>
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
