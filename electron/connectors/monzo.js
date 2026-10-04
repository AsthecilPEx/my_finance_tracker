import crypto from 'node:crypto';
import { addDays, todayISO, daysBetween } from '../../src/engine/dates.js';
import { listenOnce, donePage } from './loopback.js';

// Monzo's own developer API: free, read-only, for your own accounts (current, joint and Flex).
// You create a "confidential" client at developers.monzo.com, sign in with the email link Monzo
// sends, then approve access in the Monzo app. Monzo's rules (Strong Customer Authentication):
//  - for 5 minutes after you approve, the full transaction history can be read;
//  - after that, only the last 90 days;
//  - approval must be renewed in the Monzo app every 90 days.
const API = 'https://api.monzo.com';
const AUTH = 'https://auth.monzo.com/';
export const MONZO_PORT = 47286;
export const MONZO_REDIRECT = `http://localhost:${MONZO_PORT}/monzo/callback`;
const SIX_HOURS = 6 * 60 * 60 * 1000;
const DAY = 86400000;
const APPROVAL_DAYS = 90;

export class MonzoError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Monzo transaction → Pulse row. Returns null for declined payments. Amounts are in pence. */
export function mapMonzoTransaction(t, account) {
  if (t.decline_reason) return null;
  const amount = Math.round(Number(t.amount)) / 100;
  if (!amount || Number.isNaN(amount)) return null;
  const isPot = !!t.metadata?.pot_id || /^pot_/.test(t.description || '');
  const name = t.merchant?.name || t.counterparty?.name || t.description || 'Monzo transaction';
  return {
    date: String(t.created || '').slice(0, 10) || todayISO(),
    amount,
    description: isPot ? (amount < 0 ? 'Moved to a Monzo pot' : 'Moved from a Monzo pot') : name.trim(),
    externalId: `monzo:${t.id}`,
    account: account.name,
    ...(isPot ? { categoryId: 'transfer' } : {}),
    ...(t.settled ? {} : { pending: true }),
  };
}

export function accountLabel(a) {
  const type = String(a.type || '');
  if (/flex/.test(type)) return { name: 'Monzo Flex', kind: 'credit' };
  if (/joint/.test(type)) return { name: 'Monzo Joint', kind: 'current' };
  if (/business/.test(type)) return { name: 'Monzo Business', kind: 'current' };
  return { name: 'Monzo Current', kind: 'current' };
}

/**
 * A Flex repayment shows up twice: money leaving the current account and arriving on Flex.
 * Both are transfers, not spending or income. Pair them by amount within 3 days.
 */
export function pairFlexRepayments(rows, accounts) {
  const credit = new Set(accounts.filter((a) => a.kind === 'credit').map((a) => a.name));
  const used = new Set();
  for (const r of rows) {
    if (!credit.has(r.account) || r.amount <= 0) continue;
    r.categoryId = 'transfer';
    const match = rows.find((o) => !used.has(o) && !credit.has(o.account) && Math.abs(o.amount + r.amount) < 0.005 && Math.abs(daysBetween(o.date, r.date)) <= 3);
    if (match) { used.add(match); match.categoryId = 'transfer'; }
  }
  return rows;
}

export class MonzoConnector {
  id = 'monzo';
  name = 'Monzo';
  kind = 'bank';
  capabilities = ['read'];

  constructor({ secrets, getState, dispatch, notify, openExternal, fetchImpl = globalThis.fetch, log = console.log, listen = listenOnce, autoStart = true }) {
    Object.assign(this, { secrets, getState, dispatch, notify, openExternal, fetchImpl, log, listen });
    this.pending = null;
    if (autoStart) {
      this.timer = setInterval(() => this.autoSync(), 30 * 60 * 1000);
      setTimeout(() => this.autoSync(), 25_000);
    }
  }

  creds() { return this.secrets.get('monzo'); }
  saveCreds(c) { this.secrets.set('monzo', c); }
  settings() { return this.getState().settings.monzo || {}; }
  update(patch) { return this.dispatch({ type: 'settings/update', payload: { monzo: patch } }); }

  info() {
    const c = this.creds();
    return { hasClient: !!(c?.clientId && c?.clientSecret), clientId: c?.clientId || '', redirectUrl: MONZO_REDIRECT };
  }

  async saveClient(clientId, clientSecret) {
    clientId = String(clientId || '').trim();
    clientSecret = String(clientSecret || '').trim();
    if (!clientId && !clientSecret) { this.saveCreds(null); return this.info(); }
    if (!/^oauth2client_[A-Za-z0-9]+$/.test(clientId)) throw new Error('That Client ID doesn\'t look right. It starts with "oauth2client_".');
    if (clientSecret.length < 20 || /\s/.test(clientSecret)) throw new Error('That Client secret doesn\'t look right. Copy it again from developers.monzo.com.');
    this.saveCreds({ clientId, clientSecret });
    return this.info();
  }

