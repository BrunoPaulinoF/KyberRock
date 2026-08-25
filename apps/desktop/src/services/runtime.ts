import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import {
  initializeDesktopDatabase,
  type InitializedDesktopDatabase
} from "../database/initialize.js";
import { runDesktopMigrations } from "../database/migrate.js";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite.js";
import {
  assertDatabaseFileHealthy,
  createAutomaticBackup,
  exportManualBackup,
  pruneOldBackups,
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
  listRunnableSyncJobs,
  pruneCompletedSyncJobs,
  resetOmieQueueJobForRetry,
  type OmieQueueItem
} from "./sync-queue.js";
import {
  startOmieQueueDrainScheduler,
  type OmieQueueDrainSchedulerHandle
} from "./omie-queue-scheduler.js";
import { readUpdateChannel, type DesktopUpdateChannel } from "./update-channel.js";
import {
  checkCustomerOmieReadiness,
  type OmieCustomerReadiness,
  type OmieReadinessOperationType
} from "./omie-customer-readiness.js";
import {
  cancelWeighingOperation,
  clearCanceledWeighingOperations,
  clearClosedWeighingOperations,
  closeWeighingOperation,
  createWeighingOperation,
  deleteClosedWeighingOperation,
  getCustomerLastEntryPreferences,
  getOperationOmieIssue,
  listCanceledWeighingOperations,
  listClosedWeighingOperations,
  listOpenWeighingOperations,
  updateWeighingOperationProduct,
  updateWeighingOperationCustomer,
  updateWeighingOperationCarrier,
  updateWeighingOperationDetails,
  type CustomerLastEntryPreferences,
  type OperationOmieIssue,
  type OperationType,
  type OperationFreightInput,
  type ScaleCaptureAudit,
  type WeighingOperationSummary,
  type UpdateWeighingOperationProductInput,
  type UpdateWeighingOperationCustomerInput,
  type UpdateWeighingOperationCarrierInput,
  type UpdateWeighingOperationDetailsInput
} from "./weighing-operations.js";
import {
  getCustomerFreightRules,
  getCustomerFreightRuleForProduct,
  getLastCustomerFreightNote,
  setCustomerFreightRule,
  rememberCustomerFreightValue,
  removeCustomerFreightRule,
  removeCustomerFreightModality,
  type SetCustomerFreightRuleInput
} from "./customer-freight-rules.js";
import {
  getCustomerFutureBillingInvoices,
  setCustomerFutureBillingInvoice,
  removeCustomerFutureBillingInvoice,
  type SetCustomerFutureBillingInvoiceInput
} from "./customer-future-billing.js";
import type { FreightModality } from "./freight.js";
import {
  configureReceiptPrintProfile,
  getActiveReceiptPrintProfile,
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
  createWhatsappConnectionLink,
  initializeSupabaseFromSettings,
  pingSupabase,
  processCloudSyncQueue,
  pushPendingReportRecipients,
  pushReportChannelSettings,
  revokeWhatsappConnectionLink,
  sendFinancialReportNow,
  type FinancialReportDispatchResult,
  syncOperationToSupabase,
  syncLoadingRequestToSupabase,
  listOperationsPendingCloudPush,
  syncOmieReferenceDataFromCloud,
  syncCustomerAdvancesFromCloud,
  type CustomerAdvancesSyncResult,
  listOmieDocumentTypesFromCloud,
  type OmieDocumentTypeOption,
  pushOmieCarriersToCloud,
  pushOmieCustomersToCloud,
  processOmieSyncQueue,
  processFiscalBillingNow,
  reconcileOmieBillingFromOmie,
  type OmieBillingReconcileResult,
  rearmOmieBillingForCustomer,
  getSupabaseSyncStatus,
  isSupabaseInitialized,
  pullCompanyPricePasswordFromCloud,
  pushSharedCadastroToCloud,
  pullLoaderCompletionsFromCloud,
  pullDesktopDataFromCloud,
  lookupCnpjFromCloud,
  type CloudBootstrapResult,
  type CnpjLookupResult,
  type OmieCloudSyncResult,
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
import { readOmiePullState, writeOmiePullState, SETUP_COMPANY_ID } from "./supabase-sync.js";
import { listUnitDevices, type UnitDeviceInfo } from "./unit-devices.js";
import { CustomerReportService, type CustomerReportVariant } from "./customer-report.js";
import {
  customerReportFileBaseName,
  customersOverviewFileBaseName,
  renderCustomerReportHtml,
  renderCustomerReportSpreadsheet,
  renderCustomersOverviewHtml,
  renderCustomersOverviewSpreadsheet
} from "./customer-report-render.js";
import { InvoiceClosingService } from "./invoice-closing.js";
import type { InvoiceClosingOptions } from "./invoice-closing.js";
import {
  countBillableCandidates,
  runInvoiceClosing,
  selectInvoiceClosingCandidates
} from "./invoice-closing-run.js";
import {
  OMIE_INVOICE_NUMBER_ASK_LIMIT,
  selectOperationsMissingInvoiceNumber
} from "./omie-invoice-numbers.js";
import type { InvoiceClosingRunProgress, InvoiceClosingRunResult } from "./invoice-closing-run.js";
import {
  invoiceClosingFileBaseName,
  renderInvoiceClosingHtml,
  renderInvoiceClosingSpreadsheet
} from "./invoice-closing-render.js";
import { WeighingBillingReportService } from "./weighing-billing-report.js";
import type { WeighingBillingReportOptions } from "./weighing-billing-report.js";
import {
  renderWeighingBillingReportHtml,
  renderWeighingBillingReportSpreadsheet,
  weighingBillingReportFileBaseName
} from "./weighing-billing-report-render.js";
import { ReportService } from "./reports.js";
import {
  filterTruckControlReport,
  renderTruckControlHtml,
  renderTruckControlSpreadsheet,
  truckControlFileBaseName
} from "./truck-control-report.js";
import {
  sendEmail,
  verifySmtpConnection,
  type EmailSendInput,
  type EmailSendResult,
  type SmtpOverrides
} from "./email.js";
import {
  computeDueBundles,
  computeManualBundles,
  coversMonthToDate,
  monthToDateSales,
  readReportDispatchSettings,
  readReportDispatchState,
  writeReportDispatchSettings,
  writeReportDispatchState,
  type DispatchSendResult,
  type DueBundle,
  type MonthToDateSales,
  type ReportAttachment,
  type ReportDispatchSettings,
  type ReportDispatchState
} from "./report-dispatch.js";
import {
  normalizeUazapiBaseUrl,
  readReportChannelSettings,
  readWhatsappConnectionLink,
  uazapiConnectInstance,
  uazapiDisconnectInstance,
  uazapiSendDocument,
  uazapiInstanceStatus,
  writeReportChannelSettings,
  writeWhatsappConnectionLink,
  type ReportChannelSettings,
  type UazapiInstanceState
} from "./report-channels.js";
import type { WhatsappConnectionLink } from "./whatsapp-connection-link.js";
import { renderTotalBar } from "./report-total-bar.js";
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
import { CreditService, type CreditMovementRow, type CustomerCreditSummary } from "./credit.js";
import {
  getDefaultOmieCategory,
  listOmieCategories,
  setDefaultOmieCategory,
  setProductOmieCategory,
  type OmieCategoryOption
} from "./omie-categories.js";
import {
  readOmieAdvanceConfig,
  writeOmieAdvanceConfig,
  type OmieAdvanceConfig
} from "./omie-advance-config.js";
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
  askDocsAssistant,
  type DocsAssistantRequest,
  type DocsAssistantResult
} from "./docs-assistant.js";
import {
  syncOmieMasterData,
  getLastSyncRun,
  getSyncEntitiesByRun,
  type OmieSyncResult,
  type SyncOmieMasterDataOptions
} from "./omie-master-sync.js";

/**
 * Traduz a varredura para uma linha que responde sozinha a pergunta "por que nao
 * veio tudo?": quantas paginas rodaram das que o OMIE declara, quantos registros
 * crus chegaram e quantos foram descartados na classificacao por tag.
 */
export function describeOmieCustomersScan(scan: OmieCustomersScan): string | null {
  if (scan.pagesRun === 0) return null;
  const pages =
    scan.omieTotalPages && scan.omieTotalPages > 0
      ? `${scan.pagesRun}/${scan.omieTotalPages} paginas`
      : `${scan.pagesRun} paginas`;
  const records = scan.omieTotalRecords
    ? `${scan.rawRecords} de ${scan.omieTotalRecords} registros`
    : `${scan.rawRecords} registros`;
  // Nomeia o motivo em vez de um "ignorados" generico: cadastro invalido e
  // cadastro fora da classificacao pedem acoes diferentes.
  const unaccounted = Math.max(
    0,
    scan.rawRecords -
      scan.classifiedCustomers -
      scan.classifiedCarriers -
      scan.supplierOnly -
      scan.invalid
  );
  const parts = [
    pages,
    records,
    `${scan.classifiedCustomers} clientes`,
    `${scan.classifiedCarriers} transportadoras`,
    `${scan.invalid} sem codigo/razao social`
  ];
  // Deve ficar em zero: so transportadora pura fica fora dos clientes, e ela ja
  // esta contada acima. Qualquer numero aqui e cadastro sumindo em silencio.
  if (scan.supplierOnly > 0) parts.push(`${scan.supplierOnly} fora da classificacao`);
  if (unaccounted > 0) parts.push(`${unaccounted} nao classificados`);
  if (!scan.finished) parts.push("varredura NAO concluida");
  return parts.join(", ");
}

