import { randomUUID } from "node:crypto";

import {
  initializeDesktopDatabase,
  type InitializedDesktopDatabase
} from "../database/initialize.js";
import { runDesktopMigrations } from "../database/migrate.js";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite.js";
import {
  createAutomaticBackup,
  exportManualBackup,
  restoreBackup,
  type BackupResult
} from "./backup.js";
import {
  ensureInitialDesktopIdentity,
  getLocalDesktopIdentity,
  type LocalDesktopIdentity
} from "./bootstrap.js";
import {
  startDailyBackupScheduler,
  type BackupSchedulerHandle,
  type StartDailyBackupSchedulerOptions
} from "./backup-scheduler.js";
import {
  computeNextPullAt,
  readOmiePullLastRunAt,
  readOmieSchedulerConfig,
  recordOmiePullRanAt,
  startOmiePullScheduler,
  writeOmieSchedulerConfig,
  type OmieSchedulerConfig,
  type OmieSchedulerHandle,
  type OmieSchedulerStatus
} from "./omie-scheduler.js";
import {
  startCloudSyncScheduler,
  computeNextSyncAt as computeNextCloudSyncAt,
  readCloudSyncConfig,
  readCloudSyncLastRunAt,
  recordCloudSyncRanAt,
  writeCloudSyncConfig,
  type CloudSyncConfig,
  type CloudSyncSchedulerHandle,
  type CloudSyncSchedulerStatus
} from "./cloud-scheduler.js";
import { probeInternet, probeOmie } from "./connectivity.js";
import {
  getDesktopStatusSnapshot,
  recordLastBackupAt,
  type DesktopStatusSnapshot
} from "./status.js";
import {
  cancelWeighingOperation,
  clearCanceledWeighingOperations,
  closeWeighingOperation,
  createWeighingOperation,
  listCanceledWeighingOperations,
  listClosedWeighingOperations,
  listOpenWeighingOperations,
  type OperationType,
  type OperationFreightInput,
  type ScaleCaptureAudit,
  type WeighingOperationSummary
} from "./weighing-operations.js";
import {
  configureReceiptPrintProfile,
  listPrintProfiles,
  listPrintReceipts,
  printTestReceipt,
  printWeighingReceipt,
  reprintWeighingReceipt,
  type ConfigureReceiptPrintProfileInput,
  type PrintProfileSummary,
  type PrintReceiptSummary,
  type ReceiptPrinter
} from "./printing.js";
import {
  initializeSupabaseFromSettings,
  pingSupabase,
  processCloudSyncQueue,
  syncOperationToSupabase,
  syncLoadingRequestToSupabase,
  syncOmieReferenceDataFromCloud,
  pushOmieCustomersToCloud,
  processOmieSyncQueue,
  processFiscalBillingNow,
  getSupabaseSyncStatus,
  isSupabaseInitialized,
  pullCompanyPricePasswordFromCloud,
  syncCustomerCarriersToCloud,
  syncDriverCarriersToCloud,
  pullCustomerCarriersFromCloud,
  pullDriverCarriersFromCloud,
  pullLoaderCompletionsFromCloud,
  type FiscalBillingResult,
  type SyncResult
} from "./supabase-sync.js";
import {
  activateDesktop,
  getStoredDesktopAccessStatus,
  logoutDesktop,
  validateDesktopAccess,
  type ActivateDesktopInput,
  type DesktopAccessStatus
} from "./desktop-activation.js";
import { CacheStore, type CacheQueryOptions, type CacheQueryResult } from "./cache-store.js";
import { readOmiePullState, writeOmiePullState } from "./supabase-sync.js";
import { ReportService } from "./reports.js";
import {
  createReportRecipient,
  deleteReportRecipient,
  listReportRecipients,
  updateReportRecipient,
  type CreateReportRecipientInput,
  type ReportRecipient,
  type UpdateReportRecipientInput
} from "./report-recipients.js";
import { PricingService, type PriceDetails } from "./pricing.js";
import {
  listCustomerSpecialPrices,
  listProductDefaultPriceSummaries,
  removeCustomerSpecialPrice,
  setCustomerSpecialPrice,
  upsertProductDefaultPrice,
  type CustomerSpecialPriceSummary,
  type ProductDefaultPriceSummary
} from "./product-prices.js";
import { CreditService, type CreditMovementRow } from "./credit.js";
import {
  cancelQuotation,
  createQuotation,
  listOpenQuotationsForCustomer,
  type CreateQuotationInput,
  type QuotationRow,
  type QuotationSummary
} from "./quotations.js";
import { createOmieClient, OmieSyncService } from "./omie-sync.js";
import {
  syncOmieMasterData,
  getLastSyncRun,
  getSyncEntitiesByRun,
  type OmieSyncResult,
  type SyncOmieMasterDataOptions
} from "./omie-master-sync.js";

export interface OmieLoopProgress {
  iteration: number;
  customersPulled: number;
  productsSynced: number;
  paymentTermsSynced: number;
  suppliersSynced: number;
  customersPage: number;
  productsPage: number;
  paymentTermsPage: number;
  inProgress: boolean;
  lastBatchCustomers: number;
  lastBatchProducts: number;
  lastBatchPaymentTerms: number;
  lastBatchSuppliers: number;
  lastUpdatedAt?: string | null;
}

export interface FiscalDocumentPrinter {
  printDocument: (documentUrl: string) => Promise<{ printed: boolean; error: string | null }>;
}
import {
  createToledoTcpAdapter,
  createVirtualScaleAdapter,
  type ToledoTcpAdapter,
  type ToledoTcpConfig,
  type ToledoTcpAdapterStatus,
  type ParsedToledoReading,
  type ScaleReading
} from "@kyberrock/scale-adapters";
import { discoverScale } from "./scale-discovery.js";
import {
  readScaleConfiguration,
  writeScaleConfiguration,
  type ScaleConnectionConfig,
  type ScaleConfiguration,
  type ScaleConfigurationInput
} from "./scale-configs.js";
import { ScaleCaptureService, type ScaleCaptureOperationType } from "./scale-capture.js";
import {
  createCustomer,
  deleteCustomer,
  getCustomersByCarrier,
  updateCustomer,
  type CreateCustomerInput,
  type UpdateCustomerInput
} from "./customers.js";
import {
  addPriceTableItem,
  createPriceTable,
  deletePriceTable,
  linkCustomerToPriceTable,
  listPriceTableItems,
  listPriceTables,
  listCustomerLinks,
  removePriceTableItem,
  unlinkCustomerFromPriceTable,
  updatePriceTableItem,
  updatePriceTableName,
  type AddPriceTableItemInput,
  type CreatePriceTableInput,
  type LinkCustomerToPriceTableInput,
  type UpdatePriceTableItemInput
} from "./price-tables.js";
import {
  createVehicle,
  deleteVehicle,
  findOrCreateVehicle,
  getVehicleCarriers,
  linkVehicleToCarrier,
  updateVehicle,
  type CreateVehicleInput,
  type UpdateVehicleInput
} from "./vehicles.js";
import {
  createDriver,
  deleteDriver,
  findOrCreateDriver,
  updateDriver,
  type CreateDriverInput,
  type UpdateDriverInput
} from "./drivers.js";
import {
  createCarrier,
  deleteCarrier,
  getCarrierVehicles,
  listCarriers,
  updateCarrier,
  type CarrierRow,
  type CreateCarrierInput,
  type UpdateCarrierInput
} from "./carriers.js";
import {
  linkCustomerCarrier,
  unlinkCustomerCarrier,
  listCarriersByCustomer,
  listCustomersByCarrier
} from "./customer-carriers.js";
import {
  linkDriverCarrier,
  unlinkDriverCarrier,
  listCarriersByDriver,
  listDriversByCarrier,
  listIndependentDrivers
} from "./driver-carriers.js";

