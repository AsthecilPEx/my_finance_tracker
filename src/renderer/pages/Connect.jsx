import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api, isDesktop } from '../api.js';
import { parseStatement } from '../../engine/csv.js';
import { categorise } from '../../engine/categories.js';
import { Field } from '../components/Forms.jsx';

const COUNTRIES = { GB: 'United Kingdom', IE: 'Ireland', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', BE: 'Belgium', PT: 'Portugal', AT: 'Austria', FI: 'Finland', SE: 'Sweden', DK: 'Denmark', PL: 'Poland' };

export default function Connect() {
  const { state, dispatch, fmt, notify, cats } = useApp();
  const [file, setFile] = useState(null);
  const [invert, setInvert] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    try {
      setPreview({ ...parseStatement(file.text, { invertSign: invert }) });
    } catch (e) {
      setPreview({ error: e.message });
    }
  }, [file, invert]);

  const pick = async () => {
    const f = await api.openCsvFile();
    if (f) { setFile(f); setInvert(false); }
  };

  const doImport = async () => {
    const before = state.transactions.length;
    const next = await dispatch({ type: 'txn/import', payload: { rows: preview.rows, source: 'csv', fileName: file.name } });
    const added = next.transactions.length - before;
    notify(`Imported ${added} new transaction${added === 1 ? '' : 's'}${preview.rows.length - added ? ` · ${preview.rows.length - added} duplicates skipped` : ''}`, 'good');
    setFile(null);
  };

  return (
    <div className="page">
      <header className="page-head"><div><h1>Import & Sync</h1><p className="muted">Three ways to get transactions in. All read-only: the app can never move money.</p></div></header>

      <div className="card">
        <div className="card-head"><h3>1 · Import a bank statement (CSV)</h3></div>
        <p className="muted">Download a CSV from your banking app or website. Works with Monzo, Starling, Revolut, Barclays, HSBC, Lloyds, Halifax, Nationwide, Santander, NatWest, Chase, Amex and most EU banks. Duplicates are skipped automatically, so overlapping statements are fine.</p>
        <button className="btn primary" onClick={pick}>Choose CSV file…</button>
        {preview?.error && <p className="error">⚠ {preview.error}</p>}
        {preview?.rows && (
          <div className="preview">
            <div className="card-head">
              <h4>{file.name}: {preview.rows.length} transactions found{preview.errors.length ? ` · ${preview.errors.length} rows skipped` : ''}</h4>
              <label className="check inline"><input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /><span>Flip signs (credit card statements that show spending as positive)</span></label>
            </div>
            <table className="table">
              <thead><tr><th>Date</th><th>Description</th><th>Auto category</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {preview.rows.slice(0, 8).map((r, i) => {
                  const c = cats[categorise(r.description, r.amount, state.rules)];
                  return <tr key={i}><td className="nowrap">{r.date}</td><td>{r.description}</td><td>{c?.icon} {c?.name}</td><td className={`num ${r.amount > 0 ? 'pos' : ''}`}>{fmt(r.amount, { sign: true })}</td></tr>;
                })}
              </tbody>
            </table>
            <div className="form-actions">
              <button className="btn ghost" onClick={() => setFile(null)}>Cancel</button>
              <button className="btn primary" onClick={doImport} disabled={!preview.rows.length}>Import {preview.rows.length} transactions</button>
            </div>
          </div>
        )}
      </div>

      <WatchFolder />
      <OpenBanking />

      {state.imports?.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>Import history</h3></div>
          <ul className="list compact">
            {state.imports.slice(0, 12).map((i) => (
              <li key={i.id} className="list-row">
                <span className="muted nowrap">{new Date(i.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                <span className="grow">{i.source === 'bank' ? '🏦 Bank sync' : i.source === 'watch' ? '📂 Watched folder' : i.source === 'demo' ? 'Demo data' : '📄 CSV'} {i.fileName && <span className="muted">· {i.fileName}</span>}</span>
                <span>{i.added} added{i.duplicates ? <span className="muted"> · {i.duplicates} dupes</span> : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DesktopOnly() {
  return <p className="note">Available in the Windows desktop app.</p>;
}

function WatchFolder() {
  const { state, dispatch, notify } = useApp();
  const { watchFolder, watchEnabled } = state.settings;
  const choose = async () => {
    const folder = await api.chooseFolder();
    if (folder) await dispatch({ type: 'settings/update', payload: { watchFolder: folder, watchEnabled: true } });
  };
  return (
    <div className="card">
      <div className="card-head"><h3>2 · Auto-import from a folder</h3>{watchEnabled && watchFolder && <span className="badge done">● Watching</span>}</div>
      <p className="muted">Pick a folder (e.g. a "Bank statements" folder, or Downloads). Whenever a new bank CSV appears there, it's imported and categorised automatically, even while the app is in the tray.</p>
      {!isDesktop ? <DesktopOnly /> : (
        <div className="inline-row">
          <input readOnly value={watchFolder || 'No folder chosen'} className="grow" />
          <button className="btn ghost" onClick={choose}>Choose folder…</button>
          {watchFolder && (
            <label className="switch" title="Watch this folder">
              <input type="checkbox" checked={!!watchEnabled} onChange={(e) => dispatch({ type: 'settings/update', payload: { watchEnabled: e.target.checked } })} />
              <span />
            </label>
          )}
          {watchFolder && watchEnabled && <button className="btn ghost" onClick={async () => { const r = await api.watcher.scanNow(); notify(`Scanned folder: ${r.imported} file(s) imported`, 'good'); }}>Scan now</button>}
        </div>
      )}
    </div>
  );
}

function OpenBanking() {
  const { state, notify, fmt } = useApp();
  const bank = state.settings.bank;
  const [hasCreds, setHasCreds] = useState(false);
  const [creds, setCreds] = useState({ id: '', key: '' });
  const [country, setCountry] = useState('GB');
  const [banks, setBanks] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => { if (isDesktop) api.bank.hasCredentials().then(setHasCreds); }, []);

  const run = async (label, fn) => {
    setBusy(label);
    try { return await fn(); } catch (e) { notify(e.message || String(e), 'critical'); } finally { setBusy(''); }
  };

  const saveCreds = () => run('creds', async () => {
    await api.bank.saveCredentials(creds.id.trim(), creds.key.trim());
    setHasCreds(true);
    setCreds({ id: '', key: '' });
    notify('Keys verified and stored encrypted', 'good');
  });
  const loadBanks = () => run('banks', async () => setBanks(await api.bank.institutions(country)));
  const connect = (inst) => run('connect', async () => {
    await api.bank.connect(inst.id, inst.name, inst.transaction_total_days);
    notify(`Connected to ${inst.name}. Importing transactions…`, 'good');
  });

  return (
    <div className="card">
      <div className="card-head"><h3>3 · Connect your bank (Open Banking, read-only)</h3>{bank.connected && <span className="badge done">● Connected</span>}</div>
      <p className="muted">
        Uses the regulated UK/EU Open Banking "account information" service via GoCardless Bank Account Data. Access is <b>read-only by law</b>: it can see balances and transactions, never make payments.
        Your bank asks you to re-approve every 90 days. The app then syncs automatically up to 4 times a day.
      </p>
      {!isDesktop ? <DesktopOnly /> : bank.connected ? (
        <>
          <ul className="list">
            {(state.accounts || []).map((a) => (
              <li key={a.id} className="list-row"><span aria-hidden>🏦</span><span className="grow"><b>{a.name}</b><small className="muted"> · {bank.institutionName}</small></span><b>{typeof a.balance === 'number' ? fmt(a.balance) : '–'}</b></li>
            ))}
          </ul>
          <div className="inline-row">
            <span className="muted grow">Last synced: {bank.lastSync ? new Date(bank.lastSync).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'never'}{bank.expires ? ` · consent renews by ${new Date(bank.expires).toLocaleDateString('en-GB')}` : ''}</span>
            <button className="btn ghost" disabled={!!busy} onClick={() => run('sync', async () => { const r = await api.bank.sync(); notify(`Synced: ${r.added} new transactions`, 'good'); })}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
            <button className="btn ghost danger" onClick={() => run('dc', () => api.bank.disconnect())}>Disconnect</button>
          </div>
        </>
      ) : !hasCreds ? (
        <div className="steps">
          <ol>
            <li>Create a free account at <button className="linkish" onClick={() => api.openExternal('https://bankaccountdata.gocardless.com/')}>bankaccountdata.gocardless.com</button>.</li>
            <li>Go to <i>Developers → User secrets</i> and create a secret.</li>
            <li>Paste the Secret ID and Secret Key below. They're encrypted with Windows' own data protection and never leave this PC except to talk to GoCardless.</li>
          </ol>
          <div className="row2">
            <Field label="Secret ID"><input value={creds.id} onChange={(e) => setCreds((c) => ({ ...c, id: e.target.value }))} /></Field>
            <Field label="Secret Key"><input type="password" value={creds.key} onChange={(e) => setCreds((c) => ({ ...c, key: e.target.value }))} /></Field>
          </div>
          <button className="btn primary" disabled={!creds.id || !creds.key || !!busy} onClick={saveCreds}>{busy === 'creds' ? 'Checking…' : 'Save & verify'}</button>
        </div>
      ) : (
        <div>
          <div className="inline-row">
            <select value={country} onChange={(e) => setCountry(e.target.value)}>{Object.entries(COUNTRIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <button className="btn primary" disabled={!!busy} onClick={loadBanks}>{busy === 'banks' ? 'Loading…' : 'Find my bank'}</button>
            <button className="btn ghost sm" onClick={async () => { await api.bank.saveCredentials('', ''); setHasCreds(false); }}>Change keys</button>
          </div>
          {banks && (
            <>
              <input type="search" placeholder="Search banks…" value={q} onChange={(e) => setQ(e.target.value)} className="bank-search" />
              <div className="bank-grid">
                {banks.filter((b) => b.name.toLowerCase().includes(q.toLowerCase())).slice(0, 60).map((b) => (
                  <button key={b.id} className="bank" disabled={!!busy} onClick={() => connect(b)}>
                    {b.logo && <img src={b.logo} alt="" />}<span>{b.name}</span>
                  </button>
                ))}
              </div>
              {busy === 'connect' && <p className="note">Finish approving access in your browser. This page updates when you're done.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
