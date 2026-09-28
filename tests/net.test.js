import { describe, it, expect } from 'vitest';
import { createSecureFetch } from '../electron/net.js';
import { startFxUpdater } from '../electron/fx-updater.js';
import { createDemoState } from '../src/engine/demo.js';
import { reduce } from '../src/engine/state.js';

const res = (status, body, headers = {}) => ({ status, ok: status < 300, headers: new Headers(headers), text: async () => body, body: null });

describe('secure network gateway', () => {
  it('allows HTTPS to approved hosts only', async () => {
    const f = createSecureFetch(async () => res(200, '{"a":1}'));
    expect(await (await f('https://api.frankfurter.dev/v1/latest?base=GBP')).json()).toEqual({ a: 1 });
    await expect(f('http://api.frankfurter.dev/v1/latest')).rejects.toThrow(/https/);
    await expect(f('https://evil.example.com/x')).rejects.toThrow(/allowed/);
    await expect(f('https://user:pw@api.frankfurter.dev/')).rejects.toThrow(/credentials/);
  });
  it('follows redirects only to approved hosts, and caps response size', async () => {
    let calls = 0;
    const f = createSecureFetch(async (url) => (calls++ === 0 ? res(302, '', { location: 'https://api.frankfurter.dev/v1/x' }) : res(200, 'ok')));
    expect(await (await f('https://api.frankfurter.app/latest')).text()).toBe('ok');
    const bad = createSecureFetch(async () => res(302, '', { location: 'https://attacker.test/steal' }));
    await expect(bad('https://api.frankfurter.app/latest')).rejects.toThrow(/allowed/);
    const big = createSecureFetch(async () => res(200, 'x'.repeat(100)));
    await expect(big('https://open.er-api.com/v6/latest/GBP', { maxBytes: 10 })).rejects.toThrow(/too large/);
  });
});

describe('exchange-rate updater', () => {
  it('uses ECB rates and fills missing currencies from the fallback', async () => {
    let state = createDemoState('2026-09-27');
    state = reduce(state, { type: 'settings/update', payload: { watchCurrencies: ['INR', 'AED'] } });
    const seen = [];
    const secureFetch = async (url) => {
      seen.push(new URL(url).hostname);
      if (url.includes('frankfurter')) return { ok: true, json: async () => ({ base: 'GBP', date: '2026-09-26', rates: { INR: 113.1, EUR: 1.17 } }) };
      return { ok: true, json: async () => ({ result: 'success', base_code: 'GBP', time_last_update_unix: 1790000000, rates: { INR: 999, AED: 4.9 } }) };
    };
    const up = startFxUpdater({ getState: () => state, dispatch: async (a) => { state = reduce(state, a); }, secureFetch, log: () => {} });
    const r = await up.refresh();
    up.stop();
    expect(seen).toEqual(['api.frankfurter.dev', 'open.er-api.com']);
    expect(state.fx.rates.INR).toBe(113.1); // ECB wins where it has a rate
    expect(state.fx.rates.AED).toBe(4.9);
    expect(r.source).toMatch(/ECB/);
    expect(state.fx.history['2026-09-26'].INR).toBe(113.1);
  });
});
