import { parseFrankfurter, parseErApi, mergeRates, currenciesInUse } from '../src/engine/fx.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Keeps exchange rates fresh: on launch, every 6 hours, and whenever the home currency changes. */
export function startFxUpdater({ getState, dispatch, secureFetch, log = console.log }) {
  let running = null;

  async function fetchRates(base) {
    if (!/^[A-Z]{3}$/.test(base)) throw new Error('Invalid currency');
    let primary = null;
    try {
      const r = await secureFetch(`https://api.frankfurter.dev/v1/latest?base=${base}`);
      if (r.ok) primary = parseFrankfurter(await r.json());
    } catch (err) {
      log('Frankfurter failed', err.message);
    }
    const s = getState();
    const needed = [...new Set([...currenciesInUse(s), ...(s.settings.watchCurrencies || [])])];
    // The ECB doesn't publish every currency (e.g. AED, PKR, NGN): fill the gaps from the fallback.
    if (!primary || needed.some((c) => c !== base && !primary.rates[c])) {
      try {
        const r = await secureFetch(`https://open.er-api.com/v6/latest/${base}`);
        if (r.ok) {
          const fallback = parseErApi(await r.json());
          primary = primary ? { ...primary, rates: { ...fallback.rates, ...primary.rates }, source: `${primary.source} + ExchangeRate-API` } : fallback;
        }
      } catch (err) {
        log('Fallback rates failed', err.message);
      }
    }
    if (!primary || primary.base !== base) throw new Error("Couldn't download exchange rates. Pulse will keep using the last known rates.");
    return { fresh: primary, keep: needed };
  }

  async function refresh() {
    if (running) return running;
    running = (async () => {
      const s = getState();
      const { fresh, keep } = await fetchRates(s.settings.currency);
      await dispatch({ type: 'fx/set', payload: mergeRates(s.fx, fresh, keep) });
      return { date: fresh.date, source: fresh.source };
    })().finally(() => { running = null; });
    return running;
  }

  const safe = () => refresh().catch((e) => log('FX refresh failed', e.message));
  setTimeout(safe, 5000);
  const timer = setInterval(safe, SIX_HOURS);
  return { refresh, stop: () => clearInterval(timer) };
}
