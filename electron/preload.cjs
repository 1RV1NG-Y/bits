const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bits", {
  platform: process.platform,
  ocrStatus: () => ipcRenderer.invoke("ocr:status"),
  ocrSetup: () => ipcRenderer.invoke("ocr:setup"),
  ocrImport: () => ipcRenderer.invoke("ocr:import"),
  ocrCancel: () => ipcRenderer.invoke("ocr:cancel"),
  openExternal: (url) => ipcRenderer.invoke("link:open", url),
  sync: (method, params) => ipcRenderer.invoke("sync:call", method, params ?? null),
  onSyncEvent: (callback) => {
    const listener = (_event, name) => callback(name);
    ipcRenderer.on("sync:event", listener);
    return () => ipcRenderer.removeListener("sync:event", listener);
  },
  migrationError: () => ipcRenderer.invoke("library:migrationError"),
  migrationResolved: () => ipcRenderer.invoke("library:migrationResolved"),
  export: (data) => ipcRenderer.invoke("library:export", data),
  import: () => ipcRenderer.invoke("library:import"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
});
