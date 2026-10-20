const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('garden', {
  call: (action, args) => ipcRenderer.invoke('garden:call', action, args),
  onChange: callback => { const handler = () => callback(); ipcRenderer.on('garden:changed', handler); return () => ipcRenderer.removeListener('garden:changed', handler); }
});
