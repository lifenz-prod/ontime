const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('renderer', {
  getState: () => ipcRenderer.invoke('settings:get'),
  save: (config) => ipcRenderer.invoke('settings:save', config),
  reload: (index) => ipcRenderer.invoke('settings:reload', index),
  getPreviews: () => ipcRenderer.invoke('settings:previews'),
  onState: (callback) => ipcRenderer.on('settings:state', (_event, state) => callback(state)),
});