export interface StartSimulatedWeighingInput {
  operationType: OperationType;
  customerName: string;
  plate: string;
  driverName: string;
  productDescription: string;
  paymentTermName?: string;
  unitPriceCents?: number;
}

export interface ScaleCaptureResult {
  captureId: string;
  reading: ScaleReading;
}

export class DesktopRuntime {
  private database: DesktopDatabase;
  private readonly paths: InitializedDesktopDatabase["paths"];
  private backupScheduler: BackupSchedulerHandle | null = null;
  private omieScheduler: OmieSchedulerHandle | null = null;
  private cloudSyncScheduler: CloudSyncSchedulerHandle | null = null;
  private cloudSyncInProgress = false;
  private receiptPrinter: ReceiptPrinter = { printReceipt: async () => undefined };
  private fiscalDocumentPrinter: FiscalDocumentPrinter = {
    printDocument: async () => ({ printed: false, error: null })
  };
  private cacheStore: CacheStore;
  private tcpScaleAdapter: ToledoTcpAdapter = createToledoTcpAdapter();
  private virtualScaleAdapter: ReturnType<typeof createVirtualScaleAdapter> = createVirtualScaleAdapter();
  private activeScaleAdapter: ToledoTcpAdapter = this.tcpScaleAdapter;
  private readonly pendingScaleCaptures = new Map<
    string,
    { operationType: ScaleCaptureOperationType; reading: ScaleReading; expiresAt: number }
  >();
  private reportService: ReportService;

  private constructor(initialized: InitializedDesktopDatabase) {
    this.database = initialized.database;
    this.paths = initialized.paths;
    this.cacheStore = new CacheStore(this.database);
    this.reportService = new ReportService(this.database);
    this.ensureIdentity();
    this.cacheStore.loadAll(this.ensureIdentity().companyId);
    initializeSupabaseFromSettings(this.database);
  }

  static initialize(baseDirectory?: string): DesktopRuntime {
    return new DesktopRuntime(initializeDesktopDatabase(baseDirectory));
  }

  getStatus(internetOnline?: boolean): DesktopStatusSnapshot {
    return getDesktopStatusSnapshot(this.database, {
      databasePath: this.paths.databasePath,
      internetOnline,
      cloudInitialized: isSupabaseInitialized(),
      cloudReachable: isSupabaseInitialized()
    });
  }

  async runAutomaticBackup(now: Date = new Date()): Promise<BackupResult> {
    const identity = this.ensureIdentity();
    const backup = await createAutomaticBackup({
      database: this.database,
      databasePath: this.paths.databasePath,
      backupDirectory: this.paths.backupDirectory,
      unitId: identity.unitId,
      now
    });

    recordLastBackupAt(this.database, now);

    return backup;
  }

  async exportBackup(destinationPath: string): Promise<BackupResult> {
    const backup = await exportManualBackup(this.database, destinationPath);
    recordLastBackupAt(this.database, new Date(backup.createdAt));
    return backup;
  }

  restoreFromBackup(backupPath: string): void {
    this.database.close();
    restoreBackup(backupPath, this.paths.databasePath);
    this.database = openDesktopDatabase({ databasePath: this.paths.databasePath });
    runDesktopMigrations(this.database);
    this.ensureIdentity();
  }

  startAutomaticBackupScheduler(
    options: Partial<StartDailyBackupSchedulerOptions> = {}
  ): BackupSchedulerHandle {
    this.backupScheduler?.stop();
    this.backupScheduler = startDailyBackupScheduler({
      getLastBackupAt: () => this.getStatus().lastBackupAt,
      runBackup: () => this.runAutomaticBackup().then(() => undefined),
      onError: (error) => console.error("Automatic backup failed", error),
      ...options
    });

    return this.backupScheduler;
  }

  startOmiePullScheduler(): OmieSchedulerHandle {
    this.omieScheduler?.stop();
    this.omieScheduler = startOmiePullScheduler({
      getConfig: () => readOmieSchedulerConfig(this.database),
      getLastPullAt: () => readOmiePullLastRunAt(this.database),
      setLastPullAt: (isoString) => recordOmiePullRanAt(this.database, isoString),
      isPullInProgress: () => readOmiePullState(this.database).inProgress,
      runPull: async () => {
        await this.runOmieDataEntryLoop({ maxIterations: 200 });
      },
      onError: (error) => console.error("Pull OMIE automatico falhou", error)
    });

    return this.omieScheduler;
  }

  stopOmiePullScheduler(): void {
    this.omieScheduler?.stop();
    this.omieScheduler = null;
  }

  startCloudSyncScheduler(): CloudSyncSchedulerHandle {
    this.cloudSyncScheduler?.stop();
    this.cloudSyncScheduler = startCloudSyncScheduler({
      getConfig: () => readCloudSyncConfig(this.database),
      getLastRunAt: () => readCloudSyncLastRunAt(this.database),
      setLastRunAt: (isoString) => recordCloudSyncRanAt(this.database, isoString),
      isSyncInProgress: () => this.cloudSyncInProgress,
      runSync: async () => {
        await this.syncCloudNow();
      },
      onError: (error) => console.error("Sincronizacao cloud automatica falhou", error)
    });

    return this.cloudSyncScheduler;
  }

  stopCloudSyncScheduler(): void {
    this.cloudSyncScheduler?.stop();
    this.cloudSyncScheduler = null;
  }

  getCloudSyncSchedulerStatus(): CloudSyncSchedulerStatus {
    const config = readCloudSyncConfig(this.database);
    const lastRunAt = readCloudSyncLastRunAt(this.database);
    return {
      ...config,
      lastRunAt,
      nextRunAt: computeNextCloudSyncAt(config, lastRunAt)
    };
  }

  setCloudSyncConfig(config: Partial<CloudSyncConfig>): CloudSyncSchedulerStatus {
    writeCloudSyncConfig(this.database, config);
    if (this.cloudSyncScheduler) {
      this.startCloudSyncScheduler();
    }
    return this.getCloudSyncSchedulerStatus();
  }

