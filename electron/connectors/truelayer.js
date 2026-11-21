import crypto from 'node:crypto';
import { addDays, todayISO } from '../../src/engine/dates.js';
import { listenOnce, donePage } from './loopback.js';

// TrueLayer's Data API: read-only Open Banking for UK banks (Lloyds, HSBC, Barclays, Revolut…).
// You create an app in TrueLayer's console (Data: Active, Live) and enter its client ID and
// secret in Pulse. Each bank you connect is its own consent, renewed every 90 days.
// Safety rules:
//  - no public server: the sign-in reply comes back to localhost only, for that minute;
//  - Pulse only ever calls TrueLayer, never the other way round (no webhooks);
//  - banks allow only a few unattended reads a day, so the background sync runs once a day
//    and "Sync now" at most every 4 hours;
//  - pending payments are kept apart ("on its way") and never counted; only settled ones are.
const AUTH = 'https://auth.truelayer.com';
const API = 'https://api.truelayer.com/data/v1';
export const TRUELAYER_PORT = 47287;
export const TRUELAYER_REDIRECT = `http://localhost:${TRUELAYER_PORT}/truelayer/callback`;
const SCOPES = 'info accounts balance cards transactions offline_access';
const HOUR = 3600000;
const DAY = 24 * HOUR;
const CONSENT_DAYS = 90;
const MANUAL_GAP = 4 * HOUR;

export class TrueLayerError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** TrueLayer transaction → Pulse row. The sign comes from DEBIT/CREDIT, which is the same for accounts and cards. */
export function mapTrueLayerTransaction(t, account) {
  const raw = Math.abs(Number(t.amount));
  if (!raw || Number.isNaN(raw)) return null;
  const amount = Math.round((String(t.transaction_type).toUpperCase() === 'CREDIT' ? raw : -raw) * 100) / 100;
  const id = t.normalised_provider_transaction_id || t.provider_transaction_id || t.transaction_id;
  return {
    date: String(t.timestamp || '').slice(0, 10) || todayISO(),
    amount,
    description: String(t.merchant_name || t.description || 'Bank transaction').trim(),
    externalId: `truelayer:${account.id}:${id}`,
    account: account.name,
    ...(t.currency && t.currency !== 'GBP' ? { currency: t.currency } : {}),
  };
}

/** A readable, unique name for each account, e.g. "Revolut Current", "Barclaycard". */
export function accountName(provider, displayName, taken) {
  const p = String(provider || 'Bank').trim();
  const d = String(displayName || '').trim();
  let name = !d ? p : d.toLowerCase().includes(p.toLowerCase().split(' ')[0]) ? d : `${p} ${d}`;
  const base = name;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  taken.add(name);
  return name;
}

export class TrueLayerConnector {
  id = 'truelayer';
  name = 'TrueLayer';
  kind = 'bank';
  capabilities = ['read'];

  constructor({ secrets, getState, dispatch, notify, openExternal, fetchImpl = globalThis.fetch, log = console.log, listen = listenOnce, autoStart = true, now = () => Date.now() }) {
    Object.assign(this, { secrets, getState, dispatch, notify, openExternal, fetchImpl, log, listen, now });
    this.pending = null;
    if (autoStart) {
      this.timer = setInterval(() => this.autoSync(), 30 * 60 * 1000);
      setTimeout(() => this.autoSync(), 40_000);
    }
  }

