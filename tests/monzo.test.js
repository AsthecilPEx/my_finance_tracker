import { describe, it, expect } from 'vitest';
import { MonzoConnector, mapMonzoTransaction, pairFlexRepayments, MONZO_REDIRECT } from '../electron/connectors/monzo.js';
import { reduce, createEmptyState } from '../src/engine/state.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function harness({ approved = true, history = null } = {}) {
  let state = { ...createEmptyState(), settings: { ...createEmptyState().settings, onboarded: true } };
  const store = {};
  const calls = [];
  const flags = { approved, refreshes: 0 };
  const today = new Date().toISOString().slice(0, 10);
  const txns = history || {
    acc_cur: [
      { id: 'tx_1', created: `${today}T09:00:00Z`, amount: -2340, merchant: { name: 'Tesco' }, description: 'TESCO STORES', settled: `${today}T10:00:00Z` },
      { id: 'tx_2', created: `${today}T09:30:00Z`, amount: -500, description: 'DECLINED THING', decline_reason: 'INSUFFICIENT_FUNDS' },
      { id: 'tx_3', created: `${today}T11:00:00Z`, amount: -2000, description: 'pot_0001', metadata: { pot_id: 'pot_0001' }, settled: 'x' },
      { id: 'tx_4', created: `${today}T12:00:00Z`, amount: -4500, counterparty: { name: 'Monzo Flex' }, description: 'Flex repayment', settled: 'x' },
      { id: 'tx_5', created: `${today}T13:00:00Z`, amount: -399, merchant: { name: 'Pret' }, description: 'PRET', settled: '' },
    ],
    acc_flex: [
      { id: 'tx_f1', created: `${today}T08:00:00Z`, amount: -9000, merchant: { name: 'Currys' }, description: 'CURRYS', settled: 'x' },
      { id: 'tx_f2', created: `${today}T12:00:01Z`, amount: 4500, description: 'Repayment', settled: 'x' },
    ],
  };
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, query: u.search, body: opts.body, auth: opts.headers?.authorization });
    if (u.pathname === '/oauth2/token') {
      const f = new URLSearchParams(opts.body);
      if (f.get('grant_type') === 'refresh_token') { flags.refreshes++; return json(200, { access_token: 'acc2', refresh_token: 'ref2', expires_in: 21600 }); }
      expect(f.get('redirect_uri')).toBe(MONZO_REDIRECT);
      return f.get('code') === 'good' ? json(200, { access_token: 'acc1', refresh_token: 'ref1', expires_in: 21600, user_id: 'user_1' }) : json(400, { code: 'bad_request', message: 'bad code' });
    }
    if (!flags.approved) return json(403, { code: 'forbidden.insufficient_permissions', message: 'Access forbidden' });
    if (u.pathname === '/accounts') return json(200, { accounts: [{ id: 'acc_cur', type: 'uk_retail' }, { id: 'acc_flex', type: 'uk_monzo_flex' }, { id: 'acc_old', type: 'uk_retail', closed: true }, { id: 'acc_loan', type: 'uk_monzo_flex_backing_loan' }] });
    if (u.pathname === '/transactions') {
      const id = u.searchParams.get('account_id');
      if (flags.only90 && !u.searchParams.get('since')) return json(403, { code: 'forbidden.verification_required', message: 'SCA' });
      return json(200, { transactions: txns[id] || [] });
    }
    if (u.pathname === '/balance') return json(200, { balance: u.searchParams.get('account_id') === 'acc_cur' ? 123456 : -4500, currency: 'GBP' });
    if (u.pathname === '/oauth2/logout') return json(200, {});
    return json(404, {});
  };
  const secrets = { get: (k) => store[k] || null, set: (k, v) => { store[k] = v; } };
  const dispatch = async (a) => { state = reduce(state, a); return state; };
  const m = new MonzoConnector({ secrets, getState: () => state, dispatch, notify: () => {}, openExternal: async () => {}, fetchImpl, log: () => {}, autoStart: false });
  return { m, calls, flags, store, get state() { return state; } };
}

