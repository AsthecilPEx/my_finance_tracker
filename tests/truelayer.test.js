import { describe, it, expect } from 'vitest';
import { TrueLayerConnector, mapTrueLayerTransaction, accountName, TRUELAYER_REDIRECT } from '../electron/connectors/truelayer.js';
import { reduce, createEmptyState } from '../src/engine/state.js';
import { unclassifiedAccounts } from '../src/engine/cards.js';
import { ALLOWED_HOSTS } from '../electron/net.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const today = new Date().toISOString().slice(0, 10);

function harness({ fullHistory = true } = {}) {
  let state = { ...createEmptyState(), settings: { ...createEmptyState().settings, onboarded: true } };
  const store = {};
  const calls = [];
  const flags = { refreshes: 0, revoked: 0, deny: false };
  let clock = Date.now();
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push({ host: u.hostname, path: u.pathname, query: u.search, method: opts.method || 'GET', headers: opts.headers || {} });
    if (u.hostname === 'auth.truelayer.com') {
      if (u.pathname === '/connect/token') {
        const f = new URLSearchParams(opts.body);
        if (f.get('grant_type') === 'refresh_token') {
          flags.refreshes++;
          return flags.deny ? json(400, { error: 'invalid_grant' }) : json(200, { access_token: `acc${flags.refreshes + 1}`, refresh_token: `ref${flags.refreshes + 1}`, expires_in: 3600 });
        }
        expect(f.get('redirect_uri')).toBe(TRUELAYER_REDIRECT);
        return f.get('code') === 'good' ? json(200, { access_token: 'acc1', refresh_token: 'ref1', expires_in: 3600 }) : json(400, { error: 'invalid_grant' });
      }
      if (u.pathname === '/api/delete') { flags.revoked++; return json(200, {}); }
    }
    if (flags.deny) return json(401, { error: 'invalid_token' });
    const p = u.pathname.replace('/data/v1', '');
    if (p === '/me') return json(200, { results: [{ provider: { display_name: 'Revolut', provider_id: 'ob-revolut' }, consent_expires_at: new Date(clock + 90 * 86400000).toISOString() }] });
    if (p === '/accounts') return json(200, { results: [{ account_id: 'a1', display_name: 'Current', account_type: 'TRANSACTION', currency: 'GBP' }] });
    if (p === '/cards') return json(200, { results: [{ account_id: 'c1', display_name: 'Credit Card', card_type: 'CREDIT' }] });
    if (p === '/accounts/a1/transactions') {
      if (!fullHistory && u.searchParams.get('from') < today.slice(0, 4) - 1 + today.slice(4)) return json(403, { error: 'sca_exceeded' });
      return json(200, { results: [
        { transaction_id: 'x1', normalised_provider_transaction_id: 'n1', timestamp: `${today}T09:00:00Z`, description: 'TESCO STORES 123', merchant_name: 'Tesco', amount: -23.4, currency: 'GBP', transaction_type: 'DEBIT' },
        { transaction_id: 'x2', timestamp: `${today}T10:00:00Z`, description: 'SALARY', amount: 1500, currency: 'GBP', transaction_type: 'CREDIT' },
      ] });
    }
    if (p === '/accounts/a1/transactions/pending') return json(200, { results: [{ transaction_id: 'p1', timestamp: `${today}T12:00:00Z`, description: 'PRET', amount: -3.99, currency: 'GBP', transaction_type: 'DEBIT' }] });
    if (p === '/cards/c1/transactions') return json(200, { results: [{ transaction_id: 'y1', timestamp: `${today}T08:00:00Z`, description: 'AMAZON', amount: 40, currency: 'GBP', transaction_type: 'DEBIT' }] });
    if (p === '/cards/c1/transactions/pending') return json(501, { error: 'endpoint_not_supported' });
    if (p === '/accounts/a1/balance') return json(200, { results: [{ current: 812.5, available: 800 }] });
    if (p === '/cards/c1/balance') return json(200, { results: [{ current: 40 }] });
    return json(404, {});
  };
  const secrets = { get: (k) => store[k] || null, set: (k, v) => { store[k] = v; } };
  const dispatch = async (a) => { state = reduce(state, a); return state; };
  const opened = [];
  const notes = [];
  const t = new TrueLayerConnector({
    secrets, getState: () => state, dispatch, notify: (title) => notes.push(title), openExternal: async (url) => { opened.push(url); }, fetchImpl, log: () => {}, autoStart: false, now: () => clock,
    // Stand-in for the localhost listener: the bank "redirects" straight back with a good code.
    listen: async ({ onUrl }) => { setTimeout(() => onUrl(`${TRUELAYER_REDIRECT}?code=good&state=${new URL(opened.at(-1)).searchParams.get('state')}`), 0); return { ok: true, close() {} }; },
  });
  return { t, calls, flags, store, opened, notes, advance: (ms) => { clock += ms; }, get state() { return state; } };
}

