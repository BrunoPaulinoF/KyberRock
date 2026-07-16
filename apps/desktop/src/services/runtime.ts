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
  deleteOmieQueueJob,
  getSyncJobById,
  listOmieQueueItems,
  resetOmieQueueJobForRetry,
  type OmieQueueItem
} from "./sync-queue.js";
import {
  cancelWeighingOperation,
  clearCanceledWeighingOperations,
  closeWeighingOperation,
  createWeighingOperation,
  deleteClosedWeighingOperation,
  listCanceledWeighingOperations,
  listClosedWeighingOperations,
  listOpenWeighingOperations,
  updateWeighingOperationProduct,
  type OperationType,
  type OperationFreightInput,
  type ScaleCaptureAudit,
  type WeighingOperationSummary,
  type UpdateWeighingOperationProductInput
} from "./weighing-operations.js";
import {
  getCustomerFreightRules,
  getCustomerFreightRuleForProduct,
  setCustomerFreightRule,
  removeCustomerFreightRule,
  type SetCustomerFreightRuleInput
} from "./customer-freight-rules.js";
import type { FreightModality } from "./freight.js";
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
  pushPendingReportRecipients,
  pushReportChannelSettings,
  syncOperationToSupabase,
  syncLoadingRequestToSupabase,
  syncOmieReferenceDataFromCloud,
  listOmieDocumentTypesFromCloud,
  type OmieDocumentTypeOption,
  pushOmieCarriersToCloud,
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
  pullDesktopDataFromCloud,
  lookupCnpjFromCloud,
  type CloudBootstrapResult,
  type CnpjLookupResult,
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
  sendEmail,
  verifySmtpConnection,
  type EmailSendInput,
  type EmailSendResult,
  type SmtpOverrides
} from "./email.js";
import {
  normalizeUazapiBaseUrl,
  readReportChannelSettings,
  uazapiConnectInstance,
  uazapiCreateInstance,
  uazapiDisconnectInstance,
  uazapiInstanceStatus,
  writeReportChannelSettings,
  type ReportChannelSettings,
  type UazapiInstanceState
} from "./report-channels.js";
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
  removeProductDefaultPrice,
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

const OMIE_AUTOMATIC_PULL_MAX_ITERATIONS = 10;
const OMIE_PULL_PAGE_DELAY_MS = 3_000;

import {
  createToledoSerialAdapter,
  createToledoTcpAdapter,
  createVirtualScaleAdapter,
  type ToledoSerialAdapter,
  type ToledoTcpAdapter,
  type ToledoTcpAdapterStatus,
  type ParsedToledoReading,
  type ScaleReading
} from "@kyberrock/scale-adapters";
import { discoverScale } from "./scale-discovery.js";
import {
  createDesktopSerialTransportFactory,
  listSerialPorts,
  type SerialPortInfo
} from "./scale-serial.js";
import {
  readScaleConfiguration,
  writeScaleConfiguration,
  SCALE_CONNECTION_TUNING,
  type ScaleAdapterType,
  type ScaleConnectionConfig,
  type ScaleConfiguration,
  type ScaleConfigurationInput
} from "./scale-configs.js";
import { ScaleCaptureService, type ScaleCaptureOperationType } from "./scale-capture.js";

/**
 * Interface comum dos adaptadores de balanca (TCP, serial e virtual): o que o
 * runtime precisa depois que a conexao ja foi estabelecida.
 */
