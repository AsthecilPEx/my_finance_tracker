import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, Notification, screen, safeStorage, clipboard, session } from 'electron';
import { createSecureFetch, ALLOWED_HOSTS } from './net.js';
import { startFxUpdater } from './fx-updater.js';
import { startUpdater } from './updater.js';
import { createLogger } from './logger.js';
import { FEEDBACK_EMAIL, DOWNLOAD_URL } from '../src/config.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, JsonFile } from './store.js';
import { FolderWatcher } from './watcher.js';
import { EnableBankingConnector } from './connectors/index.js';
import { recognise } from './ocr.js';
import { startReminders } from './reminders.js';
import { reduce, migrate } from '../src/engine/state.js';
import { receiptInbox } from '../src/engine/receipts.js';
import { formatMoney } from '../src/engine/money.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const WIDGET_SIZE = { width: 360, height: 500 };
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp' };
let receiptsDir;

if (!app.requestSingleInstanceLock()) app.quit();
// Sandbox every process (renderers are also sandboxed per window below). Skipped only when
// Chromium is started with --no-sandbox, e.g. CI containers running as root.
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();
app.setAppUserModelId('app.pulsefinance.desktop');

let store;
let mainWin = null;
let widgetWin = null;
let tray = null;
let quitting = false;
let watcher;
let bank;
let fxUpdater;
let updater;
let logger;
// Approved outbound traffic uses its own session, separate from the UI's (which is fully blocked).
const NET_PARTITION = 'pulse-net';
const secureFetch = createSecureFetch((url, opts) => session.fromPartition(NET_PARTITION).fetch(url, opts), { log: (...a) => console.log('[net]', ...a) });

const log = (...args) => { console.log('[pulse]', ...args); logger?.warn(...args); };

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
    getCredentials: () => dec(f.get('enablebanking')),
    setCredentials: (c) => f.set('enablebanking', c ? enc(c) : null),
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
  if ((a.currency !== b.currency || (a.watchCurrencies || []).join() !== (b.watchCurrencies || []).join()) && fxUpdater) fxUpdater.refresh().catch(() => {});
}

function notify(title, body, page) {
  if (Notification.isSupported()) {
    const n = new Notification({ title, body, icon: ICON });
    n.on('click', () => navigate(page));
    n.show();
  }
}

/** Bring the main window forward, optionally on a specific page. */
function navigate(page) {
  const fresh = !mainWin;
  showMain();
  if (!page) return;
  if (fresh) mainWin.webContents.once('did-finish-load', () => mainWin?.webContents.send('navigate', page));
  else mainWin.webContents.send('navigate', page);
}

/** After new transactions arrive, offer to itemise the newest supermarket/shopping spend. */
function promptForReceipts(beforeIds) {
  const state = store.get();
  if (state.settings.receiptPrompts === false || !state.settings.notifications) return;
  const fresh = receiptInbox(state, new Date().toISOString().slice(0, 10), 7).filter((t) => !beforeIds.has(t.id));
  if (!fresh.length) return;
  const t = fresh[0];
  const more = fresh.length > 1 ? ` (+${fresh.length - 1} more)` : '';
  notify(`🧾 ${t.description} · ${formatMoney(-t.amount, state.settings.currency)}${more}`, 'Add the receipt to see how much was essential. Snap a photo or type the items.', 'receipts');
}

async function importWithPrompt(action) {
  const before = new Set(store.get().transactions.map((t) => t.id));
  await dispatch(action);
  promptForReceipts(before);
  return store.get().transactions.length - before.size;
}

// ---------- windows ----------
const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false };

