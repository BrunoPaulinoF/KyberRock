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
    ipcRenderer.invoke("desktop:is-cloud-connected"),
  queryCache: (options: unknown) =>
    ipcRenderer.invoke("desktop:query-cache", options),
  customersCreate: (input: unknown) =>
    ipcRenderer.invoke("desktop:customers-create", input),
  customersUpdate: (id: string, input: unknown) =>
    ipcRenderer.invoke("desktop:customers-update", id, input),
  customersDelete: (id: string) =>
    ipcRenderer.invoke("desktop:customers-delete", id),
  priceTablesCreate: (input: unknown) =>
    ipcRenderer.invoke("desktop:price-tables-create", input),
  priceTablesUpdateName: (id: string, name: string) =>
    ipcRenderer.invoke("desktop:price-tables-update-name", id, name),
  priceTablesDelete: (id: string) =>
    ipcRenderer.invoke("desktop:price-tables-delete", id),
  priceTablesAddItem: (input: unknown) =>
    ipcRenderer.invoke("desktop:price-tables-add-item", input),
  priceTablesUpdateItem: (id: string, input: unknown) =>
    ipcRenderer.invoke("desktop:price-tables-update-item", id, input),
  priceTablesRemoveItem: (id: string) =>
    ipcRenderer.invoke("desktop:price-tables-remove-item", id),
  priceTablesLinkCustomer: (input: unknown) =>
    ipcRenderer.invoke("desktop:price-tables-link-customer", input),
  priceTablesUnlinkCustomer: (linkId: string) =>
    ipcRenderer.invoke("desktop:price-tables-unlink-customer", linkId),
  priceTablesList: () =>
    ipcRenderer.invoke("desktop:price-tables-list"),
  priceTablesListItems: (priceTableId: string) =>
    ipcRenderer.invoke("desktop:price-tables-list-items", priceTableId),
  priceTablesListCustomerLinks: (priceTableId: string) =>
    ipcRenderer.invoke("desktop:price-tables-list-customer-links", priceTableId),
  vehiclesCreate: (input: unknown) =>
    ipcRenderer.invoke("desktop:vehicles-create", input),
  vehiclesUpdate: (id: string, input: unknown) =>
    ipcRenderer.invoke("desktop:vehicles-update", id, input),
  vehiclesDelete: (id: string) =>
    ipcRenderer.invoke("desktop:vehicles-delete", id),
  vehiclesFindOrCreate: (plate: string) =>
    ipcRenderer.invoke("desktop:vehicles-find-or-create", plate),
  driversCreate: (input: unknown) =>
    ipcRenderer.invoke("desktop:drivers-create", input),
  driversUpdate: (id: string, input: unknown) =>
    ipcRenderer.invoke("desktop:drivers-update", id, input),
  driversDelete: (id: string) =>
    ipcRenderer.invoke("desktop:drivers-delete", id),
  driversFindOrCreate: (name: string) =>
    ipcRenderer.invoke("desktop:drivers-find-or-create", name),
  carriersCreate: (input: unknown) =>
    ipcRenderer.invoke("desktop:carriers-create", input),
  carriersUpdate: (id: string, input: unknown) =>
    ipcRenderer.invoke("desktop:carriers-update", id, input),
  carriersDelete: (id: string) =>
    ipcRenderer.invoke("desktop:carriers-delete", id),
  getOmieStatus: () =>
    ipcRenderer.invoke("desktop:get-omie-status"),
  scaleConnect: (config: unknown) =>
    ipcRenderer.invoke("desktop:scale-connect", config),
  scaleDisconnect: () =>
    ipcRenderer.invoke("desktop:scale-disconnect"),
  scaleRead: () =>
    ipcRenderer.invoke("desktop:scale-read"),
  scaleGetStatus: () =>
    ipcRenderer.invoke("desktop:scale-get-status"),
  onUpdateAvailable: (callback: (event: unknown, version: string) => void) =>
    ipcRenderer.on("desktop:update-available", callback),
  offUpdateAvailable: (callback: (event: unknown, version: string) => void) =>
    ipcRenderer.off("desktop:update-available", callback),
  onPlateScanned: (callback: (plate: string) => void) =>
    ipcRenderer.on("desktop:plate-scanned", (_event: unknown, plate: string) => callback(plate)),
  onScaleReading: (callback: (reading: unknown) => void) =>
    ipcRenderer.on("desktop:scale-reading", (_event: unknown, reading: unknown) => callback(reading))
};

contextBridge.exposeInMainWorld("kyberrockDesktop", desktopApi);