describe('Monzo connector', () => {
  it('validates the client details', async () => {
    const { m } = harness();
    await expect(m.saveClient('nope', 'x'.repeat(30))).rejects.toThrow('oauth2client_');
    await expect(m.saveClient('oauth2client_abc123', 'short')).rejects.toThrow('secret');
    expect((await m.saveClient('oauth2client_abc123', 'mnzconf.' + 'x'.repeat(40))).hasClient).toBe(true);
  });

  it('waits for in-app approval, then syncs current + Flex correctly', async () => {
    const h = harness({ approved: false });
    await h.m.saveClient('oauth2client_abc123', 'mnzconf.' + 'x'.repeat(40));
    const first = await h.m.finish('http://localhost:47286/monzo/callback?code=good&state=s');
    expect(first).toEqual({ approved: false });
    expect(h.state.settings.monzo).toMatchObject({ connected: true, needsApproval: true });
    expect(h.store.monzo).toMatchObject({ accessToken: 'acc1', refreshToken: 'ref1' });

    h.flags.approved = true;
    const r = await h.m.checkApproval();
    expect(r.approved).toBe(true);
    const mz = h.state.settings.monzo;
    expect(mz.needsApproval).toBe(false);
    expect(mz.approvedAt).toBeTruthy();
    expect(mz.accounts.map((a) => [a.name, a.kind])).toEqual([['Monzo Current', 'current'], ['Monzo Flex', 'credit']]);
    // First sync after approval asks for the whole history (no "since").
    expect(h.calls.filter((c) => c.path === '/transactions').every((c) => !new URLSearchParams(c.query).get('since'))).toBe(true);

    const byDesc = Object.fromEntries(h.state.transactions.map((t) => [t.description, t]));
    expect(Object.keys(byDesc).sort()).toEqual(['Currys', 'Monzo Flex', 'Moved to a Monzo pot', 'Pret', 'Repayment', 'Tesco']);
    expect(byDesc.Tesco).toMatchObject({ amount: -23.4, account: 'Monzo Current', source: 'monzo', externalId: 'monzo:tx_1' });
    expect(byDesc.Currys).toMatchObject({ amount: -90, account: 'Monzo Flex' });
    expect(byDesc['Moved to a Monzo pot'].categoryId).toBe('transfer');
    expect(byDesc['Monzo Flex'].categoryId).toBe('transfer');
    expect(byDesc.Repayment.categoryId).toBe('transfer');
    expect(byDesc.Pret.pending).toBe(true);
    // Balances: Flex is a debt and must not count as spendable cash.
    expect(h.state.accounts.map((a) => [a.name, a.balance, a.kind])).toEqual([['Monzo Current', 1234.56, 'current'], ['Monzo Flex', -45, 'credit']]);
  });

  it('falls back to 90 days when the full-history window has passed', async () => {
    const h = harness();
    h.flags.only90 = true;
    await h.m.saveClient('oauth2client_abc123', 'mnzconf.' + 'x'.repeat(40));
    await h.m.finish('http://localhost:47286/monzo/callback?code=good');
    expect(h.state.transactions.length).toBeGreaterThan(0);
    const sinces = h.calls.filter((c) => c.path === '/transactions').map((c) => new URLSearchParams(c.query).get('since'));
    expect(sinces.some((s) => s && s.endsWith('T00:00:00Z'))).toBe(true);
  });

  it('a settled pending payment updates instead of duplicating, and tokens refresh', async () => {
    const h = harness();
    await h.m.saveClient('oauth2client_abc123', 'mnzconf.' + 'x'.repeat(40));
    await h.m.finish('http://localhost:47286/monzo/callback?code=good');
    const count = h.state.transactions.length;
    // Pret settles at a different amount; the access token has expired.
    const today = new Date().toISOString().slice(0, 10);
    h.store.monzo.expiresAt = Date.now() - 1000;
    const pret = h.state.transactions.find((t) => t.description === 'Pret');
    const list = [{ id: 'tx_5', created: `${today}T13:00:00Z`, amount: -425, merchant: { name: 'Pret' }, description: 'PRET', settled: 'x' }];
    h.m.fetchImpl = ((orig) => async (url, opts) => (new URL(url).pathname === '/transactions' && new URL(url).searchParams.get('account_id') === 'acc_cur' ? json(200, { transactions: list }) : orig(url, opts)))(h.m.fetchImpl);
    await h.m.sync();
    expect(h.flags.refreshes).toBe(1);
    expect(h.store.monzo).toMatchObject({ accessToken: 'acc2', refreshToken: 'ref2' });
    expect(h.state.transactions.length).toBe(count);
    const after = h.state.transactions.find((t) => t.id === pret.id);
    expect(after.amount).toBe(-4.25);
    expect(after.pending).toBeUndefined();
  });

  it('asks to reconnect when Monzo withdraws access (90-day renewal)', async () => {
    const h = harness();
    await h.m.saveClient('oauth2client_abc123', 'mnzconf.' + 'x'.repeat(40));
    await h.m.finish('http://localhost:47286/monzo/callback?code=good');
    h.flags.approved = false;
    await expect(h.m.sync()).rejects.toThrow('approve Pulse again');
    expect(h.state.settings.monzo.needsReconnect).toBe(true);
  });

  it('rejects a sign-in link from another attempt and keeps the client on disconnect', async () => {
    const h = harness();
    await h.m.saveClient('oauth2client_abc123', 'mnzconf.' + 'x'.repeat(40));
    h.m.pending = { state: 'expected', resolve: () => {} };
    await expect(h.m.finish('http://localhost:47286/monzo/callback?code=good&state=other')).rejects.toThrow('different attempt');
    h.m.pending = null;
    await h.m.finish('http://localhost:47286/monzo/callback?code=good');
    await h.m.disconnect();
    expect(h.store.monzo).toEqual({ clientId: 'oauth2client_abc123', clientSecret: 'mnzconf.' + 'x'.repeat(40) });
    expect(h.state.settings.monzo.connected).toBe(false);
    expect(h.state.accounts).toEqual([]);
  });

  it('maps and pairs in isolation', () => {
    expect(mapMonzoTransaction({ id: 'a', amount: -100, decline_reason: 'X' }, { name: 'M' })).toBe(null);
    const rows = [{ account: 'Monzo Current', amount: -10, date: '2026-09-01' }, { account: 'Monzo Flex', amount: 10, date: '2026-09-03' }];
    pairFlexRepayments(rows, [{ name: 'Monzo Flex', kind: 'credit' }]);
    expect(rows.map((r) => r.categoryId)).toEqual(['transfer', 'transfer']);
  });
});

