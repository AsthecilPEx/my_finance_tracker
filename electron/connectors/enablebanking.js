import http from 'node:http';
import crypto from 'node:crypto';
import { addDays, todayISO } from '../../src/engine/dates.js';
import { BANK_REDIRECT_URL } from '../../src/config.js';

// Enable Banking: regulated UK/EU Open Banking (account information, read-only).
// Personal use is free in "restricted" mode, where the app can only read accounts the
// owner has linked to it in the Enable Banking control panel.
const BASE = 'https://api.enablebanking.com';
export const CALLBACK_PORT = 47285;
// What the bank redirects to (https, registered in Enable Banking). That page forwards to LOCAL_CALLBACK.
export const REDIRECT_URL = BANK_REDIRECT_URL;
export const LOCAL_CALLBACK = `http://localhost:${CALLBACK_PORT}/callback`;
const SIX_HOURS = 6 * 60 * 60 * 1000;
const DAY = 86400000;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** RS256 JWT for the API, signed with the application's private key. */
export function makeJwt(appId, privateKeyPem, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'RS256', kid: appId }));
  const body = b64url(JSON.stringify({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 3600 }));
  const sig = crypto.createSign('RSA-SHA256').update(`${header}.${body}`).sign(privateKeyPem);
  return `${header}.${body}.${b64url(sig)}`;
}

export function mapTransaction(t, account) {
  const raw = parseFloat(t.transaction_amount?.amount);
  const amount = t.credit_debit_indicator === 'DBIT' ? -Math.abs(raw) : Math.abs(raw);
  const party = (t.credit_debit_indicator === 'DBIT' ? t.creditor?.name : t.debtor?.name) || t.creditor?.name || t.debtor?.name || '';
  const remittance = (t.remittance_information || []).join(' ');
  return {
    date: (t.booking_date || t.value_date || t.transaction_date || todayISO()).slice(0, 10),
    amount,
    description: (party || remittance || t.bank_transaction_code?.description || 'Bank transaction').trim(),
    externalId: t.entry_reference || t.transaction_id || undefined,
    account: account.name,
  };
}

function pickBalance(balances = []) {
  const pref = ['ITAV', 'CLAV', 'XPCD', 'ITBD', 'CLBD'];
  const b = pref.map((t) => balances.find((x) => x.balance_type === t)).find(Boolean) || balances[0];
  return b ? parseFloat(b.balance_amount.amount) : null;
}

export class EnableBankingConnector {
  id = 'enablebanking';
  name = 'Enable Banking';
  kind = 'bank';
  capabilities = ['read'];

  constructor({ secrets, getState, dispatch, notify, openExternal, fetchImpl = globalThis.fetch, log = console.log }) {
    Object.assign(this, { secrets, getState, dispatch, notify, openExternal, fetchImpl, log });
    this.pending = null;
    this.timer = setInterval(() => this.autoSync(), 30 * 60 * 1000);
    setTimeout(() => this.autoSync(), 20_000);
  }

  creds() {
    return this.secrets.getCredentials();
  }

