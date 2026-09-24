import http from 'node:http';
import { addDays, todayISO } from '../src/engine/dates.js';

// GoCardless Bank Account Data (formerly Nordigen): regulated UK/EU Open Banking AIS.
// Account Information access is read-only by design: balances, details and transactions.
const BASE = 'https://bankaccountdata.gocardless.com/api/v2';
const SIX_HOURS = 6 * 60 * 60 * 1000;

function callbackServer() {
  return new Promise((resolve, reject) => {
    let done;
    const received = new Promise((r) => { done = r; });
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<body style="font:16px system-ui;background:#0b0b0f;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><div><h2>✓ Pulse is connected</h2><p>You can close this tab and go back to the app.</p></div></body>');
      done(req.url);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}/callback`,
        wait: (ms) => Promise.race([received, new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out waiting for bank approval')), ms))]),
        close: () => server.close(),
      });
    });
  });
}

function pickBalance(balances = []) {
  const pref = ['interimAvailable', 'expected', 'closingBooked', 'interimBooked'];
  const b = pref.map((t) => balances.find((x) => x.balanceType === t)).find(Boolean) || balances[0];
  return b ? parseFloat(b.balanceAmount.amount) : null;
}

export function mapTransaction(t, account) {
  const remittance = t.remittanceInformationUnstructured || (t.remittanceInformationUnstructuredArray || []).join(' ') || t.additionalInformation || '';
  const party = t.creditorName || t.debtorName || '';
  return {
    date: (t.bookingDate || t.valueDate || todayISO()).slice(0, 10),
    amount: parseFloat(t.transactionAmount?.amount),
    description: (party || remittance || 'Bank transaction').trim(),
    externalId: t.transactionId || t.internalTransactionId || undefined,
    account: account.name,
  };
}

export class BankSync {
  constructor({ secrets, getState, dispatch, notify, openExternal, log = console.log }) {
    Object.assign(this, { secrets, getState, dispatch, notify, openExternal, log });
    this.timer = setInterval(() => this.autoSync(), 30 * 60 * 1000);
    setTimeout(() => this.autoSync(), 20_000);
  }

  async request(pathname, { method = 'GET', body, auth = true } = {}) {
    const headers = { accept: 'application/json', 'content-type': 'application/json' };
    if (auth) headers.authorization = `Bearer ${await this.token()}`;
    const res = await fetch(BASE + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) {
      const detail = data?.detail || data?.summary || (typeof data === 'object' ? Object.values(data).flat().join(' ') : '') || res.statusText;
      const err = new Error(res.status === 429 ? 'Your bank limits how often data can be fetched. Try again later.' : `Bank connection error (${res.status}): ${detail}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async token() {
    const now = Date.now();
    const t = this.secrets.get('token');
    if (t && t.accessExpires > now + 60_000) return t.access;
    if (t && t.refreshExpires > now + 60_000) {
      const r = await this.request('/token/refresh/', { method: 'POST', body: { refresh: t.refresh }, auth: false });
      this.secrets.setToken({ ...t, access: r.access, accessExpires: now + r.access_expires * 1000 });
      return r.access;
    }
    const creds = this.secrets.getCredentials();
    if (!creds) throw new Error('Add your GoCardless Secret ID and Key first.');
    const r = await this.request('/token/new/', { method: 'POST', body: { secret_id: creds.id, secret_key: creds.key }, auth: false });
    this.secrets.setToken({ access: r.access, accessExpires: now + r.access_expires * 1000, refresh: r.refresh, refreshExpires: now + r.refresh_expires * 1000 });
    return r.access;
  }

  hasCredentials() {
    return !!this.secrets.getCredentials();
  }

  async saveCredentials(id, key) {
    this.secrets.setToken(null);
    if (!id || !key) { this.secrets.setCredentials(null); return false; }
    this.secrets.setCredentials({ id, key });
    try {
      await this.token();
      return true;
    } catch (err) {
      this.secrets.setCredentials(null);
      throw err;
    }
  }

  institutions(country) {
    return this.request(`/institutions/?country=${encodeURIComponent(country)}`);
  }

  async connect(institutionId, institutionName, totalDays) {
    const server = await callbackServer();
    try {
      const maxDays = Math.max(30, Math.min(730, Number(totalDays) || 90));
      const agreement = await this.request('/agreements/enduser/', {
        method: 'POST',
        body: { institution_id: institutionId, max_historical_days: maxDays, access_valid_for_days: 90, access_scope: ['balances', 'details', 'transactions'] },
      });
      const requisition = await this.request('/requisitions/', {
        method: 'POST',
        body: { redirect: server.url, institution_id: institutionId, agreement: agreement.id, reference: `pulse-${Date.now()}`, user_language: 'EN' },
      });
      await this.openExternal(requisition.link);
      await server.wait(15 * 60 * 1000);
      const r = await this.request(`/requisitions/${requisition.id}/`);
      if (r.status !== 'LN' || !r.accounts?.length) throw new Error('Access was not approved at your bank.');
      const accounts = [];
      for (const id of r.accounts) {
        let name = institutionName;
        try {
          const d = await this.request(`/accounts/${id}/details/`);
          const a = d.account || {};
          name = a.name || a.product || a.displayName || (a.iban ? `${institutionName} ••${a.iban.slice(-4)}` : institutionName);
        } catch { /* details are optional */ }
        accounts.push({ id, name });
      }
      await this.dispatch({
        type: 'settings/update',
        payload: { bank: { connected: true, needsReconnect: false, institutionId, institutionName, requisitionId: requisition.id, accounts, maxDays, expires: Date.now() + 90 * 86400000, lastSync: null } },
      });
      return this.sync();
    } finally {
      server.close();
    }
  }

  async sync() {
    const bank = this.getState().settings.bank;
    if (!bank.connected) throw new Error('No bank connected.');
    const from = bank.lastSync ? addDays(todayISO(), -14) : addDays(todayISO(), -(bank.maxDays || 90));
    const rows = [];
    const balances = [];
    try {
      for (const acc of bank.accounts) {
        const tx = await this.request(`/accounts/${acc.id}/transactions/?date_from=${from}`);
        for (const t of tx.transactions?.booked || []) {
          const row = mapTransaction(t, acc);
          if (!isNaN(row.amount) && row.amount !== 0) rows.push(row);
        }
        try {
          const b = await this.request(`/accounts/${acc.id}/balances/`);
          balances.push({ id: acc.id, name: acc.name, balance: pickBalance(b.balances), updatedAt: new Date().toISOString(), source: 'bank' });
        } catch (err) {
          this.log('Balance fetch failed', err.message);
        }
      }
    } catch (err) {
      if ([401, 403, 409].includes(err.status)) {
        await this.dispatch({ type: 'settings/update', payload: { bank: { needsReconnect: true } } });
        throw new Error('Your bank access has expired. Reconnect to keep syncing (banks require this every 90 days).');
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
      const { added } = await this.sync();
      if (added > 0) this.notify('Bank synced', `${added} new transaction${added === 1 ? '' : 's'} from ${bank.institutionName}`);
    } catch (err) {
      this.log('Auto sync failed', err.message);
      if (this.getState().settings.bank.needsReconnect) this.notify('Reconnect your bank', err.message);
    }
  }

  async disconnect() {
    const bank = this.getState().settings.bank;
    if (bank.requisitionId) {
      try { await this.request(`/requisitions/${bank.requisitionId}/`, { method: 'DELETE' }); } catch { /* already gone */ }
    }
    await this.dispatch({ type: 'settings/update', payload: { bank: { connected: false, needsReconnect: false, requisitionId: '', accounts: [], lastSync: null, expires: null } } });
    await this.dispatch({ type: 'accounts/set', payload: [] });
  }

  stop() {
    clearInterval(this.timer);
  }
}
