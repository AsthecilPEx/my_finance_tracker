// Data connectors. Every external source (bank today; brokers, crypto exchanges and fund
// platforms for SIP/SWP tracking in V3) implements the same small interface so the app
// can list, connect, sync and disconnect them uniformly:
//
//   id, name, kind ('bank' | 'broker' | 'crypto' | 'fund'), capabilities (['read'] only for now)
//   info()                -> { hasCredentials, ... }
//   saveCredentials(...)  -> verifies and stores secrets (encrypted)
//   connect(...)          -> user consent flow
//   sync()                -> { added }
//   disconnect()
//
// Connectors are read-only by design. Anything that could move money (trading, SIP/SWP
// execution) must be a separate, explicitly-confirmed capability.
export { EnableBankingConnector } from './enablebanking.js';
export { MonzoConnector } from './monzo.js';
