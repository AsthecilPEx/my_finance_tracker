import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, Notification, screen, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, JsonFile } from './store.js';
import { FolderWatcher } from './watcher.js';
import { BankSync } from './openbanking.js';
import { startReminders } from './reminders.js';
import { reduce, migrate } from '../src/engine/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const WIDGET_SIZE = { width: 360, height: 470 };

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('app.pulsefinance.desktop');

let store;
let mainWin = null;
let widgetWin = null;
let tray = null;
let quitting = false;
let watcher;
let bank;

const log = (...args) => console.log('[pulse]', ...args);

// ---------- secrets (Open Banking keys), encrypted with Windows DPAPI via safeStorage ----------
function createSecrets(file) {
  const f = new JsonFile(file);
  const enc = (obj) => {
    const s = JSON.stringify(obj);
    return safeStorage.isEncryptionAvailable() ? { e: safeStorage.encryptString(s).toString('base64') } : { p: s };
  };
  const dec = (v) => {
    if (!v) return null;
    try { return JSON.parse(v.e ? safeStorage.decryptString(Buffer.from(v.e, 'base64')) : v.p); } catch { return null; }
  };
  return {
    getCredentials: () => dec(f.get('credentials')),
    setCredentials: (c) => f.set('credentials', c ? enc(c) : null),
    get: (k) => (k === 'token' ? dec(f.get('token')) : f.get(k)),
    setToken: (t) => f.set('token', t ? enc(t) : null),
  };
}

// ---------- state ----------
function broadcast(state) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('state:changed', state);
}

async function dispatch(action) {
  if (!action || typeof action.type !== 'string') throw new Error('Invalid action');
  const prev = store.get();
  const next = store.update((s) => reduce(s, action));
  applySideEffects(prev.settings, next.settings);
  broadcast(next);
  return next;
}

function applySideEffects(a, b) {
  if (a.launchAtLogin !== b.launchAtLogin && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: !!b.launchAtLogin, args: ['--hidden'] });
  }
  if (a.watchFolder !== b.watchFolder || a.watchEnabled !== b.watchEnabled) watcher.configure(b.watchFolder, b.watchEnabled);
  if (a.widget?.pinned !== b.widget?.pinned && widgetWin) widgetWin.setAlwaysOnTop(!!b.widget.pinned, 'floating');
}

function notify(title, body) {
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, icon: ICON });
    n.on('click', showMain);
    n.show();
  }
}

// ---------- windows ----------
const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false };

function load(win, hash = '') {
  if (DEV_URL) win.loadURL(`${DEV_URL}${hash ? `#${hash}` : ''}`);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash });
}

function harden(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!DEV_URL || !url.startsWith(DEV_URL)) e.preventDefault();
  });
}

function createMain({ show = true } = {}) {
  mainWin = new BrowserWindow({
    width: 1440, height: 920, minWidth: 960, minHeight: 640,
    backgroundColor: '#0b0b0f', title: 'Pulse Finance', icon: ICON,
    autoHideMenuBar: true, show: false, webPreferences,
  });
  harden(mainWin);
  load(mainWin);
  mainWin.once('ready-to-show', () => show && mainWin.show());
  mainWin.on('close', (e) => {
    if (!quitting && store.get().settings.minimizeToTray) {
      e.preventDefault();
      mainWin.hide();
    }
  });
  mainWin.on('closed', () => { mainWin = null; });
}

function showMain() {
  if (!mainWin) createMain();
  else { mainWin.show(); if (mainWin.isMinimized()) mainWin.restore(); mainWin.focus(); }
}

function widgetBounds() {
  const saved = store.get().settings.widget.bounds;
  if (saved && screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return saved.x >= a.x - 50 && saved.y >= a.y - 50 && saved.x < a.x + a.width - 50 && saved.y < a.y + a.height - 50;
  })) return { ...saved, ...WIDGET_SIZE };
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - WIDGET_SIZE.width - 16, y: workArea.y + 16, ...WIDGET_SIZE };
}

function createWidget() {
  const pinned = store.get().settings.widget.pinned;
  widgetWin = new BrowserWindow({
    ...widgetBounds(),
    frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: pinned, hasShadow: false, backgroundColor: '#00000000',
    title: 'Pulse widget', icon: ICON, show: false, webPreferences,
  });
  if (pinned) widgetWin.setAlwaysOnTop(true, 'floating');
  harden(widgetWin);
  load(widgetWin, 'widget');
  widgetWin.once('ready-to-show', () => widgetWin.showInactive());
  let t;
  widgetWin.on('moved', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!widgetWin) return;
      const { x, y } = widgetWin.getBounds();
      dispatch({ type: 'settings/update', payload: { widget: { bounds: { x, y } } } });
    }, 400);
  });
  widgetWin.on('closed', () => { widgetWin = null; });
  dispatch({ type: 'settings/update', payload: { widget: { visible: true } } });
}

