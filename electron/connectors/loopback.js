import http from 'node:http';

/**
 * A one-shot listener for an OAuth redirect to http://localhost:<port><path>.
 * Browsers may resolve "localhost" to 127.0.0.1 or ::1, so both loopback addresses are bound
 * (never 0.0.0.0: nothing on the network can reach it). Resolves to the full redirected URL.
 */
export function listenOnce({ port, path, page, onUrl }) {
  const servers = [];
  const handler = (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname !== path) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    res.end(page);
    onUrl(url.toString());
  };
  const bind = (host) => new Promise((resolve) => {
    const s = http.createServer(handler);
    s.on('error', () => resolve(null)); // port busy or no IPv6: the user can paste the URL instead
    s.listen(port, host, () => { servers.push(s); resolve(s); });
  });
  return Promise.all([bind('127.0.0.1'), bind('::1')]).then(() => ({
    ok: servers.length > 0,
    close: () => { for (const s of servers) s.close(); },
  }));
}

export const donePage = (title, body) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;background:#0b0b0f;color:#fff;display:grid;place-items:center;height:100vh;margin:0"><div><h2>${title}</h2><p>${body}</p></div></body>`;
