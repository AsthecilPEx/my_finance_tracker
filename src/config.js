// App-wide settings for the shared (public) build. Change these in one place.
export const APP_NAME = 'Pulse Finance';
export const REPO = 'AsthecilPEx/my_finance_tracker';
export const DOWNLOAD_URL = `https://github.com/${REPO}/releases/latest`;
// Where "Report a problem" and "Send feedback" emails go. This address is public in the code.
export const FEEDBACK_EMAIL = 'yogivardhand@gmail.com';
// Injected at build time from package.json (see vite.config.js).
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