  creds() { return this.secrets.get('truelayer') || null; }
  saveCreds(c) { this.secrets.set('truelayer', c); }
  settings() { return this.getState().settings.truelayer || { connections: [] }; }
  connections() { return this.settings().connections || []; }
  update(patch) { return this.dispatch({ type: 'settings/update', payload: { truelayer: patch } }); }
  async patchConnection(id, patch) {
    await this.update({ connections: this.connections().map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  }

  info() {
    const c = this.creds();
    return { hasClient: !!(c?.clientId && c?.clientSecret), clientId: c?.clientId || '', redirectUrl: TRUELAYER_REDIRECT };
  }

  async saveClient(clientId, clientSecret) {
    clientId = String(clientId || '').trim();
    clientSecret = String(clientSecret || '').trim();
    const c = this.creds();
    if (!clientId && !clientSecret) {
      if (this.connections().length) throw new Error('Disconnect your banks first, then change the client.');
      this.saveCreds(null);
      return this.info();
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{3,}$/.test(clientId) || /^sandbox-/.test(clientId)) throw new Error('That Client ID doesn\'t look right. Copy it from your app\'s Overview in TrueLayer\'s console, with the Live switch on.');
    if (clientSecret.length < 20 || /\s/.test(clientSecret)) throw new Error('That Client secret doesn\'t look right. Create one under Settings → Client secrets (Live) and copy it straight away.');
    this.saveCreds({ ...(c || {}), clientId, clientSecret, tokens: c?.tokens || {} });
    return this.info();
  }

  async post(url, form) {
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok) throw new TrueLayerError(data.error_description || data.error || `TrueLayer returned ${res.status}`, { status: res.status, code: data.error || '' });
    return data;
  }

  async accessToken(connId) {
    const c = this.creds();
    const t = c?.tokens?.[connId];
    if (!t?.accessToken) throw new TrueLayerError('This bank isn\'t connected.', { status: 401, code: 'invalid_grant' });
    if (t.expiresAt && t.expiresAt - 60_000 > this.now()) return t.accessToken;
    if (!t.refreshToken) throw new TrueLayerError('The bank sign-in expired.', { status: 401, code: 'invalid_grant' });
    const data = await this.post(`${AUTH}/connect/token`, { grant_type: 'refresh_token', client_id: c.clientId, client_secret: c.clientSecret, refresh_token: t.refreshToken });
    this.storeTokens(connId, data);
    return data.access_token;
  }

  storeTokens(connId, data) {
    const c = this.creds();
    const prev = c.tokens?.[connId] || {};
    this.saveCreds({ ...c, tokens: { ...(c.tokens || {}), [connId]: { accessToken: data.access_token, refreshToken: data.refresh_token || prev.refreshToken || '', expiresAt: this.now() + (Number(data.expires_in) || 3600) * 1000 } } });
  }

  async get(connId, pathname, { optional = false } = {}) {
    const res = await this.fetchImpl(API + pathname, { headers: { accept: 'application/json', authorization: `Bearer ${await this.accessToken(connId)}` } });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok) {
      // Some banks don't offer cards or pending payments: that's "none", not an error.
      if (optional && [400, 403, 404, 501].includes(res.status)) return [];
      throw new TrueLayerError(data.error_description || data.error || `TrueLayer returned ${res.status}`, { status: res.status, code: data.error || '' });
    }
    return data.results || [];
  }

  /** Opens TrueLayer's bank picker (or one bank, to reconnect it). The reply comes back to localhost. */
  async connect(reconnectId) {
    const c = this.creds();
    if (!c?.clientId) throw new Error('Add your TrueLayer Client ID and secret first.');
    const old = reconnectId ? this.connections().find((x) => x.id === reconnectId) : null;
    const state = crypto.randomBytes(24).toString('hex');
    let resolveUrl;
    const landed = new Promise((resolve, reject) => {
      resolveUrl = resolve;
      setTimeout(() => reject(new Error('Timed out waiting for your bank. Try again.')), 15 * 60 * 1000);
    });
    landed.catch(() => {});
    const server = await this.listen({
      port: TRUELAYER_PORT,
      path: '/truelayer/callback',
      page: donePage('✓ Bank connected', 'You can close this tab and go back to Pulse.'),
      onUrl: (u) => resolveUrl(u),
    });
    this.pending = { state, resolve: resolveUrl, reconnectId: old?.id || null };
    try {
      const q = new URLSearchParams({ response_type: 'code', client_id: c.clientId, scope: SCOPES, redirect_uri: TRUELAYER_REDIRECT, state, providers: old?.providerId || 'uk-ob-all uk-oauth-all' });
      await this.openExternal(`${AUTH}/?${q}`);
      return await this.finish(await landed);
    } finally {
      this.pending = null;
      server.close();
    }
  }

  /** The address the bank sent the browser back to (automatically, or pasted by the user). */
  completeWithUrl(url) {
    if (this.pending) { this.pending.resolve(url); return { ok: true }; }
    throw new Error('Click Connect a bank first, then paste the address.');
  }

