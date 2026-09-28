import updaterPkg from 'electron-updater';

const { autoUpdater } = updaterPkg;
const SIX_HOURS = 6 * 60 * 60 * 1000;

/**
 * Automatic updates from GitHub Releases. New versions download quietly in the background;
 * friends are told when one is ready and it installs on restart. Downloads are checked against
 * the SHA-512 hash published with each release before anything is installed.
 */
export function startUpdater({ app, notify, broadcast, beforeInstall, log = console.log }) {
  let status = { state: 'idle', version: app.getVersion() };
  const set = (patch) => { status = { ...status, ...patch }; broadcast(status); };

  // Dev runs and the portable .exe can't self-update.
  const portable = !!process.env.PORTABLE_EXECUTABLE_DIR;
  if (!app.isPackaged || portable) {
    set({ state: 'unsupported', reason: portable ? 'portable' : 'dev' });
    return { check: async () => status, install: () => {}, status: () => status, stop: () => {} };
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.logger = { info: () => {}, debug: () => {}, warn: (m) => log('[update]', m), error: (m) => log('[update]', m) };
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', available: info.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => set({ state: 'current', checkedAt: new Date().toISOString() }));
  autoUpdater.on('download-progress', (p) => set({ percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', available: info.version });
    notify(`Pulse ${info.version} is ready`, 'Restart Pulse to finish updating. Your data stays exactly as it is.', 'settings');
  });
  autoUpdater.on('error', (err) => set({ state: 'error', error: friendly(err) }));

  const check = async () => {
    try { await autoUpdater.checkForUpdates(); } catch (err) { set({ state: 'error', error: friendly(err) }); }
    return status;
  };
  const first = setTimeout(check, 30_000);
  const timer = setInterval(check, SIX_HOURS);
  return {
    check,
    status: () => status,
    install: () => { if (status.state === 'ready') { beforeInstall?.(); autoUpdater.quitAndInstall(false, true); } },
    stop: () => { clearTimeout(first); clearInterval(timer); },
  };
}

function friendly(err) {
  const m = String(err?.message || err);
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::ERR/i.test(m)) return "Couldn't reach the update server. Check your internet connection.";
  if (/404/.test(m)) return 'No published release found yet.';
  return m.split('\n')[0].slice(0, 200);
}
