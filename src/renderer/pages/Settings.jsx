import { useState } from 'react';
import { useApp } from '../store.jsx';
import { api, isDesktop } from '../api.js';
import { createDemoState } from '../../engine/demo.js';
import { newIncome, profileSummary, describeSchedule } from '../../engine/income.js';
import { Field } from '../components/Forms.jsx';
import Modal from '../components/Modal.jsx';
import IncomeEditor from '../components/IncomeEditor.jsx';
import { CURRENCIES, formatMoney } from '../../engine/money.js';
import { currenciesInUse, historicalRate } from '../../engine/fx.js';
import { addDays } from '../../engine/dates.js';
import { useUpdateStatus } from '../components/UpdateBanner.jsx';
import { APP_VERSION } from '../../config.js';
import { useDialog } from '../components/Dialogs.jsx';
import { AccountsList } from '../components/Cards.jsx';

export default function Settings() {
  const { state, dispatch, notify, today, fmt } = useApp();
  const dialog = useDialog();
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
          <Field label="Home currency" hint="Everything is totalled in this">
            <select value={st.currency} onChange={async (e) => { const currency = e.target.value; if (await dialog.confirm({ title: 'Change home currency?', message: 'Amounts already recorded keep their values. Bills and debts in other currencies are re-converted to the new home currency.', okLabel: 'Change currency' })) set({ currency }); }}>
              {Object.entries(CURRENCIES).map(([k, v]) => <option key={k} value={k}>{v.symbol} {v.name} ({k})</option>)}
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

      <Currencies />

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

      <div className="card" id="accounts">
        <h3>🏦 Your accounts</h3>
        <p className="muted">Mark credit cards so Pulse works out their bills.</p>
        <AccountsList />
      </div>

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
          <button className="btn ghost" onClick={async () => { if (await dialog.confirm({ title: 'Load demo data?', message: 'This replaces everything in Pulse with example data. Export a backup first if you want to keep your own.', okLabel: 'Replace with demo data', danger: true })) dispatch({ type: 'data/replace', payload: createDemoState(today) }); }}>Load demo data</button>
          <button className="btn danger" onClick={async () => { if (await dialog.confirm({ title: 'Erase everything?', message: 'This deletes ALL transactions, bills, debts, receipts, goals and settings. It cannot be undone (daily backups are still in your Pulse folder).', okLabel: 'Erase everything', danger: true })) dispatch({ type: 'data/reset' }); }}>Erase everything</button>
        </div>
      </div>
      {isDesktop && <About />}
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

function Currencies() {
  const { state, dispatch, notify, today } = useApp();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const [add, setAdd] = useState('');
  const base = state.settings.currency;
  const fx = state.fx;
  const inUse = currenciesInUse(state, { includeWatched: false });
  const watched = state.settings.watchCurrencies || [];
  const list = [...new Set([...inUse, ...watched])].filter((c) => c !== base);
  const monthAgo = addDays(today, -30);
  const refresh = async () => {
    setBusy(true);
    try {
      const r = await api.fx.refresh();
      notify(`Rates updated (${r.date}, ${r.source})`, 'good');
    } catch (e) {
      notify(e.message, 'critical');
    } finally {
      setBusy(false);
    }
  };
  const setManual = async (cur) => {
    const v = await dialog.prompt({ title: `Set ${cur} rate`, message: `How many ${cur} for 1 ${base}?`, defaultValue: String(fx?.rates?.[cur] || ''), inputType: 'number', okLabel: 'Save rate' });
    if (!v || !(+v > 0)) return;
    dispatch({ type: 'fx/set', payload: { ...(fx || { base, history: {} }), base, rates: { ...(fx?.rates || {}), [cur]: +v }, source: 'manual', date: today } });
  };
  return (
    <div className="card">
      <div className="card-head">
        <h3>💱 Currencies & exchange rates</h3>
        {isDesktop && <button className="btn ghost sm" disabled={busy} onClick={refresh}>{busy ? 'Updating…' : 'Update now'}</button>}
      </div>
      <p className="muted sm">
        Bills, debts and EMIs can be in any currency. Rates update daily and every total follows them.
        {fx?.date ? ` Rates from ${fx.date}${fx.source ? ` (${fx.source})` : ''}.` : ' No rates downloaded yet.'}
      </p>
      {list.length > 0 && (
        <table className="table fx-table">
          <thead><tr><th>Currency</th><th className="num">1 {base} =</th><th className="num">30 days ago</th><th className="num">Change</th><th /></tr></thead>
          <tbody>
            {list.map((c) => {
              const now = fx?.base === base ? fx.rates?.[c] : null;
              const then = now ? historicalRate(fx, c, monthAgo) : null;
              const ch = now && then ? (now - then) / then : null;
              return (
                <tr key={c}>
                  <td><b>{c}</b> <span className="muted">{CURRENCIES[c]?.name || ''}{inUse.includes(c) ? ' · in use' : ''}</span></td>
                  <td className="num">{now ? formatMoney(now, c, { decimals: 2 }) : <span className="note">no rate yet</span>}</td>
                  <td className="num muted">{then && then !== now ? formatMoney(then, c, { decimals: 2 }) : '–'}</td>
                  <td className={`num ${ch > 0 ? 'pos' : ch < 0 ? 'neg' : ''}`} title="Positive means your pound buys more">{ch !== null && then !== now ? `${ch > 0 ? '+' : ''}${(ch * 100).toFixed(2)}%` : '–'}</td>
                  <td className="num">
                    <button className="linkish muted sm" onClick={() => setManual(c)}>set manually</button>
                    {!inUse.includes(c) && <button className="icon-btn" aria-label={`Stop watching ${c}`} onClick={() => dispatch({ type: 'settings/update', payload: { watchCurrencies: watched.filter((x) => x !== c) } })}>✕</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="inline-row">
        <select value={add} onChange={(e) => setAdd(e.target.value)}>
          <option value="">Watch another currency…</option>
          {Object.entries(CURRENCIES).filter(([k]) => k !== base && !list.includes(k)).map(([k, v]) => <option key={k} value={k}>{k} · {v.name}</option>)}
        </select>
        <button className="btn ghost sm" disabled={!add} onClick={() => { dispatch({ type: 'settings/update', payload: { watchCurrencies: [...watched, add] } }); setAdd(''); if (isDesktop) refresh(); }}>Add</button>
      </div>
    </div>
  );
}

function About() {
  const status = useUpdateStatus();
  const text = {
    idle: 'Checks for updates shortly after launch.',
    checking: 'Checking for updates…',
    current: "You're on the latest version.",
    downloading: `Downloading version ${status?.available}… ${status?.percent || 0}%`,
    ready: `Version ${status?.available} is ready. Restart to finish updating.`,
    error: status?.error,
    unsupported: status?.reason === 'portable' ? "The portable version doesn't update itself. Install Pulse with the Setup file to get automatic updates." : 'Updates are off in development builds.',
  }[status?.state || 'idle'];
  return (
    <div className="card">
      <div className="card-head">
        <h3>✨ About & updates</h3>
        <span className="muted sm">Version {APP_VERSION}</span>
      </div>
      <p className={status?.state === 'error' ? 'note' : 'muted'}>{text}</p>
      <div className="inline-row">
        {status?.state === 'ready'
          ? <button className="btn primary" onClick={() => api.updates.install()}>Restart and update</button>
          : <button className="btn ghost" disabled={['checking', 'downloading', 'unsupported'].includes(status?.state)} onClick={() => api.updates.check()}>Check for updates</button>}
      </div>
    </div>
  );
}
