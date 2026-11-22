import { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { api, isDesktop } from '../api.js';
import { parseStatement, BANK_FORMATS } from '../../engine/csv.js';
import { staleStatements } from '../../engine/freshness.js';
import { daysBetween } from '../../engine/dates.js';
import { categorise } from '../../engine/categories.js';
import { Field } from '../components/Forms.jsx';
import { Icon, Dot } from '../components/Icon.jsx';

// Enable Banking's free personal ("restricted") mode covers EU/EEA banks only, not the UK.
const COUNTRIES = { IE: 'Ireland', DE: 'Germany', FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', BE: 'Belgium', PT: 'Portugal', AT: 'Austria', FI: 'Finland', SE: 'Sweden', DK: 'Denmark', PL: 'Poland' };

export default function Connect() {
  const { state } = useApp();
  const [eu, setEu] = useState(!!state.settings.bank.connected);
  return (
    <div className="page">
      <header className="page-head"><div><h1>Bank Sync</h1><p className="muted">Bring your transactions in. Everything is read-only.</p></div></header>
      <YourBanks />
      <MonzoConnect />
      <TrueLayerConnect />
      <div className="card">
        <div className="card-head"><h3><Icon name="FileText" />Statements: for banks you haven't connected live</h3><Info>Download a statement (about 30 seconds). Pulse recognises each bank's file, skips duplicates and reminds you when one is due.</Info></div>
        <WatchFolder />
        <CsvImport />
        <BankGuides />
      </div>
      <div className="card">
        <button className="linkish card-head" onClick={() => setEu((x) => !x)}><h3><Icon name={eu ? 'ChevronDown' : 'ChevronRight'} /><Icon name="Globe" />EU / EEA banks (Enable Banking)</h3></button>
        {eu && <OpenBanking />}
      </div>
      <ImportHistory />
    </div>
  );
}

/** One line per bank: live, or when its last statement came in. */
function YourBanks() {
  const { state, today, fmt } = useApp();
  const mz = state.settings.monzo;
  const stale = new Set(staleStatements(state, today).map((x) => x.bank));
  const tl = state.settings.truelayer?.connections || [];
  const liveIds = tl.map((c) => String(c.providerId || c.providerName).toLowerCase());
  const rows = Object.entries(state.bankImports || {}).filter(([b]) => !(b === 'monzo' && mz.connected) && !liveIds.some((id) => id.includes(b)));
  if (!mz.connected && !tl.length && !rows.length && !state.settings.bank.connected) return null;
  const ago = (iso) => { const d = daysBetween(iso.slice(0, 10), today); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`; };
  return (
    <div className="card">
      <div className="card-head"><h3>Your banks</h3><Info>How up to date each bank is.</Info></div>
      <ul className="list">
        {mz.connected && (
          <li className="list-row">
            <Icon name="Landmark" className="brand-monzo" />
            <span className="grow"><b>Monzo</b><small className="muted"> · live{mz.lastSync ? ` · synced ${ago(mz.lastSync)}` : ''}</small></span>
            {(state.accounts || []).filter((a) => a.source === 'monzo').map((a) => <span key={a.id} className="muted sm">{a.name}: <b>{fmt(a.balance)}</b></span>)}
            <span className={`badge ${mz.needsApproval || mz.needsReconnect ? 'upcoming' : 'done'}`}><Dot />{mz.needsReconnect ? 'Reconnect' : mz.needsApproval ? 'Approve in app' : 'Live'}</span>
          </li>
        )}
        {tl.map((c) => (
          <li key={c.id} className="list-row">
            <Icon name="Building2" className="brand-other" />
            <span className="grow"><b>{c.providerName}</b><small className="muted"> · live{c.lastSync ? ` · synced ${ago(c.lastSync)}` : ''}</small></span>
            {(c.accounts || []).map((a) => { const b = (state.accounts || []).find((x) => x.id === `truelayer:${a.id}`); return b ? <span key={a.id} className="muted sm">{a.name}: <b>{fmt(b.balance)}</b></span> : null; })}
            <span className={`badge ${c.needsReconnect ? 'upcoming' : 'done'}`}><Dot />{c.needsReconnect ? 'Reconnect' : 'Live'}</span>
          </li>
        ))}
        {rows.map(([b, info]) => (
          <li key={b} className="list-row">
            <Icon name="FileText" />
            <span className="grow"><b>{BANK_FORMATS[b]?.name || b}</b><small className="muted"> · statement imported {ago(info.at)}{info.latest ? ` · newest payment ${info.latest}` : ''}</small></span>
            <span className={`badge ${stale.has(b) ? 'upcoming' : 'done'}`}><Dot />{stale.has(b) ? 'Time for a new one' : 'Up to date'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BankGuides() {
  const [open, setOpen] = useState(false);
  return (
    <div className="sub-section">
      <button className="linkish" onClick={() => setOpen((x) => !x)}><Icon name={open ? 'ChevronDown' : 'ChevronRight'} /> Where's the download button for my bank?</button>
      {open && (
        <ul className="list compact guides">
          {Object.entries(BANK_FORMATS).map(([id, f]) => <li key={id} className="list-row"><b className="nowrap">{f.name}</b><span className="muted sm grow">{f.howTo}</span></li>)}
          <li className="list-row"><b className="nowrap">Any other bank</b><span className="muted sm grow">Look for "Export", "Download" or "Statements" and choose CSV. Most UK and EU formats work.</span></li>
        </ul>
      )}
    </div>
  );
}

/** Monzo's own free developer API: live, read-only sync of current, joint and Flex accounts. */
function MonzoConnect() {
  const { state, notify, fmt } = useApp();
  const mz = state.settings.monzo;
  const [info, setInfo] = useState(null);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState('');
  const [pasteUrl, setPasteUrl] = useState('');
  const [setup, setSetup] = useState(false);

  useEffect(() => { if (isDesktop) api.monzo.info().then(setInfo); }, [mz.connected]);

  const run = async (label, fn) => {
    setBusy(label);
    try { return await fn(); } catch (e) { if (!/cancelled/i.test(e.message || '')) notify(e.message || String(e), 'critical'); } finally { setBusy(''); }
  };
  const saveClient = () => run('client', async () => { setInfo(await api.monzo.saveClient(clientId, secret)); setSecret(''); notify('Monzo client saved, encrypted on this PC', 'good'); });
  const connect = () => run('connect', async () => {
    const r = await api.monzo.connect();
    if (r?.approved) notify(`Monzo connected: ${r.added} transactions imported`, 'good');
  });
  const finishWithUrl = () => run('paste', async () => { await api.monzo.completeWithUrl(pasteUrl.trim()); setPasteUrl(''); });

  // While waiting for the in-app approval, check every 5 seconds (for up to 15 minutes).
  useEffect(() => {
    if (!isDesktop || !mz.connected || !mz.needsApproval) return undefined;
    let tries = 0;
    const t = setInterval(async () => {
      if (++tries > 180) return clearInterval(t);
      try {
        const r = await api.monzo.checkApproval();
        if (r?.approved) { clearInterval(t); notify(`Monzo approved: ${r.added} transactions imported`, 'good'); }
      } catch (e) { clearInterval(t); notify(e.message, 'critical'); }
    }, 5000);
    return () => clearInterval(t);
  }, [mz.connected, mz.needsApproval]);

  const daysLeft = mz.approvedAt ? 90 - Math.floor((Date.now() - Date.parse(mz.approvedAt)) / 86400000) : null;
  const accounts = (state.accounts || []).filter((a) => a.source === 'monzo');

  return (
    <div className="card">
      <div className="card-head"><h3><Icon name="Landmark" className="brand-monzo" />Monzo: live sync</h3><span className="head-right">{mz.connected && <span className={`badge ${mz.needsApproval || mz.needsReconnect ? 'upcoming' : 'done'}`}><Dot />{mz.needsReconnect ? 'Needs reconnecting' : mz.needsApproval ? 'Waiting for approval' : 'Connected'}</span>}<Info>Free, read-only live sync for your current, joint and Flex accounts.</Info></span></div>
      {!isDesktop ? <DesktopOnly /> : mz.connected && mz.needsApproval ? (
        <div className="callout">
          <p><b><Icon name="Smartphone" /> Approve "Pulse Finance" in the Monzo app on your phone.</b></p>
          <ul className="tidy muted sm"><li>Pulse checks automatically.</li><li>Approve within 5 minutes to get your full history (otherwise 90 days).</li></ul>
          <div className="inline-row"><button className="btn primary" disabled={!!busy} onClick={() => run('check', async () => { const r = await api.monzo.checkApproval(); if (!r.approved) notify("Not approved yet. Check the Monzo app.", 'info'); else notify(`Monzo approved: ${r.added} transactions imported`, 'good'); })}>{busy === 'check' ? 'Checking…' : "I've approved it"}</button><button className="btn ghost" onClick={() => run('dc', () => api.monzo.disconnect())}>Cancel</button></div>
        </div>
      ) : mz.connected ? (
        <>
          {mz.needsReconnect && <div className="callout warn"><p><b>Monzo needs you to approve Pulse again</b> (every 90 days). Click Reconnect, open the email link on this PC, then approve in the app.</p></div>}
          <ul className="list">
            {accounts.map((a) => <li key={a.id} className="list-row"><Icon name={a.kind === 'credit' ? 'CreditCard' : 'Landmark'} /><span className="grow"><b>{a.name}</b>{a.kind === 'credit' && <small className="muted"> · amount owed</small>}</span><b>{fmt(a.balance)}</b></li>)}
          </ul>
          <div className="inline-row wrap">
            <span className="muted grow">Last synced: {mz.lastSync ? new Date(mz.lastSync).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'never'}{daysLeft !== null ? ` · re-approve in ${Math.max(0, daysLeft)} days` : ''}</span>
            {mz.needsReconnect
              ? <button className="btn primary" disabled={!!busy} onClick={connect}>{busy === 'connect' ? 'Waiting for the email link…' : 'Reconnect'}</button>
              : <button className="btn ghost" disabled={!!busy} onClick={() => run('sync', async () => { const r = await api.monzo.sync(); notify(`Monzo synced: ${r.added} new transactions`, 'good'); })}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>}
            <button className="btn ghost danger" onClick={() => run('dc', () => api.monzo.disconnect())}>Disconnect</button>
          </div>
        </>
      ) : !info?.hasClient ? (
        <>
          {!setup ? <button className="btn primary" onClick={() => setSetup(true)}>Set up Monzo (about 5 minutes)</button> : (
            <div className="steps">
              <ol>
                <li>On this PC, open <button className="linkish" onClick={() => api.openExternal('https://developers.monzo.com/')}>developers.monzo.com</button> and sign in with your Monzo email. Monzo emails you a link, then asks you to approve in the app.</li>
                <li>Go to <b>Clients → New OAuth Client</b> and fill in:
                  <ul>
                    <li><b>Name:</b> Pulse Finance</li>
                    <li><b>Redirect URLs:</b> <code className="copyable" title="Click to copy" onClick={() => { api.copyText(info?.redirectUrl || ''); notify('Copied', 'good'); }}>{info?.redirectUrl || 'http://localhost:47286/monzo/callback'}</code></li>
                    <li><b>Description:</b> My personal finance app</li>
                    <li><b>Confidentiality:</b> <b>Confidential</b> (so Pulse can stay signed in)</li>
                  </ul>
                </li>
                <li>Submit, then copy the <b>Client ID</b> and <b>Client secret</b> into the boxes below. They're encrypted with Windows' own data protection and only ever sent to Monzo.</li>
              </ol>
              <div className="row2">
                <Field label="Client ID"><input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="oauth2client_…" autoComplete="off" spellCheck="false" /></Field>
                <Field label="Client secret"><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="mnzconf.…" autoComplete="off" spellCheck="false" /></Field>
              </div>
              <button className="btn primary" disabled={!clientId || !secret || !!busy} onClick={saveClient}>{busy === 'client' ? 'Saving…' : 'Save'}</button>
            </div>
          )}
        </>
      ) : (
        <div>
          <div className="inline-row wrap">
            <button className="btn primary" disabled={!!busy} onClick={connect}>{busy === 'connect' ? 'Waiting for the email link…' : 'Connect Monzo'}</button>
            <button className="btn ghost sm" onClick={async () => { setInfo(await api.monzo.saveClient('', '')); }}>Change client</button>
          </div>
          {busy === 'connect' && (
            <div className="callout">
              <p><b>1.</b> In the browser window that opened, enter your Monzo email.<br /><b>2.</b> Monzo emails you a link. <b>Open that email on this PC</b> and click the link.<br /><b>3.</b> Then approve "Pulse Finance" in the Monzo app on your phone.</p>
              <p className="muted sm">Opened the link on your phone by mistake? Copy the full address it opened (it contains <code>code=</code>) and paste it here:</p>
              <div className="inline-row"><input className="grow" value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} placeholder="http://localhost:47286/monzo/callback?code=…" /><button className="btn ghost" disabled={!pasteUrl} onClick={finishWithUrl}>Finish</button></div>
              <p className="muted sm">Link expired or sign-in stuck? <button className="btn ghost sm" onClick={() => api.monzo.cancel()}>Cancel</button> and try again.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** TrueLayer: live, read-only sync for other UK banks (Lloyds, HSBC, Barclays, Revolut…). */
function TrueLayerConnect() {
  const { state, notify, fmt } = useApp();
  const tl = state.settings.truelayer || { connections: [], pending: [] };
  const conns = tl.connections || [];
  const [info, setInfo] = useState(null);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState('');
  const [pasteUrl, setPasteUrl] = useState('');
  const [setup, setSetup] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => { if (isDesktop) api.truelayer.info().then(setInfo); }, [conns.length]);

  const run = async (label, fn) => {
    setBusy(label);
    try { return await fn(); } catch (e) { if (!/cancelled/i.test(e.message || '')) notify(e.message || String(e), 'critical'); } finally { setBusy(''); }
  };
  const connect = async (id) => {
    setProblem('');
    setBusy(id ? `re:${id}` : 'connect');
    try {
      const r = await api.truelayer.connect(id);
      notify(`${r.bank} connected: ${r.added} transactions imported`, 'good');
    } catch (e) {
      const msg = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
      if (!/cancelled/i.test(msg)) setProblem(msg);
    } finally { setBusy(''); }
  };
  const pending = tl.pending || [];
  const daysLeft = (c) => (c.consentExpiresAt ? Math.ceil((Date.parse(c.consentExpiresAt) - Date.now()) / 86400000) : null);
  const waiting = busy === 'connect' || busy.startsWith('re:');

  return (
    <div className="card">
      <div className="card-head"><h3><Icon name="Building2" className="brand-other" />Other banks: live sync</h3><span className="head-right">{conns.length > 0 && <span className={`badge ${conns.some((c) => c.needsReconnect) ? 'upcoming' : 'done'}`}><Dot />{conns.some((c) => c.needsReconnect) ? 'Needs reconnecting' : 'Connected'}</span>}<Info>Lloyds, HSBC, Barclays, Revolut and more, read-only through TrueLayer.</Info></span></div>
      {!isDesktop ? <DesktopOnly /> : !info?.hasClient ? (
        !setup ? <button className="btn primary" onClick={() => setSetup(true)}>Set up (about 5 minutes)</button> : (
          <div className="steps">
            <ol>
              <li>Open <button className="linkish" onClick={() => api.openExternal('https://console.truelayer.com/')}>console.truelayer.com</button>, open your app and switch to <b>Live</b>.</li>
              <li><b>Settings → Redirect URIs → Add:</b> <code className="copyable" title="Click to copy" onClick={() => { api.copyText(info?.redirectUrl || ''); notify('Copied', 'good'); }}>{info?.redirectUrl || 'http://localhost:47287/truelayer/callback'}</code></li>
              <li><b>Settings → Client secrets → Add secret.</b> Copy it straight away into the box below.</li>
              <li>Copy the <b>Client ID</b> from the <b>Overview</b> tab.</li>
            </ol>
            <p className="muted sm">Both are encrypted on this PC and only ever sent to TrueLayer.</p>
            <div className="row2">
              <Field label="Client ID"><input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" spellCheck="false" /></Field>
              <Field label="Client secret"><input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" spellCheck="false" /></Field>
            </div>
            <button className="btn primary" disabled={!clientId || !secret || !!busy} onClick={() => run('client', async () => { setInfo(await api.truelayer.saveClient(clientId, secret)); setSecret(''); notify('Saved, encrypted on this PC', 'good'); })}>{busy === 'client' ? 'Saving…' : 'Save'}</button>
          </div>
        )
      ) : (
        <>
          {conns.length > 0 && (
            <ul className="list">
              {conns.map((c) => {
                const left = daysLeft(c);
                return (
                  <li key={c.id} className="list-row wrap">
                    <span className="grow"><b>{c.providerName}</b><small className="muted"> · {c.needsReconnect ? 'needs reconnecting' : `synced ${c.lastSync ? new Date(c.lastSync).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'never'}`}{left !== null && !c.needsReconnect ? ` · renew in ${Math.max(0, left)} days` : ''}</small></span>
                    {(c.needsReconnect || (left !== null && left <= 7))
                      ? <button className="btn primary sm" disabled={!!busy} onClick={() => connect(c.id)}>{busy === `re:${c.id}` ? 'Waiting for your bank…' : c.needsReconnect ? 'Reconnect' : 'Renew'}</button>
                      : null}
                    <button className="btn ghost sm danger" disabled={!!busy} onClick={() => run('dc', () => api.truelayer.disconnect(c.id))}>Disconnect</button>
                  </li>
                );
              })}
            </ul>
          )}
          {problem && <div className="callout warn"><p><b>That bank didn't connect.</b> {problem}</p></div>}
          {pending.length > 0 && <p className="muted sm"><Icon name="Hourglass" /> Pending: {pending.length} pending payment{pending.length === 1 ? '' : 's'} ({fmt(pending.reduce((t, p) => t + p.amount, 0))})</p>}
          <div className="inline-row wrap">
            <button className="btn primary" disabled={!!busy} onClick={() => connect()}>{busy === 'connect' ? 'Waiting for your bank…' : conns.length ? 'Connect another bank' : 'Connect a bank'}</button>
            {conns.length > 0 && <button className="btn ghost" disabled={!!busy} onClick={() => run('sync', async () => { const r = await api.truelayer.sync(); notify(r.waiting && !r.added ? 'Already synced in the last 4 hours. Banks limit how often Pulse can check.' : `Synced: ${r.added} new transactions`, r.added ? 'good' : 'info'); })}>{busy === 'sync' ? 'Syncing…' : 'Sync now'}</button>}
            {!conns.length && <button className="btn ghost sm" onClick={async () => { setInfo(await api.truelayer.saveClient('', '')); }}>Change client</button>}
          </div>
          {waiting && (
            <div className="callout">
              <div className="inline-row"><p className="grow">Pick your bank in the browser, log in and approve. Pulse finishes by itself.</p><button className="btn ghost" onClick={() => api.truelayer.cancel()}>Cancel</button></div>
              <p className="muted sm">Page timed out or you closed it? Click <b>Cancel</b>, then connect again.</p>
              <p className="muted sm">Approved on your phone and the browser didn't come back? Paste the address it ended on (it contains <code>code=</code>):</p>
              <div className="inline-row"><input className="grow" value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} placeholder="http://localhost:47287/truelayer/callback?code=…" /><button className="btn ghost" disabled={!pasteUrl} onClick={async () => { try { await api.truelayer.completeWithUrl(pasteUrl.trim()); setPasteUrl(''); } catch (e) { notify(e.message, 'critical'); } }}>Finish</button></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** A small "!" in a card's corner: the explanation is there when you want it, not under every title. */
function Info({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="info-wrap">
      <button type="button" className="info-btn" aria-label="More info" aria-expanded={open} title={typeof children === 'string' ? children : undefined} onClick={() => setOpen((x) => !x)}>!</button>
      {open && <span className="info-pop" role="note">{children}</span>}
    </span>
  );
}

const HISTORY_ICON = { bank: 'Landmark', truelayer: 'Building2', monzo: 'Landmark', watch: 'FolderOpen', demo: 'Sparkles' };

function ImportHistory() {
  const { state } = useApp();
  if (!state.imports?.length) return null;
  return (
    <div className="card">
      <div className="card-head"><h3>Sync & import history</h3></div>
      <ul className="list compact">
        {state.imports.slice(0, 12).map((i) => (
          <li key={i.id} className="history-row">
            <span className="muted nowrap">{new Date(i.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span>
            <span>{<span className="icon-label"><Icon name={HISTORY_ICON[i.source] || 'FileText'} className={i.source === 'monzo' ? 'brand-monzo' : i.source === 'truelayer' ? 'brand-other' : ''} />{i.source === 'bank' || i.source === 'truelayer' ? 'Bank sync' : i.source === 'monzo' ? 'Monzo sync' : i.source === 'watch' ? 'Watched folder' : i.source === 'demo' ? 'Demo data' : 'Statement file'}</span>}{i.bank && BANK_FORMATS[i.bank] ? ` · ${BANK_FORMATS[i.bank].name}` : ''} {i.fileName && <span className="muted">· {i.fileName}</span>}</span>
            <span className="nowrap">{i.added} added{i.duplicates ? <span className="muted"> · {i.duplicates} already had</span> : ''}</span>
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
  const [account, setAccount] = useState('');
  const known = [...new Set(state.transactions.filter((t) => t.account && !['manual', 'demo'].includes(t.source)).map((t) => t.account))].sort();

  useEffect(() => {
    if (!file) return setPreview(null);
    try {
      const p = parseStatement(file.text, { invertSign: invert });
      setPreview(p);
      setAccount((a) => a || p.rows[0]?.account || file.name.replace(/\.csv$/i, '').replace(/[_-]+/g, ' ').trim());
    } catch (e) {
      setPreview({ error: e.message });
    }
  }, [file, invert]);

  const pick = async () => {
    const f = await api.openCsvFile();
    if (f) { setFile(f); setInvert(false); setAccount(''); }
  };

  const doImport = async () => {
    const before = state.transactions.length;
    const rows = preview.rows.map((r) => ({ ...r, account: account.trim() || r.account || '' }));
    const next = await dispatch({ type: 'txn/import', payload: { rows, source: 'csv', fileName: file.name } });
    const added = next.transactions.length - before;
    notify(`Imported ${added} new transaction${added === 1 ? '' : 's'}${preview.rows.length - added ? ` · ${preview.rows.length - added} already in Pulse` : ''}`, 'good');
    setFile(null);
  };

  return (
    <div className="sub-section">
      <h4><Icon name="FileText" />Import a statement now</h4>
      <p className="muted sm">Choose a CSV you've downloaded. Anything already in Pulse is skipped, so overlapping dates are fine.</p>
      <button className="btn ghost" onClick={pick}>Choose CSV file…</button>
      {preview?.error && <p className="error"><Icon name="TriangleAlert" /> {preview.error}</p>}
      {preview?.rows && (
        <div className="preview">
          <div className="card-head">
            <h4>{preview.bankName ? `${preview.bankName} statement` : file.name}: {preview.rows.length} transactions found{preview.skipped ? ` · ${preview.skipped} pending or declined left out` : ''}{preview.errors.length ? ` · ${preview.errors.length} rows unreadable` : ''}</h4>
            <label className="check inline"><input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /><span>Flip signs (credit card statements)</span></label>
          </div>
          <Field label="Which account is this statement from?" hint="Name it once (e.g. Lloyds Current, Barclaycard). A new account name asks whether it's a credit card.">
            <input value={account} onChange={(e) => setAccount(e.target.value)} list="known-accounts" placeholder="e.g. Barclaycard" />
          </Field>
          <datalist id="known-accounts">{known.map((a) => <option key={a} value={a} />)}</datalist>
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th>Auto category</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {preview.rows.slice(0, 8).map((r, i) => {
                const c = cats[categorise(r.description, r.amount, state.rules)];
                return <tr key={i}><td className="nowrap">{r.date}</td><td>{r.description}</td><td><Icon name={c?.icon} /> {c?.name}</td><td className={`num ${r.amount > 0 ? 'pos' : ''}`}>{fmt(r.amount, { sign: true })}</td></tr>;
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
      <div className="card-head"><h4><Icon name="FolderOpen" />Auto-import from a folder</h4>{watchEnabled && watchFolder && <span className="badge done"><Dot />Watching</span>}</div>
      <p className="muted sm">Pick your <b>Downloads</b> folder and statements you download are imported automatically.</p>
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
  const [country, setCountry] = useState('IE');
  const [banks, setBanks] = useState(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [pasteUrl, setPasteUrl] = useState('');

  useEffect(() => { if (isDesktop) api.bank.info().then(setInfo); }, [bank.connected]);

  const run = async (label, fn) => {
    setBusy(label);
    try { return await fn(); } catch (e) { if (!/cancelled/i.test(e.message || '')) notify(e.message || String(e), 'critical'); } finally { setBusy(''); }
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
    <div className="sub-section">
      <div className="card-head"><h4><Icon name="Landmark" />Enable Banking</h4>{bank.connected && <span className={`badge ${bank.needsReconnect ? 'upcoming' : 'done'}`}><Dot />{bank.needsReconnect ? 'Needs reconnecting' : 'Connected'}</span>}</div>
      <p className="muted">Free, read-only Open Banking for <b>EU/EEA banks only</b> (not UK). Re-approve every 90–180 days.</p>
      {!isDesktop ? <DesktopOnly /> : bank.connected ? (
        <>
          <ul className="list">
            {(state.accounts || []).filter((a) => (a.source || 'bank') === 'bank').map((a) => (
              <li key={a.id} className="list-row"><Icon name="Landmark" /><span className="grow"><b>{a.name}</b><small className="muted"> · {bank.institutionName}</small></span><b>{typeof a.balance === 'number' ? fmt(a.balance) : '–'}</b></li>
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
              <button type="button" className="btn ghost" onClick={async () => setPem(await api.bank.pickKey())}>{pem ? <><Icon name="Check" /> {pem.name}</> : 'Choose .pem file…'}</button>
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