  async finish(urlString) {
    let url;
    try { url = new URL(urlString); } catch { throw new Error('That doesn\'t look like a web address.'); }
    if (url.searchParams.get('error')) throw new Error(`Your bank or TrueLayer said: ${url.searchParams.get('error_description') || url.searchParams.get('error')}`);
    const code = url.searchParams.get('code');
    if (!code) throw new Error('No sign-in code in that address. Copy the whole address from the browser bar.');
    if (this.pending && url.searchParams.get('state') !== this.pending.state) throw new Error('That sign-in belongs to a different attempt. Start again.');
    const reconnectId = this.pending?.reconnectId || null;
    const c = this.creds();
    const tokens = await this.post(`${AUTH}/connect/token`, { grant_type: 'authorization_code', client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: TRUELAYER_REDIRECT, code });
    const tempId = `tl_${crypto.randomBytes(6).toString('hex')}`;
    this.storeTokens(tempId, tokens);
    let me = {};
    try { [me = {}] = await this.get(tempId, '/me'); } catch (err) { this.log('TrueLayer /me failed', err.message); }
    const providerId = me.provider?.provider_id || '';
    const providerName = me.provider?.display_name || 'Bank';
    // Reconnecting the same bank keeps its accounts and history; a new bank gets a new entry.
    const existing = this.connections().find((x) => x.id === reconnectId) || this.connections().find((x) => providerId && x.providerId === providerId);
    const id = existing?.id || tempId;
    if (id !== tempId) {
      const now = this.creds();
      const { [tempId]: fresh, ...rest } = now.tokens;
      this.saveCreds({ ...now, tokens: { ...rest, [id]: fresh } });
    }
    const consentExpiresAt = me.consent_expires_at || new Date(this.now() + CONSENT_DAYS * DAY).toISOString();
    const conn = { ...(existing || {}), id, providerId, providerName, connectedAt: new Date(this.now()).toISOString(), consentExpiresAt, needsReconnect: false };
    await this.update({ connections: existing ? this.connections().map((x) => (x.id === id ? conn : x)) : [...this.connections(), conn] });
    // Within minutes of signing in, banks allow the longest history; after that, 90 days.
    const r = await this.syncOne(id, { full: !existing?.lastSync });
    return { ...r, bank: providerName };
  }

  async syncOne(id, { full = false } = {}) {
    const conn = this.connections().find((x) => x.id === id);
    if (!conn) throw new Error('That bank isn\'t connected.');
    const recent = addDays(todayISO(), -89);
    const from = full ? addDays(todayISO(), -730) : conn.lastSync ? [addDays(conn.lastSync.slice(0, 10), -7), recent].sort()[1] : recent;
    const to = todayISO();
    const taken = new Set(this.connections().filter((x) => x.id !== id).flatMap((x) => (x.accounts || []).map((a) => a.name)));
    const rows = [];
    const balances = [];
    const pending = [];
    const accounts = [];
    try {
      const list = [
        ...(await this.get(id, '/accounts')).map((a) => ({ ...a, type: 'accounts', kind: 'current' })),
        ...(await this.get(id, '/cards', { optional: true })).map((a) => ({ ...a, type: 'cards', kind: 'credit' })),
      ];
      for (const a of list) {
        const prev = (conn.accounts || []).find((x) => x.id === a.account_id);
        const acc = { id: a.account_id, name: prev?.name || accountName(conn.providerName, a.display_name, taken), kind: a.kind };
        if (prev) taken.add(acc.name);
        accounts.push(acc);
        const base = `/${a.type}/${encodeURIComponent(a.account_id)}`;
        let txns;
        try {
          txns = await this.get(id, `${base}/transactions?from=${from}&to=${to}`);
        } catch (err) {
          if (!full || err.status !== 403) throw err;
          txns = await this.get(id, `${base}/transactions?from=${recent}&to=${to}`);
        }
        for (const t of txns) { const row = mapTrueLayerTransaction(t, acc); if (row) rows.push(row); }
        for (const t of await this.get(id, `${base}/transactions/pending`, { optional: true })) {
          const row = mapTrueLayerTransaction(t, acc);
          if (row) pending.push({ date: row.date, amount: row.amount, description: row.description, account: acc.name });
        }
        try {
          const [b] = await this.get(id, `${base}/balance`);
          if (b) {
            const value = Number(b.current ?? b.available) || 0;
            // Cards report what you owe; Pulse shows card balances as an amount owed.
            balances.push({ id: `truelayer:${a.account_id}`, name: acc.name, kind: acc.kind, balance: Math.round((acc.kind === 'credit' ? Math.abs(value) : value) * 100) / 100, updatedAt: new Date(this.now()).toISOString(), source: 'truelayer' });
          }
        } catch (err) { this.log('TrueLayer balance failed', err.message); }
      }
    } catch (err) {
      if (err.code === 'invalid_grant' || err.code === 'access_denied' || err.status === 401 || err.status === 403) {
        await this.patchConnection(id, { needsReconnect: true });
        throw new Error(`${conn.providerName} needs you to reconnect it in Bank Sync (banks ask for this every 90 days).`);
      }
      throw err;
    }
    const before = this.getState().transactions.length;
    if (rows.length) await this.dispatch({ type: 'txn/import', payload: { rows, source: 'truelayer', fileName: conn.providerName } });
    await this.patchConnection(id, { accounts, lastSync: new Date(this.now()).toISOString(), needsReconnect: false });
    // Pending payments are shown as "on its way" only: they never enter your totals.
    await this.update({ pending: [...(this.settings().pending || []).filter((p) => !accounts.some((a) => a.name === p.account)), ...pending] });
    await this.publishBalances(id, balances);
    return { added: this.getState().transactions.length - before };
  }

