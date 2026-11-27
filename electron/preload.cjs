const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paperMailDesktop', {
  openPdfFolder: paperId => ipcRenderer.invoke('paper-mail:open-pdf-folder', paperId),
  changeStorageLocation: () => ipcRenderer.invoke('paper-mail:change-storage-location'),
});