  getOmieSchedulerStatus(): OmieSchedulerStatus {
    const config = readOmieSchedulerConfig(this.database);
    const lastPullAt = readOmiePullLastRunAt(this.database);
    return {
      ...config,
      lastPullAt,
      nextPullAt: computeNextPullAt(config, lastPullAt)
    };
  }

  setOmieSchedulerConfig(config: Partial<OmieSchedulerConfig>): OmieSchedulerStatus {
    writeOmieSchedulerConfig(this.database, config);
    if (this.omieScheduler) {
      this.startOmiePullScheduler();
    }
    return this.getOmieSchedulerStatus();
  }

  setReceiptPrinter(receiptPrinter: ReceiptPrinter): void {
    this.receiptPrinter = receiptPrinter;
  }

  setFiscalDocumentPrinter(fiscalDocumentPrinter: FiscalDocumentPrinter): void {
    this.fiscalDocumentPrinter = fiscalDocumentPrinter;
  }

  async startWeighing(input: {
    operationType?: OperationType;
    customerId: string;
    vehicleId: string;
    carrierId?: string;
    driverId: string;
    productId: string;
    paymentTermId?: string;
    manualInstallments?: number;
    freight?: OperationFreightInput | null;
    quotationId?: string;
    deductFreightFromCredit?: boolean;
    scaleCaptureId?: string;
  }): Promise<WeighingOperationSummary> {
    this.assertDesktopAccess();
    const entryReading =
      this.consumeScaleCapture(input.scaleCaptureId, "entry") ??
      (await this.captureStableWeight({ operationType: "entry" }));

    return createWeighingOperation(this.database, {
      identity: this.ensureIdentity(),
      operationType: input.operationType,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      carrierId: input.carrierId,
      driverId: input.driverId,
      productId: input.productId,
      paymentTermId: input.paymentTermId,
      manualInstallments: input.manualInstallments,
      freight: input.freight,
      quotationId: input.quotationId,
      deductFreightFromCredit: input.deductFreightFromCredit,
      entryWeightKg: entryReading.weightKg,
      entryScaleCapture: buildScaleCaptureAudit(entryReading)
    });
  }

  async closeWeighing(
    operationId: string,
    operationType?: OperationType,
    scaleCaptureId?: string
  ): Promise<WeighingOperationSummary> {
    this.assertDesktopAccess();
    if (
      operationType !== undefined &&
      operationType !== "invoice" &&
      operationType !== "internal"
    ) {
      throw new Error("Invalid operation type.");
    }

    const exitReading =
      this.consumeScaleCapture(scaleCaptureId, "exit") ??
      (await this.captureStableWeight({ operationType: "exit" }));

    return closeWeighingOperation(this.database, {
      operationId,
      exitWeightKg: exitReading.weightKg,
      operationType,
      exitScaleCapture: buildScaleCaptureAudit(exitReading)
    });
  }