  async publishBalances(id, fresh) {
    const own = new Set((this.connections().find((x) => x.id === id)?.accounts || []).map((a) => `truelayer:${a.id}`));
    const others = (this.getState().accounts || []).filter((a) => a.source === 'truelayer' && !own.has(a.id));
    await this.dispatch({ type: 'accounts/set', payload: { source: 'truelayer', accounts: [...others, ...fresh] } });
  }

  /** "Sync now": every connected bank, but not more than every 4 hours (banks limit unattended reads). */
  async sync({ manual = true } = {}) {
    let added = 0;
    const errors = [];
    for (const conn of this.connections()) {
      if (conn.needsReconnect) continue;
      if (manual && conn.lastSync && this.now() - Date.parse(conn.lastSync) < MANUAL_GAP) continue;
      try { added += (await this.syncOne(conn.id)).added; } catch (err) { errors.push(err.message); }
    }
    if (errors.length && !added) throw new Error(errors[0]);
    return { added, waiting: manual && this.connections().some((c) => !c.needsReconnect && c.lastSync && this.now() - Date.parse(c.lastSync) < MANUAL_GAP) };
  }

  /** Days until a bank's 90-day consent runs out. */
  daysLeft(conn) {
    if (!conn?.consentExpiresAt) return null;
    return Math.ceil((Date.parse(conn.consentExpiresAt) - this.now()) / DAY);
  }

  async autoSync() {
    for (const conn of this.connections()) {
      if (conn.needsReconnect) continue;
      const left = this.daysLeft(conn);
      if (left !== null && left <= 0) {
        await this.patchConnection(conn.id, { needsReconnect: true });
        this.notify(`Reconnect ${conn.providerName}`, `Your bank's 90-day permission has ended. Open Bank Sync and click Reconnect.`, 'connect');
        continue;
      }
      if (conn.lastSync && this.now() - Date.parse(conn.lastSync) < DAY) continue;
      try {
        const before = this.snapshot?.();
        const { added } = await this.syncOne(conn.id);
        if (added > 0) this.onNewTransactions?.(added, conn.providerName, before);
      } catch (err) {
        this.log('TrueLayer auto sync failed', err.message);
        if (this.connections().find((x) => x.id === conn.id)?.needsReconnect) this.notify(`Reconnect ${conn.providerName}`, err.message, 'connect');
      }
    }
  }

  async disconnect(id) {
    const c = this.creds();
    const conn = this.connections().find((x) => x.id === id);
    if (!conn) return;
    try {
      const token = await this.accessToken(id);
      await this.fetchImpl(`${AUTH}/api/delete`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } });
    } catch { /* already expired: nothing to revoke */ }
    if (c?.tokens) { const { [id]: _gone, ...rest } = c.tokens; this.saveCreds({ ...c, tokens: rest }); }
    const names = new Set((conn.accounts || []).map((a) => a.name));
    await this.update({ connections: this.connections().filter((x) => x.id !== id), pending: (this.settings().pending || []).filter((p) => !names.has(p.account)) });
    await this.dispatch({ type: 'accounts/set', payload: { source: 'truelayer', accounts: (this.getState().accounts || []).filter((a) => a.source === 'truelayer' && !(conn.accounts || []).some((x) => `truelayer:${x.id}` === a.id)) } });
  }

  stop() { clearInterval(this.timer); }
}
