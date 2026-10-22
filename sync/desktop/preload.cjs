const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bitsSync", {
  call: (method, params) => ipcRenderer.invoke("sync:call", method, params ?? null),
  copy: (text) => ipcRenderer.invoke("sync:copy", text),
  onEvent: (callback) => {
    const listener = (_event, name) => callback(name);
    ipcRenderer.on("sync:event", listener);
    return () => ipcRenderer.removeListener("sync:event", listener);
  },
});
