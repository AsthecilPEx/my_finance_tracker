// Bridge between the UI and wherever data lives.
// In the desktop app, window.pulse (from electron/preload.cjs) talks to the main process,
// which owns the data file, the watched folder and the bank connection.
// In a plain browser (npm run dev:web) we fall back to localStorage so the UI still works.
import { reduce, migrate, createEmptyState } from '../engine/state.js';

const desktop = typeof window !== 'undefined' ? window.pulse : undefined;
export const isDesktop = !!desktop;

const KEY = 'pulse-finance-state';
let webState = null;
const listeners = new Set();

function loadWeb() {
  if (webState) return webState;
  try {
    webState = migrate(JSON.parse(localStorage.getItem(KEY)));
  } catch {
    webState = createEmptyState();
  }
  return webState;
}

function saveWeb() {
  try { localStorage.setItem(KEY, JSON.stringify(webState)); } catch { /* storage unavailable */ }
  listeners.forEach((cb) => cb(webState));
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.click();
  });
}

const unsupported = async () => { throw new Error('Available in the desktop app'); };

export const api = desktop || {
  getState: async () => loadWeb(),
  dispatch: async (action) => {
    webState = reduce(loadWeb(), action);
    saveWeb();
    return webState;
  },
  onState: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  openCsvFile: () => pickFile('.csv,text/csv'),
  copyText: async (text) => navigator.clipboard.writeText(text),
  saveText: async (text, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = name;
    a.click();
  },
  onNavigate: () => () => {},
  receipts: {
    // In the browser the photo is kept as a data URL; OCR needs the desktop app.
    pickImage: () => new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const f = input.files?.[0];
        if (!f) return resolve(null);
        const r = new FileReader();
        r.onload = () => resolve({ file: r.result, dataUrl: r.result });
        r.readAsDataURL(f);
      };
      input.click();
    }),
    ocr: unsupported,
    image: async (file) => file,
  },
  plan: { openFile: () => pickFile('.json,.txt,.md,text/plain') },
  exportBackup: async (state) => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pulse-finance-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    return true;
  },
  importBackup: async () => {
    const f = await pickFile('.json,application/json');
    return f ? JSON.parse(f.text) : null;
  },
  chooseFolder: unsupported,
  toggleWidget: unsupported,
  setWidgetPinned: async () => {},
  closeWidget: async () => window.close(),
  openMain: async () => {},
  openExternal: async (url) => window.open(url, '_blank'),
  bank: {
    info: async () => ({ hasCredentials: false, redirectUrl: '' }),
    pickKey: unsupported,
    completeWithUrl: unsupported,
    saveCredentials: unsupported,
    institutions: unsupported,
    connect: unsupported,
    sync: unsupported,
    disconnect: unsupported,
  },
  watcher: { status: async () => ({ active: false }), scanNow: unsupported },
};
