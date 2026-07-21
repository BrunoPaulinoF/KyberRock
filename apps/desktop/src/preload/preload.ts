// Sandboxed Electron preload scripts run as CommonJS, even when the app uses ESM.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

// ipcRenderer.on recebe (event, ...args), mas os callbacks do renderer esperam so o payload.
// Guardamos o wrapper real registrado por callback para que offScaleReading consiga remover
// exatamente o listener que onScaleReading adicionou (passar o callback original para .off nao
// remove nada, pois a referencia registrada e o wrapper) — senao os listeners vazam e acumulam.
const scaleReadingWrappers = new Map<
  (reading: unknown) => void,
  (event: unknown, reading: unknown) => void
>();

const desktopApi = {
  getStatus: (internetOnline?: boolean) => ipcRenderer.invoke("desktop:get-status", internetOnline),
  exportBackup: () => ipcRenderer.invoke("desktop:export-backup"),
  restoreBackup: () => ipcRenderer.invoke("desktop:restore-backup"),
  getUpdateState: () => ipcRenderer.invoke("desktop:get-update-state"),
  getAccessStatus: () => ipcRenderer.invoke("desktop:get-access-status"),
  validateDesktopAccess: (internetOnline?: boolean, force?: boolean) =>
    ipcRenderer.invoke("desktop:validate-access", internetOnline, force),
  activateDesktop: (input: unknown) => ipcRenderer.invoke("desktop:activate", input),
  logoutDesktop: () => ipcRenderer.invoke("desktop:logout"),
  checkForUpdates: () => ipcRenderer.invoke("desktop:check-for-updates"),
  downloadAndInstallUpdate: () => ipcRenderer.invoke("desktop:download-and-install-update"),
  listOpenWeighingOperations: () => ipcRenderer.invoke("desktop:list-open-weighing-operations"),
  pullLoaderCompletions: () => ipcRenderer.invoke("desktop:pull-loader-completions"),
  listCanceledWeighingOperations: () =>
    ipcRenderer.invoke("desktop:list-canceled-weighing-operations"),
  listClosedWeighingOperations: () => ipcRenderer.invoke("desktop:list-closed-weighing-operations"),
  clearCanceledWeighingOperations: () =>
    ipcRenderer.invoke("desktop:clear-canceled-weighing-operations"),
  deleteClosedWeighingOperation: (operationId: string) =>
    ipcRenderer.invoke("desktop:delete-closed-weighing-operation", operationId),
  startWeighing: (input: unknown) => ipcRenderer.invoke("desktop:start-weighing", input),
  closeWeighing: (operationId: string, operationType?: string, scaleCaptureId?: string) =>
    ipcRenderer.invoke("desktop:close-weighing", operationId, operationType, scaleCaptureId),
  cancelWeighing: (operationId: string, reason: string) =>
    ipcRenderer.invoke("desktop:cancel-weighing", operationId, reason),
  updateWeighingProduct: (operationId: string, newProductId: string) =>
    ipcRenderer.invoke("desktop:update-weighing-product", operationId, newProductId),
  updateWeighingCustomer: (operationId: string, newCustomerId: string) =>
    ipcRenderer.invoke("desktop:update-weighing-customer", operationId, newCustomerId),
  updateWeighingCarrier: (operationId: string, newCarrierId: string | null) =>
    ipcRenderer.invoke("desktop:update-weighing-carrier", operationId, newCarrierId),
  getCustomerFreightRules: (customerId: string) =>
    ipcRenderer.invoke("desktop:get-customer-freight-rules", customerId),
  getCustomerFreightForProduct: (customerId: string, productId: string) =>
    ipcRenderer.invoke("desktop:get-customer-freight-for-product", customerId, productId),
  setCustomerFreightRule: (input: unknown) =>
    ipcRenderer.invoke("desktop:set-customer-freight-rule", input),
  removeCustomerFreightRule: (ruleId: string) =>
    ipcRenderer.invoke("desktop:remove-customer-freight-rule", ruleId),
  listWindowsPrinters: () => ipcRenderer.invoke("desktop:list-windows-printers"),
  configureReceiptPrintProfile: (input: unknown) =>
    ipcRenderer.invoke("desktop:configure-receipt-print-profile", input),
  listPrintProfiles: () => ipcRenderer.invoke("desktop:list-print-profiles"),
  listPrintReceipts: () => ipcRenderer.invoke("desktop:list-print-receipts"),
  printReceipt: (operationId: string) => ipcRenderer.invoke("desktop:print-receipt", operationId),
  reprintReceipt: (receiptId: string) => ipcRenderer.invoke("desktop:reprint-receipt", receiptId),
  printTestReceipt: () => ipcRenderer.invoke("desktop:print-test-receipt"),
  billFiscalOperation: (operationId: string) =>
    ipcRenderer.invoke("desktop:bill-fiscal-operation", operationId),
  bootstrapCloudData: () => ipcRenderer.invoke("desktop:bootstrap-cloud-data"),
  syncToCloud: () => ipcRenderer.invoke("desktop:sync-to-cloud"),
  getCloudStatus: () => ipcRenderer.invoke("desktop:get-cloud-status"),
  isCloudConnected: () => ipcRenderer.invoke("desktop:is-cloud-connected"),
  queryCache: (options: unknown) => ipcRenderer.invoke("desktop:query-cache", options),
  getDailyReport: (date: string) => ipcRenderer.invoke("desktop:get-daily-report", date),
  getMonthlyReport: (year: number, month: number) =>
    ipcRenderer.invoke("desktop:get-monthly-report", year, month),
  getReportHtml: (startDate: string, endDate: string) =>
    ipcRenderer.invoke("desktop:get-report-html", startDate, endDate),
  exportReportPdf: (startDate: string, endDate: string, periodLabel?: string) =>
    ipcRenderer.invoke("desktop:export-report-pdf", startDate, endDate, periodLabel),
  exportReportExcel: (startDate: string, endDate: string) =>
    ipcRenderer.invoke("desktop:export-report-excel", startDate, endDate),
  getTruckControl: (startDate: string, endDate: string) =>
    ipcRenderer.invoke("desktop:get-truck-control", startDate, endDate),
  exportTruckControlPdf: (startDate: string, endDate: string) =>
    ipcRenderer.invoke("desktop:export-truck-control-pdf", startDate, endDate),
  listReportRecipients: () => ipcRenderer.invoke("desktop:list-report-recipients"),
  createReportRecipient: (input: unknown) =>
    ipcRenderer.invoke("desktop:create-report-recipient", input),
  updateReportRecipient: (id: string, input: unknown) =>
    ipcRenderer.invoke("desktop:update-report-recipient", id, input),
  deleteReportRecipient: (id: string) => ipcRenderer.invoke("desktop:delete-report-recipient", id),
  sendTestEmail: (to: string) => ipcRenderer.invoke("desktop:send-test-email", to),
  sendDailyReportEmail: (email: string, date: string) =>
    ipcRenderer.invoke("desktop:send-daily-report-email", email, date),
  sendRangeReportEmail: (email: string, startDate: string, endDate: string) =>
    ipcRenderer.invoke("desktop:send-range-report-email", email, startDate, endDate),
  verifySmtpConfig: () => ipcRenderer.invoke("desktop:verify-smtp-config"),
  getReportChannelSettings: () => ipcRenderer.invoke("desktop:report-channels-get"),
  saveReportChannelSettings: (input: unknown) =>
    ipcRenderer.invoke("desktop:report-channels-save", input),
  whatsappConnect: () => ipcRenderer.invoke("desktop:whatsapp-connect"),
  whatsappStatus: () => ipcRenderer.invoke("desktop:whatsapp-status"),
  whatsappDisconnect: () => ipcRenderer.invoke("desktop:whatsapp-disconnect"),
  getReportDispatchConfig: () => ipcRenderer.invoke("desktop:report-dispatch-get-config"),
  saveReportDispatchConfig: (patch: unknown) =>
    ipcRenderer.invoke("desktop:report-dispatch-save-config", patch),
  sendReportsNow: () => ipcRenderer.invoke("desktop:report-dispatch-send-now"),
  getReportByProduct: (startDate: string, endDate: string, limit?: number) =>
    ipcRenderer.invoke("desktop:get-report-by-product", startDate, endDate, limit),
  getReportByCustomer: (startDate: string, endDate: string, limit?: number) =>
    ipcRenderer.invoke("desktop:get-report-by-customer", startDate, endDate, limit),
  getDailySeries: (startDate: string, endDate: string) =>
    ipcRenderer.invoke("desktop:get-daily-series", startDate, endDate),
  getSalesPivot: (startDate: string, endDate: string, groupBy: string, filters?: unknown) =>
    ipcRenderer.invoke("desktop:get-sales-pivot", startDate, endDate, groupBy, filters),
  getOperationMix: (startDate: string, endDate: string) =>
    ipcRenderer.invoke("desktop:get-operation-mix", startDate, endDate),
  getPriceForCustomerProduct: (customerId: string, productId: string) =>
    ipcRenderer.invoke("desktop:get-price", customerId, productId),
  getPriceDetailsForCustomerProduct: (customerId: string, productId: string) =>
    ipcRenderer.invoke("desktop:get-price-details", customerId, productId),
  productDefaultPricesList: () => ipcRenderer.invoke("desktop:product-default-prices-list"),
  productDefaultPricesUpsert: (input: unknown) =>
    ipcRenderer.invoke("desktop:product-default-prices-upsert", input),
  productDefaultPricesRemove: (productId: string) =>
    ipcRenderer.invoke("desktop:product-default-prices-remove", productId),
  customerSpecialPricesList: (customerId: string) =>
    ipcRenderer.invoke("desktop:customer-special-prices-list", customerId),
  customerSpecialPricesSet: (input: unknown) =>
    ipcRenderer.invoke("desktop:customer-special-prices-set", input),
  customerSpecialPricesRemove: (customerId: string, productId: string) =>
    ipcRenderer.invoke("desktop:customer-special-prices-remove", customerId, productId),
  customerCreditBalance: (customerId: string) =>
    ipcRenderer.invoke("desktop:customer-credit-balance", customerId),
  customerCreditMovements: (customerId: string, limit?: number) =>
    ipcRenderer.invoke("desktop:customer-credit-movements", customerId, limit),
  quotationsCreate: (input: unknown) => ipcRenderer.invoke("desktop:quotations-create", input),
  quotationsCancel: (id: string) => ipcRenderer.invoke("desktop:quotations-cancel", id),
  quotationsListOpenForCustomer: (customerId: string) =>
    ipcRenderer.invoke("desktop:quotations-list-open-for-customer", customerId),
  customersCreate: (input: unknown) => ipcRenderer.invoke("desktop:customers-create", input),
  customersUpdate: (id: string, input: unknown, options?: { overrideOmieFields?: boolean }) =>
    ipcRenderer.invoke("desktop:customers-update", id, input, options),
  customersDelete: (id: string) => ipcRenderer.invoke("desktop:customers-delete", id),
  getDefaultNfeEmail: () => ipcRenderer.invoke("desktop:get-default-nfe-email"),
  setDefaultNfeEmail: (email: string) => ipcRenderer.invoke("desktop:set-default-nfe-email", email),
  applyDefaultNfeEmailToAll: (email: string) =>
    ipcRenderer.invoke("desktop:apply-default-nfe-email-to-all", email),
  enrichAllCustomersFromCnpj: () => ipcRenderer.invoke("desktop:enrich-all-customers-cnpj"),
  enrichAllCarriersFromCnpj: () => ipcRenderer.invoke("desktop:enrich-all-carriers-cnpj"),
  // Meios de pagamento e contas vem do OMIE (sincronizacao); localmente so ha
  // atualizacao restrita (ativar/desativar, apelido, vinculo forma -> conta).
  paymentMethodsUpdate: (id: string, input: unknown) =>
    ipcRenderer.invoke("desktop:payment-methods-update", id, input),
  accountsList: () => ipcRenderer.invoke("desktop:accounts-list"),
  accountsUpdate: (id: string, input: unknown) =>
    ipcRenderer.invoke("desktop:accounts-update", id, input),
  paymentTermsCreate: (input: unknown) =>
    ipcRenderer.invoke("desktop:payment-terms-create", input),
  paymentTermsUpdate: (id: string, input: unknown) =>
    ipcRenderer.invoke("desktop:payment-terms-update", id, input),
  paymentTermsDelete: (id: string) => ipcRenderer.invoke("desktop:payment-terms-delete", id),
  paymentTermsListOmie: () => ipcRenderer.invoke("desktop:payment-terms-list-omie"),
  priceTablesCreate: (input: unknown) => ipcRenderer.invoke("desktop:price-tables-create", input),
  priceTablesUpdateName: (id: string, name: string) =>
    ipcRenderer.invoke("desktop:price-tables-update-name", id, name),
  priceTablesDelete: (id: string) => ipcRenderer.invoke("desktop:price-tables-delete", id),
  priceTablesAddItem: (input: unknown) =>
    ipcRenderer.invoke("desktop:price-tables-add-item", input),
  priceTablesUpdateItem: (id: string, input: unknown) =>
    ipcRenderer.invoke("desktop:price-tables-update-item", id, input),
  priceTablesRemoveItem: (id: string) => ipcRenderer.invoke("desktop:price-tables-remove-item", id),
  priceTablesLinkCustomer: (input: unknown) =>
    ipcRenderer.invoke("desktop:price-tables-link-customer", input),
  priceTablesUnlinkCustomer: (linkId: string) =>
    ipcRenderer.invoke("desktop:price-tables-unlink-customer", linkId),
  priceTablesList: () => ipcRenderer.invoke("desktop:price-tables-list"),
  priceTablesListItems: (priceTableId: string) =>
    ipcRenderer.invoke("desktop:price-tables-list-items", priceTableId),
  priceTablesListCustomerLinks: (priceTableId: string) =>
    ipcRenderer.invoke("desktop:price-tables-list-customer-links", priceTableId),
  vehiclesCreate: (input: unknown) => ipcRenderer.invoke("desktop:vehicles-create", input),
  vehiclesUpdate: (id: string, input: unknown) =>
    ipcRenderer.invoke("desktop:vehicles-update", id, input),
  vehiclesDelete: (id: string) => ipcRenderer.invoke("desktop:vehicles-delete", id),
  vehiclesFindOrCreate: (plate: string) =>
    ipcRenderer.invoke("desktop:vehicles-find-or-create", plate),
  vehiclesGetCarriers: (vehicleId: string) =>
    ipcRenderer.invoke("desktop:vehicles-get-carriers", vehicleId),
  vehiclesLinkCarrier: (vehicleId: string, carrierId: string) =>
    ipcRenderer.invoke("desktop:vehicles-link-carrier", vehicleId, carrierId),
  customersByCarrier: (carrierId: string) =>
    ipcRenderer.invoke("desktop:customers-by-carrier", carrierId),
  driversCreate: (input: unknown) => ipcRenderer.invoke("desktop:drivers-create", input),
  driversUpdate: (id: string, input: unknown) =>
    ipcRenderer.invoke("desktop:drivers-update", id, input),
  driversDelete: (id: string) => ipcRenderer.invoke("desktop:drivers-delete", id),
  driversFindOrCreate: (name: string) => ipcRenderer.invoke("desktop:drivers-find-or-create", name),
  carriersCreate: (input: unknown) => ipcRenderer.invoke("desktop:carriers-create", input),
  carriersUpdate: (id: string, input: unknown) =>
    ipcRenderer.invoke("desktop:carriers-update", id, input),
  carriersDelete: (id: string) => ipcRenderer.invoke("desktop:carriers-delete", id),
  carriersList: () => ipcRenderer.invoke("desktop:carriers-list"),
  carriersGetVehicles: (carrierId: string) =>
    ipcRenderer.invoke("desktop:carriers-get-vehicles", carrierId),
  linkCustomerCarrier: (customerId: string, carrierId: string) =>
    ipcRenderer.invoke("desktop:link-customer-carrier", customerId, carrierId),
  unlinkCustomerCarrier: (customerId: string, carrierId: string) =>
    ipcRenderer.invoke("desktop:unlink-customer-carrier", customerId, carrierId),
  listCarriersByCustomer: (customerId: string) =>
    ipcRenderer.invoke("desktop:list-carriers-by-customer", customerId),
  listCustomersByCarrier: (carrierId: string) =>
    ipcRenderer.invoke("desktop:list-customers-by-carrier", carrierId),
  linkDriverCarrier: (driverId: string, carrierId: string) =>
    ipcRenderer.invoke("desktop:link-driver-carrier", driverId, carrierId),
  unlinkDriverCarrier: (driverId: string, carrierId: string) =>
    ipcRenderer.invoke("desktop:unlink-driver-carrier", driverId, carrierId),
  listCarriersByDriver: (driverId: string) =>
    ipcRenderer.invoke("desktop:list-carriers-by-driver", driverId),
  listDriversByCarrier: (carrierId: string) =>
    ipcRenderer.invoke("desktop:list-drivers-by-carrier", carrierId),
  listIndependentDrivers: () => ipcRenderer.invoke("desktop:list-independent-drivers"),
  getOmieStatus: () => ipcRenderer.invoke("desktop:get-omie-status"),
  scaleConnect: () => ipcRenderer.invoke("desktop:scale-connect"),
  scaleDisconnect: () => ipcRenderer.invoke("desktop:scale-disconnect"),
  scaleListSerialPorts: () => ipcRenderer.invoke("desktop:scale-list-serial-ports"),
  scaleRead: () => ipcRenderer.invoke("desktop:scale-read"),
  scaleReadSampled: () => ipcRenderer.invoke("desktop:scale-read-sampled"),
  scaleCaptureStable: (options: unknown) =>
    ipcRenderer.invoke("desktop:scale-capture-stable", options),
  scaleDiscover: () => ipcRenderer.invoke("desktop:scale-discover"),
  scaleGetStatus: () => ipcRenderer.invoke("desktop:scale-get-status"),
  scaleGetConfig: () => ipcRenderer.invoke("desktop:scale-get-config"),
  scaleSaveConfig: (input: unknown) => ipcRenderer.invoke("desktop:scale-save-config", input),
  virtualScaleSetWeight: (weightKg: unknown) =>
    ipcRenderer.invoke("desktop:virtual-scale-set-weight", weightKg),
  virtualScaleConnect: () => ipcRenderer.invoke("desktop:virtual-scale-connect"),
  verifyPriceChangePassword: (password: string) =>
    ipcRenderer.invoke("desktop:verify-price-password", password),
  omieConfig: () => ipcRenderer.invoke("desktop:omie-config"),
  lookupCep: (cep: string) => ipcRenderer.invoke("desktop:lookup-cep", cep),
  lookupCnpj: (cnpj: string) => ipcRenderer.invoke("desktop:lookup-cnpj", cnpj),
  omieSync: () => ipcRenderer.invoke("desktop:omie-sync"),
  omieQueueList: () => ipcRenderer.invoke("desktop:omie-queue-list"),
  omieQueueDelete: (jobId: string) => ipcRenderer.invoke("desktop:omie-queue-delete", jobId),
  omieQueueSendNow: (jobId: string) => ipcRenderer.invoke("desktop:omie-queue-send-now", jobId),
  syncOmieDirect: (appKey: string, appSecret: string) =>
    ipcRenderer.invoke("desktop:sync-omie-direct", appKey, appSecret),
  syncOmieMasterData: (options?: unknown) =>
    ipcRenderer.invoke("desktop:sync-omie-master", options),
  getLastOmieSyncRun: () => ipcRenderer.invoke("desktop:get-last-omie-sync-run"),
  listOmieDocumentTypes: () => ipcRenderer.invoke("desktop:omie-list-document-types"),
  getOmieSyncEntitiesByRun: (runId: string) =>
    ipcRenderer.invoke("desktop:get-omie-sync-entities", runId),
  resetOmieMaster: () => ipcRenderer.invoke("desktop:reset-omie-master"),
  startOmieDataEntryLoop: () => ipcRenderer.invoke("desktop:omie-data-entry-loop"),
  getOmieLoopStatus: () => ipcRenderer.invoke("desktop:omie-loop-status"),
  getOmieSchedulerStatus: () => ipcRenderer.invoke("desktop:omie-scheduler-status"),
  setOmieSchedulerConfig: (config: { enabled?: boolean; intervalMinutes?: number }) =>
    ipcRenderer.invoke("desktop:omie-scheduler-config", config),
  syncCloudNow: () => ipcRenderer.invoke("desktop:cloud-sync-now"),
  getCloudSyncSchedulerStatus: () => ipcRenderer.invoke("desktop:cloud-scheduler-status"),
  setCloudSyncConfig: (config: { enabled?: boolean; intervalMinutes?: number }) =>
    ipcRenderer.invoke("desktop:cloud-scheduler-config", config),
  probeConnectivity: () => ipcRenderer.invoke("desktop:probe-connectivity"),
  onUpdateAvailable: (callback: (event: unknown, version: string) => void) =>
    ipcRenderer.on("desktop:update-available", callback),
  offUpdateAvailable: (callback: (event: unknown, version: string) => void) =>
    ipcRenderer.off("desktop:update-available", callback),
  onUpdateDownloadProgress: (callback: (event: unknown, percent: number) => void) =>
    ipcRenderer.on("desktop:update-download-progress", callback),
  offUpdateDownloadProgress: (callback: (event: unknown, percent: number) => void) =>
    ipcRenderer.off("desktop:update-download-progress", callback),
  onUpdateDownloaded: (callback: (event: unknown, version: string) => void) =>
    ipcRenderer.on("desktop:update-downloaded", callback),
  offUpdateDownloaded: (callback: (event: unknown, version: string) => void) =>
    ipcRenderer.off("desktop:update-downloaded", callback),
  onPlateScanned: (callback: (plate: string) => void) =>
    ipcRenderer.on("desktop:plate-scanned", (_event: unknown, plate: string) => callback(plate)),
  onScaleReading: (callback: (reading: unknown) => void) => {
    const wrapper = (_event: unknown, reading: unknown) => callback(reading);
    scaleReadingWrappers.set(callback, wrapper);
    ipcRenderer.on("desktop:scale-reading", wrapper);
  },
  offScaleReading: (callback: (reading: unknown) => void) => {
    const wrapper = scaleReadingWrappers.get(callback);
    if (wrapper) {
      ipcRenderer.off("desktop:scale-reading", wrapper);
      scaleReadingWrappers.delete(callback);
    }
  }
};

contextBridge.exposeInMainWorld("kyberrockDesktop", desktopApi);