  private async captureStableWeight(options: {
    operationType: ScaleCaptureOperationType;
    timeoutMs?: number;
  }): Promise<ScaleReading> {
    const scaleConfig = this.getScaleConfiguration();

    // Attempt auto-reconnect if not connected
    const status = this.activeScaleAdapter.getStatus();
    if (status.state !== "connected") {
      const reconnected = await this.tryAutoConnectScale();
      if (!reconnected) {
        const message =
          "Balanca nao esta conectada. Verifique as configuracoes de conexao em Configuracoes > Balanca.";
        this.recordTechnicalLog("error", "scale-capture", message, {
          operationType: options.operationType,
          adapterType: scaleConfig.adapterType,
          state: status.state
        });
        throw new Error(message);
      }
    }

    try {
      const captureService = new ScaleCaptureService({
        adapter: this.activeScaleAdapter,
        stability: scaleConfig.stability,
        adapterName: scaleConfig.adapterType === "virtual" ? "virtual" : scaleConfig.model,
        deviceId: scaleConfig.id ?? this.ensureIdentity().deviceId
      });
      return await captureService.captureStableWeight({
        operationType: options.operationType,
        timeoutMs: options.timeoutMs
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "falha desconhecida";
      this.recordTechnicalLog("error", "scale-capture", message, {
        operationType: options.operationType,
        adapterType: scaleConfig.adapterType,
        connection: redactScaleConnection(scaleConfig.connection),
        status: this.activeScaleAdapter.getStatus()
      });
      throw new Error(
        `Nao foi possivel capturar peso ${options.operationType === "entry" ? "de entrada" : "de saida"}: ${message}`
      );
    }
  }

  async captureStableScaleWeight(options: {
    operationType: ScaleCaptureOperationType;
    timeoutMs?: number;
  }): Promise<ScaleCaptureResult> {
    this.assertDesktopAccess();
    const reading = await this.captureStableWeight(options);
    const captureId = randomUUID();
    this.pendingScaleCaptures.set(captureId, {
      operationType: options.operationType,
      reading,
      expiresAt: Date.now() + 30_000
    });
    this.pruneExpiredScaleCaptures();
    return { captureId, reading };
  }

  private consumeScaleCapture(
    captureId: string | undefined,
    operationType: ScaleCaptureOperationType
  ): ScaleReading | null {
    if (!captureId) return null;
    const capture = this.pendingScaleCaptures.get(captureId);
    this.pendingScaleCaptures.delete(captureId);

    if (!capture) {
      throw new Error("Captura de peso nao encontrada ou ja utilizada. Capture o peso novamente.");
    }
    if (capture.operationType !== operationType) {
      throw new Error("Captura de peso nao pertence a este tipo de operacao.");
    }
    if (capture.expiresAt < Date.now()) {
      throw new Error("Captura de peso expirada. Capture o peso novamente.");
    }
    return capture.reading;
  }

  private pruneExpiredScaleCaptures(): void {
    const now = Date.now();
    for (const [captureId, capture] of this.pendingScaleCaptures.entries()) {
      if (capture.expiresAt < now) {
        this.pendingScaleCaptures.delete(captureId);
      }
    }
  }

  cancelWeighing(operationId: string, reason: string): WeighingOperationSummary {
    this.assertDesktopAccess();
    return cancelWeighingOperation(this.database, { operationId, reason });
  }

  listOpenWeighingOperations(): WeighingOperationSummary[] {
    this.assertDesktopAccess();
    return listOpenWeighingOperations(this.database);
  }

  listCanceledWeighingOperations(): WeighingOperationSummary[] {
    this.assertDesktopAccess();
    return listCanceledWeighingOperations(this.database);
  }

  listClosedWeighingOperations(): WeighingOperationSummary[] {
    this.assertDesktopAccess();
    return listClosedWeighingOperations(this.database);
  }

  clearCanceledWeighingOperations(): number {
    this.assertDesktopAccess();
    return clearCanceledWeighingOperations(this.database);
  }

  configureReceiptPrintProfile(
    input: Omit<ConfigureReceiptPrintProfileInput, "identity">
  ): PrintProfileSummary {
    this.assertDesktopAccess();
    return configureReceiptPrintProfile(this.database, {
      ...input,
      identity: this.ensureIdentity()
    });
  }

  listPrintProfiles(): PrintProfileSummary[] {
    this.assertDesktopAccess();
    return listPrintProfiles(this.database);
  }

  listPrintReceipts(): PrintReceiptSummary[] {
    this.assertDesktopAccess();
    return listPrintReceipts(this.database);
  }

  printReceipt(operationId: string): Promise<PrintReceiptSummary> {
    this.assertDesktopAccess();
    return printWeighingReceipt(
      this.database,
      { operationId, identity: this.ensureIdentity() },
      this.receiptPrinter
    );
  }

  reprintReceipt(receiptId: string): Promise<PrintReceiptSummary> {
    this.assertDesktopAccess();
    return reprintWeighingReceipt(
      this.database,
      { receiptId, identity: this.ensureIdentity() },
      this.receiptPrinter
    );
  }

  printTestReceipt(): Promise<PrintReceiptSummary> {
    this.assertDesktopAccess();
    return printTestReceipt(
      this.database,
      { identity: this.ensureIdentity() },
      this.receiptPrinter
    );
  }

  processFiscalBilling(operationId: string): Promise<FiscalBillingResult> {
    this.assertDesktopAccess();
    return processFiscalBillingNow(
      this.database,
      this.ensureIdentity(),
      operationId,
      (documentUrl) => this.fiscalDocumentPrinter.printDocument(documentUrl)
    );
  }

  async syncToCloud(): Promise<SyncResult> {
    return this.syncCloudNow();
  }

  async syncCloudNow(): Promise<SyncResult> {
    this.assertDesktopAccess();
    if (this.cloudSyncInProgress) {
      return {
        success: true,
        synced: 0,
        failed: 0,
        errors: ["Sincronizacao cloud ja em andamento."]
      };
    }

    this.cloudSyncInProgress = true;
    const identity = this.ensureIdentity();
    const errors: string[] = [];
    let synced = 0;
    let failed = 0;

    try {
      initializeSupabaseFromSettings(this.database);
      if (!isSupabaseInitialized()) {
        return {
          success: false,
          synced: 0,
          failed: 0,
          errors: [
            "Supabase nao configurado. Defina SUPABASE_PUBLISHABLE_KEY na pedreira no admin (loader-web) e reative o desktop."
          ]
        };
      }

      const queue = await processCloudSyncQueue(this.database, identity);
      synced += queue.processed;
      failed += queue.failed;
      errors.push(...queue.errors);

      // Sync open operations
      const openOperations = listOpenWeighingOperations(this.database);
      for (const operation of openOperations) {
        try {
          await syncOperationToSupabase(this.database, operation.id, identity);
          synced++;
        } catch (error) {
          failed++;
          errors.push(
            `Operation ${operation.id}: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }
      }

      // Sync loading requests
      const loadingRequests = this.database
        .prepare("SELECT id FROM loading_requests WHERE status = 'open'")
        .all() as Array<{ id: string }>;

      for (const request of loadingRequests) {
        try {
          await syncLoadingRequestToSupabase(this.database, request.id, identity);
          synced++;
        } catch (error) {
          failed++;
          errors.push(
            `Loading request ${request.id}: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }
      }

      // Pull company price_change_password from cloud
      try {
        await pullCompanyPricePasswordFromCloud(this.database, identity);
      } catch (error) {
        errors.push(
          `Price password pull: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }

      // Sync junction tables to cloud
      try {
        const ccResult = await syncCustomerCarriersToCloud(this.database, identity);
        synced += ccResult.synced;
        errors.push(...ccResult.errors);
      } catch (error) {
        errors.push(
          `Customer carriers sync: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }

      try {
        const dcResult = await syncDriverCarriersToCloud(this.database, identity);
        synced += dcResult.synced;
        errors.push(...dcResult.errors);
      } catch (error) {
        errors.push(
          `Driver carriers sync: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }

      // Pull junction tables from cloud
      try {
        const ccPull = await pullCustomerCarriersFromCloud(this.database, identity);
        synced += ccPull.pulled;
        errors.push(...ccPull.errors);
      } catch (error) {
        errors.push(
          `Customer carriers pull: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }

      try {
        const dcPull = await pullDriverCarriersFromCloud(this.database, identity);
        synced += dcPull.pulled;
        errors.push(...dcPull.errors);
      } catch (error) {
        errors.push(
          `Driver carriers pull: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }

      // Pull loader completions from cloud so the desktop knows when the
      // loader marked a loading_request as completed via the loader-web.
      try {
        const lcPull = await pullLoaderCompletionsFromCloud(this.database, identity);
        synced += lcPull.pulled;
        errors.push(...lcPull.errors);
      } catch (error) {
        errors.push(
          `Loader completions pull: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }

      recordCloudSyncRanAt(this.database);
      return { success: failed === 0, synced, failed, errors };
    } catch (error) {
      return {
        success: false,
        synced,
        failed,
        errors: [...errors, error instanceof Error ? error.message : "Cloud synchronization failed"]
      };
    } finally {
      this.cloudSyncInProgress = false;
    }
  }

  async probeCloudConnectivity(): Promise<{
    internetOnline: boolean;
    cloudReachable: boolean;
    omieReachable: boolean;
  }> {
    const [internet, supabaseReachable, omie] = await Promise.all([
      probeInternet(),
      pingSupabase(),
      probeOmie()
    ]);
    return {
      internetOnline: internet.online,
      cloudReachable: supabaseReachable,
      omieReachable: omie.online
    };
  }

  async getCloudStatus(): Promise<{ totalOperations: number; lastSync: string | null }> {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = await getSupabaseSyncStatus(identity.companyId);
    const lastRunAt = readCloudSyncLastRunAt(this.database);
    return {
      totalOperations: result.totalOperations,
      lastSync: lastRunAt ?? result.lastSync
    };
  }

  isCloudConnected(): boolean {
    return isSupabaseInitialized();
  }

  async connectScale(config: ToledoTcpConfig): Promise<void> {
    const scaleConfig = this.getScaleConfiguration();
    this.activateAdapter(scaleConfig.adapterType);
    this.activeScaleAdapter.removeAllListeners();
    await this.activeScaleAdapter.connect(config);
  }

  private activateAdapter(adapterType: "tcp" | "virtual"): void {
    this.tcpScaleAdapter.disconnect();
    this.virtualScaleAdapter.disconnect();
    this.activeScaleAdapter =
      adapterType === "virtual" ? this.virtualScaleAdapter : this.tcpScaleAdapter;
  }

  async virtualScaleSetWeight(weightKg: number): Promise<void> {
    const scaleConfig = this.getScaleConfiguration();
    if (scaleConfig.adapterType !== "virtual") {
      throw new Error("Modo virtual nao esta ativo. Altere a configuracao da balanca.");
    }
    this.virtualScaleAdapter.setWeight(weightKg);
  }

  async tryAutoConnectScale(): Promise<boolean> {
    try {
      const scaleConfig = this.getScaleConfiguration();
      if (!scaleConfig.id) return false;
      this.activateAdapter(scaleConfig.adapterType);
      this.activeScaleAdapter.removeAllListeners();
      await this.activeScaleAdapter.connect({
        host: scaleConfig.connection.host,
        port: scaleConfig.connection.port,
        timeoutMs: scaleConfig.connection.timeoutMs,
        reconnectIntervalMs: scaleConfig.connection.reconnectIntervalMs,
        maxReconnectAttempts: scaleConfig.connection.maxReconnectAttempts
      });
      return true;
    } catch {
      return false;
    }
  }

  disconnectScale(): void {
    this.tcpScaleAdapter.disconnect();
    this.virtualScaleAdapter.disconnect();
  }

  async readScale(): Promise<ScaleReading> {
    return this.activeScaleAdapter.read();
  }

  async readScaleSampled(): Promise<ScaleReading> {
    return this.captureStableWeight({ operationType: "entry" });
  }

  async discoverScale(): Promise<{ host: string; port: number } | null> {
    const result = await discoverScale();
    if (!result) return null;
    return { host: result.host, port: result.port };
  }

  getScaleStatus(): ToledoTcpAdapterStatus {
    return this.activeScaleAdapter.getStatus();
  }

  getScaleConfiguration(): ScaleConfiguration {
    return readScaleConfiguration(this.database, this.ensureIdentity());
  }

  saveScaleConfiguration(input: ScaleConfigurationInput): ScaleConfiguration {
    return writeScaleConfiguration(this.database, this.ensureIdentity(), input);
  }

  onScaleReading(callback: (reading: ParsedToledoReading) => void): () => void {
    return this.activeScaleAdapter.onReading(callback);
  }

  verifyPriceChangePassword(password: string): boolean {
    const identity = this.ensureIdentity();
    const row = this.database
      .prepare("SELECT price_change_password FROM companies WHERE id = ?")
      .get(identity.companyId) as { price_change_password: string } | undefined;
    return row ? row.price_change_password === password : false;
  }

  close(): void {
    this.backupScheduler?.stop();
    this.backupScheduler = null;
    this.cloudSyncScheduler?.stop();
    this.cloudSyncScheduler = null;
    this.omieScheduler?.stop();
    this.omieScheduler = null;
    this.database.close();
  }

  getDesktopAccessStatus(): DesktopAccessStatus {
    return getStoredDesktopAccessStatus(this.database);
  }

  async validateDesktopAccess(
    internetOnline?: boolean,
    force?: boolean
  ): Promise<DesktopAccessStatus> {
    const status = await validateDesktopAccess(this.database, { internetOnline, force });
    return status;
  }

  async activateDesktop(input: ActivateDesktopInput): Promise<DesktopAccessStatus> {
    return activateDesktop(this.database, input);
  }

  logoutDesktop(): void {
    logoutDesktop(this.database);
  }

  queryCache(options: CacheQueryOptions): CacheQueryResult<unknown> {
    return this.cacheStore.query(options);
  }

  getDailyReport(date: string): ReturnType<ReportService["getDailyReport"]> {
    return this.reportService.getDailyReport(date, this.ensureIdentity().unitId);
  }

  getMonthlyReport(year: number, month: number): ReturnType<ReportService["getMonthlyReport"]> {
    return this.reportService.getMonthlyReport(year, month, this.ensureIdentity().unitId);
  }

  getReportByProduct(
    startDate: string,
    endDate: string,
    limit?: number
  ): ReturnType<ReportService["getReportByProduct"]> {
    const all = this.reportService.getReportByProduct(
      startDate,
      endDate,
      this.ensureIdentity().unitId
    );
    return typeof limit === "number" ? all.slice(0, limit) : all;
  }

  getReportByCustomer(
    startDate: string,
    endDate: string,
    limit?: number
  ): ReturnType<ReportService["getReportByCustomer"]> {
    const all = this.reportService.getReportByCustomer(
      startDate,
      endDate,
      this.ensureIdentity().unitId
    );
    return typeof limit === "number" ? all.slice(0, limit) : all;
  }

  getDailySeries(startDate: string, endDate: string): ReturnType<ReportService["getDailySeries"]> {
    return this.reportService.getDailySeries(startDate, endDate, this.ensureIdentity().unitId);
  }

  getOperationMix(
    startDate: string,
    endDate: string
  ): ReturnType<ReportService["getOperationMix"]> {
    return this.reportService.getOperationMix(startDate, endDate, this.ensureIdentity().unitId);
  }

  getReportHtml(startDate: string, endDate: string): string {
    return this.reportService.exportRangeToHtml(
      startDate,
      endDate,
      this.ensureIdentity().unitId
    );
  }

  listReportRecipients(): ReportRecipient[] {
    return listReportRecipients(this.database, this.ensureIdentity().companyId);
  }

  createReportRecipient(input: Omit<CreateReportRecipientInput, "companyId">): ReportRecipient {
    return createReportRecipient(this.database, {
      companyId: this.ensureIdentity().companyId,
      ...input
    });
  }

  updateReportRecipient(id: string, input: UpdateReportRecipientInput): ReportRecipient {
    return updateReportRecipient(this.database, id, input);
  }

  deleteReportRecipient(id: string): void {
    deleteReportRecipient(this.database, id);
  }

  getPriceForCustomerProduct(customerId: string, productId: string): number | null {
    return new PricingService(this.database).getPriceForCustomerProduct(customerId, productId);
  }

  getPriceDetailsForCustomerProduct(customerId: string, productId: string): PriceDetails | null {
    return new PricingService(this.database).getPriceDetailsForCustomerProduct(
      customerId,
      productId
    );
  }

  listProductDefaultPrices(): ProductDefaultPriceSummary[] {
    this.assertDesktopAccess();
    return listProductDefaultPriceSummaries(this.database, this.ensureIdentity().companyId);
  }

  upsertProductDefaultPrice(input: {
    productId: string;
    unitPriceCents: number;
    unit?: string;
  }): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = upsertProductDefaultPrice(this.database, {
      ...input,
      companyId: identity.companyId
    });
    this.cacheStore.invalidate("product", identity.companyId);
    return result;
  }

  listCustomerSpecialPrices(customerId: string): CustomerSpecialPriceSummary[] {
    this.assertDesktopAccess();
    return listCustomerSpecialPrices(this.database, customerId);
  }

  setCustomerSpecialPrice(input: {
    customerId: string;
    productId: string;
    unitPriceCents: number;
    unit?: string;
  }): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    return setCustomerSpecialPrice(this.database, {
      ...input,
      companyId: identity.companyId
    });
  }

  removeCustomerSpecialPrice(customerId: string, productId: string): void {
    this.assertDesktopAccess();
    removeCustomerSpecialPrice(this.database, customerId, productId);
  }

  getCustomerCreditBalance(customerId: string): number {
    this.assertDesktopAccess();
    return new CreditService(this.database).getBalance(customerId);
  }

  listCustomerCreditMovements(customerId: string, limit?: number): CreditMovementRow[] {
    this.assertDesktopAccess();
    return new CreditService(this.database).listMovements(customerId, limit ?? 100);
  }

  createQuotation(input: Omit<CreateQuotationInput, "companyId">): QuotationRow {
    this.assertDesktopAccess();
    return createQuotation(this.database, {
      ...input,
      companyId: this.ensureIdentity().companyId
    });
  }

  cancelQuotation(id: string): void {
    this.assertDesktopAccess();
    cancelQuotation(this.database, id);
  }

  listOpenQuotationsForCustomer(customerId: string): QuotationSummary[] {
    this.assertDesktopAccess();
    return listOpenQuotationsForCustomer(this.database, customerId);
  }

  invalidateCache(entityType: CacheQueryOptions["entityType"]): void {
    const identity = this.ensureIdentity();
    this.cacheStore.invalidate(entityType, identity.companyId);
  }

  createCustomer(input: Omit<CreateCustomerInput, "companyId">): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = createCustomer(this.database, {
      ...input,
      companyId: identity.companyId
    });
    this.cacheStore.invalidate("customer", identity.companyId);
    this.cacheStore.invalidate("carrier", identity.companyId);
    return result;
  }

  updateCustomer(id: string, input: UpdateCustomerInput): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = updateCustomer(this.database, id, input);
    this.cacheStore.invalidate("customer", identity.companyId);
    this.cacheStore.invalidate("carrier", identity.companyId);
    return result;
  }

  deleteCustomer(id: string): void {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    deleteCustomer(this.database, id);
    this.cacheStore.invalidate("customer", identity.companyId);
  }

  createPriceTable(input: Omit<CreatePriceTableInput, "companyId">): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = createPriceTable(this.database, { ...input, companyId: identity.companyId });
    this.cacheStore.invalidate("price_table", identity.companyId);
    return result;
  }

  updatePriceTableName(id: string, name: string): unknown {
    this.assertDesktopAccess();
    const result = updatePriceTableName(this.database, id, name);
    this.cacheStore.invalidate("price_table", this.ensureIdentity().companyId);
    return result;
  }

  deletePriceTable(id: string): void {
    this.assertDesktopAccess();
    deletePriceTable(this.database, id);
    this.cacheStore.invalidate("price_table", this.ensureIdentity().companyId);
  }

  addPriceTableItem(input: AddPriceTableItemInput): unknown {
    this.assertDesktopAccess();
    const result = addPriceTableItem(this.database, input);
    this.cacheStore.invalidate("price_table_item", this.ensureIdentity().companyId);
    return result;
  }

  updatePriceTableItem(id: string, input: UpdatePriceTableItemInput): unknown {
    this.assertDesktopAccess();
    const result = updatePriceTableItem(this.database, id, input);
    this.cacheStore.invalidate("price_table_item", this.ensureIdentity().companyId);
    return result;
  }

  removePriceTableItem(id: string): void {
    this.assertDesktopAccess();
    removePriceTableItem(this.database, id);
    this.cacheStore.invalidate("price_table_item", this.ensureIdentity().companyId);
  }

  linkCustomerToPriceTable(input: LinkCustomerToPriceTableInput): unknown {
    this.assertDesktopAccess();
    const result = linkCustomerToPriceTable(this.database, input);
    this.cacheStore.invalidate("customer_price_table", this.ensureIdentity().companyId);
    return result;
  }

  unlinkCustomerFromPriceTable(linkId: string): void {
    this.assertDesktopAccess();
    unlinkCustomerFromPriceTable(this.database, linkId);
    this.cacheStore.invalidate("customer_price_table", this.ensureIdentity().companyId);
  }

  listPriceTables(): unknown[] {
    this.assertDesktopAccess();
    return listPriceTables(this.database, this.ensureIdentity().companyId);
  }

  listPriceTableItems(priceTableId: string): unknown[] {
    this.assertDesktopAccess();
    return listPriceTableItems(this.database, priceTableId);
  }

  listCustomerLinks(priceTableId: string): unknown[] {
    this.assertDesktopAccess();
    return listCustomerLinks(this.database, priceTableId);
  }

  createVehicle(input: Omit<CreateVehicleInput, "companyId">): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = createVehicle(this.database, { ...input, companyId: identity.companyId });
    this.cacheStore.invalidate("vehicle", identity.companyId);
    return result;
  }

