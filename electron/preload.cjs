// Exposes a narrow, typed API to the UI. The renderer has no Node.js access.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = async (channel, ...args) => {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (err) {
    throw new Error(String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
};

const subscribe = (channel) => (cb) => {
  const handler = (_e, value) => cb(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('pulse', {
  getState: () => invoke('state:get'),
  dispatch: (action) => invoke('state:dispatch', action),
  onState: subscribe('state:changed'),
  onNavigate: subscribe('navigate'),
  openCsvFile: () => invoke('dialog:openCsv'),
  chooseFolder: () => invoke('dialog:chooseFolder'),
  exportBackup: () => invoke('backup:export'),
  importBackup: () => invoke('backup:import'),
  copyText: (text) => invoke('clipboard:write', text),
  saveText: (text, name) => invoke('file:saveText', text, name),
  toggleWidget: () => invoke('widget:toggle'),
  setWidgetPinned: (pinned) => invoke('widget:pin', pinned),
  closeWidget: () => invoke('widget:close'),
  openMain: () => invoke('app:openMain'),
  openExternal: (url) => invoke('app:openExternal', url),
  receipts: {
    pickImage: () => invoke('receipt:pickImage'),
    image: (file) => invoke('receipt:image', file),
    ocr: (file) => invoke('receipt:ocr', file),
  },
  plan: { openFile: () => invoke('plan:openFile') },
  bank: {
    info: () => invoke('bank:info'),
    pickKey: () => invoke('bank:pickKey'),
    saveCredentials: (appId, pem) => invoke('bank:saveCredentials', appId, pem),
    institutions: (country) => invoke('bank:institutions', country),
    connect: (name, country, validity) => invoke('bank:connect', name, country, validity),
    completeWithUrl: (url) => invoke('bank:completeWithUrl', url),
    sync: () => invoke('bank:sync'),
    disconnect: () => invoke('bank:disconnect'),
  },
  watcher: {
    status: () => invoke('watcher:status'),
    scanNow: () => invoke('watcher:scan'),
  },
});
