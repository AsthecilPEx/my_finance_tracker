# Live bank sync: safety rules

Pulse runs on your own PC. Live bank sync must never make that PC reachable from the internet.
These rules apply to every live connector (Monzo, TrueLayer, and any added later).

## 1. Sign-in without a public server
- The bank sends your browser back to `http://localhost:<port>/...`. Pulse listens on the loopback
  addresses only (127.0.0.1 and ::1, never the network), only during sign-in, and checks the
  `state` value belongs to the sign-in it started.
- If the browser doesn't come back (e.g. you approved on your phone), paste the address it ended on.
- For providers that require an `https://` address, use the static relay page on GitHub Pages
  (`docs/callback/`), which hands the reply straight to localhost. Never a tunnel such as ngrok:
  that briefly gives the PC a public address.

## 2. Pulse calls out; nothing calls in
- No webhooks. Requests are made by Pulse and answered in the same connection.
- Ask for `offline_access` so a refresh token keeps the connection alive.
- Banks allow about 4 unattended reads a day. Pulse syncs once a day in the background and
  "Sync now" at most every 4 hours per bank.
- Pulse does **not** send `X-PSU-IP`. That header tells the bank the account holder is present
  right now; sending it on background syncs to get round the limit would be untrue and could get
  the app blocked.

## 3. Pending vs settled, and the 90-day consent
- Pending payments are kept apart ("on its way") and never counted. Only settled transactions
  are imported, keyed by the bank's stable ID (`normalised_provider_transaction_id`).
- Each bank's consent lasts 90 days. Pulse reminds you 7 days before, shows **Renew**, and marks
  the bank **Reconnect** (with one notification) when the bank refuses (`invalid_grant`,
  `access_denied`, 401/403).
- History: the longest history is requested right after sign-in; if the bank refuses, Pulse
  falls back to 90 days.

## Secrets
- Client secrets and tokens are encrypted with Windows DPAPI on the PC and only sent to the
  provider's own hosts, which are on the network allow-list (`electron/net.js`).
- Nothing secret is ever committed to this repository.
