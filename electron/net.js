// The app's only door to the internet. Every outbound request goes through here:
//  - HTTPS only (TLS is verified by Chromium against the operating system's certificate store)
//  - only to an explicit allow-list of hosts; redirects are followed only to allowed hosts
//  - timeouts and a hard response-size cap, so a slow or hostile server can't hang or flood the app
// The renderer (UI) has no network access at all; see the request blocking in main.js.
export const ALLOWED_HOSTS = new Set([
  'api.enablebanking.com', // Open Banking (read-only)
  'api.frankfurter.dev', // ECB reference exchange rates
  'api.frankfurter.app',
  'open.er-api.com', // fallback exchange rates
]);

export function createSecureFetch(fetchImpl, { allowed = ALLOWED_HOSTS, log = () => {} } = {}) {
  const check = (url) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error('Blocked: only secure (https) connections are allowed.');
    if (!allowed.has(u.hostname)) throw new Error(`Blocked: ${u.hostname} isn't on Pulse's list of allowed services.`);
    if (u.username || u.password) throw new Error('Blocked: credentials in URLs are not allowed.');
    return u;
  };

  return async function secureFetch(url, { method = 'GET', headers = {}, body, timeoutMs = 20000, maxBytes = 5 * 1024 * 1024 } = {}) {
    let target = check(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      let res;
      for (let hop = 0; ; hop++) {
        res = await fetchImpl(target.toString(), { method, headers: { 'user-agent': 'PulseFinance', ...headers }, body, redirect: 'manual', signal: ctrl.signal });
        if (res.status < 300 || res.status >= 400) break;
        const loc = res.headers.get('location');
        if (!loc || hop >= 3) throw new Error('Too many redirects.');
        target = check(new URL(loc, target).toString());
        log('redirect', target.hostname);
      }
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared > maxBytes) throw new Error('Response too large.');
      const reader = res.body?.getReader?.();
      let text = '';
      if (reader) {
        const chunks = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) { ctrl.abort(); throw new Error('Response too large.'); }
          chunks.push(value);
        }
        text = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
      } else {
        text = await res.text();
        if (text.length > maxBytes) throw new Error('Response too large.');
      }
      return { ok: res.ok, status: res.status, headers: res.headers, text: async () => text, json: async () => JSON.parse(text) };
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('The connection timed out. Check your internet and try again.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };
}