  updateVehicle(id: string, input: UpdateVehicleInput): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = updateVehicle(this.database, id, input);
    this.cacheStore.invalidate("vehicle", identity.companyId);
    return result;
  }

  deleteVehicle(id: string): void {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    deleteVehicle(this.database, id);
    this.cacheStore.invalidate("vehicle", identity.companyId);
  }

  findOrCreateVehicle(plate: string): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = findOrCreateVehicle(this.database, identity.companyId, plate);
    this.cacheStore.invalidate("vehicle", identity.companyId);
    return result;
  }

  getVehicleCarriers(
    vehicleId: string
  ): Array<{ carrierId: string; carrierName: string; carrierDocument: string | null }> {
    return getVehicleCarriers(this.database, vehicleId);
  }

  linkVehicleToCarrier(vehicleId: string, carrierId: string): unknown {
    this.assertDesktopAccess();
    const result = linkVehicleToCarrier(this.database, vehicleId, carrierId);
    this.cacheStore.invalidate("vehicle", this.ensureIdentity().companyId);
    return result;
  }

  getCustomersByCarrier(carrierId: string): unknown[] {
    return getCustomersByCarrier(this.database, carrierId);
  }

  createDriver(input: Omit<CreateDriverInput, "companyId">): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = createDriver(this.database, { ...input, companyId: identity.companyId });
    this.cacheStore.invalidate("driver", identity.companyId);
    return result;
  }

  updateDriver(id: string, input: UpdateDriverInput): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = updateDriver(this.database, id, input);
    this.cacheStore.invalidate("driver", identity.companyId);
    return result;
  }

  deleteDriver(id: string): void {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    deleteDriver(this.database, id);
    this.cacheStore.invalidate("driver", identity.companyId);
  }

  findOrCreateDriver(name: string): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = findOrCreateDriver(this.database, identity.companyId, name);
    this.cacheStore.invalidate("driver", identity.companyId);
    return result;
  }

  createCarrier(input: Omit<CreateCarrierInput, "companyId">): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = createCarrier(this.database, { ...input, companyId: identity.companyId });
    this.cacheStore.invalidate("carrier", identity.companyId);
    return result;
  }

  updateCarrier(id: string, input: UpdateCarrierInput): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = updateCarrier(this.database, id, input);
    this.cacheStore.invalidate("carrier", identity.companyId);
    return result;
  }

  deleteCarrier(id: string): void {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    deleteCarrier(this.database, id);
    this.cacheStore.invalidate("carrier", identity.companyId);
  }

  listCarriers(): CarrierRow[] {
    const identity = this.ensureIdentity();
    return listCarriers(this.database, identity.companyId);
  }

  getCarrierVehicles(
    carrierId: string
  ): Array<{ id: string; plate: string; description: string | null }> {
    return getCarrierVehicles(this.database, carrierId);
  }

  linkCustomerCarrier(customerId: string, carrierId: string): unknown {
    this.assertDesktopAccess();
    return linkCustomerCarrier(this.database, customerId, carrierId);
  }

  unlinkCustomerCarrier(customerId: string, carrierId: string): void {
    this.assertDesktopAccess();
    unlinkCustomerCarrier(this.database, customerId, carrierId);
  }

  listCarriersByCustomer(customerId: string): Array<{ id: string; name: string; document: string | null }> {
    return listCarriersByCustomer(this.database, customerId);
  }

  listCustomersByCarrier(carrierId: string): Array<{ id: string; trade_name: string; legal_name: string }> {
    return listCustomersByCarrier(this.database, carrierId);
  }

  linkDriverCarrier(driverId: string, carrierId: string): unknown {
    this.assertDesktopAccess();
    return linkDriverCarrier(this.database, driverId, carrierId);
  }

  unlinkDriverCarrier(driverId: string, carrierId: string): void {
    this.assertDesktopAccess();
    unlinkDriverCarrier(this.database, driverId, carrierId);
  }

  listCarriersByDriver(driverId: string): Array<{ id: string; name: string; document: string | null }> {
    return listCarriersByDriver(this.database, driverId);
  }

  listDriversByCarrier(carrierId: string): Array<{ id: string; name: string; document: string | null; is_independent: number }> {
    return listDriversByCarrier(this.database, carrierId);
  }

  listIndependentDrivers(): Array<{ id: string; name: string; document: string | null }> {
    const identity = this.ensureIdentity();
    return listIndependentDrivers(this.database, identity.companyId);
  }

  getOmieSyncStatus(): {
    configured: boolean;
    appKeyMasked: string | null;
    hasSyncedData: boolean;
    totalCustomers: number;
    totalProducts: number;
    totalPaymentTerms: number;
    pendingPushCustomers: number;
    pendingOmieJobs: number;
    lastSyncAt: string | null;
  } {
    const identity = this.ensureIdentity();

    const totalCustomers = this.database
      .prepare(
        "SELECT COUNT(*) FROM customers WHERE company_id = ? AND deleted_at IS NULL AND source = 'omie'"
      )
      .pluck()
      .get(identity.companyId) as number;

    const totalProducts = this.database
      .prepare(
        "SELECT COUNT(*) FROM products WHERE company_id = ? AND deleted_at IS NULL AND omie_product_id IS NOT NULL"
      )
      .pluck()
      .get(identity.companyId) as number;

    const totalPaymentTerms = this.database
      .prepare(
        "SELECT COUNT(*) FROM payment_terms WHERE company_id = ? AND deleted_at IS NULL AND omie_code IS NOT NULL"
      )
      .pluck()
      .get(identity.companyId) as number;

    const pendingPushCustomers = this.database
      .prepare(
        "SELECT COUNT(*) FROM customers WHERE company_id = ? AND deleted_at IS NULL AND needs_push = 1"
      )
      .pluck()
      .get(identity.companyId) as number;

    const pendingOmieJobs = this.database
      .prepare(
        "SELECT COUNT(*) FROM sync_queue WHERE target = 'omie' AND status IN ('pending', 'failed')"
      )
      .pluck()
      .get() as number;

    const lastSync = this.database
      .prepare(
        "SELECT MAX(last_synced_at) FROM customers WHERE company_id = ? AND deleted_at IS NULL"
      )
      .pluck()
      .get(identity.companyId) as string | null;

    const config = this.getOmieConfig();
    const hasSyncedData = totalCustomers > 0 || totalProducts > 0 || totalPaymentTerms > 0;

    return {
      configured: config.configured,
      appKeyMasked: config.appKeyMasked,
      hasSyncedData,
      totalCustomers,
      totalProducts,
      totalPaymentTerms,
      pendingPushCustomers,
      pendingOmieJobs,
      lastSyncAt: lastSync
    };
  }

  getOmieConfig(): { configured: boolean; appKeyMasked: string | null } {
    return { configured: this.hasCloudCredentials(), appKeyMasked: null };
  }

  async syncOmieAll(): Promise<{
    customersPulled: number;
    customersPushed: number;
    productsSynced: number;
    paymentTermsSynced: number;
    suppliersSynced: number;
    ordersProcessed: number;
    ordersFailed: number;
    customersPushFailed: number;
    errors: string[];
  }> {
    initializeSupabaseFromSettings(this.database);
    if (!isSupabaseInitialized()) {
      return {
        customersPulled: 0,
        customersPushed: 0,
        productsSynced: 0,
        paymentTermsSynced: 0,
        suppliersSynced: 0,
        ordersProcessed: 0,
        ordersFailed: 0,
        customersPushFailed: 0,
        errors: [
          "Supabase nao configurado. Defina SUPABASE_PUBLISHABLE_KEY na pedreira no admin (loader-web) e reative o desktop."
        ]
      };
    }
    const identity = this.ensureIdentity();
    const loop = await this.runOmieDataEntryLoop({ reset: true, maxIterations: 200 });
    const customerPush = await pushOmieCustomersToCloud(this.database, identity);
    const finalLoop = await this.runOmieDataEntryLoop({ reset: true, maxIterations: 200 });
    const queue = await processOmieSyncQueue(this.database, identity);
    this.cacheStore.invalidateAll(identity.companyId);
    return {
      customersPulled: loop.customersPulled + finalLoop.customersPulled,
      customersPushed: customerPush.pushed,
      productsSynced: loop.productsSynced + finalLoop.productsSynced,
      paymentTermsSynced: loop.paymentTermsSynced + finalLoop.paymentTermsSynced,
      suppliersSynced: loop.suppliersSynced + finalLoop.suppliersSynced,
      ordersProcessed: queue.processed,
      ordersFailed: queue.failed,
      customersPushFailed: customerPush.failed,
      errors: customerPush.errors.concat(loop.errors, finalLoop.errors, queue.errors)
    };
  }

  async syncOmieDirect(appKey: string, appSecret: string): Promise<{
    customersPulled: number;
    customersPushed: number;
    productsSynced: number;
    paymentTermsSynced: number;
    suppliersSynced: number;
    errors: string[];
  }> {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const client = createOmieClient({ appKey, appSecret });
    const service = new OmieSyncService(client, this.database);
    const result = await service.syncAll(identity.companyId);
    this.cacheStore.invalidateAll(identity.companyId);
    return {
      customersPulled: result.customersPulled,
      customersPushed: result.customersPushed,
      productsSynced: result.productsSynced,
      paymentTermsSynced: result.paymentTermsSynced,
      suppliersSynced: result.suppliersSynced,
      errors: result.errors
    };
  }

  async syncOmieMasterData(options?: SyncOmieMasterDataOptions): Promise<OmieSyncResult> {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    return syncOmieMasterData(this.database, identity.companyId, options);
  }

  getLastOmieSyncRun(): ReturnType<typeof getLastSyncRun> {
    const identity = this.ensureIdentity();
    return getLastSyncRun(this.database, identity.companyId);
  }

  getOmieSyncEntitiesByRun(runId: string): ReturnType<typeof getSyncEntitiesByRun> {
    return getSyncEntitiesByRun(this.database, runId);
  }

  async runOmieDataEntryLoop(
    options: {
      reset?: boolean;
      maxIterations?: number;
      onProgress?: (progress: OmieLoopProgress) => void;
    } = {}
  ): Promise<{
    customersPulled: number;
    productsSynced: number;
    paymentTermsSynced: number;
    suppliersSynced: number;
    iterations: number;
    finished: boolean;
    errors: string[];
  }> {
    const identity = this.ensureIdentity();
    const maxIterations = options.maxIterations ?? 200;
    let customersPulled = 0;
    let productsSynced = 0;
    let paymentTermsSynced = 0;
    let suppliersSynced = 0;
    const errors: string[] = [];
    let iterations = 0;

    if (options.reset) {
      writeOmiePullState(this.database, {
        customersPage: 1,
        productsPage: 1,
        paymentTermsPage: 1,
        inProgress: true
      });
    }

    while (iterations < maxIterations) {
      const before = readOmiePullState(this.database);
      const result = await syncOmieReferenceDataFromCloud(this.database, identity);
      const after = readOmiePullState(this.database);
      iterations += 1;
      customersPulled += result.customersPulled;
      productsSynced += result.productsSynced;
      paymentTermsSynced += result.paymentTermsSynced;
      suppliersSynced += result.suppliersSynced;
      errors.push(...result.errors);

      const progress: OmieLoopProgress = {
        iteration: iterations,
        customersPulled,
        productsSynced,
        paymentTermsSynced,
        suppliersSynced,
        customersPage: after.customersPage,
        productsPage: after.productsPage,
        paymentTermsPage: after.paymentTermsPage,
        inProgress: after.inProgress,
        lastBatchCustomers: result.customersPulled,
        lastBatchProducts: result.productsSynced,
        lastBatchPaymentTerms: result.paymentTermsSynced,
        lastBatchSuppliers: result.suppliersSynced
      };
      options.onProgress?.(progress);

      const totalBefore = before.customersPage + before.productsPage + before.paymentTermsPage;
      const totalAfter = after.customersPage + after.productsPage + after.paymentTermsPage;
      const noProgress =
        totalAfter <= totalBefore &&
        result.customersPulled + result.productsSynced + result.paymentTermsSynced + result.suppliersSynced === 0;
      if (noProgress || !after.inProgress) {
        writeOmiePullState(this.database, { inProgress: false });
        this.cacheStore.invalidateAll(identity.companyId);
        return {
          customersPulled,
          productsSynced,
          paymentTermsSynced,
          suppliersSynced,
          iterations,
          finished: !after.inProgress,
          errors
        };
      }
    }

    this.cacheStore.invalidateAll(identity.companyId);
    return {
      customersPulled,
      productsSynced,
      paymentTermsSynced,
      suppliersSynced,
      iterations,
      finished: false,
      errors
    };
  }

  getOmieLoopStatus(): OmieLoopProgress | null {
    const state = readOmiePullState(this.database);
    return {
      iteration: 0,
      customersPulled: 0,
      productsSynced: 0,
      paymentTermsSynced: 0,
      suppliersSynced: 0,
      customersPage: state.customersPage,
      productsPage: state.productsPage,
      paymentTermsPage: state.paymentTermsPage,
      inProgress: state.inProgress,
      lastBatchCustomers: 0,
      lastBatchProducts: 0,
      lastBatchPaymentTerms: 0,
      lastBatchSuppliers: 0,
      lastUpdatedAt: state.lastUpdatedAt
    };
  }

  private ensureIdentity(): LocalDesktopIdentity {
    return (
      getLocalDesktopIdentity(this.database) ??
      ensureInitialDesktopIdentity(this.database, {
        companyId: "setup-company",
        companyLegalName: "KyberRock - Configuracao Inicial",
        companyTradeName: "KyberRock",
        unitId: "setup-unit",
        unitName: "Unidade inicial",
        deviceId: "setup-device",
        deviceName: "Desktop balanca"
      })
    );
  }

  private hasCloudCredentials(): boolean {
    const count = this.database
      .prepare(
        `SELECT COUNT(*)
         FROM local_settings
         WHERE key IN ('cloud_company_id', 'cloud_unit_id', 'cloud_device_id', 'cloud_device_token')`
      )
      .pluck()
      .get() as number;
    return count === 4;
  }

  private recordTechnicalLog(
    level: "debug" | "info" | "warning" | "error",
    source: string,
    message: string,
    context: Record<string, unknown>
  ): void {
    try {
      this.database
        .prepare(
          `INSERT INTO technical_logs (id, level, source, message, context_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(randomUUID(), level, source, message, JSON.stringify(context), new Date().toISOString());
    } catch (error) {
      console.error("Failed to record technical log", error);
    }
  }

  private assertDesktopAccess(): void {
    const access = getStoredDesktopAccessStatus(this.database);
    if (!access.canOperate) {
      throw new Error(access.message);
    }
  }
}

function buildScaleCaptureAudit(reading: ScaleReading): ScaleCaptureAudit {
  return {
    weightKg: reading.weightKg,
    status: reading.status,
    stable: reading.stable,
    capturedAt: reading.capturedAt,
    receivedAt: reading.receivedAt,
    rawFrame: reading.rawFrame,
    deviceId: reading.deviceId,
    adapterName: reading.adapterName
  };
}

function redactScaleConnection(connection: ScaleConnectionConfig): Record<string, unknown> {
  return {
    host: connection.host,
    port: connection.port,
    timeoutMs: connection.timeoutMs,
    reconnectIntervalMs: connection.reconnectIntervalMs,
    maxReconnectAttempts: connection.maxReconnectAttempts,
    autoConnect: connection.autoConnect
  };
}