function load(win, hash = '') {
  if (DEV_URL) win.loadURL(`${DEV_URL}${hash ? `#${hash}` : ''}`);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash });
}

function harden(win) {
  // Windows/Electron quirk: after a dialog or switching apps, the page can lose keyboard focus
  // even though the window is active, so text boxes ignore typing. Always hand focus back.
  win.on('focus', () => { if (!win.isDestroyed()) win.webContents.focus(); });
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
// Native file pickers can leave the page without keyboard focus on Windows (text boxes then
// ignore typing), so focus is handed back to the page after every one.
async function withDialog(fn) {
  try { return await fn(); } finally {
    if (mainWin && !mainWin.isDestroyed()) { mainWin.focus(); mainWin.webContents.focus(); }
  }
}

function registerIpc() {
  const handle = (ch, fn) => ipcMain.handle(ch, (_e, ...args) => fn(...args));
  handle('state:get', () => store.get());
  handle('state:dispatch', (action) => dispatch(action));

  handle('dialog:openCsv', async () => {
    const r = await withDialog(() => dialog.showOpenDialog(mainWin, { title: 'Import bank statement', filters: [{ name: 'CSV statement', extensions: ['csv'] }], properties: ['openFile'] }));
    if (r.canceled || !r.filePaths[0]) return null;
    return { name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], 'utf8') };
  });
  handle('dialog:chooseFolder', async () => {
    const r = await withDialog(() => dialog.showOpenDialog(mainWin, { title: 'Choose a folder to watch for statements', properties: ['openDirectory'] }));
    return r.canceled ? null : r.filePaths[0];
  });
  handle('backup:export', async () => {
    const r = await withDialog(() => dialog.showSaveDialog(mainWin, { defaultPath: `pulse-finance-backup-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: 'Backup', extensions: ['json'] }] }));
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, JSON.stringify(store.get(), null, 2));
    return true;
  });
  handle('backup:import', async () => {
    const r = await withDialog(() => dialog.showOpenDialog(mainWin, { filters: [{ name: 'Backup', extensions: ['json'] }], properties: ['openFile'] }));
    if (r.canceled || !r.filePaths[0]) return null;
    return migrate(JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')));
  });

  handle('clipboard:write', (text) => clipboard.writeText(String(text)));
  handle('file:saveText', async (text, name) => {
    const r = await withDialog(() => dialog.showSaveDialog(mainWin, { defaultPath: name, filters: [{ name: 'Text', extensions: ['txt'] }] }));
    if (!r.canceled && r.filePath) fs.writeFileSync(r.filePath, String(text));
    return !r.canceled;
  });
  handle('plan:openFile', async () => {
    const r = await withDialog(() => dialog.showOpenDialog(mainWin, { title: 'Open AI reply', filters: [{ name: 'Text or JSON', extensions: ['txt', 'json', 'md'] }], properties: ['openFile'] }));
    if (r.canceled || !r.filePaths[0]) return null;
    const stat = fs.statSync(r.filePaths[0]);
    if (stat.size > 2 * 1024 * 1024) throw new Error('That file is too large to be an AI reply.');
    return { name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], 'utf8') };
  });

  // Receipt photos are copied into the app's own folder and referenced by file name only.
  const receiptPath = (name) => {
    if (typeof name !== 'string' || !/^[a-f0-9-]{36}\.(png|jpe?g|webp|bmp)$/i.test(name)) throw new Error('Invalid receipt image');
    return path.join(receiptsDir, name);
  };
  const dataUrl = (file) => `data:${IMAGE_TYPES[path.extname(file).slice(1).toLowerCase()]};base64,${fs.readFileSync(file).toString('base64')}`;
  handle('receipt:pickImage', async () => {
    const r = await withDialog(() => dialog.showOpenDialog(mainWin, { title: 'Receipt photo', filters: [{ name: 'Images', extensions: Object.keys(IMAGE_TYPES) }], properties: ['openFile'] }));
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0];
    const ext = path.extname(src).slice(1).toLowerCase();
    if (!IMAGE_TYPES[ext]) throw new Error('Please choose a JPG, PNG or WebP photo. (iPhone HEIC photos can be exported as JPG.)');
    if (fs.statSync(src).size > 15 * 1024 * 1024) throw new Error('That photo is over 15 MB.');
    const name = `${crypto.randomUUID()}.${ext}`;
    fs.copyFileSync(src, path.join(receiptsDir, name));
    return { file: name, dataUrl: dataUrl(path.join(receiptsDir, name)) };
  });
  handle('receipt:image', (name) => dataUrl(receiptPath(name)));
  handle('receipt:ocr', (name) => recognise(receiptPath(name), path.join(app.getPath('userData'), 'ocr-cache')));

  handle('widget:toggle', () => toggleWidget());
  handle('widget:pin', (pinned) => widgetWin?.setAlwaysOnTop(!!pinned, 'floating'));
  handle('widget:close', () => toggleWidget(false));
  handle('app:openMain', showMain);
  handle('app:openExternal', (url) => {
    if (typeof url === 'string' && url.startsWith('https://')) return shell.openExternal(url);
    throw new Error('Blocked non-https link');
  });

  handle('bank:info', () => bank.info());
  handle('bank:pickKey', async () => {
    const r = await withDialog(() => dialog.showOpenDialog(mainWin, { title: 'Enable Banking private key', filters: [{ name: 'Private key', extensions: ['pem', 'key'] }], properties: ['openFile'] }));
    if (r.canceled || !r.filePaths[0]) return null;
    return { name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], 'utf8') };
  });
  handle('bank:saveCredentials', (appId, pem) => bank.saveCredentials(appId, pem));
  handle('bank:institutions', (country) => bank.institutions(country));
  handle('bank:connect', async (name, country, validity) => {
    const before = new Set(store.get().transactions.map((t) => t.id));
    const r = await bank.connect(name, country, validity);
    updateTray();
    showMain();
    promptForReceipts(before);
    return r;
  });
  handle('bank:completeWithUrl', (url) => bank.completeWithUrl(url));
  handle('bank:sync', async () => {
    const before = new Set(store.get().transactions.map((t) => t.id));
    const r = await bank.sync();
    promptForReceipts(before);
    return r;
  });
  handle('bank:disconnect', async () => { await bank.disconnect(); updateTray(); });

  handle('fx:refresh', () => fxUpdater.refresh());
  handle('update:status', () => updater.status());
  handle('update:check', () => updater.check());
  handle('update:install', () => updater.install());
  handle('log:error', (message, stack) => { logger.error('[ui]', String(message).slice(0, 500), String(stack || '').slice(0, 2000)); });
  handle('app:info', () => ({ version: app.getVersion(), platform: `${process.platform} ${process.getSystemVersion?.() || ''}`.trim(), electron: process.versions.electron, downloadUrl: DOWNLOAD_URL, feedbackEmail: FEEDBACK_EMAIL }));
  // Opens the user's email app addressed to the app's feedback inbox only.
  handle('app:feedback', ({ subject, body, includeLog }) => {
    const info = `\n\n---\nPulse ${app.getVersion()} · ${process.platform} ${process.getSystemVersion?.() || ''}`;
    const tail = includeLog ? `\n\nRecent errors:\n${logger.tail(25)}` : '';
    const text = `${String(body || '')}${info}${tail}`.slice(0, 1800);
    return shell.openExternal(`mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(String(subject || 'Pulse feedback').slice(0, 120))}&body=${encodeURIComponent(text)}`);
  });
  handle('watcher:status', () => watcher.status());
  handle('watcher:scan', () => watcher.scan());
}

// ---------- security & right-click ----------
/** Lock down the web layer: no permissions, no webviews, no network from the UI. */
function hardenSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    const local = u.startsWith('file:') || u.startsWith('data:') || u.startsWith('devtools:') || u.startsWith('chrome-extension:') || (DEV_URL && (u.startsWith(DEV_URL) || u.startsWith(DEV_URL.replace('http', 'ws'))));
    // Bank logos are the only remote content the UI may show.
    const logo = details.resourceType === 'image' && /^https:\/\/([a-z0-9-]+\.)*enablebanking\.com\//i.test(u);
    cb({ cancel: !(local || logo) });
  });
  // The gateway's session: HTTPS to allow-listed hosts only (a second lock behind net.js).
  session.fromPartition(NET_PARTITION).webRequest.onBeforeRequest((details, cb) => {
    let ok = false;
    try { const u = new URL(details.url); ok = u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname); } catch { /* invalid URL */ }
    cb({ cancel: !ok });
  });
  // The updater's own session may only talk to GitHub's release servers over HTTPS.
  const UPDATE_HOSTS = /^https:\/\/(github\.com|api\.github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//i;
  session.fromPartition('electron-updater').webRequest.onBeforeRequest((details, cb) => cb({ cancel: !UPDATE_HOSTS.test(details.url) }));
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
  // Standard right-click menu for text fields and selected text.
  contents.on('context-menu', (_ev, params) => {
    const f = params.editFlags;
    const template = [];
    if (params.misspelledWord) {
      for (const s of params.dictionarySuggestions.slice(0, 5)) template.push({ label: s, click: () => contents.replaceMisspelling(s) });
      if (template.length) template.push({ type: 'separator' });
    }
    if (params.isEditable) {
      template.push(
        { label: 'Undo', role: 'undo', enabled: f.canUndo },
        { label: 'Redo', role: 'redo', enabled: f.canRedo },
        { type: 'separator' },
        { label: 'Cut', role: 'cut', enabled: f.canCut },
        { label: 'Copy', role: 'copy', enabled: f.canCopy },
        { label: 'Paste', role: 'paste', enabled: f.canPaste },
        { label: 'Delete', role: 'delete', enabled: f.canDelete },
        { type: 'separator' },
        { label: 'Select all', role: 'selectAll', enabled: f.canSelectAll },
      );
    } else if (params.selectionText.trim()) {
      template.push({ label: 'Copy', role: 'copy' }, { label: 'Select all', role: 'selectAll' });
    }
    if (template.length) Menu.buildFromTemplate(template).popup({ window: BrowserWindow.fromWebContents(contents) || undefined });
  });
});

// ---------- lifecycle ----------
app.on('second-instance', showMain);

app.whenReady().then(() => {
  hardenSession();
  const dir = app.getPath('userData');
  logger = createLogger(path.join(dir, 'logs'));
  process.on('uncaughtException', (err) => logger.error('[main]', err));
  process.on('unhandledRejection', (err) => logger.error('[main] unhandled', err));
  store = new Store(dir);
  receiptsDir = path.join(dir, 'receipts');
  fs.mkdirSync(receiptsDir, { recursive: true });
  const secrets = createSecrets(path.join(dir, 'secrets.json'));
  const meta = new JsonFile(path.join(dir, 'pulse-meta.json'));

  watcher = new FolderWatcher({
    processed: meta,
    log,
    onRows: async (rows, fileName) => {
      const added = await importWithPrompt({ type: 'txn/import', payload: { rows, source: 'watch', fileName } });
      if (added > 0) notify('Statement imported', `${added} new transaction${added === 1 ? '' : 's'} from ${fileName}`, 'transactions');
    },
  });
  bank = new EnableBankingConnector({ secrets, getState: () => store.get(), dispatch, notify, openExternal: (url) => shell.openExternal(url), fetchImpl: secureFetch, log });
  fxUpdater = startFxUpdater({ getState: () => store.get(), dispatch, secureFetch, log });
  updater = startUpdater({
    app,
    notify,
    log,
    beforeInstall: () => { quitting = true; store.flush(); },
    broadcast: (status) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('update:status', status); },
  });
  bank.snapshot = () => new Set(store.get().transactions.map((t) => t.id));
  bank.onNewTransactions = (added, from, before) => {
    notify('Bank synced', `${added} new transaction${added === 1 ? '' : 's'} from ${from}`, 'transactions');
    if (before) promptForReceipts(before);
  };

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
  fxUpdater?.stop();
  updater?.stop();
});

app.on('window-all-closed', () => {
  if (!store?.get().settings.minimizeToTray) app.quit();
});
