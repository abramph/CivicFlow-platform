console.log("🔥 PRELOAD LOADED");

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("civicflow", {

  license: {
    getStatus: () => ipcRenderer.invoke("license:getStatus"),
    activate: (data) => ipcRenderer.invoke("license:activate", data),
    refresh: () => ipcRenderer.invoke("license:refresh"),
    startTrial: () => ipcRenderer.invoke("license:startTrial"),
    deactivate: () => ipcRenderer.invoke("license:deactivate"),
    status: () => ipcRenderer.invoke("license:getStatus")
  },

  campaigns: {
    list: () => ipcRenderer.invoke("db:campaigns:list"),
    create: (data) => ipcRenderer.invoke("db:campaigns:create", data),
    update: (id, updates) => ipcRenderer.invoke("db:campaigns:update", id, updates),
    archive: (id) => ipcRenderer.invoke("db:campaigns:archive", id)
  },

  organization: {
    getSetupStatus: () => ipcRenderer.invoke("organization:getSetupStatus"),
    getSettings: () => ipcRenderer.invoke("organization:getSettings"),
    updateSettings: (data) => ipcRenderer.invoke("organization:updateSettings", data)
  },

  getDeviceId: () => ipcRenderer.invoke("get-device-id")
});

console.log("🔥 civicflow bridge exposed");
