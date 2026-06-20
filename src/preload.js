const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sortZoneDesktop", {
  listPrinters: () => ipcRenderer.invoke("printers:list"),
  silentPrint: (payload) => ipcRenderer.invoke("print:silent", payload),
  rawZplPrint: (payload) => ipcRenderer.invoke("print:zpl", payload),
  openKeyboard: () => ipcRenderer.invoke("keyboard:open")
});