  async request(pathname, { method = 'GET', body } = {}) {
    const c = this.creds();
    if (!c) throw new Error('Add your Enable Banking application first.');
    const res = await this.fetchImpl(BASE + pathname, {
      method,
      headers: { authorization: `Bearer ${makeJwt(c.appId, c.key)}`, accept: 'application/json', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) {
      const detail = data?.message || data?.detail || data?.error || res.statusText;
      const err = new Error(res.status === 429 ? 'Your bank limits how often data can be fetched. Try again later.' : `Bank connection error (${res.status}): ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  info() {
    return { hasCredentials: !!this.creds(), redirectUrl: REDIRECT_URL, appId: this.creds()?.appId || '' };
  }

  async saveCredentials(appId, pem) {
    if (!appId || !pem) { this.secrets.setCredentials(null); return false; }
    try { crypto.createPrivateKey(pem); } catch { throw new Error("That file isn't a valid private key (.pem)."); }
    this.secrets.setCredentials({ appId, key: pem });
    try {
      await this.request('/application');
      return true;
    } catch (err) {
      this.secrets.setCredentials(null);
      throw err;
    }
  }

  async institutions(country) {
    const r = await this.request(`/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`);
    return (r.aspsps || []).map((a) => ({ name: a.name, country: a.country, logo: a.logo, maximum_consent_validity: a.maximum_consent_validity }));
  }

  /** Local listener for the redirect back from the bank. Pasting the URL works too. */
  listen() {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url, LOCAL_CALLBACK);
        if (url.pathname !== '/callback') { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<body style="font:16px system-ui;background:#0b0b0f;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><div><h2>✓ Pulse is connected</h2><p>You can close this tab and go back to the app.</p></div></body>');
        this.pending?.resolve(url.toString());
      });
      server.on('error', () => resolve(null)); // port busy: user can paste the URL instead
      server.listen(CALLBACK_PORT, '127.0.0.1', () => resolve(server));
    });
  }

  async connect(bankName, country, maxValiditySeconds) {
    const validMs = Math.min(90 * DAY, (Number(maxValiditySeconds) || 90 * 86400) * 1000);
    const state = crypto.randomUUID();
    const server = await this.listen();
    try {
      const auth = await this.request('/auth', {
        method: 'POST',
        body: { access: { valid_until: new Date(Date.now() + validMs).toISOString() }, aspsp: { name: bankName, country }, state, redirect_url: REDIRECT_URL, psu_type: 'personal' },
      });
      let settle;
      const done = new Promise((res, rej) => { settle = { res, rej }; });
      done.catch(() => {});
      const landed = new Promise((resolve, reject) => {
        this.pending = { resolve, reject, state, done };
        setTimeout(() => reject(new Error('Timed out waiting for bank approval.')), 15 * 60 * 1000);
      });
      await this.openExternal(auth.url);
      try {
        const result = await this.finish(await landed, { bankName, country });
        settle.res(result);
        return result;
      } catch (err) {
        settle.rej(err);
        throw err;
      }
    } finally {
      this.pending = null;
      server?.close();
    }
  }

  /** Called with the URL the bank redirected to (automatically, or pasted by the user). */
  completeWithUrl(url) {
    // Mid-connect: hand the URL to the waiting flow and report its real outcome.
    if (this.pending) { const { done } = this.pending; this.pending.resolve(url); return done; }
    return this.finish(url, {});
  }

  async finish(urlString, { bankName, country }) {
    let url;
    try { url = new URL(urlString); } catch { throw new Error("That doesn't look like a web address."); }
    const error = url.searchParams.get('error');
    if (error) throw new Error(`The bank said: ${url.searchParams.get('error_description') || error}`);
    const code = url.searchParams.get('code');
    if (!code) throw new Error('No approval code in that address. Make sure you copied the whole thing.');
    if (this.pending?.state && url.searchParams.get('state') && url.searchParams.get('state') !== this.pending.state) throw new Error('This approval belongs to a different request.');
    const session = await this.request('/sessions', { method: 'POST', body: { code } });
    const accounts = (session.accounts || []).map((a) => ({
      id: a.uid,
      name: a.name || a.details || a.product || (a.account_id?.iban ? `${session.aspsp?.name || bankName} ••${a.account_id.iban.slice(-4)}` : session.aspsp?.name || bankName),
    }));
    if (!accounts.length) throw new Error('No accounts were shared. In restricted mode, link your accounts to the app in the Enable Banking control panel first.');
    await this.dispatch({
      type: 'settings/update',
      payload: { bank: { provider: 'enablebanking', connected: true, needsReconnect: false, institutionName: session.aspsp?.name || bankName, country: session.aspsp?.country || country, sessionId: session.session_id, accounts, expires: session.access?.valid_until ? Date.parse(session.access.valid_until) : Date.now() + 90 * DAY, lastSync: null } },
    });
    return this.sync();
  }

  async sync() {
    const bank = this.getState().settings.bank;
    if (!bank.connected) throw new Error('No bank connected.');
    const from = bank.lastSync ? addDays(todayISO(), -14) : addDays(todayISO(), -365);
    const rows = [];
    const balances = [];
    try {
      for (const acc of bank.accounts) {
        let key = null;
        let pages = 0;
        do {
          const q = `date_from=${from}${key ? `&continuation_key=${encodeURIComponent(key)}` : ''}`;
          const r = await this.request(`/accounts/${acc.id}/transactions?${q}`);
          for (const t of r.transactions || []) {
            if (t.status && t.status !== 'BOOK') continue;
            const row = mapTransaction(t, acc);
            if (!isNaN(row.amount) && row.amount !== 0) rows.push(row);
          }
          key = r.continuation_key;
        } while (key && ++pages < 50);
        try {
          const b = await this.request(`/accounts/${acc.id}/balances`);
          balances.push({ id: acc.id, name: acc.name, balance: pickBalance(b.balances), updatedAt: new Date().toISOString(), source: 'bank' });
        } catch (err) {
          this.log('Balance fetch failed', err.message);
        }
      }
    } catch (err) {
      if ([401, 403].includes(err.status) || /expired|revoked/i.test(err.message)) {
        await this.dispatch({ type: 'settings/update', payload: { bank: { needsReconnect: true } } });
        throw new Error('Your bank access has expired. Reconnect to keep syncing (banks require this every 90–180 days).');
      }
      throw err;
    }
    const before = this.getState().transactions.length;
    await this.dispatch({ type: 'txn/import', payload: { rows, source: 'bank', fileName: bank.institutionName } });
    if (balances.length) await this.dispatch({ type: 'accounts/set', payload: balances });
    await this.dispatch({ type: 'settings/update', payload: { bank: { lastSync: new Date().toISOString() } } });
    return { added: this.getState().transactions.length - before };
  }

  async autoSync() {
    const bank = this.getState().settings.bank;
    if (!bank.connected || !bank.autoSync || bank.needsReconnect) return;
    if (bank.lastSync && Date.now() - new Date(bank.lastSync).getTime() < SIX_HOURS) return;
    try {
      const before = this.snapshot?.();
      const { added } = await this.sync();
      if (added > 0) this.onNewTransactions?.(added, bank.institutionName, before);
    } catch (err) {
      this.log('Auto sync failed', err.message);
      if (this.getState().settings.bank.needsReconnect) this.notify('Reconnect your bank', err.message);
    }
  }

  async disconnect() {
    const bank = this.getState().settings.bank;
    if (bank.sessionId) {
      try { await this.request(`/sessions/${bank.sessionId}`, { method: 'DELETE' }); } catch { /* already gone */ }
    }
    await this.dispatch({ type: 'settings/update', payload: { bank: { connected: false, needsReconnect: false, sessionId: '', accounts: [], lastSync: null, expires: null } } });
    await this.dispatch({ type: 'accounts/set', payload: [] });
  }

  stop() {
    clearInterval(this.timer);
  }
}
