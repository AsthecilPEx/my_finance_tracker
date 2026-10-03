import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api, isDesktop } from '../api.js';
import { parseStatement } from '../../engine/csv.js';
import { categorise } from '../../engine/categories.js';
import { Field } from '../components/Forms.jsx';

const COUNTRIES = { GB: 'United Kingdom', IE: 'Ireland', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', BE: 'Belgium', PT: 'Portugal', AT: 'Austria', FI: 'Finland', SE: 'Sweden', DK: 'Denmark', PL: 'Poland' };

export default function Connect() {
  const { state } = useApp();
  const [more, setMore] = useState(!state.settings.bank.connected && (state.imports || []).some((i) => i.source !== 'demo'));
  return (
    <div className="page">
      <header className="page-head"><div><h1>Bank Sync</h1><p className="muted">Transactions flow in by themselves. Access is read-only: Pulse can never move money.</p></div></header>
      <OpenBanking />
      <div className="card">
        <button className="linkish card-head" onClick={() => setMore((x) => !x)}><h3>{more ? '▾' : '▸'} Other ways to bring in transactions</h3><span className="muted sm">Watched folder or a statement file, for banks Open Banking doesn't cover</span></button>
        {more && <><WatchFolder /><CsvImport /></>}
      </div>
      <ImportHistory />
    </div>
  );
}

function ImportHistory() {
  const { state } = useApp();
  if (!state.imports?.length) return null;
  return (
    <div className="card">
      <div className="card-head"><h3>Sync & import history</h3></div>
      <ul className="list compact">
        {state.imports.slice(0, 12).map((i) => (
          <li key={i.id} className="list-row">
            <span className="muted nowrap">{new Date(i.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            <span className="grow">{i.source === 'bank' ? '🏦 Bank sync' : i.source === 'watch' ? '📂 Watched folder' : i.source === 'demo' ? 'Demo data' : '📄 Statement file'} {i.fileName && <span className="muted">· {i.fileName}</span>}</span>
            <span>{i.added} added{i.duplicates ? <span className="muted"> · {i.duplicates} already had</span> : ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CsvImport() {
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
    notify(`Imported ${added} new transaction${added === 1 ? '' : 's'}${preview.rows.length - added ? ` · ${preview.rows.length - added} already in Pulse` : ''}`, 'good');
    setFile(null);
  };

  return (
    <div className="sub-section">
      <h4>📄 Import a statement file (CSV)</h4>
      <p className="muted sm">Works with exports from Monzo, Starling, Revolut, Barclays, HSBC, Lloyds, Nationwide, Santander, NatWest, Chase, Amex and most EU banks. Anything already in Pulse is skipped.</p>
      <button className="btn ghost" onClick={pick}>Choose CSV file…</button>
      {preview?.error && <p className="error">⚠ {preview.error}</p>}
      {preview?.rows && (
        <div className="preview">
          <div className="card-head">
            <h4>{file.name}: {preview.rows.length} transactions found{preview.errors.length ? ` · ${preview.errors.length} rows skipped` : ''}</h4>
            <label className="check inline"><input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /><span>Flip signs (credit card statements)</span></label>
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
    <div className="sub-section">
      <div className="card-head"><h4>📂 Auto-import from a folder</h4>{watchEnabled && watchFolder && <span className="badge done">● Watching</span>}</div>
      <p className="muted sm">Pick a folder (e.g. "Bank statements" or Downloads). Whenever a new bank CSV lands there, it's imported and categorised automatically, even while Pulse is in the tray.</p>
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
  const [info, setInfo] = useState(null);
  const [appId, setAppId] = useState('');
  const [pem, setPem] = useState(null);
  const [country, setCountry] = useState('GB');
  const [banks, setBanks] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [pasteUrl, setPasteUrl] = useState('');

  useEffect(() => { if (isDesktop) api.bank.info().then(setInfo); }, [bank.connected]);

  const run = async (label, fn) => {
    setBusy(label);
    try { return await fn(); } catch (e) { notify(e.message || String(e), 'critical'); } finally { setBusy(''); }
  };
  const saveCreds = () => run('creds', async () => {
    await api.bank.saveCredentials(appId.trim(), pem.text);
    setInfo(await api.bank.info());
    notify('Keys checked and stored encrypted on this PC', 'good');
  });
  const loadBanks = () => run('banks', async () => setBanks(await api.bank.institutions(country)));
  const connect = (b) => run('connect', async () => {
    const r = await api.bank.connect(b.name, b.country || country, b.maximum_consent_validity);
    if (r?.added !== undefined) notify(`Connected to ${b.name}: ${r.added} transactions imported`, 'good');
  });
  const finishWithUrl = () => run('paste', async () => {
    const r = await api.bank.completeWithUrl(pasteUrl.trim());
    setPasteUrl('');
    notify(`Connected: ${r.added} transactions imported`, 'good');
  });

  return (
    <div className="card">
      <div className="card-head"><h3>🏦 Connect your bank (Open Banking)</h3>{bank.connected && <span className={`badge ${bank.needsReconnect ? 'upcoming' : 'done'}`}>● {bank.needsReconnect ? 'Needs reconnecting' : 'Connected'}</span>}</div>
      <p className="muted">
        Uses <b>Enable Banking</b>, a regulated Open Banking provider covering 2,500+ UK and EU banks. It's free for personal use: you connect <i>your own</i> accounts in "restricted" mode.
        Access is <b>read-only by law</b> (balances and transactions only). Your bank asks you to re-approve every 90–180 days, and Pulse syncs up to 4 times a day.
      </p>
      {!isDesktop ? <DesktopOnly /> : bank.connected ? (
        <>
          <ul className="list">
            {(state.accounts || []).map((a) => (
              <li key={a.id} className="list-row"><span aria-hidden>🏦</span><span className="grow"><b>{a.name}</b><small className="muted"> · {bank.institutionName}</small></span><b>{typeof a.balance === 'number' ? fmt(a.balance) : '–'}</b></li>
            ))}
          </ul>
          <div className="inline-row wrap">
            <span className="muted grow">Last synced: {bank.lastSync ? new Date(bank.lastSync).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'never'}{bank.expires ? ` · access renews by ${new Date(bank.expires).toLocaleDateString('en-GB')}` : ''}</span>
            <button className="btn ghost" disabled={!!busy} onClick={() => run('sync', async () => { const r = await api.bank.sync(); notify(`Synced: ${r.added} new transactions`, 'good'); })}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>
            <button className="btn ghost danger" onClick={() => run('dc', () => api.bank.disconnect())}>Disconnect</button>
          </div>
        </>
      ) : !info?.hasCredentials ? (
        <div className="steps">
          <ol>
            <li>Create a free account at <button className="linkish" onClick={() => api.openExternal('https://enablebanking.com/sign-in/')}>enablebanking.com</button> and open <i>API applications → Register new</i>. Choose <b>Production</b> and add this redirect URL: <code className="copyable" onClick={() => api.copyText(info?.redirectUrl || '')}>{info?.redirectUrl || 'https://asthecilpex.github.io/my_finance_tracker/callback/'}</code></li>
            <li>Download the <b>private key (.pem)</b> it gives you, and note the <b>Application ID</b>.</li>
            <li>In the Enable Banking control panel, <b>link your own accounts</b> to the app. Restricted apps can only read linked accounts.</li>
            <li>Enter the details below. The key is encrypted with Windows' own data protection and only used to talk to Enable Banking.</li>
          </ol>
          <div className="row2">
            <Field label="Application ID"><input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="e.g. 3f2c…" /></Field>
            <Field label="Private key file (.pem)">
              <button type="button" className="btn ghost" onClick={async () => setPem(await api.bank.pickKey())}>{pem ? `✓ ${pem.name}` : 'Choose .pem file…'}</button>
            </Field>
          </div>
          <button className="btn primary" disabled={!appId || !pem || !!busy} onClick={saveCreds}>{busy === 'creds' ? 'Checking…' : 'Save & verify'}</button>
        </div>
      ) : (
        <div>
          <div className="inline-row wrap">
            <select value={country} onChange={(e) => setCountry(e.target.value)}>{Object.entries(COUNTRIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <button className="btn primary" disabled={!!busy} onClick={loadBanks}>{busy === 'banks' ? 'Loading…' : 'Find my bank'}</button>
            <button className="btn ghost sm" onClick={async () => { await api.bank.saveCredentials('', ''); setInfo(await api.bank.info()); }}>Change keys</button>
          </div>
          {banks && (
            <>
              <input type="search" placeholder="Search banks…" value={q} onChange={(e) => setQ(e.target.value)} className="bank-search" />
              <div className="bank-grid">
                {banks.filter((b) => b.name.toLowerCase().includes(q.toLowerCase())).slice(0, 80).map((b) => (
                  <button key={b.name + b.country} className="bank" disabled={!!busy} onClick={() => connect(b)}>
                    {b.logo && <img src={b.logo} alt="" />}<span>{b.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {busy === 'connect' && (
            <div className="callout">
              <p>Approve access in the browser window that just opened. Pulse carries on automatically when you're sent back.</p>
              <p className="muted sm">Stuck on a page after approving? Copy its full address (it contains <code>code=</code>) and paste it here:</p>
              <div className="inline-row"><input className="grow" value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} placeholder="https://…?code=…" /><button className="btn ghost" disabled={!pasteUrl} onClick={finishWithUrl}>Finish</button></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