/** Resumo do que a varredura de clientes pediu e recebeu do OMIE. */
export interface OmieCustomersScan {
  pagesRun: number;
  rawRecords: number;
  classifiedCustomers: number;
  classifiedCarriers: number;
  invalid: number;
  supplierOnly: number;
  omieTotalPages: number | null;
  omieTotalRecords: number | null;
  finished: boolean;
}

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
/** Tentativas seguidas na mesma pagina do OMIE antes de adiar o resto do pull. */
const OMIE_PULL_MAX_CONSECUTIVE_FAILURES = 3;
const OMIE_PULL_RETRY_DELAY_MS = 5_000;

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
  scaleSessionKey,
  writeScaleConfiguration,
  SCALE_CONNECTION_TUNING,
  type ScaleAdapterType,
  type ScaleConnectionConfig,
  type ScaleConfiguration,
  type ScaleConfigurationInput
} from "./scale-configs.js";
import { ScaleCaptureService, type ScaleCaptureOperationType } from "./scale-capture.js";
import { ScaleCaptureTokenStore } from "./scale-capture-tokens.js";

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
  getCustomerDefaultCarrierId,
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
  getWalletReport,
  reopenWalletOperations,
  settleWalletOperations,
  type SettleWalletInput,
  type WalletQuery,
  type WalletReport
} from "./wallet.js";
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
  /** Pedido de varredura que chegou com outra em andamento — roda ao terminar. */
  private cloudSyncRerunRequested = false;
  /** Serializa os envios avulsos de operacao (um de cada vez, em ordem). */
  private operationPushChain: Promise<void> = Promise.resolve();
  private omieSyncInProgress = false;
  private omieQueueProcessing = false;
  /** Pedido de execucao da fila OMIE que chegou com outra em andamento — roda ao terminar. */
  private omieQueueRerunRequested = false;
  private omieQueueDrainScheduler: OmieQueueDrainSchedulerHandle | null = null;
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
  // Forwarders de leitura persistentes (ex.: o que envia desktop:scale-reading ao renderer),
  // guardados aqui para serem reanexados ao adaptador ativo apos cada (re)conexao — connectScale
  // chama removeAllListeners() e, sem reanexar, o peso ao vivo congelaria numa reconexao.
  private readonly scaleReadingUnsubscribes = new Map<
    (reading: ParsedToledoReading) => void,
    () => void
  >();
  /**
   * Conexao de balanca em andamento. Varias telas chamam connectScale ao abrir e
   * cada chamada derrubava os adaptadores antes de reconectar; concorrentes, elas
   * fechavam a sessao uma da outra e a balanca ficava piscando entre conectada e
   * desconectada. Todas passam a aguardar a mesma tentativa.
   */
  private scaleConnectInFlight: Promise<void> | null = null;
  /**
   * Configuracao com que a sessao viva foi aberta (ver `scaleSessionKey`). Serve
   * para distinguir "ja conectada na mesma balanca" de "conectada na configuracao
   * antiga" quando o operador troca IP/porta/baud em Configuracoes > Balanca.
   */
  private activeScaleSessionKey: string | null = null;
  /**
   * Pesos capturados pela balanca aguardando a tela confirmar a operacao. Ver
   * `SCALE_CAPTURE_TOKEN_TTL_MS` para o porque da janela ser generosa.
   */
  private readonly pendingScaleCaptures = new ScaleCaptureTokenStore();
  private reportService: ReportService;
  private customerReportService: CustomerReportService;
  private weighingBillingReportService: WeighingBillingReportService;
  private invoiceClosingService: InvoiceClosingService;

  private constructor(initialized: InitializedDesktopDatabase) {
    this.database = initialized.database;
    this.paths = initialized.paths;
    this.cacheStore = new CacheStore(this.database);
    this.reportService = new ReportService(this.database);
    this.customerReportService = new CustomerReportService(this.database);
    this.weighingBillingReportService = new WeighingBillingReportService(this.database);
    this.invoiceClosingService = new InvoiceClosingService(this.database);
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
    this.runDatabaseMaintenance(now);

    return backup;
  }

  /**
   * Manutencao diaria, executada logo APOS um backup bem-sucedido — nessa ordem de
   * proposito: tudo que e podado aqui ja esta dentro do backup recem-criado.
   *
   * Best-effort inteira: manutencao nunca pode derrubar a rotina de backup nem uma
   * operacao em andamento, entao cada etapa falha em silencio e tenta de novo amanha.
   */
  private runDatabaseMaintenance(now: Date = new Date()): void {
    try {
      pruneCompletedSyncJobs(this.database, { now });
    } catch {
      // proxima janela tenta de novo
    }

    try {
      pruneOldBackups(this.paths.backupDirectory);
    } catch {
      // proxima janela tenta de novo
    }

    try {
      // Reamostra as estatisticas que o planejador do SQLite usa para escolher indice.
      // Sem isso, os indices novos (migracao 48) podem ser ignorados num banco que ja
      // acumulou historico. `optimize` so faz o ANALYZE do que realmente mudou.
      this.database.pragma("optimize");
    } catch {
      // proxima janela tenta de novo
    }
  }

  async exportBackup(destinationPath: string): Promise<BackupResult> {
    const backup = await exportManualBackup(this.database, destinationPath);
    recordLastBackupAt(this.database, new Date(backup.createdAt));
    return backup;
  }

  restoreFromBackup(backupPath: string): void {
    // Valida a saude do arquivo de backup ANTES de fechar o banco em uso. Um backup
    // corrompido/incompleto faz assertDatabaseFileHealthy lancar aqui, com o banco original
    // ainda aberto e utilizavel. Sem isto, o close() acontecia antes da validacao e uma
    // falha deixava o runtime com um handle fechado ("database connection is not open" em
    // toda operacao ate reiniciar o app).
    assertDatabaseFileHealthy(backupPath);

    this.database.close();
    try {
      restoreBackup(backupPath, this.paths.databasePath);
      this.database = openDesktopDatabase({ databasePath: this.paths.databasePath });
      runDesktopMigrations(this.database);
      this.ensureIdentity();
    } catch (error) {
      // Rede de seguranca para falhas apos o close (ex.: erro de disco no copyFileSync):
      // reabre o banco para nao deixar o runtime inutilizavel, e propaga o erro original.
      this.database = openDesktopDatabase({ databasePath: this.paths.databasePath });
      throw error;
    }
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
          // Adiantamentos entram no mesmo ciclo: o saldo que banca as compras
          // envelhece rapido. Falha aqui nao derruba o pull de cadastros.
          try {
            await this.syncCustomerAdvancesFromOmie();
          } catch (error) {
            this.recordTechnicalLog(
              "warning",
              "omie-sync",
              "Falha ao sincronizar adiantamentos do OMIE.",
              { error: error instanceof Error ? error.message : String(error) }
            );
          }
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
    /** Venda em carteira que sai do adiantamento do cliente (ver createWeighingOperation). */
    settleFromAdvance?: boolean;
    scaleCaptureId?: string;
  }): Promise<WeighingOperationSummary> {
    this.assertDesktopAccess();
    // Trava de cadastro ANTES de tudo — antes de capturar peso e antes de conferir
    // adiantamento. O fechamento acontece com o caminhao carregado em cima da balanca e
    // TEM que fechar local (offline-first), entao a abertura e a unica hora em que dizer
    // "falta o endereco do cliente" ainda e barato. Sem isso a venda ia ate o fim e so
    // entao o OMIE recusava o pedido, com a carga ja pesada, impressa e faturada.
    this.assertCustomerReadyForOmie(input.customerId, input.operationType);
    // Venda que vai sair do adiantamento: confere o saldo do cliente no OMIE agora,
    // enquanto o caminhao estabiliza na balanca. O financeiro lanca o adiantamento la,
    // e o que ainda nao foi espelhado aqui e dinheiro que a balanca nao enxerga.
    const advanceSync = input.settleFromAdvance
      ? this.refreshCustomerAdvanceFromOmie(input.customerId, "entrada")
      : Promise.resolve();

    const entryReading =
      this.pendingScaleCaptures.consume(input.scaleCaptureId, { operationType: "entry" }) ??
      (await this.captureStableWeight({ operationType: "entry" }));
    await advanceSync;

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
      settleFromAdvance: input.settleFromAdvance,
      entryWeightKg: entryReading.weightKg,
      entryScaleCapture: buildScaleCaptureAudit(entryReading)
    });
    // O valor de frete desta venda vira o "ultimo valor" do cliente para esse tipo de
    // frete, para a proxima entrada ja vir preenchida. Best-effort: memoria de
    // conveniencia nao pode derrubar o registro de uma entrada.
    if (input.freight && input.freightModality) {
      try {
        rememberCustomerFreightValue(this.database, {
          customerId: input.customerId,
          productId: input.productId,
          modality: input.freightModality,
          rule: input.freight.rule,
          destination: input.freight.destination ?? null,
          showOnReceipt: input.freight.showOnReceipt !== false
        });
      } catch {
        /* ignore */
      }
    }
    // A entrada pode ter gravado condicao/forma como padrao do cliente (primeira escolha).
    this.cacheStore.invalidate("customer", this.ensureIdentity().companyId);
    this.triggerOperationCloudPush("entry_registered", operation.id);
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

    // O abatimento do adiantamento e calculado NO fechamento: e aqui que o saldo
    // precisa estar em dia com o OMIE. Dispara junto com a captura do peso para nao
    // somar espera, e e conferido antes de fechar.
    const advanceSync = this.customerIdOfAdvanceSale(operationId)
      .then((customerId) =>
        customerId ? this.refreshCustomerAdvanceFromOmie(customerId, "fechamento") : undefined
      )
      // A conferencia nunca derruba o fechamento: a operacao fecha local, como manda o
      // offline-first, e a falha ja foi registrada nos logs tecnicos.
      .catch(() => undefined);

    const exitReading =
      this.pendingScaleCaptures.consume(scaleCaptureId, { operationType: "exit", operationId }) ??
      (await this.captureStableWeight({ operationType: "exit" }));
    await advanceSync;

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
    this.triggerOperationCloudPush("exit_registered", operationId);
    // O pedido/OS do fechamento vai para o OMIE imediatamente (apenas os jobs desta
    // operacao), sem esperar a varredura completa de sincronizacao.
    this.triggerBackgroundOmieOrderPush("operation_closed", operationId);
    return operation;
  }

  /**
   * Processa a fila OMIE (pedidos/OS/cancelamentos) com trava unica contra execucoes
   * concorrentes (push do fechamento x sincronizacao agendada). entityId limita aos
   * jobs de uma operacao. Retorna null quando outro processamento ja esta em andamento
   * — e, nesse caso, agenda uma passada COMPLETA para logo apos a atual terminar.
   *
   * Esse re-agendamento e o que impede o pedido de ficar parado: antes, o envio imediato
   * do fechamento que caisse em cima de uma varredura em andamento era simplesmente
   * descartado, e o job so era pego na proxima sincronizacao cloud — ate 30 minutos
   * depois. A passada de recuperacao e completa (sem entityId) de proposito: ela cobre a
   * operacao descartada e qualquer outra que tenha esbarrado na mesma trava.
   */
  private async runOmieQueue(
    entityId?: string
  ): Promise<{ processed: number; failed: number; errors: string[] } | null> {
    if (this.omieQueueProcessing) {
      this.omieQueueRerunRequested = true;
      return null;
    }
    this.omieQueueProcessing = true;
    try {
      // Fila sem job vencido: nada a fazer. Corta antes de qualquer chamada de rede,
      // para o tick de drenagem (e as passadas de recuperacao) custarem uma consulta
      // local quando nao ha fechamento esperando.
      if (!this.hasRunnableOmieJobs(entityId)) {
        return { processed: 0, failed: 0, errors: [] };
      }
      initializeSupabaseFromSettings(this.database);
      if (!isSupabaseInitialized()) {
        return { processed: 0, failed: 0, errors: ["Supabase nao configurado."] };
      }
      const identity = this.ensureIdentity();
      return await processOmieSyncQueue(this.database, identity, { entityId });
    } finally {
      this.omieQueueProcessing = false;
      if (this.omieQueueRerunRequested) {
        // Limpa ANTES de re-executar: a passada de recuperacao pode receber novos
        // pedidos enquanto roda, e eles precisam marcar a proxima — nao esta.
        this.omieQueueRerunRequested = false;
        void this.runOmieQueue().catch((error: unknown) => {
          this.recordTechnicalLog(
            "warning",
            "omie-sync",
            error instanceof Error ? error.message : "Nova passada da fila OMIE falhou.",
            {}
          );
        });
      }
    }
  }

  /**
   * Cadastro do cliente conferido contra o que o OMIE exige para esse tipo de operacao.
   * Alimenta o aviso da tela de entrada (que desabilita o botao antes do operador tentar)
   * e usa a mesma regra da trava de `startWeighing` — tela e backend nunca divergem.
   */
  getCustomerOmieReadiness(
    customerId: string | null,
    operationType?: OperationType
  ): OmieCustomerReadiness {
    this.assertDesktopAccess();
    return checkCustomerOmieReadiness(
      this.database,
      customerId,
      resolveReadinessType(operationType)
    );
  }

  /**
   * Trava da abertura: recusa a entrada enquanto faltar campo que o OMIE exige. A mensagem
   * ja nomeia os campos, entao ela serve tanto para o erro do formulario quanto para o
   * operador saber o que preencher.
   */
  private assertCustomerReadyForOmie(customerId: string, operationType?: OperationType): void {
    const readiness = checkCustomerOmieReadiness(
      this.database,
      customerId,
      resolveReadinessType(operationType)
    );
    if (readiness.ready) return;
    throw new Error(readiness.message ?? "Cadastro do cliente incompleto para o OMIE.");
  }

  /** Ha job OMIE elegivel agora (respeitando o backoff de `next_attempt_at`)? */
  private hasRunnableOmieJobs(entityId?: string): boolean {
    try {
      return listRunnableSyncJobs(this.database, { target: "omie", entityId, limit: 1 }).length > 0;
    } catch {
      // Consulta local falhou (banco ocupado): segue para a passada normal em vez de
      // engolir o envio — errar para o lado de tentar.
      return true;
    }
  }

  /**
   * Confere no OMIE quem ja foi faturado, se o intervalo minimo da conferencia ja passou.
   *
   * Ponto unico dos dois chamadores (o tique do OMIE e a sincronizacao cloud): sem
   * credencial de nuvem nao ha o que perguntar, e a falha nunca sobe — a conferencia e a
   * ultima coisa do sistema que pode derrubar um envio de fechamento.
   */
  private async runOmieBillingCheck(): Promise<OmieBillingReconcileResult> {
    const idle = { checked: 0, billed: 0, skipped: true, errors: [] };
    if (!this.hasCloudCredentials()) return idle;
    initializeSupabaseFromSettings(this.database);
    if (!isSupabaseInitialized()) return idle;
    return await reconcileOmieBillingFromOmie(this.database, this.ensureIdentity());
  }

  /**
   * Liga o tick que drena a fila OMIE e confere o faturamento (ver omie-queue-scheduler).
   * Sem ele, a re-tentativa de um job que falhou (60 s, 2 min, 4 min...) so acontecia
   * quando algo disparava a sincronizacao cloud — no pior caso, o ciclo de 30 minutos —,
   * e a conferencia de faturamento tinha o mesmo problema: acompanhava o dia enquanto a
   * pedreira estava movimentada e parava justamente quando o movimento parava.
   */
  startOmieQueueDrainScheduler(): OmieQueueDrainSchedulerHandle {
    this.omieQueueDrainScheduler?.stop();
    this.omieQueueDrainScheduler = startOmieQueueDrainScheduler({
      hasRunnableJobs: () => this.hasRunnableOmieJobs(),
      drain: async () => {
        await this.runOmieQueue();
      },
      reconcileBilling: async () => {
        await this.runOmieBillingCheck();
      },
      onError: (error) => console.error("Drenagem da fila OMIE falhou", error)
    });

    return this.omieQueueDrainScheduler;
  }

  stopOmieQueueDrainScheduler(): void {
    this.omieQueueDrainScheduler?.stop();
    this.omieQueueDrainScheduler = null;
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
    // O job do fechamento ja foi montado (no close) com o cadastro ANTIGO: sem isto o
    // cliente sobe ao OMIE sem o e-mail/endereco que acabamos de completar e o
    // IncluirCliente e recusado ("O preenchimento da tag [email] e obrigatorio!"),
    // derrubando o pedido junto. Reconstroi o payload antes do envio imediato.
    rearmOmieBillingForCustomer(this.database, op.customer_id);
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
    /** Operacao que sera fechada com este peso (saida). A entrada ainda nao tem uma. */
    operationId?: string;
  }): Promise<ScaleCaptureResult> {
    this.assertDesktopAccess();
    const reading = await this.captureStableWeight(options);
    const captureId = this.pendingScaleCaptures.issue({
      operationType: options.operationType,
      reading,
      operationId: options.operationId
    });
    return { captureId, reading };
  }

  cancelWeighing(operationId: string, reason: string): WeighingOperationSummary {
    this.assertDesktopAccess();
    const operation = cancelWeighingOperation(this.database, { operationId, reason });
    this.triggerOperationCloudPush("operation_cancelled", operationId);
    // Se ja existe pedido no OMIE, o cancel_order enfileirado tambem segue de imediato.
    this.triggerBackgroundOmieOrderPush("operation_cancelled", operationId);
    return operation;
  }

  updateWeighingProduct(input: UpdateWeighingOperationProductInput): WeighingOperationSummary {
    this.assertDesktopAccess();
    const operation = updateWeighingOperationProduct(this.database, input);
    this.triggerOperationCloudPush("operation_product_changed", input.operationId);
    return operation;
  }

  updateWeighingCustomer(input: UpdateWeighingOperationCustomerInput): WeighingOperationSummary {
    this.assertDesktopAccess();
    const operation = updateWeighingOperationCustomer(this.database, input);
    this.triggerOperationCloudPush("operation_customer_changed", input.operationId);
    return operation;
  }

  updateWeighingCarrier(input: UpdateWeighingOperationCarrierInput): WeighingOperationSummary {
    this.assertDesktopAccess();
    const operation = updateWeighingOperationCarrier(this.database, input);
    this.triggerOperationCloudPush("operation_carrier_changed", input.operationId);
    return operation;
  }

  /** Edicao completa de uma operacao em andamento (dados comerciais, preco e frete). */
  updateWeighingOperation(input: UpdateWeighingOperationDetailsInput): WeighingOperationSummary {
    this.assertDesktopAccess();
    const operation = updateWeighingOperationDetails(this.database, input);
    // A correcao do frete tambem vira o "ultimo usado" do cliente: a proxima entrada
    // dele precisa vir com o valor certo, e nao com o que foi corrigido aqui.
    if (input.freight && input.freightModality && operation.customerId && operation.productId) {
      try {
        rememberCustomerFreightValue(this.database, {
          customerId: operation.customerId,
          productId: operation.productId,
          modality: input.freightModality,
          rule: input.freight.rule,
          destination: input.freight.destination ?? null,
          showOnReceipt: input.freight.showOnReceipt !== false
        });
      } catch {
        /* ignore */
      }
    }
    this.triggerOperationCloudPush("operation_updated", input.operationId);
    return operation;
  }

  listOpenWeighingOperations(): WeighingOperationSummary[] {
    this.assertDesktopAccess();
    return listOpenWeighingOperations(this.database);
  }

  /** Transportadora/condicao/forma de pagamento da ultima entrada daquele cliente. */
  getCustomerLastEntryPreferences(customerId: string): CustomerLastEntryPreferences | null {
    this.assertDesktopAccess();
    return getCustomerLastEntryPreferences(this.database, customerId);
  }

  /**
   * Computadores da unidade (multi-desktop): nome + cor de cada maquina para a
   * legenda e o contorno das operacoes. Vem do espelho local alimentado por
   * desktop-status/desktop-pull; funciona offline.
   */
  listUnitDevices(): UnitDeviceInfo[] {
    const identity = getLocalDesktopIdentity(this.database);
    if (!identity) return [];
    return listUnitDevices(this.database, identity);
  }

  /**
   * Pull leve da projecao cloud (operacoes/solicitacoes/cadastros da unidade),
   * sem processar filas de push nem OMIE. Usado pelo renderer para enxergar em
   * perto de tempo real o que os outros computadores da pedreira registraram.
   */
  async pullCloudNow(): Promise<{ pulled: number; errors: string[] }> {
    this.assertDesktopAccess();
    if (this.cloudSyncInProgress) {
      return { pulled: 0, errors: [] };
    }
    try {
      initializeSupabaseFromSettings(this.database);
      if (!isSupabaseInitialized()) {
        return { pulled: 0, errors: [] };
      }
      const identity = this.ensureIdentity();
      // Pull leve: cadastro so com o que mudou desde o ultimo ciclo (a varredura
      // completa, a cada sincronizacao, reenvia o cadastro inteiro).
      const pulled = await pullDesktopDataFromCloud(this.database, identity, {
        incremental: true
      });
      this.cacheStore.loadAll(identity.companyId);
      return {
        pulled:
          pulled.customers +
          pulled.products +
          pulled.operations +
          pulled.loadingRequests +
          pulled.printReceipts +
          pulled.cadastro,
        errors: pulled.warnings
      };
    } catch (error) {
      return {
        pulled: 0,
        errors: [error instanceof Error ? error.message : "Falha ao atualizar dados da nuvem."]
      };
    }
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

  /**
   * Diagnostico "por que essa operacao concluida nao foi ao OMIE", com os campos do
   * cadastro do cliente a corrigir. Usado pelo alerta da tela de Concluidas e pelo
   * botao "Editar item" da fila OMIE (tela cloud).
   */
  getOperationOmieIssue(operationId: string): OperationOmieIssue {
    this.assertDesktopAccess();
    return getOperationOmieIssue(this.database, operationId);
  }

  clearCanceledWeighingOperations(): number {
    this.assertDesktopAccess();
    return clearCanceledWeighingOperations(this.database);
  }

  /**
   * Limpa a lista de concluidas em lote. `untilDate` preserva o movimento do dia
   * corrente: limpar historico nao pode levar junto o que a balanca fez hoje.
   */
  clearClosedWeighingOperations(options: { untilDate?: string } = {}): number {
    this.assertDesktopAccess();
    return clearClosedWeighingOperations(this.database, options);
  }

  deleteClosedWeighingOperation(operationId: string): void {
    this.assertDesktopAccess();
    deleteClosedWeighingOperation(this.database, operationId);
  }

  getCustomerFreightRules(customerId: string) {
    this.assertDesktopAccess();
    return getCustomerFreightRules(this.database, customerId);
  }

  getCustomerFreightForProduct(
    customerId: string,
    productId: string,
    modality?: FreightModality | null
  ) {
    this.assertDesktopAccess();
    return getCustomerFreightRuleForProduct(this.database, customerId, productId, modality);
  }

  /** Ultima observacao de frete escrita para esse cliente, seja qual for o produto. */
  getLastCustomerFreightNote(customerId: string) {
    this.assertDesktopAccess();
    return getLastCustomerFreightNote(this.database, customerId);
  }

  setCustomerFreightRule(input: SetCustomerFreightRuleInput) {
    this.assertDesktopAccess();
    return setCustomerFreightRule(this.database, input);
  }

  removeCustomerFreightRule(ruleId: string) {
    this.assertDesktopAccess();
    return removeCustomerFreightRule(this.database, ruleId);
  }

  removeCustomerFreightModality(ruleId: string, modality: FreightModality) {
    this.assertDesktopAccess();
    return removeCustomerFreightModality(this.database, ruleId, modality);
  }

  /** Notas de venda para entrega futura ja emitidas contra o cliente (por produto). */
  getCustomerFutureBillingInvoices(customerId: string) {
    this.assertDesktopAccess();
    return getCustomerFutureBillingInvoices(this.database, customerId);
  }

  setCustomerFutureBillingInvoice(input: SetCustomerFutureBillingInvoiceInput) {
    this.assertDesktopAccess();
    return setCustomerFutureBillingInvoice(this.database, input);
  }

  removeCustomerFutureBillingInvoice(invoiceId: string) {
    this.assertDesktopAccess();
    return removeCustomerFutureBillingInvoice(this.database, invoiceId);
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

  /** Perfil de cupom 80 mm ativo deste computador — o que a impressao realmente usa. */
  getActiveReceiptProfile(): PrintProfileSummary | null {
    this.assertDesktopAccess();
    return getActiveReceiptPrintProfile(this.database, this.ensureIdentity().deviceId);
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

  /**
   * Assistente da documentacao. Sem `assertDesktopAccess` de proposito: a tela
   * de ajuda tem que responder justamente quando o acesso esta com problema —
   * "o app pediu ativacao de novo" e uma das duvidas que ele existe para
   * resolver. A funcao na nuvem ainda valida o dispositivo por conta propria.
   */
  askDocsAssistant(request: DocsAssistantRequest): Promise<DocsAssistantResult> {
    return askDocsAssistant(this.database, request);
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
      printReceipts: 0,
      cadastro: 0,
      warnings: [] as string[]
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

    // Publica o cadastro desta maquina antes do pull: assim, no primeiro login de
    // um desktop novo, a nuvem ja tem o cadastro das demais e ele entra com a
    // mesma base da pedreira.
    try {
      const cadastroPush = await pushSharedCadastroToCloud(this.database, identity);
      synced += cadastroPush.pushed;
      errors.push(...cadastroPush.errors);
    } catch (error) {
      errors.push(
        `Cadastro compartilhado: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }

    const pulled = await pullDesktopDataFromCloud(this.database, identity);
    errors.push(...pulled.warnings.map((warning) => `Cloud pull: ${warning}`));
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
      // O pedido nao pode ser jogado fora: era assim que uma alteracao feita
      // durante uma varredura longa (cadastro inteiro + fila OMIE) ficava
      // esperando o proximo ciclo agendado — 30 minutos, por padrao.
      this.cloudSyncRerunRequested = true;
      return {
        success: true,
        synced: 0,
        failed: 0,
        errors: ["Sincronizacao cloud ja em andamento; nova passada agendada ao terminar."]
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
        errors.push(`Fila OMIE: ${error instanceof Error ? error.message : "erro desconhecido"}`);
      }

      // Volta do OMIE: quem faturou o pedido/OS foi uma pessoa la dentro, e sem
      // perguntar a pesagem ficaria em "No OMIE, falta faturar" para sempre. O tique do
      // OMIE ja faz isso a cada 30 s (respeitando o intervalo minimo da conferencia);
      // aqui e so para a sincronizacao manual da tela devolver o estado ja atualizado.
      // Nunca derruba a sincronizacao: o cadastro e as operacoes valem mais do que saber
      // a situacao de faturamento agora.
      try {
        const billingCheck = await this.runOmieBillingCheck();
        synced += billingCheck.billed;
        errors.push(...billingCheck.errors);
      } catch (error) {
        errors.push(
          `Conferencia de faturamento OMIE: ${error instanceof Error ? error.message : "erro desconhecido"}`
        );
      }

      // Reconciliacao: toda operacao cuja versao local esta na frente do que a
      // nuvem confirmou volta a ser enviada — abertas, fechadas e canceladas,
      // criadas aqui ou em outra balanca. E a rede de seguranca da fila de jobs,
      // que descarta o job depois de 10 falhas (uma queda de internet longa
      // bastava para o fechamento nunca chegar na outra maquina).
      const pendingOperations = listOperationsPendingCloudPush(this.database);
      const pushedRequestIds = new Set<string>();
      for (const pending of pendingOperations) {
        try {
          await syncOperationToSupabase(this.database, pending.id, identity);
          synced++;
        } catch (error) {
          failed++;
          errors.push(
            `Operation ${pending.id}: ${error instanceof Error ? error.message : "Unknown error"}`
          );
          continue;
        }
        // A solicitacao de carregamento acompanha a operacao: e o que fecha a
        // luz do carregador na outra balanca junto com o fechamento.
        if (!pending.loadingRequestId) continue;
        try {
          await syncLoadingRequestToSupabase(this.database, pending.loadingRequestId, identity);
          pushedRequestIds.add(pending.loadingRequestId);
          synced++;
        } catch (error) {
          failed++;
          errors.push(
            `Loading request ${pending.loadingRequestId}: ${error instanceof Error ? error.message : "Unknown error"}`
          );
        }
      }

      // Sync loading requests
      const loadingRequests = this.database
        .prepare("SELECT id FROM loading_requests WHERE status = 'open'")
        .all() as Array<{ id: string }>;

      for (const request of loadingRequests) {
        if (pushedRequestIds.has(request.id)) continue;
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

      // Cadastro compartilhado da pedreira (clientes, produtos, transportadoras,
      // motoristas, veiculos, vinculos e precos): publica o que esta maquina
      // conhece para as demais receberem no pull logo abaixo.
      try {
        const cadastroPush = await pushSharedCadastroToCloud(this.database, identity);
        synced += cadastroPush.pushed;
        errors.push(...cadastroPush.errors);
      } catch (error) {
        errors.push(
          `Cadastro compartilhado: ${error instanceof Error ? error.message : "Unknown error"}`
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
          cloudPull.printReceipts +
          cloudPull.cadastro;
        // Avisos por tabela (ex.: migracao pendente na nuvem) chegam como erros
        // de sincronizacao para nao passarem despercebidos.
        errors.push(...cloudPull.warnings.map((warning) => `Cloud pull: ${warning}`));
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
      if (this.cloudSyncRerunRequested) {
        this.cloudSyncRerunRequested = false;
        void this.syncCloudNow().catch((error: unknown) => {
          this.recordTechnicalLog(
            "error",
            "cloud-sync",
            error instanceof Error ? error.message : "Nova passada da sincronizacao cloud falhou.",
            {}
          );
        });
      }
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
    if (this.scaleConnectInFlight) return this.scaleConnectInFlight;
    const attempt = this.runConnectScale().finally(() => {
      this.scaleConnectInFlight = null;
    });
    this.scaleConnectInFlight = attempt;
    return attempt;
  }

  private async runConnectScale(): Promise<void> {
    const scaleConfig = this.getScaleConfiguration();
    const sessionKey = scaleSessionKey(scaleConfig);

    // Mesma configuracao e sessao viva: nao ha o que reconectar. Derrubar a sessao
    // para reabri-la — o que acontecia a cada tela de pesagem que abria — cortava o
    // peso ao vivo por alguns segundos e fazia a tela pedir reconexao sem motivo.
    // A chave inclui host/porta/baud: se o operador mudar a configuracao em
    // Configuracoes > Balanca, a sessao antiga cai e a nova entra normalmente.
    if (
      this.activeScaleSessionKey === sessionKey &&
      this.activeScaleAdapter === this.adapterFor(scaleConfig.adapterType) &&
      this.activeScaleAdapter.getStatus().state === "connected"
    ) {
      // Sem tocar no adaptador, os forwarders ja registrados continuam validos —
      // reanexa-los aqui duplicaria cada leitura enviada ao renderer.
      return;
    }

    this.activeScaleSessionKey = null;
    this.activateAdapter(scaleConfig.adapterType);
    this.activeScaleAdapter.removeAllListeners();
    // Reanexa os forwarders persistentes ao adaptador recem-ativado. Sem isto, o listener que
    // envia desktop:scale-reading ao renderer (registrado so no startup/connect no main) some
    // apos uma reconexao automatica disparada durante a captura, e o peso ao vivo congela.
    this.reattachScaleReadingListeners();

    if (scaleConfig.adapterType === "virtual") {
      await this.virtualScaleAdapter.connect({ host: "virtual", port: 0 });
      this.activeScaleSessionKey = sessionKey;
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
        maxReconnectAttempts: SCALE_CONNECTION_TUNING.maxReconnectAttempts,
        reconnectBackoffMaxMs: SCALE_CONNECTION_TUNING.reconnectBackoffMaxMs,
        staleReadingMs: SCALE_CONNECTION_TUNING.staleReadingMs
      });
      this.activeScaleSessionKey = sessionKey;
      return;
    }

    await this.tcpScaleAdapter.connect({
      host: scaleConfig.connection.host,
      port: scaleConfig.connection.port,
      timeoutMs: SCALE_CONNECTION_TUNING.timeoutMs,
      reconnectIntervalMs: SCALE_CONNECTION_TUNING.reconnectIntervalMs,
      maxReconnectAttempts: SCALE_CONNECTION_TUNING.maxReconnectAttempts,
      reconnectBackoffMaxMs: SCALE_CONNECTION_TUNING.reconnectBackoffMaxMs,
      staleReadingMs: SCALE_CONNECTION_TUNING.staleReadingMs,
      silenceRotateMs: SCALE_CONNECTION_TUNING.silenceRotateMs
    });
    this.activeScaleSessionKey = sessionKey;
  }

  private adapterFor(adapterType: ScaleAdapterType): ActiveScaleAdapter {
    if (adapterType === "virtual") return this.virtualScaleAdapter;
    if (adapterType === "serial") return this.serialScaleAdapter;
    return this.tcpScaleAdapter;
  }

  private activateAdapter(adapterType: ScaleAdapterType): void {
    this.tcpScaleAdapter.disconnect();
    this.serialScaleAdapter.disconnect();
    this.virtualScaleAdapter.disconnect();
    this.activeScaleAdapter = this.adapterFor(adapterType);
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
    this.activeScaleSessionKey = null;
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
    // Idempotente: o main reregistra o forwarder do renderer a cada conexao, e sem
    // esta guarda o mesmo callback entrava varias vezes na lista do adaptador —
    // cada leitura chegava duplicada na tela e a inscricao antiga vazava.
    if (!this.scaleReadingUnsubscribes.has(callback)) {
      this.scaleReadingUnsubscribes.set(callback, this.activeScaleAdapter.onReading(callback));
    }
    return () => {
      const current = this.scaleReadingUnsubscribes.get(callback);
      if (current) {
        current();
        this.scaleReadingUnsubscribes.delete(callback);
      }
    };
  }

  /** Reinscreve todos os forwarders persistentes no adaptador ativo (usado apos reconexao). */
  private reattachScaleReadingListeners(): void {
    const listeners = [...this.scaleReadingUnsubscribes.keys()];
    this.scaleReadingUnsubscribes.clear();
    for (const listener of listeners) {
      const unsubscribe = this.activeScaleAdapter.onReading(listener);
      this.scaleReadingUnsubscribes.set(listener, unsubscribe);
    }
  }

  verifyPriceChangePassword(password: string): boolean {
    const identity = this.ensureIdentity();
    const row = this.database
      .prepare("SELECT price_change_password FROM companies WHERE id = ?")
      .get(identity.companyId) as { price_change_password: string } | undefined;
    if (!row) return false;
    return safeStringEquals(row.price_change_password, password);
  }

  close(): void {
    this.backupScheduler?.stop();
    this.backupScheduler = null;
    this.cloudSyncScheduler?.stop();
    this.cloudSyncScheduler = null;
    this.omieScheduler?.stop();
    this.omieScheduler = null;
    // Antes do database.close(): o tick da fila consulta o SQLite, e um timer vivo
    // depois do fechamento bate num handle fechado a cada 30 s.
    this.omieQueueDrainScheduler?.stop();
    this.omieQueueDrainScheduler = null;
    // A reconexao da balanca nao desiste mais sozinha: sem encerrar o adaptador no
    // fechamento, o timer da proxima tentativa sobrevive ao pedido de saida.
    this.disconnectScale();
    this.database.close();
  }

  getDesktopAccessStatus(): DesktopAccessStatus {
    return getStoredDesktopAccessStatus(this.database);
  }

  /**
   * Canal de atualizacao desta balanca (`latest` = producao, `beta` = teste).
   * Quem define e o painel administrativo; o `desktop-status` traz o valor e o
   * `main.ts` aplica no `electron-updater`. Ler daqui e nao do banco direto
   * mantem o `main.ts` sem acesso ao SQLite.
   */
  getUpdateChannel(): DesktopUpdateChannel {
    return readUpdateChannel(this.database);
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

  getSalesPivot(
    startDate: string,
    endDate: string,
    groupBy: Parameters<ReportService["getSalesPivot"]>[3],
    filters?: Parameters<ReportService["getSalesPivot"]>[4]
  ): ReturnType<ReportService["getSalesPivot"]> {
    return this.reportService.getSalesPivot(
      startDate,
      endDate,
      this.ensureIdentity().unitId,
      groupBy,
      filters
    );
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

  /**
   * Controle de caminhoes do periodo, ja recortado pela busca de placa/motorista quando
   * ela vem preenchida — a tela, o PDF e a planilha partem deste mesmo relatorio.
   */
  getTruckControlReport(
    startDate: string,
    endDate: string,
    search?: string | null
  ): ReturnType<ReportService["getTruckControlReport"]> {
    return filterTruckControlReport(
      this.reportService.getTruckControlReport(startDate, endDate, this.ensureIdentity().unitId),
      search
    );
  }

  getTruckControlHtml(startDate: string, endDate: string, search?: string | null): string {
    return renderTruckControlHtml(this.getTruckControlReport(startDate, endDate, search));
  }

  /**
   * Documento do controle de caminhoes pronto para gravar em disco, no formato pedido. O
   * main so escolhe o destino e escreve, como nos demais relatorios.
   */
  buildTruckControlDocument(
    format: "pdf" | "excel",
    startDate: string,
    endDate: string,
    search?: string | null
  ): { format: "pdf" | "excel"; fileName: string; html: string } {
    const report = this.getTruckControlReport(startDate, endDate, search);
    return {
      format,
      fileName: `${truckControlFileBaseName(report)}.${format === "pdf" ? "pdf" : "xls"}`,
      html:
        format === "pdf" ? renderTruckControlHtml(report) : renderTruckControlSpreadsheet(report)
    };
  }

  // --- Relatorio por cliente -------------------------------------------------

  listCustomerReportOptions(): ReturnType<CustomerReportService["listCustomerOptions"]> {
    return this.customerReportService.listCustomerOptions(this.ensureIdentity().unitId);
  }

  getCustomerReport(
    customerId: string,
    startDate: string,
    endDate: string,
    periodLabel?: string | null
  ): ReturnType<CustomerReportService["getCustomerReport"]> {
    return this.customerReportService.getCustomerReport(
      customerId,
      startDate,
      endDate,
      this.ensureIdentity().unitId,
      periodLabel
    );
  }

  getCustomersOverview(
    startDate: string,
    endDate: string,
    periodLabel?: string | null
  ): ReturnType<CustomerReportService["getCustomersOverview"]> {
    return this.customerReportService.getCustomersOverview(
      startDate,
      endDate,
      this.ensureIdentity().unitId,
      periodLabel
    );
  }

  /** Resumo comparativo de todos os clientes do periodo, pronto para gravar em disco. */
  buildCustomersOverviewDocuments(
    startDate: string,
    endDate: string,
    formats: Array<"pdf" | "excel">,
    periodLabel?: string | null
  ): Array<{ format: "pdf" | "excel"; fileName: string; html: string }> {
    const overview = this.getCustomersOverview(startDate, endDate, periodLabel);
    const baseName = customersOverviewFileBaseName(overview);
    return formats.map((format) => ({
      format,
      fileName: `${baseName}.${format === "pdf" ? "pdf" : "xls"}`,
      html:
        format === "pdf"
          ? renderCustomersOverviewHtml(overview)
          : renderCustomersOverviewSpreadsheet(overview)
    }));
  }

  /**
   * "Conferir notas no OMIE" do relatorio por cliente: pergunta AGORA o numero da nota das
   * cargas do cliente no periodo.
   *
   * A atendente que vai mandar o relatorio para o cliente nao pode esperar a vez do rodizio
   * — e era exatamente isso que ela via: o relatorio saindo com "-" na coluna Nota fiscal
   * numa carga cuja nota ja existia no OMIE havia dias.
   *
   * Manda TODAS as operacoes do periodo e deixa a reconciliacao escolher: e ela que sabe
   * quais ainda tem documento a perguntar (pedido de venda ou ordem de servico) e quais ja
   * estao resolvidas. Filtrar aqui duplicaria essa regra em dois lugares — e a versao daqui
   * nem enxerga a ordem de servico da venda interna.
   */
  async reconcileCustomerReportNotes(
    customerId: string,
    startDate: string,
    endDate: string
  ): Promise<{ checked: number; billed: number; errors: string[] }> {
    this.assertDesktopAccess();
    const report = this.getCustomerReport(customerId, startDate, endDate);
    const operationIds = report.operations.map((operation) => operation.id);
    if (operationIds.length === 0) return { checked: 0, billed: 0, errors: [] };
    const result = await reconcileOmieBillingFromOmie(this.database, this.ensureIdentity(), {
      operationIds
    });
    return { checked: result.checked, billed: result.billed, errors: result.errors };
  }

  /**
   * Documentos do relatorio por cliente prontos para gravar em disco. O main so escolhe
   * o destino e escreve: PDF passa pelo `renderHtmlToPdf` (HTML A4) e Excel e gravado
   * direto (HTML de tabelas com extensao `.xls`).
   */
  buildCustomerReportDocuments(
    customerId: string,
    startDate: string,
    endDate: string,
    variants: CustomerReportVariant[],
    formats: Array<"pdf" | "excel">,
    periodLabel?: string | null
  ): Array<{
    variant: CustomerReportVariant;
    format: "pdf" | "excel";
    fileName: string;
    html: string;
  }> {
    const report = this.getCustomerReport(customerId, startDate, endDate, periodLabel);
    const documents: Array<{
      variant: CustomerReportVariant;
      format: "pdf" | "excel";
      fileName: string;
      html: string;
    }> = [];
    for (const variant of variants) {
      const baseName = customerReportFileBaseName(report, variant);
      for (const format of formats) {
        documents.push({
          variant,
          format,
          fileName: `${baseName}.${format === "pdf" ? "pdf" : "xls"}`,
          html:
            format === "pdf"
              ? renderCustomerReportHtml(report, variant)
              : renderCustomerReportSpreadsheet(report, variant)
        });
      }
    }
    return documents;
  }

  // --- Conferencia de faturamento --------------------------------------------

  getWeighingBillingReport(
    startDate: string,
    endDate: string,
    options?: WeighingBillingReportOptions
  ): ReturnType<WeighingBillingReportService["getReport"]> {
    return this.weighingBillingReportService.getReport(
      startDate,
      endDate,
      this.ensureIdentity().unitId,
      options
    );
  }

  /**
   * Os documentos da conferencia prontos para gravar. Recebem os MESMOS filtros da tela:
   * o arquivo tem de trazer exatamente as pesagens que o operador estava olhando quando
   * clicou em gerar — um PDF com o periodo inteiro depois de filtrar por "Recusada pelo
   * OMIE" nao serviria para conferir nada.
   */
  buildWeighingBillingReportDocuments(
    startDate: string,
    endDate: string,
    formats: Array<"pdf" | "excel">,
    options?: WeighingBillingReportOptions
  ): Array<{ format: "pdf" | "excel"; fileName: string; html: string }> {
    const report = this.getWeighingBillingReport(startDate, endDate, options);
    const baseName = weighingBillingReportFileBaseName(report);
    return formats.map((format) => ({
      format,
      fileName: `${baseName}.${format === "pdf" ? "pdf" : "xls"}`,
      html:
        format === "pdf"
          ? renderWeighingBillingReportHtml(report)
          : renderWeighingBillingReportSpreadsheet(report)
    }));
  }

  // --- Fechamento de faturas -------------------------------------------------

  getInvoiceClosing(
    startDate: string,
    endDate: string,
    options?: InvoiceClosingOptions
  ): ReturnType<InvoiceClosingService["getReport"]> {
    return this.invoiceClosingService.getReport(
      startDate,
      endDate,
      this.ensureIdentity().unitId,
      options
    );
  }

  /**
   * "Cancelar as pesagens repetidas": tira do sistema a carga que foi registrada duas vezes.
   *
   * O relancamento feito para corrigir preco ou tipo de venda deixa a pesagem errada para
   * tras, concluida, somando no fechamento e, no OMIE, virando um pedido que alguem exclui
   * la dentro — e e essa a diferenca entre os dois totais. O fechamento ja para de cobrar a
   * repetida sozinho; este botao e o passo que faltava: cancela de vez, com motivo gravado,
   * e leva o cancelamento para a nuvem e para o OMIE pelo caminho normal do
   * `cancelWeighing` (que exclui o pedido/OS de la quando ele ainda nao virou nota).
   *
   * Cancela SO as repetidas que o relatorio marcou (`report.duplicates[].repeats`), e
   * recalcula a lista aqui em vez de aceitar ids da tela: entre abrir a tela e clicar o
   * botao a base pode ter mudado, e cancelar pesagem por id vindo de fora seria uma porta
   * para cancelar qualquer carga.
   *
   * Repetida que JA TEM NOTA emitida nao e cancelada: a nota existe, o cliente vai receber a
   * cobranca dela, e so o OMIE cancela nota fiscal. Ela volta na lista de `skipped`, com o
   * numero da nota, para a atendente resolver do lado de la.
   */
  cancelInvoiceClosingDuplicates(
    startDate: string,
    endDate: string,
    options?: InvoiceClosingOptions
  ): { cancelled: number; skipped: Array<{ couponNumber: number | null; invoiceNumber: string }> } {
    this.assertDesktopAccess();
    const report = this.getInvoiceClosing(startDate, endDate, options);
    const skipped: Array<{ couponNumber: number | null; invoiceNumber: string }> = [];
    let cancelled = 0;

    for (const group of report.duplicates) {
      for (const repeat of group.repeats) {
        if (repeat.invoiceNumber) {
          skipped.push({
            couponNumber: repeat.couponNumber,
            invoiceNumber: repeat.invoiceNumber
          });
          continue;
        }
        const keptCoupon = group.kept[0]?.couponNumber ?? null;
        this.cancelWeighing(
          repeat.operationId,
          keptCoupon === null
            ? "Pesagem repetida: a mesma carga ja esta registrada em outro vale."
            : `Pesagem repetida: a mesma carga ja esta registrada no vale ${keptCoupon}.`
        );
        cancelled += 1;
      }
    }

    return { cancelled, skipped };
  }

  /**
   * Os documentos do fechamento prontos para gravar. Recebem os MESMOS filtros da tela: o
   * arquivo que vai para o cliente tem de trazer exatamente as faturas que a atendente
   * estava olhando quando clicou em gerar.
   */
  buildInvoiceClosingDocuments(
    startDate: string,
    endDate: string,
    formats: Array<"pdf" | "excel">,
    options?: InvoiceClosingOptions
  ): Array<{ format: "pdf" | "excel"; fileName: string; html: string }> {
    const report = this.getInvoiceClosing(startDate, endDate, options);
    const baseName = invoiceClosingFileBaseName(report);
    return formats.map((format) => ({
      format,
      fileName: `${baseName}.${format === "pdf" ? "pdf" : "xls"}`,
      html:
        format === "pdf"
          ? renderInvoiceClosingHtml(report)
          : renderInvoiceClosingSpreadsheet(report)
    }));
  }

  /**
   * "Fazer fechamento": fatura no OMIE todas as pesagens do periodo que estao na tela.
   *
   * Recebe os MESMOS filtros da consulta de proposito: o que e faturado tem de ser
   * exatamente o que a atendente viu antes de confirmar — refazer a selecao aqui abriria a
   * porta para o botao emitir nota de uma carga que nao estava na lista.
   *
   * Emite nota fiscal de verdade, entao a confirmacao e a contagem sao da tela; aqui a
   * garantia e outra: pesagem ja faturada nao e reenviada, e uma recusa nao interrompe o
   * resto da passada.
   *
   * NAO imprime as notas, ao contrario do botao de faturar UMA pesagem. Ali o motorista
   * esta no patio esperando o papel; aqui a quinzena fechada dispararia trinta impressoes
   * de uma vez, dias depois de as cargas terem saido. O link de cada documento fica
   * gravado na operacao (`omie_document_url`) e a nota continua no OMIE.
   */
  async runInvoiceClosing(
    startDate: string,
    endDate: string,
    options?: InvoiceClosingOptions,
    onProgress?: (progress: InvoiceClosingRunProgress) => void
  ): Promise<InvoiceClosingRunResult> {
    this.assertDesktopAccess();
    await this.reconcileClosingPeriodWithOmie(startDate, endDate, options);
    const report = this.getInvoiceClosing(startDate, endDate, options);
    return runInvoiceClosing(
      selectInvoiceClosingCandidates(report.rows),
      (operationId) => processFiscalBillingNow(this.database, this.ensureIdentity(), operationId),
      onProgress
    );
  }

  /**
   * Pergunta ao OMIE o que das cargas do periodo JA foi faturado la, antes de faturar
   * qualquer coisa.
   *
   * O KyberRock cria o pedido na etapa "Faturar" e para ali: quem emite a nota costuma ser
   * uma pessoa, dentro do OMIE, e a balanca so descobre isso pela reconciliacao — que roda
   * por rodizio e pode nao ter chegado nestas cargas ainda. Sem esta passada, o fechamento
   * de uma quinzena ja resolvida no OMIE tentava faturar tudo de novo e voltava com uma
   * lista de "nao foi possivel faturar... ja foi autorizado", que parece erro e nao e.
   *
   * Falha aqui nao impede o fechamento: sem internet ou com o OMIE fora, a passada segue
   * com o que se sabe localmente, e a recusa por "ja autorizado" ainda e reconhecida uma a
   * uma no faturamento.
   */
  /**
   * Pergunta ao OMIE o numero da nota DESTAS cargas — as que estao na tela agora.
   *
   * Chamada pela propria tela ao abrir: a reconciliacao de fundo pergunta por rodizio, e o
   * rodizio poe o movimento dos ultimos dois dias na frente do acervo. Fechar a quinzena
   * do dia 1 ao 15 e olhar justamente para o acervo — as cargas que a atendente precisa
   * agora sao as que o rodizio deixa para depois —, e por isso a coluna "Nota fiscal" saia
   * com "-" numa carga cuja nota ja existia no OMIE.
   *
   * Somente LEITURA: nao fatura, nao emite e nao muda documento nenhum no OMIE. As cargas
   * sem documento la, ou ja canceladas, sao descartadas na propria consulta da
   * reconciliacao — mandar o id delas nao custa chamada.
   */
  async reconcileOmieInvoiceNumbers(
    operationIds: readonly string[]
  ): Promise<{ checked: number; billed: number; errors: string[] }> {
    this.assertDesktopAccess();
    const wanted = operationIds.slice(0, OMIE_INVOICE_NUMBER_ASK_LIMIT);
    if (wanted.length === 0) return { checked: 0, billed: 0, errors: [] };
    const result = await reconcileOmieBillingFromOmie(this.database, this.ensureIdentity(), {
      operationIds: wanted
    });
    return { checked: result.checked, billed: result.billed, errors: result.errors };
  }

  /** As cargas do periodo que ja tem documento no OMIE e ainda estao sem numero de nota. */
  private closingPeriodOperationsWithoutInvoice(
    startDate: string,
    endDate: string,
    options?: InvoiceClosingOptions
  ): string[] {
    return selectOperationsMissingInvoiceNumber(
      this.getInvoiceClosing(startDate, endDate, options).rows
    );
  }

  private async reconcileClosingPeriodWithOmie(
    startDate: string,
    endDate: string,
    options?: InvoiceClosingOptions
  ): Promise<void> {
    const operationIds = this.closingPeriodOperationsWithoutInvoice(startDate, endDate, options);
    if (operationIds.length === 0) return;

    try {
      await reconcileOmieBillingFromOmie(this.database, this.ensureIdentity(), { operationIds });
    } catch {
      // Silencioso de proposito: a conferencia e um ganho, nao um pre-requisito.
    }
  }

  /** Quantas pesagens do periodo o botao de fechamento mandaria ao OMIE, sem mandar nada. */
  async previewInvoiceClosingRun(
    startDate: string,
    endDate: string,
    options?: InvoiceClosingOptions
  ): Promise<{ billable: number; total: number }> {
    // Concilia antes de contar: a confirmacao precisa dizer quantas notas vao SAIR, e nao
    // quantas o app ainda achava que faltavam.
    await this.reconcileClosingPeriodWithOmie(startDate, endDate, options);
    const report = this.getInvoiceClosing(startDate, endDate, options);
    const candidates = selectInvoiceClosingCandidates(report.rows);
    return { billable: countBillableCandidates(candidates), total: candidates.length };
  }

  getReportDispatchConfig(): { settings: ReportDispatchSettings; state: ReportDispatchState } {
    return {
      settings: readReportDispatchSettings(this.database),
      state: readReportDispatchState(this.database)
    };
  }

  saveReportDispatchConfig(patch: Partial<ReportDispatchSettings>): {
    settings: ReportDispatchSettings;
    state: ReportDispatchState;
  } {
    const settings = writeReportDispatchSettings(this.database, patch);
    return { settings, state: readReportDispatchState(this.database) };
  }

  // Tick do agendador (chamado pelo main a cada poucos minutos): envia os
  // pacotes vencidos e marca o estado. Depois de uma falha total, espera 30min
  // antes de tentar de novo para nao martelar SMTP/UAZAPI.
  async runReportDispatchTick(
    renderPdf: (html: string) => Promise<Buffer>,
    now: Date = new Date()
  ): Promise<DispatchSendResult | null> {
    const settings = readReportDispatchSettings(this.database);
    const state = readReportDispatchState(this.database);
    const due = computeDueBundles(settings, state, now);
    if (due.length === 0) return null;

    if (state.lastError && state.lastAttemptAt) {
      const sinceLastAttemptMs = now.getTime() - new Date(state.lastAttemptAt).getTime();
      if (sinceLastAttemptMs < 30 * 60_000) return null;
    }

    const result = await this.dispatchBundles(due, renderPdf, now);
    const anySuccess = result.emailsSent > 0 || result.whatsappSent > 0;
    const allErrors = [...result.emailErrors, ...result.whatsappErrors];
    const statePatch: Partial<ReportDispatchState> = {
      lastAttemptAt: now.toISOString(),
      lastError: allErrors.length > 0 ? allErrors[0] : null
    };
    // So marca o pacote como enviado se algum destinatario recebeu; falha total
    // fica pendente para a proxima tentativa.
    if (anySuccess || result.recipients === 0) {
      for (const bundle of due) {
        if (bundle.kind === "daily") statePatch.lastDailyDate = bundle.endDate;
        if (bundle.kind === "weekly") statePatch.lastWeeklyDate = bundle.endDate;
        if (bundle.kind === "monthly") statePatch.lastMonthlyMonth = bundle.startDate.slice(0, 7);
      }
    }
    writeReportDispatchState(this.database, statePatch);
    return result;
  }

  // Botao "Enviar agora": envia os pacotes marcados nas configuracoes com os
  // periodos de hoje, sem tocar no estado do agendador.
  async sendReportsNow(
    renderPdf: (html: string) => Promise<Buffer>,
    now: Date = new Date()
  ): Promise<DispatchSendResult> {
    const settings = readReportDispatchSettings(this.database);
    return this.dispatchBundles(computeManualBundles(settings, now), renderPdf, now);
  }

  // Botao "Enviar agora" do relatorio financeiro do OMIE. Diferente dos demais
  // relatorios, este e montado e enviado pela nuvem (unico lugar que fala com o
  // OMIE): aqui so pedimos o disparo imediato para os destinatarios marcados.
  async sendFinancialReportNow(): Promise<FinancialReportDispatchResult[]> {
    const identity = this.ensureIdentity();
    return sendFinancialReportNow(this.database, identity);
  }

  private async buildBundleAttachments(
    bundles: DueBundle[],
    renderPdf: (html: string) => Promise<Buffer>,
    monthly: MonthToDateSales | null
  ): Promise<ReportAttachment[]> {
    const attachments: ReportAttachment[] = [];
    for (const bundle of bundles) {
      const suffix =
        bundle.kind === "daily"
          ? bundle.endDate
          : bundle.kind === "weekly"
            ? `semana-${bundle.startDate}-a-${bundle.endDate}`
            : `mes-${bundle.startDate.slice(0, 7)}`;

      const insightsPdf = await renderPdf(
        this.getInsightsHtml(bundle.startDate, bundle.endDate, bundle.label)
      );
      attachments.push({
        filename: `insights-${suffix}.pdf`,
        mimetype: "application/pdf",
        content: insightsPdf,
        reportType: "sales",
        bundleLabel: bundle.label
      });
      // Vendas vai em PDF (mesmo HTML A4 do relatorio da tela) — o anexo era um
      // `.xls` de tabelas HTML, que muitos destinatarios abriam no celular sem
      // Excel instalado.
      const salesPdf = await renderPdf(this.getReportHtml(bundle.startDate, bundle.endDate));
      attachments.push({
        filename: `vendas-${suffix}.pdf`,
        mimetype: "application/pdf",
        content: salesPdf,
        reportType: "sales",
        bundleLabel: bundle.label
      });

      const trucksPdf = await renderPdf(this.getTruckControlHtml(bundle.startDate, bundle.endDate));
      attachments.push({
        filename: `caminhoes-${suffix}.pdf`,
        mimetype: "application/pdf",
        content: trucksPdf,
        reportType: "trucks",
        bundleLabel: bundle.label
      });
    }

    // Vendas do mes corrente acompanham todo envio: quem recebe o diario ou o
    // semanal ve no mesmo e-mail como o mes esta acumulando ate hoje.
    if (monthly) {
      const monthlySalesPdf = await renderPdf(
        this.getReportHtml(monthly.startDate, monthly.endDate)
      );
      attachments.push({
        filename: `vendas-mes-${monthly.month}.pdf`,
        mimetype: "application/pdf",
        content: monthlySalesPdf,
        reportType: "sales",
        bundleLabel: monthly.label
      });
    }
    return attachments;
  }

  private async dispatchBundles(
    bundles: DueBundle[],
    renderPdf: (html: string) => Promise<Buffer>,
    now: Date = new Date()
  ): Promise<DispatchSendResult> {
    const recipients = this.listReportRecipients().filter((recipient) => recipient.isActive);
    const result: DispatchSendResult = {
      bundles: bundles.map((bundle) => bundle.kind),
      recipients: recipients.length,
      emailsSent: 0,
      emailErrors: [],
      whatsappSent: 0,
      whatsappErrors: []
    };
    if (recipients.length === 0) return result;

    // No dia 1 o pacote diario ja cobre o acumulado do mes — nao repete o anexo.
    const monthlySales = monthToDateSales(now);
    const monthly = coversMonthToDate(bundles, monthlySales) ? null : monthlySales;
    const attachments = await this.buildBundleAttachments(bundles, renderPdf, monthly);
    const channelSettings = readReportChannelSettings(this.database);
    const labels = bundles.map((bundle) => bundle.label).join(" · ");
    const bodyLabels = monthly ? `${labels} · ${monthly.label}` : labels;
    const subject = `Relatorios KyberRock — ${labels}`;
    const bodyHtml = `<!doctype html><html><head><meta charset="utf-8" /></head><body style="font-family:Arial,sans-serif;padding:16px"><p>Seguem em anexo os relatorios: <strong>${bodyLabels}</strong>.</p><p style="color:#64748b;font-size:12px">Enviado automaticamente pelo KyberRock Desktop.</p></body></html>`;

    for (const recipient of recipients) {
      const recipientAttachments = attachments.filter(
        (attachment) =>
          recipient.reportTypes === "both" || attachment.reportType === recipient.reportTypes
      );
      if (recipientAttachments.length === 0) continue;

      if (recipient.sendEmail && recipient.email) {
        const emailResult = await this.sendReportEmail({
          to: recipient.email,
          subject,
          html: bodyHtml,
          attachments: recipientAttachments.map((attachment) => ({
            filename: attachment.filename,
            content: attachment.content,
            contentType: attachment.mimetype
          }))
        });
        if (emailResult.success) {
          result.emailsSent += 1;
        } else {
          result.emailErrors.push(`${recipient.email}: ${emailResult.error ?? "falha no envio"}`);
        }
      }

      if (recipient.sendWhatsapp && recipient.whatsappPhone) {
        if (!channelSettings.uazapiBaseUrl || !channelSettings.uazapiInstanceToken) {
          result.whatsappErrors.push(
            `${recipient.whatsappPhone}: WhatsApp nao configurado (URL/token da instancia).`
          );
        } else {
          for (const [index, attachment] of recipientAttachments.entries()) {
            try {
              await uazapiSendDocument({
                baseUrl: channelSettings.uazapiBaseUrl,
                instanceToken: channelSettings.uazapiInstanceToken,
                number: recipient.whatsappPhone,
                fileBase64: `data:${attachment.mimetype};base64,${attachment.content.toString("base64")}`,
                docName: attachment.filename,
                mimetype: attachment.mimetype,
                caption: index === 0 ? `Relatorios KyberRock — ${bodyLabels}` : undefined
              });
              result.whatsappSent += 1;
            } catch (error) {
              result.whatsappErrors.push(
                `${recipient.whatsappPhone} (${attachment.filename}): ${
                  error instanceof Error ? error.message : "falha no envio"
                }`
              );
            }
          }
        }
      }
    }
    return result;
  }

  listReportRecipients(): ReportRecipient[] {
    return listReportRecipients(this.database, this.ensureIdentity().companyId);
  }

  async createReportRecipient(
    input: Omit<CreateReportRecipientInput, "companyId">
  ): Promise<ReportRecipient> {
    const created = createReportRecipient(this.database, {
      companyId: this.ensureIdentity().companyId,
      ...input
    });
    await this.pushReportRecipientsBestEffort();
    return this.refreshReportRecipient(created);
  }

  async updateReportRecipient(
    id: string,
    input: UpdateReportRecipientInput
  ): Promise<ReportRecipient> {
    const updated = updateReportRecipient(this.database, id, input);
    await this.pushReportRecipientsBestEffort();
    return this.refreshReportRecipient(updated);
  }

  async deleteReportRecipient(id: string): Promise<void> {
    deleteReportRecipient(this.database, id);
    await this.pushReportRecipientsBestEffort();
  }

  /**
   * Empurra os destinatarios pendentes para a nuvem IMEDIATAMENTE apos salvar:
   * o envio automatico roda na nuvem, entao esperar o ciclo de 30 min deixava
   * uma janela em que o destinatario existia so no desktop e o agendador
   * despachava "sem destinatarios ativos". Falha aqui nao bloqueia o salvar —
   * needs_push continua 1 e o ciclo agendado re-tenta.
   */
  private async pushReportRecipientsBestEffort(): Promise<void> {
    try {
      initializeSupabaseFromSettings(this.database);
      if (!isSupabaseInitialized()) return;
      await pushPendingReportRecipients(this.database, this.ensureIdentity());
    } catch {
      // sync_status='error' fica registrado na linha; o scheduler re-tenta.
    }
  }

  /** Rele o destinatario para devolver o sync_status ja atualizado pelo push. */
  private refreshReportRecipient(fallback: ReportRecipient): ReportRecipient {
    const rows = listReportRecipients(this.database, this.ensureIdentity().companyId);
    return rows.find((row) => row.id === fallback.id) ?? fallback;
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
    // Conectou: o link temporario cumpriu o que tinha para fazer e sai da tela.
    // A nuvem ja o encerrou do lado dela ao ver o pareamento; aqui e so nao
    // continuar oferecendo um endereco que nao pareia mais nada.
    if (state.status === "connected") {
      writeWhatsappConnectionLink(this.database, null);
    }
  }

  // Inicia a conexao da instancia UAZAPI ja provisionada (o token da instancia
  // e criado pelos admins direto na UAZAPI/loader-web e colado na tela); o QR
  // code volta no estado retornado e rotaciona via whatsappStatus().
  async whatsappConnect(): Promise<UazapiInstanceState> {
    const settings = readReportChannelSettings(this.database);
    if (!settings.uazapiBaseUrl) {
      throw new Error("Informe o servidor UAZAPI (URL) e salve a configuracao antes de conectar.");
    }
    const instanceToken = settings.uazapiInstanceToken;
    if (!instanceToken) {
      throw new Error(
        "Informe o token da instancia UAZAPI e salve a configuracao antes de conectar."
      );
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

  /**
   * Link temporario guardado neste computador, ou null quando nao ha nenhum
   * dentro do prazo. Quem descarta o vencido e o proprio leitor: um link que
   * nao abre mais nao pode continuar na tela como se abrisse.
   */
  whatsappConnectionLink(): WhatsappConnectionLink | null {
    return readWhatsappConnectionLink(this.database);
  }

  /**
   * Gera o link temporario (15 min) para parear o WhatsApp fora daqui. Empurra
   * a configuracao dos canais antes: a nuvem precisa do servidor e do token da
   * instancia para montar o QR da pagina, e recusa o link enquanto nao tiver.
   */
  async whatsappCreateConnectionLink(): Promise<WhatsappConnectionLink> {
    const settings = readReportChannelSettings(this.database);
    if (!settings.uazapiBaseUrl || !settings.uazapiInstanceToken) {
      throw new Error(
        "Informe o servidor UAZAPI e o token da instancia e salve a configuracao antes de gerar o link."
      );
    }
    const identity = this.ensureIdentity();
    if (settings.cloudPushPending) {
      await this.pushChannelSettingsToCloud();
    }
    const link = await createWhatsappConnectionLink(this.database, identity);
    writeWhatsappConnectionLink(this.database, link);
    return link;
  }

  /** Cancela o link antes do prazo. O registro local sai mesmo se a nuvem falhar. */
  async whatsappRevokeConnectionLink(): Promise<void> {
    const link = readWhatsappConnectionLink(this.database);
    writeWhatsappConnectionLink(this.database, null);
    if (!link) return;
    await revokeWhatsappConnectionLink(this.database, this.ensureIdentity(), link.id);
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

  listOmieCategories(): OmieCategoryOption[] {
    this.assertDesktopAccess();
    return listOmieCategories(this.database, this.ensureIdentity().companyId);
  }

  setProductOmieCategory(productId: string, categoryCode: string | null): void {
    this.assertDesktopAccess();
    setProductOmieCategory(this.database, this.ensureIdentity().companyId, productId, categoryCode);
  }

  getDefaultOmieCategory(): string | null {
    this.assertDesktopAccess();
    return getDefaultOmieCategory(this.database);
  }

  setDefaultOmieCategory(categoryCode: string | null): string | null {
    this.assertDesktopAccess();
    return setDefaultOmieCategory(this.database, this.ensureIdentity().companyId, categoryCode);
  }

  getCustomerCreditBalance(customerId: string): number {
    this.assertDesktopAccess();
    return new CreditService(this.database).getBalance(customerId);
  }

  getCustomerCreditSummary(customerId: string): CustomerCreditSummary {
    this.assertDesktopAccess();
    return new CreditService(this.database).getSummary(customerId);
  }

  // Nao existe lancamento de credito pelo KyberRock: o adiantamento e feito no
  // financeiro do OMIE e chega pelo espelho da sincronizacao
  // (`syncCustomerAdvancesFromOmie`). O que o desktop escreve no extrato e o
  // consumo da compra (debito no fechamento) e o estorno do cancelamento.

  listCustomerCreditMovements(customerId: string, limit?: number): CreditMovementRow[] {
    this.assertDesktopAccess();
    return new CreditService(this.database).listMovements(customerId, limit ?? 100);
  }

  /**
   * Categorias e conta corrente que identificam o adiantamento no OMIE. Vazio =
   * o KyberRock descobre pela descricao ("Adiantamento de Clientes").
   */
  getOmieAdvanceConfig(): OmieAdvanceConfig {
    this.assertDesktopAccess();
    return readOmieAdvanceConfig(this.database);
  }

  /**
   * Fixa a configuracao do adiantamento. Uma vez definida na tela, ela vence a
   * deteccao automatica — e o caminho para pedreiras que renomearam a categoria.
   */
  setOmieAdvanceConfig(patch: {
    categoryCodes?: string[];
    accountCode?: number | null;
    accountName?: string | null;
  }): OmieAdvanceConfig {
    this.assertDesktopAccess();
    const categoryCodes = Array.isArray(patch.categoryCodes) ? patch.categoryCodes : undefined;
    const manual =
      (categoryCodes?.length ?? 0) > 0 ||
      (patch.accountCode !== undefined && patch.accountCode !== null);
    return writeOmieAdvanceConfig(this.database, {
      ...(categoryCodes ? { categoryCodes } : {}),
      ...(patch.accountCode !== undefined ? { accountCode: patch.accountCode } : {}),
      ...(patch.accountName !== undefined ? { accountName: patch.accountName } : {}),
      manual
    });
  }

  /**
   * Traz do OMIE os adiantamentos dos clientes (dinheiro ja depositado) e os
   * espelha no extrato de credito, de onde as compras da balanca sao abatidas.
   * O financeiro continua sendo feito no OMIE: aqui nada e criado la.
   */
  async syncCustomerAdvancesFromOmie(
    options: { fullRescan?: boolean } = {}
  ): Promise<CustomerAdvancesSyncResult> {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = await syncCustomerAdvancesFromCloud(this.database, identity, options);
    this.recordTechnicalLog("info", "omie-sync", "Adiantamentos do OMIE sincronizados.", {
      advances: result.advances,
      imported: result.imported,
      adjusted: result.adjusted,
      unknownCustomers: result.unknownCustomers,
      pages: result.pages,
      finished: result.finished
    });
    return result;
  }

  /**
   * Cliente da operacao QUANDO ela e uma venda em carteira marcada para abater do
   * adiantamento. `null` em qualquer outro caso — e o que decide se a pesagem para
   * de sair para conferir saldo no OMIE.
   */
  private async customerIdOfAdvanceSale(operationId: string): Promise<string | null> {
    const row = this.database
      .prepare(
        `SELECT o.customer_id
         FROM weighing_operations o
         JOIN payment_methods pm ON pm.id = o.payment_method_id
         WHERE o.id = ? AND o.settle_from_advance = 1 AND pm.is_wallet = 1`
      )
      .get(operationId) as { customer_id: string | null } | undefined;
    return row?.customer_id ?? null;
  }

  /**
   * Confere no OMIE, na hora, o adiantamento de UM cliente — o passo que garante que a
   * venda em carteira marcada para abater saia contra o saldo real, e nao contra o que
   * a ultima varredura por acaso ja tinha espelhado.
   *
   * Best-effort de proposito. A balanca e offline-first: sem internet, com o OMIE fora
   * do ar ou com a nuvem nao configurada, a pesagem acontece do mesmo jeito e o
   * abatimento usa o adiantamento ja espelhado. O erro dessa falha e sempre seguro —
   * abate de MENOS e o restante fica em carteira, que e cobravel depois; nunca abate
   * de mais nem inventa saldo. A falha fica registrada nos logs tecnicos.
   */
  private async refreshCustomerAdvanceFromOmie(
    customerId: string,
    stage: "entrada" | "fechamento"
  ): Promise<void> {
    try {
      const omieCode = this.database
        .prepare("SELECT omie_customer_id FROM customers WHERE id = ? AND deleted_at IS NULL")
        .pluck()
        .get(customerId) as number | null | undefined;
      // Cliente ainda sem cadastro no OMIE nao tem adiantamento la para conferir.
      if (!omieCode) return;

      initializeSupabaseFromSettings(this.database);
      if (!isSupabaseInitialized()) return;

      const result = await syncCustomerAdvancesFromCloud(this.database, this.ensureIdentity(), {
        customerOmieCode: omieCode
      });
      this.recordTechnicalLog(
        "info",
        "omie-sync",
        `Adiantamento do cliente conferido no OMIE na ${stage} da pesagem.`,
        {
          customerId,
          omieCustomerId: omieCode,
          advances: result.advances,
          imported: result.imported,
          adjusted: result.adjusted,
          movementsApplied: result.movementsApplied
        }
      );
    } catch (error) {
      this.recordTechnicalLog(
        "warning",
        "omie-sync",
        `Nao foi possivel conferir o adiantamento do cliente no OMIE na ${stage} da pesagem. ` +
          "A pesagem seguiu com o adiantamento ja espelhado nesta maquina.",
        { customerId, error: error instanceof Error ? error.message : String(error) }
      );
    }
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
    // O job do fechamento carrega um SNAPSHOT do cadastro montado no close. Sem
    // reconstruir o payload aqui, corrigir o cliente (razao social, e-mail, endereco...)
    // nao muda nada no que sobe ao OMIE: o job segue parado com o dado antigo e repete a
    // mesma recusa, dando a impressao de que a edicao "nao salvou". Rearma os fechamentos
    // que estao presos por causa deste cliente para eles sairem com o cadastro corrigido.
    rearmOmieBillingForCustomer(this.database, id);
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
        // Mesmo motivo do updateCustomer manual: o fechamento parado precisa do payload
        // reconstruido para aproveitar o cadastro que a Receita acabou de completar.
        rearmOmieBillingForCustomer(this.database, customer.id, now);
        summary.updated += 1;
      } catch {
        summary.failed += 1;
      }
    }

    this.cacheStore.invalidate("customer", identity.companyId);
    return summary;
  }

  /**
   * Mesma busca automatica em lote dos clientes, para TODAS as transportadoras com
   * CNPJ valido (14 digitos): consulta a Receita em serie e grava os dados retornados.
   * Cada campo so e sobrescrito quando a consulta traz valor; o update marca
   * needs_push=1, entao o cadastro atualizado sobe ao OMIE no proximo sync.
   */
  async enrichAllCarriersFromCnpj(): Promise<CnpjBulkEnrichResult> {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const carriers = listCarriers(this.database, identity.companyId);
    const summary: CnpjBulkEnrichResult = {
      total: carriers.length,
      withCnpj: 0,
      updated: 0,
      notFound: 0,
      failed: 0
    };

    for (const carrier of carriers) {
      const digits = (carrier.document ?? "").replace(/\D/g, "");
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

      const patch: UpdateCarrierInput = {};
      if (data.legalName) patch.name = data.legalName;
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
        updateCarrier(this.database, carrier.id, patch);
        summary.updated += 1;
      } catch {
        summary.failed += 1;
      }
    }

    this.cacheStore.invalidate("carrier", identity.companyId);
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

  // Carteira: vendas fechadas na forma "em carteira", aguardando o fechamento que
  // define como o cliente vai pagar.
  getWalletReport(query: WalletQuery = {}): WalletReport {
    this.assertDesktopAccess();
    return getWalletReport(this.database, query);
  }

  /** Registra o fechamento e devolve quantas vendas foram fechadas. */
  settleWalletOperations(input: SettleWalletInput): number {
    this.assertDesktopAccess();
    const settled = settleWalletOperations(this.database, input);
    // A carteira e da pedreira inteira: o fechamento tem de aparecer nas outras
    // balancas. O job ja ficou na fila (duravel); isto so adianta a varredura.
    if (settled > 0) this.triggerBackgroundCloudSync("wallet_settled", { count: settled });
    return settled;
  }

  /** Desfaz o fechamento e devolve quantas vendas voltaram para a carteira. */
  reopenWalletOperations(operationIds: string[]): number {
    this.assertDesktopAccess();
    const reopened = reopenWalletOperations(this.database, operationIds);
    if (reopened > 0) this.triggerBackgroundCloudSync("wallet_reopened", { count: reopened });
    return reopened;
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
    // createVehicle ja cria o vinculo em vehicle_carriers (o seletor de placa da entrada
    // lista os veiculos VINCULADOS a transportadora, nao os que tem carrier_id) e
    // reaproveita a placa que ja existe em vez de recusar o cadastro.
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

  /**
   * Devolve a transportadora padrao resultante: vincular/desvincular pode promover
   * (ou trocar) o padrao do cliente, e o formulario aberto precisa saber disso para
   * nao regravar o valor antigo ao salvar.
   */
  linkCustomerCarrier(customerId: string, carrierId: string): { defaultCarrierId: string | null } {
    this.assertDesktopAccess();
    linkCustomerCarrier(this.database, customerId, carrierId);
    return { defaultCarrierId: getCustomerDefaultCarrierId(this.database, customerId) };
  }

  unlinkCustomerCarrier(
    customerId: string,
    carrierId: string
  ): { defaultCarrierId: string | null } {
    this.assertDesktopAccess();
    unlinkCustomerCarrier(this.database, customerId, carrierId);
    return { defaultCarrierId: getCustomerDefaultCarrierId(this.database, customerId) };
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

    // Espelhados do OMIE = tem id do OMIE. Filtrar por `source = 'omie'` contava
    // menos do que existe: o cliente que chega antes pelo pull da nuvem entra como
    // 'hybrid' e o upsert do OMIE nao reescreve `source`, entao a tela mostrava 1 ou 2
    // enquanto a base tinha centenas.
    const totalCustomers = this.database
      .prepare(
        "SELECT COUNT(*) FROM customers WHERE company_id = ? AND deleted_at IS NULL AND omie_customer_id IS NOT NULL"
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
    /** Categorias do plano gerencial espelhadas (usadas na categoria por produto). */
    categoriesSynced: number;
    ordersProcessed: number;
    ordersFailed: number;
    customersPushFailed: number;
    errors: string[];
    /** Diagnostico legivel da varredura de clientes (paginas/registros do OMIE). */
    customersScanSummary: string | null;
  }> {
    if (this.omieSyncInProgress) {
      return {
        customersPulled: 0,
        customersPushed: 0,
        productsSynced: 0,
        paymentTermsSynced: 0,
        suppliersSynced: 0,
        categoriesSynced: 0,
        ordersProcessed: 0,
        ordersFailed: 0,
        customersPushFailed: 0,
        errors: ["Sincronizacao OMIE ja em andamento."],
        customersScanSummary: null
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
          categoriesSynced: 0,
          ordersProcessed: 0,
          ordersFailed: 0,
          customersPushFailed: 0,
          errors: [
            "Supabase nao configurado. Defina SUPABASE_PUBLISHABLE_KEY na pedreira no admin (loader-web) e reative o desktop."
          ],
          customersScanSummary: null
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
        categoriesSynced: loop.categoriesSynced,
        ordersProcessed: queue.processed,
        ordersFailed: queue.failed,
        customersPushFailed: customerPush.failed + carrierPush.failed,
        errors: customerPush.errors.concat(carrierPush.errors, loop.errors, queue.errors),
        customersScanSummary: describeOmieCustomersScan(loop.customersScan)
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
    categoriesSynced: number;
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
      categoriesSynced: result.categoriesSynced,
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
      /** Espera antes de repetir a pagina que falhou (cresce a cada tentativa). */
      retryDelayMs?: number;
      onProgress?: (progress: OmieLoopProgress) => void;
    } = {}
  ): Promise<{
    customersPulled: number;
    productsSynced: number;
    paymentTermsSynced: number;
    suppliersSynced: number;
    categoriesSynced: number;
    iterations: number;
    finished: boolean;
    errors: string[];
    customersScan: OmieCustomersScan;
  }> {
    const identity = this.ensureIdentity();
    const maxIterations = options.maxIterations ?? 200;
    const delayBetweenPagesMs = options.delayBetweenPagesMs ?? OMIE_PULL_PAGE_DELAY_MS;
    const retryDelayMs = options.retryDelayMs ?? OMIE_PULL_RETRY_DELAY_MS;
    let customersPulled = 0;
    let productsSynced = 0;
    let paymentTermsSynced = 0;
    let suppliersSynced = 0;
    let categoriesSynced = 0;
    const errors: string[] = [];
    let iterations = 0;
    // Diagnostico da varredura de clientes: sem isto, um pull que traz menos do
    // que existe no OMIE fica indistinguivel de um pull completo — a tela so
    // mostra o total baixado. Com os numeros do proprio OMIE (paginas e
    // registros) da para separar "a varredura parou cedo" de "o cadastro foi
    // descartado na classificacao por tag".
    const customersScan: OmieCustomersScan = {
      pagesRun: 0,
      rawRecords: 0,
      classifiedCustomers: 0,
      classifiedCarriers: 0,
      invalid: 0,
      supplierOnly: 0,
      omieTotalPages: null,
      omieTotalRecords: null,
      finished: false
    };

    const initialState = readOmiePullState(this.database);
    if (options.reset || !initialState.inProgress) {
      writeOmiePullState(this.database, {
        customersPage: 1,
        productsPage: 1,
        paymentTermsPage: 1,
        suppliersPage: 1,
        categoriesPage: 1,
        customersFinished: false,
        productsFinished: false,
        paymentTermsFinished: false,
        suppliersFinished: false,
        categoriesFinished: false,
        inProgress: true
      });
    }

    // Falha numa pagina (timeout/instabilidade do OMIE) nao pode abortar o pull
    // inteiro: antes, um erro na pagina 3 deixava a base so com as duas primeiras
    // (200 clientes) e sem nenhuma re-tentativa. Agora a mesma pagina e tentada
    // de novo com espera crescente e, se ainda assim falhar, o estado fica
    // marcado como em andamento para o proximo ciclo retomar de onde parou.
    let consecutiveFailures = 0;

    while (iterations < maxIterations) {
      const before = readOmiePullState(this.database);
      let result: OmieCloudSyncResult;
      try {
        result = await syncOmieReferenceDataFromCloud(this.database, identity);
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures += 1;
        const message = error instanceof Error ? error.message : "Falha no pull do OMIE";
        errors.push(
          `Pull OMIE (pagina clientes ${before.customersPage}/produtos ${before.productsPage}): ${message}`
        );
        if (consecutiveFailures >= OMIE_PULL_MAX_CONSECUTIVE_FAILURES) {
          this.cacheStore.invalidateAll(identity.companyId);
          return {
            customersPulled,
            productsSynced,
            paymentTermsSynced,
            suppliersSynced,
            categoriesSynced,
            iterations,
            finished: false,
            errors,
            customersScan
          };
        }
        if (retryDelayMs > 0) await sleep(retryDelayMs * consecutiveFailures);
        continue;
      }
      const after = readOmiePullState(this.database);
      iterations += 1;
      customersPulled += result.customersPulled;
      productsSynced += result.productsSynced;
      paymentTermsSynced += result.paymentTermsSynced;
      suppliersSynced += result.suppliersSynced;
      categoriesSynced += result.categoriesSynced;
      errors.push(...result.errors);
      if (result.customersPage) {
        const page = result.customersPage;
        customersScan.pagesRun += 1;
        customersScan.rawRecords += page.returned;
        customersScan.classifiedCustomers += page.classifiedCustomers;
        customersScan.classifiedCarriers += page.classifiedCarriers;
        customersScan.invalid += page.invalid;
        customersScan.supplierOnly += page.supplierOnly;
        customersScan.omieTotalPages = page.totalPages ?? customersScan.omieTotalPages;
        customersScan.omieTotalRecords = page.totalRecords ?? customersScan.omieTotalRecords;
        customersScan.finished = page.finished;
      }

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

      const totalBefore =
        before.customersPage +
        before.productsPage +
        before.paymentTermsPage +
        before.categoriesPage;
      const totalAfter =
        after.customersPage + after.productsPage + after.paymentTermsPage + after.categoriesPage;
      const noProgress =
        totalAfter <= totalBefore &&
        result.customersPulled +
          result.productsSynced +
          result.paymentTermsSynced +
          result.suppliersSynced +
          result.categoriesSynced ===
          0;
      if (noProgress || !after.inProgress) {
        writeOmiePullState(this.database, { inProgress: false });
        this.cacheStore.invalidateAll(identity.companyId);
        return {
          customersPulled,
          productsSynced,
          paymentTermsSynced,
          suppliersSynced,
          categoriesSynced,
          iterations,
          finished: !after.inProgress,
          errors,
          customersScan
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
      categoriesSynced,
      iterations,
      finished: false,
      errors,
      customersScan
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
        companyId: SETUP_COMPANY_ID,
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

  /**
   * Publica UMA operacao (e a solicitacao de carregamento dela) na nuvem agora,
   * sem esperar a varredura completa.
   *
   * `syncCloudNow` e pesado — fila cloud, fila OMIE, cadastro compartilhado
   * inteiro e pull — e desiste na hora quando ja existe outra em andamento.
   * Enquanto isso a troca de produto/cliente/transportadora numa operacao aberta
   * ficava so no SQLite desta maquina ate o proximo ciclo agendado, que e o que
   * fazia a outra balanca da pedreira enxergar a mudanca apenas depois do
   * fechamento. Este caminho e uma chamada HTTP curta, roda em serie consigo
   * mesmo e nao concorre com a varredura.
   */
  private triggerOperationCloudPush(reason: string, operationId: string): void {
    this.operationPushChain = this.operationPushChain
      .then(() => this.pushOperationToCloud(operationId))
      .catch((error: unknown) => {
        // A fila de jobs e a reconciliacao reenviam na proxima varredura:
        // aqui a falha so precisa ficar registrada.
        this.recordTechnicalLog(
          "warning",
          "cloud-sync",
          error instanceof Error ? error.message : "Envio imediato da operacao falhou.",
          { reason, operationId }
        );
      });
    // A varredura completa continua sendo disparada: leva o resto (fila OMIE,
    // cadastro compartilhado, pull) quando nao houver outra em andamento.
    this.triggerBackgroundCloudSync(reason, { operationId });
  }

  private async pushOperationToCloud(operationId: string): Promise<void> {
    if (!this.hasCloudCredentials()) return;
    initializeSupabaseFromSettings(this.database);
    if (!isSupabaseInitialized()) return;
    const identity = this.ensureIdentity();
    await syncOperationToSupabase(this.database, operationId, identity);
    const loadingRequestId = this.database
      .prepare("SELECT id FROM loading_requests WHERE operation_id = ?")
      .pluck()
      .get(operationId) as string | undefined;
    if (loadingRequestId) {
      await syncLoadingRequestToSupabase(this.database, loadingRequestId, identity);
    }
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

/**
 * Comparacao de strings em tempo constante, para a senha de alteracao de preco nao vazar seu
 * tamanho/prefixo por timing. Compara os digests SHA-256 (sempre 32 bytes) para que strings de
 * tamanhos diferentes tambem passem por timingSafeEqual sem lancar. Observacao: a senha ainda e
 * armazenada em texto puro na tabela companies — endurece-la exige uma migration para migrar as
 * senhas existentes para hash, feita a parte para nao invalidar cadastros ja gravados.
 */
function safeStringEquals(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
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

  return `<!doctype html><html><head><meta charset="utf-8" /><title>Fechamento diario ${input.date}</title></head><body style="font-family:Arial,sans-serif;color:#0f172a;padding:24px;background:#f8fafc"><h1 style="margin:0 0 4px;font-size:22px">Fechamento diario ${input.date}</h1><p style="margin:0 0 16px;color:#475569">${escapeHtml(input.companyName)}</p><table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;background:#fff;border:1px solid #cbd5e1;margin-bottom:24px"><thead><tr style="background:#1e293b;color:#fff"><th>Carregamentos</th><th>Tonelagem</th><th>Produto</th><th>Frete</th><th>Total</th><th>Preco medio</th></tr></thead><tbody><tr><td>${input.report.totalOperations}</td><td>${(input.report.totalNetWeightKg / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} t</td><td>${centsToBRL(input.report.totalProductCents)}</td><td>${centsToBRL(input.report.totalFreightCents)}</td><td>${centsToBRL(input.report.totalCents)}</td><td>${centsToBRL(input.report.totalNetWeightKg > 0 ? Math.round(input.report.totalCents / input.report.totalNetWeightKg) : 0)}</td></tr></tbody></table><table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;background:#fff;border:1px solid #cbd5e1"><thead><tr style="background:#e2e8f0"><th>Cliente</th><th>Produto</th><th>Peso</th><th>Produto</th><th>Frete</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>${renderTotalBar(
    [
      { label: "Carregamentos", value: input.report.totalOperations.toLocaleString("pt-BR") },
      {
        label: "Tonelagem",
        value: `${(input.report.totalNetWeightKg / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} t`
      },
      { label: "Produto", value: centsToBRL(input.report.totalProductCents) },
      { label: "Frete", value: centsToBRL(input.report.totalFreightCents) },
      { label: "Total", value: centsToBRL(input.report.totalCents), emphasis: true }
    ]
  )}</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Tipo da operacao para a regra de cadastro. A entrada sem tipo escolhido nasce fiscal
 * (ver `createWeighingOperation`), e a trava tem que assumir o MESMO padrao: assumir
 * "interna" aqui deixaria passar exatamente a venda com nota que a regra existe para pegar.
 */
function resolveReadinessType(operationType?: OperationType): OmieReadinessOperationType {
  return operationType === "internal" ? "internal" : "invoice";
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