function toggleWidget(force) {
  const show = force ?? !widgetWin;
  if (show && !widgetWin) createWidget();
  if (!show && widgetWin) {
    widgetWin.close();
    dispatch({ type: 'settings/update', payload: { widget: { visible: false } } });
  }
  updateTray();
}

function updateTray() {
  if (!tray) return;
  const bankConnected = store.get().settings.bank.connected;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Pulse', click: showMain },
    { label: widgetWin ? 'Hide desktop widget' : 'Show desktop widget', click: () => toggleWidget() },
    ...(bankConnected ? [{ label: 'Sync bank now', click: () => bank.sync().then((r) => notify('Bank synced', `${r.added} new transactions`)).catch((e) => notify('Sync failed', e.message)) }] : []),
    { type: 'separator' },
    { label: 'Quit Pulse', click: () => { quitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'tray.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Pulse Finance');
  tray.on('click', showMain);
  updateTray();
}

// ---------- IPC ----------
function registerIpc() {
  const handle = (ch, fn) => ipcMain.handle(ch, (_e, ...args) => fn(...args));
  handle('state:get', () => store.get());
  handle('state:dispatch', (action) => dispatch(action));

  handle('dialog:openCsv', async () => {
    const r = await dialog.showOpenDialog(mainWin, { title: 'Import bank statement', filters: [{ name: 'CSV statement', extensions: ['csv'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return { name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], 'utf8') };
  });
  handle('dialog:chooseFolder', async () => {
    const r = await dialog.showOpenDialog(mainWin, { title: 'Choose a folder to watch for statements', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('backup:export', async () => {
    const r = await dialog.showSaveDialog(mainWin, { defaultPath: `pulse-finance-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'Backup', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, JSON.stringify(store.get(), null, 2));
    return true;
  });
  handle('backup:import', async () => {
    const r = await dialog.showOpenDialog(mainWin, { filters: [{ name: 'Backup', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return migrate(JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')));
  });

  handle('widget:toggle', () => toggleWidget());
  handle('widget:pin', (pinned) => widgetWin?.setAlwaysOnTop(!!pinned, 'floating'));
  handle('widget:close', () => toggleWidget(false));
  handle('app:openMain', showMain);
  handle('app:openExternal', (url) => {
    if (typeof url === 'string' && url.startsWith('https://')) return shell.openExternal(url);
    throw new Error('Blocked non-https link');
  });

  handle('bank:hasCredentials', () => bank.hasCredentials());
  handle('bank:saveCredentials', (id, key) => bank.saveCredentials(id, key));
  handle('bank:institutions', (country) => bank.institutions(country));
  handle('bank:connect', async (id, name, days) => { const r = await bank.connect(id, name, days); updateTray(); showMain(); return r; });
  handle('bank:sync', () => bank.sync());
  handle('bank:disconnect', async () => { await bank.disconnect(); updateTray(); });

  handle('watcher:status', () => watcher.status());
  handle('watcher:scan', () => watcher.scan());
}

// ---------- lifecycle ----------
app.on('second-instance', showMain);

app.whenReady().then(() => {
  const dir = app.getPath('userData');
  store = new Store(dir);
  const secrets = createSecrets(path.join(dir, 'secrets.json'));
  const meta = new JsonFile(path.join(dir, 'pulse-meta.json'));

  watcher = new FolderWatcher({
    processed: meta,
    log,
    onRows: async (rows, fileName) => {
      const before = store.get().transactions.length;
      await dispatch({ type: 'txn/import', payload: { rows, source: 'watch', fileName } });
      const added = store.get().transactions.length - before;
      if (added > 0) notify('Statement imported', `${added} new transaction${added === 1 ? '' : 's'} from ${fileName}`);
    },
  });
  bank = new BankSync({ secrets, getState: () => store.get(), dispatch, notify, openExternal: (url) => shell.openExternal(url), log });

  registerIpc();
  const s = store.get().settings;
  watcher.configure(s.watchFolder, s.watchEnabled);
  startReminders({ getState: () => store.get(), notify, sent: meta });

  const hidden = process.argv.includes('--hidden');
  createMain({ show: !hidden });
  if (s.widget.visible) createWidget();
  createTray();

  app.on('activate', showMain);
});

app.on('before-quit', () => {
  quitting = true;
  store?.flush();
  watcher?.stop();
  bank?.stop();
});

app.on('window-all-closed', () => {
  if (!store?.get().settings.minimizeToTray) app.quit();
});
