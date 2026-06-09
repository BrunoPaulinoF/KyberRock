// Sandboxed Electron preload scripts run as CommonJS, even when the app uses ESM.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

const desktopApi = {
  getStatus: (internetOnline?: boolean) =>
    ipcRenderer.invoke("desktop:get-status", internetOnline),
  exportBackup: () => ipcRenderer.invoke("desktop:export-backup"),
  restoreBackup: () => ipcRenderer.invoke("desktop:restore-backup"),
  getUpdateState: () => ipcRenderer.invoke("desktop:get-update-state"),
  getAccessStatus: () => ipcRenderer.invoke("desktop:get-access-status"),
  validateDesktopAccess: (internetOnline?: boolean, force?: boolean) =>
    ipcRenderer.invoke("desktop:validate-access", internetOnline, force),
  activateDesktop: (input: unknown) => ipcRenderer.invoke("desktop:activate", input),
  logoutDesktop: () => ipcRenderer.invoke("desktop:logout"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  downloadAndInstallUpdate: () =>
    ipcRenderer.invoke("desktop:download-and-install-update"),
  listOpenWeighingOperations: () =>
    ipcRenderer.invoke("desktop:list-open-weighing-operations"),
  startSimulatedWeighing: (input: unknown) =>
    ipcRenderer.invoke(
      "desktop:start-simulated-weighing",
      input
    ),
  closeSimulatedWeighing: (operationId: string) =>
    ipcRenderer.invoke(
      "desktop:close-simulated-weighing",
      operationId
    ),
  cancelWeighing: (operationId: string, reason: string) =>
    ipcRenderer.invoke(
      "desktop:cancel-weighing",
      operationId,
      reason
    ),
  listWindowsPrinters: () =>
    ipcRenderer.invoke("desktop:list-windows-printers"),
  configureReceiptPrintProfile: (input: unknown) =>
    ipcRenderer.invoke(
      "desktop:configure-receipt-print-profile",
      input
    ),
  listPrintProfiles: () =>
    ipcRenderer.invoke("desktop:list-print-profiles"),
  listPrintReceipts: () =>
    ipcRenderer.invoke("desktop:list-print-receipts"),
  printReceipt: (operationId: string) =>
    ipcRenderer.invoke("desktop:print-receipt", operationId),
  reprintReceipt: (receiptId: string) =>
    ipcRenderer.invoke("desktop:reprint-receipt", receiptId),
  printTestReceipt: () =>
    ipcRenderer.invoke("desktop:print-test-receipt"),
  syncToCloud: () => ipcRenderer.invoke("desktop:sync-to-cloud"),
  getCloudStatus: () =>
    ipcRenderer.invoke("desktop:get-cloud-status"),
  isCloudConnected: () =>
    ipcRenderer.invoke("desktop:is-cloud-connected")
};

contextBridge.exposeInMainWorld("kyberrockDesktop", desktopApi);