describe('Bank copies of hand-entered purchases', () => {
  it('links your own entry to the Monzo account instead of dropping the bank copy', async () => {
    const { createEmptyState, reduce } = await import('../src/engine/state.js');
    let s = createEmptyState();
    s = reduce(s, { type: 'txn/add', payload: { date: '2026-09-30', amount: -14.32, description: 'Aldi', categoryId: 'groceries' } });
    s = reduce(s, { type: 'txn/add', payload: { date: '2026-09-30', amount: -5, description: 'Coffee', account: 'Lloyds Current' } });
    const lloyds = s.transactions.find((t) => t.description === 'Coffee');
    s = reduce(s, { type: 'txn/import', payload: { source: 'monzo', rows: [
      { date: '2026-09-30', amount: -14.32, description: 'ALDI', account: 'Monzo Flex', externalId: 'monzo:tx_1' },
    ] } });
    const aldi = s.transactions.filter((t) => Math.abs(t.amount) === 14.32);
    expect(aldi).toHaveLength(1);
    expect(aldi[0]).toMatchObject({ description: 'Aldi', categoryId: 'groceries', account: 'Monzo Flex', externalId: 'monzo:tx_1' });
    // Synced again later: still one, nothing re-added.
    s = reduce(s, { type: 'txn/import', payload: { source: 'monzo', rows: [{ date: '2026-09-30', amount: -14.32, description: 'ALDI', account: 'Monzo Flex', externalId: 'monzo:tx_1' }] } });
    expect(s.transactions.filter((t) => Math.abs(t.amount) === 14.32)).toHaveLength(1);
    // A different bank's purchase of the same amount is a different payment.
    s = reduce(s, { type: 'txn/import', payload: { source: 'monzo', rows: [{ date: '2026-09-30', amount: -5, description: 'PRET', account: 'Monzo Flex', externalId: 'monzo:tx_2' }] } });
    expect(s.transactions.find((t) => t.id === lloyds.id).account).toBe('Lloyds Current');
    expect(s.transactions.find((t) => t.externalId === 'monzo:tx_2')).toMatchObject({ account: 'Monzo Flex', amount: -5 });
  });
});
