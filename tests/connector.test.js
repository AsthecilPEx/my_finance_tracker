import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { makeJwt, mapTransaction } from '../electron/connectors/enablebanking.js';

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
});