  async call(pathname, { method = 'GET', form, auth = true } = {}) {
    const headers = { accept: 'application/json' };
    if (auth) headers.authorization = `Bearer ${await this.accessToken()}`;
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const res = await this.fetchImpl(API + pathname, { method, headers, body });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok) throw new MonzoError(data.message || `Monzo returned ${res.status}`, { status: res.status, code: data.code || '' });
    return data;
  }

  async accessToken() {
    const c = this.creds();
    if (!c?.accessToken) throw new MonzoError('Monzo isn\'t connected.', { status: 401, code: 'unauthorized' });
    if (c.expiresAt && c.expiresAt - 60_000 > Date.now()) return c.accessToken;
    if (!c.refreshToken) throw new MonzoError('Monzo sign-in expired.', { status: 401, code: 'unauthorized' });
    // Refresh tokens are single use: store the new pair straight away.
    const res = await this.fetchImpl(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken }).toString(),
    });
    const data = JSON.parse((await res.text()) || '{}');
    if (!res.ok || !data.access_token) throw new MonzoError('Monzo sign-in expired. Connect again.', { status: 401, code: data.code || 'unauthorized' });
    this.saveCreds({ ...c, accessToken: data.access_token, refreshToken: data.refresh_token || c.refreshToken, expiresAt: Date.now() + (Number(data.expires_in) || 21600) * 1000 });
    return data.access_token;
  }

  /** Step 1: open Monzo's sign-in page. Monzo emails a link; opening it on this PC returns here. */
  async connect() {
    const c = this.creds();
    if (!c?.clientId) throw new Error('Add your Monzo Client ID and secret first.');
    const state = crypto.randomBytes(24).toString('hex');
    let resolveUrl;
    const landed = new Promise((resolve, reject) => {
      resolveUrl = resolve;
      setTimeout(() => reject(new Error('Timed out waiting for the Monzo email link. Try again.')), 20 * 60 * 1000);
    });
    landed.catch(() => {});
    const server = await this.listen({
      port: MONZO_PORT,
      path: '/monzo/callback',
      page: donePage('✓ Signed in to Monzo', 'Now open the <b>Monzo app</b> on your phone and approve Pulse Finance. Then go back to Pulse.'),
      onUrl: (u) => resolveUrl(u),
    });
    this.pending = { state, resolve: resolveUrl };
    try {
      const url = `${AUTH}?${new URLSearchParams({ client_id: c.clientId, redirect_uri: MONZO_REDIRECT, response_type: 'code', state })}`;
      await this.openExternal(url);
      return await this.finish(await landed);
    } finally {
      this.pending = null;
      server.close();
    }
  }

  /** The address Monzo's email link opened (automatically, or pasted by the user). */
  completeWithUrl(url) {
    if (this.pending) { this.pending.resolve(url); return { ok: true }; }
    return this.finish(url);
  }

  async finish(urlString) {
    let url;
    try { url = new URL(urlString); } catch { throw new Error('That doesn\'t look like a web address.'); }
    if (url.searchParams.get('error')) throw new Error(`Monzo said: ${url.searchParams.get('error_description') || url.searchParams.get('error')}`);
    const code = url.searchParams.get('code');
    if (!code) throw new Error('No sign-in code in that address. Copy the whole address from the browser bar.');
    if (this.pending && url.searchParams.get('state') !== this.pending.state) throw new Error('That sign-in link belongs to a different attempt. Start again.');
    const c = this.creds();
    const data = await this.call('/oauth2/token', {
      method: 'POST',
      auth: false,
      form: { grant_type: 'authorization_code', client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: MONZO_REDIRECT, code },
    });
    if (!data.refresh_token) this.log('Monzo returned no refresh token: is the client set to Confidential?');
    this.saveCreds({ ...c, accessToken: data.access_token, refreshToken: data.refresh_token || '', expiresAt: Date.now() + (Number(data.expires_in) || 21600) * 1000, userId: data.user_id || '' });
    await this.update({ connected: true, needsApproval: true, needsReconnect: false, accounts: [], lastSync: null, approvedAt: null });
    return this.checkApproval();
  }

  /** Step 2: has the user approved Pulse in the Monzo app yet? On approval, sync straight away. */
  async checkApproval() {
    let accounts;
    try {
      const r = await this.call('/accounts');
      accounts = (r.accounts || []).filter((a) => !a.closed && !/backing_loan/.test(a.type || '')).map((a) => ({ id: a.id, type: a.type, ...accountLabel(a) }));
    } catch (err) {
      if (err.status === 403) return { approved: false };
      throw err;
    }
    // Two accounts of the same kind (e.g. two joint accounts) get a short suffix.
    const seen = {};
    for (const a of accounts) { seen[a.name] = (seen[a.name] || 0) + 1; if (seen[a.name] > 1) a.name = `${a.name} ${seen[a.name]}`; }
    const first = this.settings().needsApproval;
    await this.update({ accounts, needsApproval: false, needsReconnect: false, ...(first ? { approvedAt: new Date().toISOString() } : {}) });
    const r = await this.sync({ full: first });
    return { approved: true, ...r };
  }

  async sync({ full = false } = {}) {
    const m = this.settings();
    if (!m.connected) throw new Error('Monzo isn\'t connected.');
    if (m.needsApproval) throw new Error('Approve Pulse in the Monzo app first.');
    const rows = [];
    const balances = [];
    const recent = addDays(todayISO(), -89);
    let since = m.lastSync ? [addDays(m.lastSync.slice(0, 10), -7), recent].sort()[1] : recent;
    // Once after 0.5.2: look back 90 days so purchases skipped as duplicates of hand-entered
    // ones get linked to their Monzo account.
    if (!m.relinked) since = recent;
    try {
      for (const acc of m.accounts) {
        const pull = async (from) => {
          const out = [];
          let cursor = from ? `${from}T00:00:00Z` : null;
          for (let page = 0; page < 200; page++) {
            const q = new URLSearchParams({ account_id: acc.id, limit: '100' });
            q.append('expand[]', 'merchant');
            if (cursor) q.set('since', cursor);
            const r = await this.call(`/transactions?${q}`);
            const list = r.transactions || [];
            for (const t of list) { const row = mapMonzoTransaction(t, acc); if (row) out.push(row); }
            if (list.length < 100) break;
            cursor = list[list.length - 1].id;
          }
          return out;
        };
        let got;
        if (full) {
          // Within 5 minutes of approval Monzo allows the whole history; fall back to 90 days if not.
          try { got = await pull(null); } catch (err) { if (err.status !== 403) throw err; got = await pull(recent); }
        } else {
          got = await pull(since);
        }
        rows.push(...got);
        try {
          const b = await this.call(`/balance?account_id=${encodeURIComponent(acc.id)}`);
          balances.push({ id: `monzo:${acc.id}`, name: acc.name, kind: acc.kind, balance: Math.round(Number(b.balance)) / 100, updatedAt: new Date().toISOString(), source: 'monzo' });
        } catch (err) {
          this.log('Monzo balance fetch failed', acc.name, err.message);
        }
      }
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        await this.update({ needsReconnect: true });
        throw new Error('Monzo needs you to approve Pulse again. Open Bank Sync and reconnect Monzo (Monzo asks for this every 90 days).');
      }
      throw err;
    }
    pairFlexRepayments(rows, m.accounts);
    const before = this.getState().transactions.length;
    await this.dispatch({ type: 'txn/import', payload: { rows, source: 'monzo', fileName: 'Monzo' } });
    await this.dispatch({ type: 'accounts/set', payload: { source: 'monzo', accounts: balances } });
    await this.update({ lastSync: new Date().toISOString(), relinked: true });
    return { added: this.getState().transactions.length - before };
  }

  /** Days until Monzo wants the in-app approval renewed, or null. */
  approvalDaysLeft() {
    const at = this.settings().approvedAt;
    if (!at) return null;
    return APPROVAL_DAYS - Math.floor((Date.now() - Date.parse(at)) / DAY);
  }

  async autoSync() {
    const m = this.settings();
    if (m.connected && m.needsApproval) {
      // Approved in the Monzo app while the Bank Sync screen was closed: finish setting up.
      try {
        const before = this.snapshot?.();
        const r = await this.checkApproval();
        if (r.approved && r.added > 0) this.onNewTransactions?.(r.added, 'Monzo', before);
      } catch (err) { this.log('Monzo approval check failed', err.message); }
      return;
    }
    if (!m.connected || m.needsReconnect) return;
    if (m.lastSync && Date.now() - Date.parse(m.lastSync) < SIX_HOURS) return;
    try {
      const before = this.snapshot?.();
      const { added } = await this.sync();
      if (added > 0) this.onNewTransactions?.(added, 'Monzo', before);
    } catch (err) {
      this.log('Monzo auto sync failed', err.message);
      if (this.settings().needsReconnect) this.notify('Reconnect Monzo', err.message, 'connect');
    }
  }

  async disconnect() {
    const c = this.creds();
    if (c?.accessToken) {
      try { await this.call('/oauth2/logout', { method: 'POST' }); } catch { /* token already gone */ }
    }
    if (c) this.saveCreds({ clientId: c.clientId, clientSecret: c.clientSecret });
    await this.update({ connected: false, needsApproval: false, needsReconnect: false, accounts: [], lastSync: null, approvedAt: null });
    await this.dispatch({ type: 'accounts/set', payload: { source: 'monzo', accounts: [] } });
  }

  stop() { clearInterval(this.timer); }
}
