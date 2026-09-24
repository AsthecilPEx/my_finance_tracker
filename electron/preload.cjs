// Exposes a narrow, typed API to the UI. The renderer has no Node.js access.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = async (channel, ...args) => {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (err) {
    throw new Error(String(err.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }
};

contextBridge.exposeInMainWorld('pulse', {
  getState: () => invoke('state:get'),
  dispatch: (action) => invoke('state:dispatch', action),
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on('state:changed', handler);
    return () => ipcRenderer.removeListener('state:changed', handler);
  },
  openCsvFile: () => invoke('dialog:openCsv'),
  chooseFolder: () => invoke('dialog:chooseFolder'),
  exportBackup: () => invoke('backup:export'),
  importBackup: () => invoke('backup:import'),
  toggleWidget: () => invoke('widget:toggle'),
  setWidgetPinned: (pinned) => invoke('widget:pin', pinned),
  closeWidget: () => invoke('widget:close'),
  openMain: () => invoke('app:openMain'),
  openExternal: (url) => invoke('app:openExternal', url),
  bank: {
    hasCredentials: () => invoke('bank:hasCredentials'),
    saveCredentials: (id, key) => invoke('bank:saveCredentials', id, key),
    institutions: (country) => invoke('bank:institutions', country),
    connect: (id, name, days) => invoke('bank:connect', id, name, days),
    sync: () => invoke('bank:sync'),
    disconnect: () => invoke('bank:disconnect'),
  },
  watcher: {
    status: () => invoke('watcher:status'),
    scanNow: () => invoke('watcher:scan'),
  },
});
