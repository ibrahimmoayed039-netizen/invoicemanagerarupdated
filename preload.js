const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  system: {
    openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
  },
  license: {
    getStatus: () => ipcRenderer.invoke('license:getStatus'),
    activate: (key) => ipcRenderer.invoke('license:activate', key),
    enterApp: () => ipcRenderer.invoke('license:enterApp'),
    deactivate: () => ipcRenderer.invoke('license:deactivate'),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
  },
  customers: {
    list: () => ipcRenderer.invoke('customers:list'),
    get: (id) => ipcRenderer.invoke('customers:get', id),
    add: (data) => ipcRenderer.invoke('customers:add', data),
    update: (id, patch) => ipcRenderer.invoke('customers:update', id, patch),
    delete: (id) => ipcRenderer.invoke('customers:delete', id),
  },
  invoices: {
    listSale: () => ipcRenderer.invoke('invoices:listSale'),
    listPurchase: () => ipcRenderer.invoke('invoices:listPurchase'),
    get: (type, id) => ipcRenderer.invoke('invoices:get', type, id),
    add: (type, data) => ipcRenderer.invoke('invoices:add', type, data),
    update: (type, id, data) => ipcRenderer.invoke('invoices:update', type, id, data),
    delete: (type, id) => ipcRenderer.invoke('invoices:delete', type, id),
  },
  payments: {
    add: (data) => ipcRenderer.invoke('payments:add', data),
    list: () => ipcRenderer.invoke('payments:list'),
    settleOpening: (customerId, currency, amount, date, notes, batchId) => ipcRenderer.invoke('payments:settleOpening', customerId, currency, amount, date, notes, batchId),
  },
  dues: {
    summary: () => ipcRenderer.invoke('dues:summary'),
  },
  history: {
    get: () => ipcRenderer.invoke('history:get'),
  },
  dashboard: {
    summary: () => ipcRenderer.invoke('dashboard:summary'),
  },
  print: {
    current: (options) => ipcRenderer.invoke('print:current', options),
    exportPdf: (payload) => ipcRenderer.invoke('print:exportPdf', payload),
  },
  backup: {
    export: () => ipcRenderer.invoke('backup:export'),
    import: () => ipcRenderer.invoke('backup:import'),
    restore: (data) => ipcRenderer.invoke('backup:restore', data),
    autoInfo: () => ipcRenderer.invoke('backup:autoInfo'),
    openAutoFolder: () => ipcRenderer.invoke('backup:openAutoFolder'),
    chooseAutoFolder: () => ipcRenderer.invoke('backup:chooseAutoFolder'),
    clearAutoFolder: () => ipcRenderer.invoke('backup:clearAutoFolder'),
    sendEmailNow: () => ipcRenderer.invoke('backup:sendEmailNow'),
    uploadNow: () => ipcRenderer.invoke('backup:uploadNow'),
  },
});
