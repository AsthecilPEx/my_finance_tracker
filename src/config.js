// App-wide settings for the shared (public) build. Change these in one place.
export const APP_NAME = 'Pulse Finance';
export const REPO = 'AsthecilPEx/my_finance_tracker';
export const DOWNLOAD_URL = `https://github.com/${REPO}/releases/latest`;
// Enable Banking only accepts https:// redirect URLs for production apps, so the bank sends people
// to this static page (docs/callback/ on GitHub Pages), which hands the reply straight to Pulse on
// http://localhost. The one-time code it carries is useless without the user's own private key.
const [OWNER, NAME] = REPO.split('/');
export const BANK_REDIRECT_URL = `https://${OWNER.toLowerCase()}.github.io/${NAME}/callback/`;
// Where "Report a problem" and "Send feedback" emails go. This address is public in the code.
export const FEEDBACK_EMAIL = 'yogivardhand874@gmail.com';
// Injected at build time from package.json (see vite.config.js).
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
