const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bits", {
  platform: process.platform,
  ocrStatus: () => ipcRenderer.invoke("ocr:status"),
  ocrSetup: () => ipcRenderer.invoke("ocr:setup"),
  ocrImport: () => ipcRenderer.invoke("ocr:import"),
  ocrCancel: () => ipcRenderer.invoke("ocr:cancel"),
  openExternal: (url) => ipcRenderer.invoke("link:open", url),
  load: () => ipcRenderer.invoke("library:load"),
  save: (data) => ipcRenderer.invoke("library:save", data),
  export: (data) => ipcRenderer.invoke("library:export", data),
  import: () => ipcRenderer.invoke("library:import"),
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
});
