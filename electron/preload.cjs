const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  edit: (role) => ipcRenderer.send('edit', role),
  onEditMenu: (cb) => ipcRenderer.on('edit-menu', (_e, p) => cb(p)),
  syncServer: () => ipcRenderer.invoke('sync-server'),
  setSyncServer: (url) => ipcRenderer.invoke('set-sync-server', url),
});