interface ActiveScaleAdapter {
  disconnect(): void;
  read(): Promise<ScaleReading>;
  getStatus(): ToledoTcpAdapterStatus;
  onReading(callback: (reading: ParsedToledoReading) => void): () => void;
  removeAllListeners(): void;
}
import {
  applyDefaultNfeEmailToAllCustomers,
  createCustomer,
  deleteCustomer,
  getCustomersByCarrier,
  getDefaultNfeEmail,
  listCustomers,
  setDefaultNfeEmail,
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
import {
  applyDefaultAccountBindings,
  ensureDefaultPaymentMethods,
  updatePaymentMethod,
  type UpdatePaymentMethodInput
} from "./payment-methods.js";
import {
  ensureDefaultAccounts,
  listAccounts,
  updateAccount,
  type UpdateAccountInput
} from "./accounts.js";
import {
  createPaymentTerm,
  deletePaymentTerm,
  listOmiePaymentTerms,
  updatePaymentTerm,
  type CreatePaymentTermInput,
  type UpdatePaymentTermInput
} from "./payment-terms.js";

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

/** Resumo da busca de CNPJ em lote (enrichAllCustomersFromCnpj). */
export interface CnpjBulkEnrichResult {
  /** Total de clientes examinados. */
  total: number;
  /** Clientes com CNPJ de 14 digitos (efetivamente consultados). */
  withCnpj: number;
  /** Clientes atualizados com dados da Receita. */
  updated: number;
  /** CNPJs nao encontrados na base da Receita. */
  notFound: number;
  /** Falhas na consulta ou na gravacao. */
  failed: number;
}

export class DesktopRuntime {
  private database: DesktopDatabase;
  private readonly paths: InitializedDesktopDatabase["paths"];
  private backupScheduler: BackupSchedulerHandle | null = null;
  private omieScheduler: OmieSchedulerHandle | null = null;
  private cloudSyncScheduler: CloudSyncSchedulerHandle | null = null;
  private cloudSyncInProgress = false;
  private omieSyncInProgress = false;
  private omieQueueProcessing = false;
  private receiptPrinter: ReceiptPrinter = { printReceipt: async () => undefined };
  private fiscalDocumentPrinter: FiscalDocumentPrinter = {
    printDocument: async () => ({ printed: false, error: null })
  };
  private cacheStore: CacheStore;
  private tcpScaleAdapter: ToledoTcpAdapter = createToledoTcpAdapter();
  private serialScaleAdapter: ToledoSerialAdapter = createToledoSerialAdapter(
    createDesktopSerialTransportFactory()
  );
  private virtualScaleAdapter: ReturnType<typeof createVirtualScaleAdapter> =
    createVirtualScaleAdapter();
  private activeScaleAdapter: ActiveScaleAdapter = this.tcpScaleAdapter;
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
    ensureDefaultAccounts(this.database, this.ensureIdentity().companyId);
    ensureDefaultPaymentMethods(this.database, this.ensureIdentity().companyId);
    applyDefaultAccountBindings(this.database, this.ensureIdentity().companyId);
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
        if (this.omieSyncInProgress) return;
        this.omieSyncInProgress = true;
        try {
          await this.runOmieDataEntryLoop({ maxIterations: OMIE_AUTOMATIC_PULL_MAX_ITERATIONS });
        } finally {
          this.omieSyncInProgress = false;
        }
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
    paymentMethodId?: string;
    manualInstallments?: number;
    manualDownPaymentCents?: number;
    freight?: OperationFreightInput | null;
    freightModality?: FreightModality | null;
    quotationId?: string;
    deductFreightFromCredit?: boolean;
    scaleCaptureId?: string;
  }): Promise<WeighingOperationSummary> {
    this.assertDesktopAccess();
    const entryReading =
      this.consumeScaleCapture(input.scaleCaptureId, "entry") ??
      (await this.captureStableWeight({ operationType: "entry" }));

    const operation = createWeighingOperation(this.database, {
      identity: this.ensureIdentity(),
      operationType: input.operationType,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      carrierId: input.carrierId,
      driverId: input.driverId,
      productId: input.productId,
      paymentTermId: input.paymentTermId,
      paymentMethodId: input.paymentMethodId,
      manualInstallments: input.manualInstallments,
      manualDownPaymentCents: input.manualDownPaymentCents,
      freight: input.freight,
      freightModality: input.freightModality,
      quotationId: input.quotationId,
      deductFreightFromCredit: input.deductFreightFromCredit,
      entryWeightKg: entryReading.weightKg,
      entryScaleCapture: buildScaleCaptureAudit(entryReading)
    });
    // A entrada pode ter gravado condicao/forma como padrao do cliente (primeira escolha).
    this.cacheStore.invalidate("customer", this.ensureIdentity().companyId);
    this.triggerBackgroundCloudSync("entry_registered", { operationId: operation.id });
    return operation;
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

    const operation = closeWeighingOperation(this.database, {
      operationId,
      exitWeightKg: exitReading.weightKg,
      operationType,
      exitScaleCapture: buildScaleCaptureAudit(exitReading)
    });
    // Best-effort: completa o cadastro do cliente para NF-e (busca por CNPJ + e-mail
    // padrao) em vez de deixar o faturamento pendente por falta de dados. Nao bloqueia
    // nem falha o fechamento se a busca nao der certo.
    await this.autoCompleteCustomerForNfe(operationId).catch(() => undefined);
    this.triggerBackgroundCloudSync("exit_registered", { operationId });
    // O pedido/OS do fechamento vai para o OMIE imediatamente (apenas os jobs desta
    // operacao), sem esperar a varredura completa de sincronizacao.
    this.triggerBackgroundOmieOrderPush("operation_closed", operationId);
    return operation;
  }

  /**
   * Processa a fila OMIE (pedidos/OS/cancelamentos) com trava unica contra execucoes
   * concorrentes (push do fechamento x sincronizacao agendada). entityId limita aos
   * jobs de uma operacao. Retorna null quando outro processamento ja esta em andamento
   * (os jobs permanecem na fila e a proxima passada os pega).
   */
  private async runOmieQueue(
    entityId?: string
  ): Promise<{ processed: number; failed: number; errors: string[] } | null> {
    if (this.omieQueueProcessing) return null;
    this.omieQueueProcessing = true;
    try {
      initializeSupabaseFromSettings(this.database);
      if (!isSupabaseInitialized()) {
        return { processed: 0, failed: 0, errors: ["Supabase nao configurado."] };
      }
      const identity = this.ensureIdentity();
      return await processOmieSyncQueue(this.database, identity, { entityId });
    } finally {
      this.omieQueueProcessing = false;
    }
  }

  /**
   * Processa em segundo plano APENAS os jobs OMIE da operacao informada (pedido/OS,
   * cancelamento), logo apos o fechamento/cancelamento — o envio nao depende mais da
   * varredura completa do OMIE. Falha aqui nao e terminal: o job permanece na fila e a
   * sincronizacao agendada re-tenta (syncCloudNow tambem processa a fila OMIE).
   */
  private triggerBackgroundOmieOrderPush(reason: string, operationId: string): void {
    void this.runOmieQueue(operationId)
      .then((result) => {
        if (!result) return;
        if (result.failed > 0) {
          this.recordTechnicalLog(
            "warning",
            "omie-sync",
            "Envio imediato do pedido ao OMIE falhou; o job permanece na fila para nova tentativa.",
            { reason, operationId, errors: result.errors }
          );
        } else if (result.processed > 0) {
          this.recordTechnicalLog("info", "omie-sync", "Pedido enviado ao OMIE no fechamento.", {
            reason,
            operationId,
            processed: result.processed
          });
        }
      })
      .catch((error: unknown) => {
        this.recordTechnicalLog(
          "warning",
          "omie-sync",
          error instanceof Error ? error.message : "Envio imediato do pedido ao OMIE falhou.",
          { reason, operationId }
        );
      });
  }

  /**
   * Se o cliente da operacao estiver sem Numero do Endereco ou E-mail (exigidos pela
   * NF-e), busca os dados por CNPJ (Receita) e aplica o e-mail padrao, completando o
   * cadastro e marcando para push ao OMIE. Silencioso: qualquer falha e ignorada.
   */
  private async autoCompleteCustomerForNfe(operationId: string): Promise<void> {
    const op = this.database
      .prepare("SELECT customer_id FROM weighing_operations WHERE id = ?")
      .get(operationId) as { customer_id: string | null } | undefined;
    if (!op?.customer_id) return;

    const customer = this.database
      .prepare(
        "SELECT document, email, address_number FROM customers WHERE id = ? AND deleted_at IS NULL"
      )
      .get(op.customer_id) as
      | { document: string | null; email: string | null; address_number: string | null }
      | undefined;
    if (!customer) return;

    const missingEmail = !customer.email?.trim();
    const missingNumber = !customer.address_number?.trim();
    if (!missingEmail && !missingNumber) return;

    const patch: Record<string, unknown> = {};

    // 1. Completa endereco/razao pelo CNPJ quando ha documento valido.
    const digits = (customer.document ?? "").replace(/\D/g, "");
    if (digits.length === 14) {
      const data = await lookupCnpjFromCloud(this.database, this.ensureIdentity(), digits).catch(
        () => null
      );
      if (data?.found) {
        if (missingNumber && data.addressNumber) patch.addressNumber = data.addressNumber;
        if (data.addressStreet) patch.addressStreet = data.addressStreet;
        if (data.neighborhood) patch.neighborhood = data.neighborhood;
        if (data.city) patch.city = data.city;
        if (data.state) patch.state = data.state;
        if (data.zipcode) patch.zipcode = data.zipcode;
        if (missingEmail && data.email) patch.email = data.email;
      }
    }

    // 2. E-mail padrao de NF-e quando ainda faltar (Receita raramente traz e-mail).
    if (missingEmail && patch.email === undefined) {
      const defaultEmail = getDefaultNfeEmail(this.database);
      if (defaultEmail) patch.email = defaultEmail;
    }

    if (Object.keys(patch).length === 0) return;
    updateCustomer(this.database, op.customer_id, patch, new Date(), { overrideOmieFields: true });
    this.cacheStore.invalidate("customer", this.ensureIdentity().companyId);
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
        adapterName:
          scaleConfig.adapterType === "virtual"
            ? "virtual"
            : scaleConfig.adapterType === "serial"
              ? "toledo-serial"
              : "toledo-tcp",
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
    const operation = cancelWeighingOperation(this.database, { operationId, reason });
    this.triggerBackgroundCloudSync("operation_cancelled", { operationId });
    // Se ja existe pedido no OMIE, o cancel_order enfileirado tambem segue de imediato.
    this.triggerBackgroundOmieOrderPush("operation_cancelled", operationId);
    return operation;
  }

  updateWeighingProduct(input: UpdateWeighingOperationProductInput): WeighingOperationSummary {
    this.assertDesktopAccess();
    const operation = updateWeighingOperationProduct(this.database, input);
    this.triggerBackgroundCloudSync("operation_product_changed", {
      operationId: input.operationId
    });
    return operation;
  }

  listOpenWeighingOperations(): WeighingOperationSummary[] {
    this.assertDesktopAccess();
    return listOpenWeighingOperations(this.database);
  }

  /**
   * Busca no cloud apenas as conclusoes do carregador (loader-web) e as projeta
   * no SQLite local. E uma consulta leve (uma tabela, filtrada por unidade) que
   * o renderer pode chamar com frequencia para manter a "luz" de conclusao
   * praticamente em tempo real, sem depender da varredura completa de 30 min.
   */
  async pullLoaderCompletions(): Promise<{ pulled: number; errors: string[] }> {
    this.assertDesktopAccess();
    try {
      initializeSupabaseFromSettings(this.database);
      if (!isSupabaseInitialized()) {
        return { pulled: 0, errors: [] };
      }
      const identity = this.ensureIdentity();
      return await pullLoaderCompletionsFromCloud(this.database, identity);
    } catch (error) {
      return {
        pulled: 0,
        errors: [
          error instanceof Error ? error.message : "Falha ao buscar conclusoes do carregador."
        ]
      };
    }
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

  deleteClosedWeighingOperation(operationId: string): void {
    this.assertDesktopAccess();
    deleteClosedWeighingOperation(this.database, operationId);
  }

  getCustomerFreightRules(customerId: string) {
    this.assertDesktopAccess();
    return getCustomerFreightRules(this.database, customerId);
  }

  getCustomerFreightForProduct(customerId: string, productId: string) {
    this.assertDesktopAccess();
    return getCustomerFreightRuleForProduct(this.database, customerId, productId);
  }

  setCustomerFreightRule(input: SetCustomerFreightRuleInput) {
    this.assertDesktopAccess();
    return setCustomerFreightRule(this.database, input);
  }

  removeCustomerFreightRule(ruleId: string) {
    this.assertDesktopAccess();
    return removeCustomerFreightRule(this.database, ruleId);
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

  lookupCnpj(cnpj: string): Promise<CnpjLookupResult> {
    this.assertDesktopAccess();
    return lookupCnpjFromCloud(this.database, this.ensureIdentity(), cnpj);
  }

  async syncToCloud(): Promise<SyncResult> {
    return this.syncCloudNow();
  }

  async bootstrapCloudData(): Promise<CloudBootstrapResult> {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const emptyPulled = {
      customers: 0,
      products: 0,
      operations: 0,
      loadingRequests: 0,
      printReceipts: 0
    };

    initializeSupabaseFromSettings(this.database);
    if (!isSupabaseInitialized()) {
      return {
        mode: "local_emergency",
        success: false,
        synced: 0,
        failed: 0,
        pulled: emptyPulled,
        errors: ["Supabase nao configurado. Entrando com dados locais de emergencia."]
      };
    }

    const reachable = await pingSupabase();
    if (!reachable) {
      return {
        mode: "local_emergency",
        success: false,
        synced: 0,
        failed: 0,
        pulled: emptyPulled,
        errors: ["Sem conexao com Supabase. Entrando com dados locais de emergencia."]
      };
    }

    const errors: string[] = [];
    let synced = 0;
    let failed = 0;

    const queue = await processCloudSyncQueue(this.database, identity);
    synced += queue.processed;
    failed += queue.failed;
    errors.push(...queue.errors);

    const pulled = await pullDesktopDataFromCloud(this.database, identity);
    recordCloudSyncRanAt(this.database);
    ensureDefaultAccounts(this.database, identity.companyId);
    ensureDefaultPaymentMethods(this.database, identity.companyId);
    applyDefaultAccountBindings(this.database, identity.companyId);
    this.cacheStore.loadAll(identity.companyId);

    return {
      mode: "cloud",
      success: failed === 0,
      synced,
      failed,
      pulled,
      errors
    };
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

      // Fila OMIE (pedidos/OS dos fechamentos): processada junto da sincronizacao
      // cloud — que roda logo apos cada fechamento e no agendador — para o envio ao
      // OMIE nao depender da varredura completa; falhas re-tentam a cada ciclo.
      try {
        const omieQueue = await this.runOmieQueue();
        if (omieQueue) {
          synced += omieQueue.processed;
          failed += omieQueue.failed;
          errors.push(...omieQueue.errors);
        }
      } catch (error) {
        failed++;
        errors.push(
          `Fila OMIE: ${error instanceof Error ? error.message : "erro desconhecido"}`
        );
      }

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

      // Sync report recipients (quem recebe o envio automatico) to cloud
      try {
        synced += await pushPendingReportRecipients(this.database, identity);
      } catch (error) {
        failed++;
        errors.push(
          `Report recipients sync: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }

      // Config dos canais de envio (SMTP/WhatsApp) com push pendente de uma
      // tentativa anterior que falhou (ex.: salvo offline na tela de Relatorios).
      try {
        if (readReportChannelSettings(this.database).cloudPushPending) {
          await pushReportChannelSettings(this.database, identity);
          writeReportChannelSettings(this.database, {
            cloudPushPending: false,
            cloudPushError: null
          });
        }
      } catch (error) {
        errors.push(
          `Report channel settings sync: ${error instanceof Error ? error.message : "Unknown error"}`
        );
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

      try {
        const cloudPull = await pullDesktopDataFromCloud(this.database, identity);
        synced +=
          cloudPull.customers +
          cloudPull.products +
          cloudPull.operations +
          cloudPull.loadingRequests +
          cloudPull.printReceipts;
      } catch (error) {
        errors.push(`Cloud pull: ${error instanceof Error ? error.message : "Unknown error"}`);
      }

      recordCloudSyncRanAt(this.database);
      ensureDefaultAccounts(this.database, identity.companyId);
      ensureDefaultPaymentMethods(this.database, identity.companyId);
      applyDefaultAccountBindings(this.database, identity.companyId);
      this.cacheStore.loadAll(identity.companyId);
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

  /**
   * Conecta a balanca usando a configuracao salva (tipo de conexao + campos
   * do tipo). Unica porta de entrada de conexao: TCP, serial (COM/USB) e
   * virtual passam todos por aqui.
   */
  async connectScale(): Promise<void> {
    const scaleConfig = this.getScaleConfiguration();
    this.activateAdapter(scaleConfig.adapterType);
    this.activeScaleAdapter.removeAllListeners();

    if (scaleConfig.adapterType === "virtual") {
      await this.virtualScaleAdapter.connect({ host: "virtual", port: 0 });
      return;
    }

    if (scaleConfig.adapterType === "serial") {
      const serialPath = scaleConfig.connection.serialPath.trim();
      if (!serialPath) {
        throw new Error(
          "Nenhuma porta serial (COM/USB) selecionada. Escolha a porta em Configuracoes > Balanca."
        );
      }
      await this.serialScaleAdapter.connect({
        path: serialPath,
        baudRate: scaleConfig.connection.baudRate,
        reconnectIntervalMs: SCALE_CONNECTION_TUNING.reconnectIntervalMs,
        maxReconnectAttempts: SCALE_CONNECTION_TUNING.maxReconnectAttempts
      });
      return;
    }

    await this.tcpScaleAdapter.connect({
      host: scaleConfig.connection.host,
      port: scaleConfig.connection.port,
      timeoutMs: SCALE_CONNECTION_TUNING.timeoutMs,
      reconnectIntervalMs: SCALE_CONNECTION_TUNING.reconnectIntervalMs,
      maxReconnectAttempts: SCALE_CONNECTION_TUNING.maxReconnectAttempts
    });
  }

  private activateAdapter(adapterType: ScaleAdapterType): void {
    this.tcpScaleAdapter.disconnect();
    this.serialScaleAdapter.disconnect();
    this.virtualScaleAdapter.disconnect();
    this.activeScaleAdapter =
      adapterType === "virtual"
        ? this.virtualScaleAdapter
        : adapterType === "serial"
          ? this.serialScaleAdapter
          : this.tcpScaleAdapter;
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
      if (scaleConfig.adapterType === "serial" && !scaleConfig.connection.serialPath.trim()) {
        return false;
      }
      await this.connectScale();
      return true;
    } catch {
      return false;
    }
  }

  disconnectScale(): void {
    this.tcpScaleAdapter.disconnect();
    this.serialScaleAdapter.disconnect();
    this.virtualScaleAdapter.disconnect();
  }

  listScaleSerialPorts(): Promise<SerialPortInfo[]> {
    return listSerialPorts();
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
    return this.reportService.exportRangeToHtml(startDate, endDate, this.ensureIdentity().unitId);
  }

  getInsightsHtml(startDate: string, endDate: string, periodLabel?: string): string {
    return this.reportService.exportInsightsToHtml(
      startDate,
      endDate,
      this.ensureIdentity().unitId,
      periodLabel
    );
  }

  getTruckControlReport(
    startDate: string,
    endDate: string
  ): ReturnType<ReportService["getTruckControlReport"]> {
    return this.reportService.getTruckControlReport(
      startDate,
      endDate,
      this.ensureIdentity().unitId
    );
  }

  getTruckControlHtml(startDate: string, endDate: string): string {
    return this.reportService.exportTruckControlToHtml(
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

  // Config SMTP cadastrada na tela de Relatorios; os envs SMTP_* sao fallback.
  private smtpOverrides(): SmtpOverrides {
    const settings = readReportChannelSettings(this.database);
    return {
      host: settings.smtpHost,
      port: settings.smtpPort,
      user: settings.smtpUser,
      password: settings.smtpPassword,
      from: settings.smtpSender
    };
  }

  sendReportEmail(input: EmailSendInput): Promise<EmailSendResult> {
    return sendEmail(input, this.smtpOverrides());
  }

  async sendTestEmail(to: string): Promise<EmailSendResult> {
    return sendEmail(
      {
        to,
        subject: "Teste de envio - KyberRock",
        html: '<!doctype html><html><head><meta charset="utf-8" /></head><body style="font-family:Arial,sans-serif;padding:24px"><h1>KyberRock - Email configurado com sucesso!</h1><p>Este e um email de teste para verificar a conexao SMTP. Se voce esta lendo isso, o envio de relatorios por email esta funcionando.</p></body></html>'
      },
      this.smtpOverrides()
    );
  }

  async sendDailyReportEmail(email: string, date: string): Promise<EmailSendResult> {
    const report = this.getDailyReport(date);
    const identity = this.ensureIdentity();
    const companyRow = this.database
      .prepare("SELECT legal_name FROM companies WHERE id = ?")
      .get(identity.companyId) as { legal_name: string | null } | undefined;
    const companyName = companyRow?.legal_name || "KyberRock";
    const html = renderDailyReportHtml({
      companyName,
      date,
      report
    });
    return sendEmail(
      {
        to: email,
        subject: `Fechamento diario ${date} - ${companyName}`,
        html
      },
      this.smtpOverrides()
    );
  }

  async sendRangeReportEmail(
    email: string,
    startDate: string,
    endDate: string
  ): Promise<EmailSendResult> {
    const identity = this.ensureIdentity();
    const companyRow = this.database
      .prepare("SELECT legal_name FROM companies WHERE id = ?")
      .get(identity.companyId) as { legal_name: string | null } | undefined;
    const companyName = companyRow?.legal_name || "KyberRock";
    const html = this.getReportHtml(startDate, endDate);
    return sendEmail(
      {
        to: email,
        subject: `Relatorio ${startDate} a ${endDate} - ${companyName}`,
        html
      },
      this.smtpOverrides()
    );
  }

  verifySmtpConfig(): Promise<EmailSendResult> {
    return verifySmtpConnection(this.smtpOverrides());
  }

  getReportChannelSettings(): ReportChannelSettings {
    return readReportChannelSettings(this.database);
  }

  // Salva a configuracao dos canais localmente e tenta empurrar para o cloud;
  // falha de push nao perde o salvamento local (fica pendente para o proximo sync).
  async saveReportChannelSettings(
    input: Partial<ReportChannelSettings>
  ): Promise<ReportChannelSettings> {
    const sanitized: Partial<ReportChannelSettings> = { ...input };
    if (typeof sanitized.uazapiBaseUrl === "string") {
      sanitized.uazapiBaseUrl = normalizeUazapiBaseUrl(sanitized.uazapiBaseUrl);
    }
    if (typeof sanitized.smtpPort === "number" && !Number.isFinite(sanitized.smtpPort)) {
      sanitized.smtpPort = 587;
    }
    writeReportChannelSettings(this.database, {
      ...sanitized,
      cloudPushPending: true,
      cloudPushError: null
    });
    return this.pushChannelSettingsToCloud();
  }

  private async pushChannelSettingsToCloud(): Promise<ReportChannelSettings> {
    try {
      const identity = this.ensureIdentity();
      await pushReportChannelSettings(this.database, identity);
      return writeReportChannelSettings(this.database, {
        cloudPushPending: false,
        cloudPushError: null
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Falha ao sincronizar configuracao com o cloud";
      return writeReportChannelSettings(this.database, {
        cloudPushPending: true,
        cloudPushError: message
      });
    }
  }

  private persistWhatsappState(state: UazapiInstanceState): void {
    writeReportChannelSettings(this.database, {
      uazapiStatus: state.status,
      uazapiProfileName: state.profileName ?? "",
      cloudPushPending: true
    });
  }

  // Cria a instancia UAZAPI (na primeira vez) e inicia a conexao; o QR code
  // volta no estado retornado e rotaciona via whatsappStatus().
  async whatsappConnect(): Promise<UazapiInstanceState> {
    const settings = readReportChannelSettings(this.database);
    if (!settings.uazapiBaseUrl) {
      throw new Error("Informe o servidor UAZAPI (URL) e salve a configuracao antes de conectar.");
    }
    let instanceToken = settings.uazapiInstanceToken;
    if (!instanceToken) {
      if (!settings.uazapiAdminToken) {
        throw new Error("Informe a chave de API (admin token) do UAZAPI e salve antes de conectar.");
      }
      let instanceName = settings.uazapiInstanceName;
      if (!instanceName) {
        try {
          instanceName = `kyberrock-${this.ensureIdentity().companyId.slice(0, 8)}`;
        } catch {
          instanceName = "kyberrock-desktop";
        }
      }
      const created = await uazapiCreateInstance({
        baseUrl: settings.uazapiBaseUrl,
        adminToken: settings.uazapiAdminToken,
        name: instanceName
      });
      if (!created.instanceToken) {
        throw new Error("UAZAPI nao retornou o token da instancia criada.");
      }
      instanceToken = created.instanceToken;
      writeReportChannelSettings(this.database, {
        uazapiInstanceToken: instanceToken,
        uazapiInstanceName: instanceName,
        uazapiStatus: created.status,
        cloudPushPending: true
      });
    }
    await uazapiConnectInstance({ baseUrl: settings.uazapiBaseUrl, instanceToken });
    // O QR mais recente vem no status (o connect pode responder antes de gera-lo).
    const state = await uazapiInstanceStatus({ baseUrl: settings.uazapiBaseUrl, instanceToken });
    this.persistWhatsappState(state);
    void this.pushChannelSettingsToCloud();
    return state;
  }

  async whatsappStatus(): Promise<UazapiInstanceState> {
    const settings = readReportChannelSettings(this.database);
    if (!settings.uazapiBaseUrl || !settings.uazapiInstanceToken) {
      return {
        status: "disconnected",
        connected: false,
        loggedIn: false,
        qrcode: null,
        paircode: null,
        profileName: null,
        owner: null,
        instanceToken: null,
        lastDisconnectReason: null
      };
    }
    const state = await uazapiInstanceStatus({
      baseUrl: settings.uazapiBaseUrl,
      instanceToken: settings.uazapiInstanceToken
    });
    if (state.status !== settings.uazapiStatus) {
      this.persistWhatsappState(state);
      void this.pushChannelSettingsToCloud();
    }
    return state;
  }

  async whatsappDisconnect(): Promise<UazapiInstanceState> {
    const settings = readReportChannelSettings(this.database);
    if (!settings.uazapiBaseUrl || !settings.uazapiInstanceToken) {
      throw new Error("Nenhuma instancia WhatsApp configurada.");
    }
    const state = await uazapiDisconnectInstance({
      baseUrl: settings.uazapiBaseUrl,
      instanceToken: settings.uazapiInstanceToken
    });
    this.persistWhatsappState({ ...state, status: "disconnected" });
    void this.pushChannelSettingsToCloud();
    return { ...state, status: "disconnected" };
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

  removeProductDefaultPrice(productId: string): void {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    removeProductDefaultPrice(this.database, identity.companyId, productId);
    this.cacheStore.invalidate("product", identity.companyId);
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

  updateCustomer(
    id: string,
    input: UpdateCustomerInput,
    options?: { overrideOmieFields?: boolean }
  ): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = updateCustomer(this.database, id, input, new Date(), {
      overrideOmieFields: options?.overrideOmieFields
    });
    this.cacheStore.invalidate("customer", identity.companyId);
    this.cacheStore.invalidate("carrier", identity.companyId);
    return result;
  }

  getDefaultNfeEmail(): string | null {
    this.assertDesktopAccess();
    return getDefaultNfeEmail(this.database);
  }

  setDefaultNfeEmail(email: string): string | null {
    this.assertDesktopAccess();
    return setDefaultNfeEmail(this.database, email);
  }

  applyDefaultNfeEmailToAll(email: string): number {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const count = applyDefaultNfeEmailToAllCustomers(this.database, identity.companyId, email);
    this.cacheStore.invalidate("customer", identity.companyId);
    return count;
  }

  /**
   * Executa "buscar CNPJ" (Receita via edge cnpj-lookup) para TODOS os clientes com
   * CNPJ valido (14 digitos) e grava os dados retornados. Processa em serie para nao
   * estourar o limite da BrasilAPI. Cada campo so e sobrescrito quando a consulta traz
   * valor (mesma regra da busca individual). Clientes origem OMIE viram 'hybrid'
   * (overrideOmieFields) para o cadastro ser empurrado ao OMIE no proximo sync.
   * Nunca lanca por causa de um cliente: falhas isoladas entram no resumo retornado.
   */
  async enrichAllCustomersFromCnpj(): Promise<CnpjBulkEnrichResult> {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const customers = listCustomers(this.database, identity.companyId);
    const summary: CnpjBulkEnrichResult = {
      total: customers.length,
      withCnpj: 0,
      updated: 0,
      notFound: 0,
      failed: 0
    };
    const now = new Date();

    for (const customer of customers) {
      const digits = (customer.document ?? "").replace(/\D/g, "");
      if (digits.length !== 14) continue;
      summary.withCnpj += 1;

      let data: CnpjLookupResult;
      try {
        data = await lookupCnpjFromCloud(this.database, identity, digits);
      } catch {
        summary.failed += 1;
        continue;
      }
      if (!data.found) {
        summary.notFound += 1;
        continue;
      }

      const patch: UpdateCustomerInput = {};
      if (data.legalName) patch.legalName = data.legalName;
      if (data.tradeName) patch.tradeName = data.tradeName;
      if (data.phone) patch.phone = data.phone;
      if (data.email) patch.email = data.email;
      if (data.zipcode) patch.zipcode = data.zipcode;
      if (data.addressStreet) patch.addressStreet = data.addressStreet;
      if (data.addressNumber) patch.addressNumber = data.addressNumber;
      if (data.addressComplement) patch.addressComplement = data.addressComplement;
      if (data.neighborhood) patch.neighborhood = data.neighborhood;
      if (data.city) patch.city = data.city;
      if (data.state) patch.state = data.state.toUpperCase().slice(0, 2);
      if (Object.keys(patch).length === 0) continue;

      try {
        updateCustomer(this.database, customer.id, patch, now, { overrideOmieFields: true });
        summary.updated += 1;
      } catch {
        summary.failed += 1;
      }
    }

    this.cacheStore.invalidate("customer", identity.companyId);
    return summary;
  }

  deleteCustomer(id: string): void {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    deleteCustomer(this.database, id);
    this.cacheStore.invalidate("customer", identity.companyId);
  }

  // Meios de pagamento e contas nao sao criados nem excluidos no desktop: o
  // cadastro vem do OMIE via sincronizacao. Localmente so ha atualizacao
  // restrita (ativar/desativar, apelido e vinculo forma -> conta).
  updatePaymentMethod(id: string, input: UpdatePaymentMethodInput): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = updatePaymentMethod(this.database, id, {
      alias: input.alias,
      accountId: input.accountId,
      isActive: input.isActive,
      sortOrder: input.sortOrder
    });
    this.cacheStore.invalidate("payment_method", identity.companyId);
    return result;
  }

  listAccounts(): unknown {
    this.assertDesktopAccess();
    return listAccounts(this.database, this.ensureIdentity().companyId);
  }

  updateAccount(id: string, input: UpdateAccountInput): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = updateAccount(this.database, id, {
      isActive: input.isActive,
      sortOrder: input.sortOrder
    });
    this.cacheStore.invalidate("account", identity.companyId);
    return result;
  }

  createPaymentTerm(input: Omit<CreatePaymentTermInput, "companyId">): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = createPaymentTerm(this.database, { ...input, companyId: identity.companyId });
    this.cacheStore.invalidate("payment_term", identity.companyId);
    return result;
  }

  updatePaymentTerm(id: string, input: UpdatePaymentTermInput): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = updatePaymentTerm(this.database, id, input);
    this.cacheStore.invalidate("payment_term", identity.companyId);
    return result;
  }

  deletePaymentTerm(id: string): void {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    deletePaymentTerm(this.database, id);
    this.cacheStore.invalidate("payment_term", identity.companyId);
  }

  listOmiePaymentTerms(): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    return listOmiePaymentTerms(this.database, identity.companyId);
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

  listCarriersByCustomer(
    customerId: string
  ): Array<{ id: string; name: string; document: string | null }> {
    return listCarriersByCustomer(this.database, customerId);
  }

  listCustomersByCarrier(
    carrierId: string
  ): Array<{ id: string; trade_name: string; legal_name: string }> {
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

  listCarriersByDriver(
    driverId: string
  ): Array<{ id: string; name: string; document: string | null }> {
    return listCarriersByDriver(this.database, driverId);
  }

  listDriversByCarrier(
    carrierId: string
  ): Array<{ id: string; name: string; document: string | null; is_independent: number }> {
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
    pendingPushCarriers: number;
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

    const pendingPushCarriers = this.database
      .prepare(
        "SELECT COUNT(*) FROM carriers WHERE company_id = ? AND deleted_at IS NULL AND needs_push = 1"
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
      pendingPushCarriers,
      pendingOmieJobs,
      lastSyncAt: lastSync
    };
  }

  getOmieConfig(): { configured: boolean; appKeyMasked: string | null } {
    return { configured: this.hasCloudCredentials(), appKeyMasked: null };
  }

  /** Itens da fila OMIE (fechamentos a enviar) para a tela cloud. */
  listOmieQueue(): OmieQueueItem[] {
    this.assertDesktopAccess();
    return listOmieQueueItems(this.database);
  }

  /** Exclui um item da fila OMIE: o fechamento NAO sera mais enviado ao OMIE. */
  deleteOmieQueueItem(jobId: string): { deleted: boolean } {
    this.assertDesktopAccess();
    const job = getSyncJobById(this.database, jobId);
    const deleted = deleteOmieQueueJob(this.database, jobId);
    if (deleted) {
      this.recordTechnicalLog("info", "omie-sync", "Item removido da fila OMIE pelo operador.", {
        jobId,
        action: job?.action ?? null,
        operationId: job?.entityId ?? null
      });
    }
    return { deleted };
  }

  /** Rearma e envia agora um item da fila OMIE (ignora backoff/dead_letter). */
  async sendOmieQueueItemNow(
    jobId: string
  ): Promise<{ processed: number; failed: number; errors: string[] }> {
    this.assertDesktopAccess();
    const job = resetOmieQueueJobForRetry(this.database, jobId);
    if (!job) {
      throw new Error("Item nao encontrado na fila OMIE.");
    }
    const result = await this.runOmieQueue(job.entityId);
    if (!result) {
      return {
        processed: 0,
        failed: 0,
        errors: ["Envio OMIE ja em andamento. O item foi rearmado e sera enviado em instantes."]
      };
    }
    return result;
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
    if (this.omieSyncInProgress) {
      return {
        customersPulled: 0,
        customersPushed: 0,
        productsSynced: 0,
        paymentTermsSynced: 0,
        suppliersSynced: 0,
        ordersProcessed: 0,
        ordersFailed: 0,
        customersPushFailed: 0,
        errors: ["Sincronizacao OMIE ja em andamento."]
      };
    }

    this.omieSyncInProgress = true;
    try {
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
      const carrierPush = await pushOmieCarriersToCloud(this.database, identity);
      // Trava unica da fila OMIE (compartilhada com o push do fechamento e o
      // syncCloudNow); se outro processamento estiver em andamento, os jobs ficam
      // para a proxima passada.
      const queue = (await this.runOmieQueue()) ?? { processed: 0, failed: 0, errors: [] };
      this.cacheStore.invalidateAll(identity.companyId);
      return {
        customersPulled: loop.customersPulled,
        customersPushed: customerPush.pushed,
        productsSynced: loop.productsSynced,
        paymentTermsSynced: loop.paymentTermsSynced,
        suppliersSynced: loop.suppliersSynced,
        ordersProcessed: queue.processed,
        ordersFailed: queue.failed,
        customersPushFailed: customerPush.failed + carrierPush.failed,
        errors: customerPush.errors.concat(carrierPush.errors, loop.errors, queue.errors)
      };
    } finally {
      this.omieSyncInProgress = false;
    }
  }

  async syncOmieDirect(
    appKey: string,
    appSecret: string
  ): Promise<{
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
    await service.pushCarriersToOmie(identity.companyId);
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

  async listOmieDocumentTypes(): Promise<OmieDocumentTypeOption[]> {
    const identity = this.ensureIdentity();
    return listOmieDocumentTypesFromCloud(this.database, identity);
  }

  async runOmieDataEntryLoop(
    options: {
      reset?: boolean;
      maxIterations?: number;
      delayBetweenPagesMs?: number;
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
    const delayBetweenPagesMs = options.delayBetweenPagesMs ?? OMIE_PULL_PAGE_DELAY_MS;
    let customersPulled = 0;
    let productsSynced = 0;
    let paymentTermsSynced = 0;
    let suppliersSynced = 0;
    const errors: string[] = [];
    let iterations = 0;

    const initialState = readOmiePullState(this.database);
    if (options.reset || !initialState.inProgress) {
      writeOmiePullState(this.database, {
        customersPage: 1,
        productsPage: 1,
        paymentTermsPage: 1,
        suppliersPage: 1,
        customersFinished: false,
        productsFinished: false,
        paymentTermsFinished: false,
        suppliersFinished: false,
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
        result.customersPulled +
          result.productsSynced +
          result.paymentTermsSynced +
          result.suppliersSynced ===
          0;
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

      if (delayBetweenPagesMs > 0 && iterations < maxIterations) {
        await sleep(delayBetweenPagesMs);
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

  private triggerBackgroundCloudSync(reason: string, context: Record<string, unknown> = {}): void {
    void this.syncCloudNow()
      .then((result) => {
        if (!result.success) {
          this.recordTechnicalLog(
            "warning",
            "cloud-sync",
            "Sincronizacao cloud em segundo plano falhou.",
            { reason, ...context, result }
          );
        }
      })
      .catch((error: unknown) => {
        this.recordTechnicalLog(
          "error",
          "cloud-sync",
          error instanceof Error ? error.message : "Sincronizacao cloud em segundo plano falhou.",
          { reason, ...context }
        );
      });
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
        .run(
          randomUUID(),
          level,
          source,
          message,
          JSON.stringify(context),
          new Date().toISOString()
        );
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

  /**
   * Limpa todos os dados OMIE locais (clientes, transportadoras, estado de sync)
   * e reseta o estado para forcar uma re-sincronizacao completa.
   */
  resetOmieMasterData(): {
    customersCleared: number;
    carriersCleared: number;
    productsCleared: number;
    paymentTermsCleared: number;
    syncRunsCleared: number;
    syncQueueCleared: number;
  } {
    const identity = this.ensureIdentity();
    const companyId = identity.companyId;

    const customersResult = this.database
      .prepare(
        `UPDATE customers
         SET default_carrier_id = NULL,
             deleted_at = datetime('now'),
             is_active = 0,
             updated_at = datetime('now')
         WHERE company_id = ? AND deleted_at IS NULL`
      )
      .run(companyId);
    const customersCleared = customersResult.changes;

    const carriersResult = this.database
      .prepare(
        `UPDATE carriers
         SET deleted_at = datetime('now'),
             is_active = 0,
             updated_at = datetime('now')
         WHERE company_id = ? AND deleted_at IS NULL`
      )
      .run(companyId);
    const carriersCleared = carriersResult.changes;

    const productsResult = this.database
      .prepare(
        `UPDATE products
         SET deleted_at = datetime('now'),
             is_active = 0,
             updated_at = datetime('now')
         WHERE company_id = ? AND deleted_at IS NULL`
      )
      .run(companyId);
    const productsCleared = productsResult.changes;

    const paymentTermsResult = this.database
      .prepare(
        `UPDATE payment_terms
         SET deleted_at = datetime('now'),
             is_active = 0,
             updated_at = datetime('now')
         WHERE company_id = ? AND deleted_at IS NULL`
      )
      .run(companyId);
    const paymentTermsCleared = paymentTermsResult.changes;

    const syncRunsResult = this.database
      .prepare(`DELETE FROM omie_sync_runs WHERE company_id = ?`)
      .run(companyId);
    const syncRunsCleared = syncRunsResult.changes;

    this.database
      .prepare(`DELETE FROM omie_sync_entities WHERE run_id NOT IN (SELECT id FROM omie_sync_runs)`)
      .run();

    this.database
      .prepare(`DELETE FROM local_settings WHERE key IN ('omie_pull_state', 'omie_sync_lock')`)
      .run();

    const queueResult = this.database.prepare(`DELETE FROM sync_queue WHERE target = 'omie'`).run();
    const syncQueueCleared = queueResult.changes;

    this.omieSyncInProgress = false;
    this.cacheStore.invalidateAll(companyId);

    return {
      customersCleared,
      carriersCleared,
      productsCleared,
      paymentTermsCleared,
      syncRunsCleared,
      syncQueueCleared
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderDailyReportHtml(input: {
  companyName: string;
  date: string;
  report: {
    totalOperations: number;
    totalNetWeightKg: number;
    totalProductCents: number;
    totalFreightCents: number;
    totalCents: number;
    operations: Array<{
      id: string;
      customerName: string;
      productDescription: string;
      netWeightKg: number;
      productTotalCents: number;
      freightTotalCents: number;
      totalCents: number;
    }>;
  };
}): string {
  const centsToBRL = (cents: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

  const rows = input.report.operations
    .map(
      (op) =>
        `<tr><td>${escapeHtml(op.customerName)}</td><td>${escapeHtml(op.productDescription)}</td><td class="num">${(op.netWeightKg / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} t</td><td class="num">${centsToBRL(op.productTotalCents)}</td><td class="num">${centsToBRL(op.freightTotalCents)}</td><td class="num">${centsToBRL(op.totalCents)}</td></tr>`
    )
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8" /><title>Fechamento diario ${input.date}</title></head><body style="font-family:Arial,sans-serif;color:#0f172a;padding:24px;background:#f8fafc"><h1 style="margin:0 0 4px;font-size:22px">Fechamento diario ${input.date}</h1><p style="margin:0 0 16px;color:#475569">${escapeHtml(input.companyName)}</p><table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;background:#fff;border:1px solid #cbd5e1;margin-bottom:24px"><thead><tr style="background:#1e293b;color:#fff"><th>Carregamentos</th><th>Tonelagem</th><th>Produto</th><th>Frete</th><th>Total</th><th>Preco medio</th></tr></thead><tbody><tr><td>${input.report.totalOperations}</td><td>${(input.report.totalNetWeightKg / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} t</td><td>${centsToBRL(input.report.totalProductCents)}</td><td>${centsToBRL(input.report.totalFreightCents)}</td><td>${centsToBRL(input.report.totalCents)}</td><td>${centsToBRL(input.report.totalNetWeightKg > 0 ? Math.round(input.report.totalCents / input.report.totalNetWeightKg) : 0)}</td></tr></tbody></table><table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;background:#fff;border:1px solid #cbd5e1"><thead><tr style="background:#e2e8f0"><th>Cliente</th><th>Produto</th><th>Peso</th><th>Produto</th><th>Frete</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
    serialPath: connection.serialPath,
    baudRate: connection.baudRate,
    serialTransport: connection.serialTransport,
    autoConnect: connection.autoConnect
  };
}
