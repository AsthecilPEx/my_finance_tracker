import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { makeJwt, mapTransaction, EnableBankingConnector, REDIRECT_URL, LOCAL_CALLBACK } from '../electron/connectors/enablebanking.js';

describe('Enable Banking connector', () => {
  it('signs a verifiable RS256 JWT with the app id as kid', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const jwt = makeJwt('app-123', pem, 1_800_000_000);
    const [h, b, sig] = jwt.split('.');
    const dec = (s) => JSON.parse(Buffer.from(s, 'base64url').toString());
    expect(dec(h)).toEqual({ typ: 'JWT', alg: 'RS256', kid: 'app-123' });
    expect(dec(b)).toEqual({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: 1_800_000_000, exp: 1_800_003_600 });
    expect(crypto.createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(true);
  });

  it('maps debits, credits and counterparties', () => {
    const acc = { name: 'Current' };
    expect(mapTransaction({ entry_reference: 'r1', transaction_amount: { amount: '23.40', currency: 'GBP' }, credit_debit_indicator: 'DBIT', booking_date: '2026-09-02', creditor: { name: 'TESCO STORES' } }, acc))
      .toEqual({ date: '2026-09-02', amount: -23.4, description: 'TESCO STORES', externalId: 'r1', account: 'Current' });
    expect(mapTransaction({ transaction_amount: { amount: '2850.00' }, credit_debit_indicator: 'CRDT', value_date: '2026-09-25', debtor: { name: 'ACME LTD' }, remittance_information: ['SALARY'] }, acc))
      .toMatchObject({ amount: 2850, description: 'ACME LTD' });
    expect(mapTransaction({ transaction_amount: { amount: '4.20' }, credit_debit_indicator: 'DBIT', booking_date: '2026-09-03', remittance_information: ['PRET A MANGER', 'LONDON'] }, acc).description).toBe('PRET A MANGER LONDON');
  });

  it('registers an https redirect (production apps reject http) and finishes via the local listener', async () => {
    expect(REDIRECT_URL).toBe('https://asthecilpex.github.io/my_finance_tracker/callback/');
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const secrets = { getCredentials: () => ({ appId: 'app-1', key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }) };
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
      const json = url.endsWith('/auth') ? { url: 'https://bank.example/approve' }
        : url.endsWith('/sessions') ? { session_id: 's1', aspsp: { name: 'Test Bank', country: 'GB' }, accounts: [{ uid: 'a1', name: 'Current' }] }
        : {};
      return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const dispatched = [];
    const c = new EnableBankingConnector({
      secrets, getState: () => ({ settings: { bank: dispatched.findLast((a) => a.payload?.bank)?.payload.bank }, transactions: [] }), dispatch: async (a) => dispatched.push(a), notify: () => {}, fetchImpl, log: () => {},
      // Stand-in for the bank + the GitHub Pages page: it forwards code and state to the local listener.
      openExternal: async () => {
        const state = calls.find((x) => x.url.endsWith('/auth')).body.state;
        const res = await fetch(`${LOCAL_CALLBACK.replace('localhost', '127.0.0.1')}?code=abc&state=${state}`);
        expect(res.status).toBe(200);
      },
    });
    c.autoSync = async () => {};
    try {
      await c.connect('Test Bank', 'GB');
      expect(calls.find((x) => x.url.endsWith('/auth')).body.redirect_url).toBe(REDIRECT_URL);
      expect(calls.find((x) => x.url.endsWith('/sessions')).body).toEqual({ code: 'abc' });
      expect(dispatched.some((a) => a.payload?.bank?.sessionId === 's1')).toBe(true);
    } finally {
      clearInterval(c.timer);
    }
  });

  it('accepts the pasted GitHub Pages address as a fallback', async () => {
    const c = Object.create(EnableBankingConnector.prototype);
    c.pending = null;
    await expect(c.finish(`${REDIRECT_URL}?error=access_denied&error_description=User%20cancelled`, {})).rejects.toThrow('User cancelled');
    await expect(c.finish(`${REDIRECT_URL}?state=x`, {})).rejects.toThrow('No approval code');
  });
});