describe('TrueLayer (other UK banks, live)', () => {
  it('only talks to TrueLayer hosts that are on the allow-list', () => {
    expect(ALLOWED_HOSTS.has('auth.truelayer.com')).toBe(true);
    expect(ALLOWED_HOSTS.has('api.truelayer.com')).toBe(true);
  });

  it('checks the client details before saving them', async () => {
    const { t, store } = harness();
    await expect(t.saveClient('sandbox-pulse-123', 'x'.repeat(30))).rejects.toThrow('Live');
    await expect(t.saveClient('pulsefinance-abc123', 'short')).rejects.toThrow('secret');
    expect((await t.saveClient('pulsefinance-abc123', 'x'.repeat(36))).hasClient).toBe(true);
    expect(store.truelayer.clientId).toBe('pulsefinance-abc123');
  });

  it('maps signs from DEBIT/CREDIT for both accounts and cards', () => {
    const acc = { id: 'a', name: 'Revolut Current' };
    expect(mapTrueLayerTransaction({ amount: -5, transaction_type: 'DEBIT', timestamp: `${today}T1`, description: 'X', transaction_id: 't' }, acc).amount).toBe(-5);
    expect(mapTrueLayerTransaction({ amount: 40, transaction_type: 'DEBIT', timestamp: `${today}T1`, description: 'X', transaction_id: 't' }, acc).amount).toBe(-40);
    expect(mapTrueLayerTransaction({ amount: 10, transaction_type: 'CREDIT', timestamp: `${today}T1`, description: 'X', transaction_id: 't' }, acc).amount).toBe(10);
    expect(accountName('Barclaycard', 'Barclaycard Platinum', new Set())).toBe('Barclaycard Platinum');
    const taken = new Set();
    expect(accountName('Revolut', 'Current', taken)).toBe('Revolut Current');
    expect(accountName('Revolut', 'Current', taken)).toBe('Revolut Current 2');
  });

  it('connects a bank on localhost, imports settled payments only and keeps pending ones apart', async () => {
    const h = harness();
    await h.t.saveClient('pulsefinance-abc123', 'x'.repeat(36));
    const r = await h.t.connect();
    const auth = new URL(h.opened[0]);
    expect(auth.hostname).toBe('auth.truelayer.com');
    expect(auth.searchParams.get('redirect_uri')).toBe('http://localhost:47287/truelayer/callback');
    expect(auth.searchParams.get('scope')).toContain('offline_access');
    expect(r).toMatchObject({ bank: 'Revolut', added: 3 });
    const tx = h.state.transactions.filter((x) => x.source === 'truelayer');
    expect(tx.map((x) => [x.account, x.amount, x.description]).sort()).toEqual([
      ['Revolut Credit Card', -40, 'AMAZON'],
      ['Revolut Current', -23.4, 'Tesco'],
      ['Revolut Current', 1500, 'SALARY'],
    ]);
    expect(tx.find((x) => x.description === 'Tesco').externalId).toBe('truelayer:a1:n1');
    // Pending: shown as "on its way", never a transaction.
    expect(h.state.settings.truelayer.pending).toEqual([{ date: today, amount: -3.99, description: 'PRET', account: 'Revolut Current' }]);
    expect(h.state.transactions.some((x) => x.description === 'PRET')).toBe(false);
    // Balances: a card's balance is what you owe.
    expect(h.state.accounts.filter((a) => a.source === 'truelayer').map((a) => [a.name, a.kind, a.balance])).toEqual([['Revolut Current', 'current', 812.5], ['Revolut Credit Card', 'credit', 40]]);
    // The card asks "is this a credit card?"; the current account doesn't.
    expect(unclassifiedAccounts(h.state).map((a) => [a.account, a.likelyCard])).toEqual([['Revolut Credit Card', true]]);
    // No secret or token is ever sent to the Data API host; only a bearer token.
    expect(h.calls.filter((c) => c.host === 'api.truelayer.com').every((c) => /^Bearer acc/.test(c.headers.authorization))).toBe(true);
    // Nothing tells the bank you're present (no X-PSU-IP on background reads).
    expect(h.calls.some((c) => c.headers['x-psu-ip'])).toBe(false);
  });

  it('a second sync adds nothing twice, and "Sync now" waits 4 hours between bank reads', async () => {
    const h = harness();
    await h.t.saveClient('pulsefinance-abc123', 'x'.repeat(36));
    await h.t.connect();
    const reads = h.calls.length;
    const r = await h.t.sync();
    expect(r).toMatchObject({ added: 0, waiting: true });
    expect(h.calls.length).toBe(reads);
    h.advance(5 * 3600000);
    expect((await h.t.sync()).added).toBe(0);
    expect(h.state.transactions.filter((x) => x.source === 'truelayer')).toHaveLength(3);
    expect(h.flags.refreshes).toBe(1); // the 1-hour token was refreshed, once
  });

  it('background sync runs once a day, and asks you to reconnect when the bank says no', async () => {
    const h = harness();
    await h.t.saveClient('pulsefinance-abc123', 'x'.repeat(36));
    await h.t.connect();
    const reads = h.calls.length;
    await h.t.autoSync();
    expect(h.calls.length).toBe(reads);
    h.advance(25 * 3600000);
    h.flags.deny = true;
    await h.t.autoSync();
    const conn = h.state.settings.truelayer.connections[0];
    expect(conn.needsReconnect).toBe(true);
    expect(h.notes).toContain('Reconnect Revolut');
  });

  it('falls back to 90 days when the bank refuses the long history', async () => {
    const h = harness({ fullHistory: false });
    await h.t.saveClient('pulsefinance-abc123', 'x'.repeat(36));
    expect((await h.t.connect()).added).toBe(3);
  });

  it('disconnecting revokes access and removes that bank only', async () => {
    const h = harness();
    await h.t.saveClient('pulsefinance-abc123', 'x'.repeat(36));
    await h.t.connect();
    const id = h.state.settings.truelayer.connections[0].id;
    await h.t.disconnect(id);
    expect(h.flags.revoked).toBe(1);
    expect(h.state.settings.truelayer).toMatchObject({ connections: [], pending: [] });
    expect(h.state.accounts.filter((a) => a.source === 'truelayer')).toEqual([]);
    expect(h.store.truelayer.tokens).toEqual({});
    expect(h.state.transactions.filter((x) => x.source === 'truelayer')).toHaveLength(3); // your history stays
  });
});
