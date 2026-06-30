import type { BackupResult } from "../services/backup";
import type {
  ConfigureReceiptPrintProfileInput,
  PrintProfileSummary,
  PrintReceiptSummary,
  WindowsPrinterSummary
} from "../services/printing";
import type { DesktopStatusSnapshot } from "../services/status";
import type { UpdateState } from "../services/update-flow";
import type {
  OperationFreightInput,
  OperationType,
  WeighingOperationSummary
} from "../services/weighing-operations";
import type {
  CloudBootstrapResult,
  FiscalBillingResult,
  SyncResult
} from "../services/supabase-sync";
import type { PriceDetails } from "../services/pricing";
import type {
  CustomerSpecialPriceSummary,
  ProductDefaultPriceSummary
} from "../services/product-prices";
import type { CreditMovementRow } from "../services/credit";
import type { CreateQuotationInput, QuotationRow, QuotationSummary } from "../services/quotations";
import type { ActivateDesktopInput, DesktopAccessStatus } from "../services/desktop-activation";
import type { CacheQueryOptions, CacheQueryResult } from "../services/cache-store";
import type {
  DailyReport,
  DailySeriesPoint,
  MonthlyReport,
  OperationMix,
  ProductReport,
  CustomerReport
} from "../services/reports";
import type { CreateCustomerInput, UpdateCustomerInput } from "../services/customers";
import type {
  AddPriceTableItemInput,
  CreatePriceTableInput,
  LinkCustomerToPriceTableInput,
  UpdatePriceTableItemInput
} from "../services/price-tables";
import type { CreateVehicleInput, UpdateVehicleInput } from "../services/vehicles";
import type { CreateDriverInput, UpdateDriverInput } from "../services/drivers";
import type { CreateCarrierInput, UpdateCarrierInput } from "../services/carriers";
import type { ScaleConfiguration, ScaleConfigurationInput } from "../services/scale-configs";
import type {
  ToledoTcpConfig,
  ToledoTcpAdapterStatus,
  ParsedToledoReading,
  ScaleReading
} from "@kyberrock/scale-adapters";

export interface KyberRockDesktopApi {
  getStatus: (internetOnline?: boolean) => Promise<DesktopStatusSnapshot>;
  exportBackup: () => Promise<BackupResult | null>;
  restoreBackup: () => Promise<boolean>;
  getUpdateState: () => Promise<UpdateState>;
  getAccessStatus: () => Promise<DesktopAccessStatus>;
  validateDesktopAccess: (
    internetOnline?: boolean,
    force?: boolean
  ) => Promise<DesktopAccessStatus>;
  activateDesktop: (input: ActivateDesktopInput) => Promise<DesktopAccessStatus>;
  logoutDesktop: () => Promise<void>;
  checkForUpdates: () => Promise<UpdateState>;
  downloadAndInstallUpdate: () => Promise<UpdateState>;
  listOpenWeighingOperations: () => Promise<WeighingOperationSummary[]>;
  listCanceledWeighingOperations: () => Promise<WeighingOperationSummary[]>;
  listClosedWeighingOperations: () => Promise<WeighingOperationSummary[]>;
  clearCanceledWeighingOperations: () => Promise<number>;
  startWeighing: (input: {
    operationType?: OperationType;
    customerId: string;
    vehicleId: string;
    carrierId?: string;
    driverId: string;
    productId: string;
    paymentTermId?: string;
    manualInstallments?: number;
    manualDownPaymentCents?: number;
    freight?: OperationFreightInput | null;
    quotationId?: string;
    deductFreightFromCredit?: boolean;
    scaleCaptureId?: string;
  }) => Promise<WeighingOperationSummary>;
  closeWeighing: (
    operationId: string,
    operationType?: OperationType,
    scaleCaptureId?: string
  ) => Promise<WeighingOperationSummary>;
  cancelWeighing: (operationId: string, reason: string) => Promise<WeighingOperationSummary>;
  updateWeighingProduct: (operationId: string, newProductId: string) => Promise<WeighingOperationSummary>;
  getCustomerFreightRules: (customerId: string) => Promise<
    Array<{
      id: string;
      customerId: string;
      productId: string | null;
      productDescription: string | null;
      rule: {
        id: string;
        name: string;
        type: "per_ton" | "per_ton_km" | "fixed_plus_ton" | "distance_range";
        baseValueCents: number;
        minValueCents?: number;
        fixedValueCents?: number;
        distanceKm?: number;
        ranges?: Array<{ maxKm: number; valueCents: number }>;
        unit: string;
      };
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>
  >;
  getCustomerFreightForProduct: (
    customerId: string,
    productId: string
  ) => Promise<{
    id: string;
    customerId: string;
    productId: string | null;
    productDescription: string | null;
    rule: {
      id: string;
      name: string;
      type: "per_ton" | "per_ton_km" | "fixed_plus_ton" | "distance_range";
      baseValueCents: number;
      minValueCents?: number;
      fixedValueCents?: number;
      distanceKm?: number;
      ranges?: Array<{ maxKm: number; valueCents: number }>;
      unit: string;
    };
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
  } | null>;
  setCustomerFreightRule: (input: {
    customerId: string;
    productId?: string | null;
    rule: {
      id: string;
      name: string;
      type: "per_ton" | "per_ton_km" | "fixed_plus_ton" | "distance_range";
      baseValueCents: number;
      minValueCents?: number;
      fixedValueCents?: number;
      distanceKm?: number;
      ranges?: Array<{ maxKm: number; valueCents: number }>;
      unit: string;
    };
  }) => Promise<unknown>;
  removeCustomerFreightRule: (ruleId: string) => Promise<void>;
  listWindowsPrinters: () => Promise<WindowsPrinterSummary[]>;
  configureReceiptPrintProfile: (
    input: Omit<ConfigureReceiptPrintProfileInput, "identity">
  ) => Promise<PrintProfileSummary>;
  listPrintProfiles: () => Promise<PrintProfileSummary[]>;
  listPrintReceipts: () => Promise<PrintReceiptSummary[]>;
  printReceipt: (operationId: string) => Promise<PrintReceiptSummary>;
  reprintReceipt: (receiptId: string) => Promise<PrintReceiptSummary>;
  printTestReceipt: () => Promise<PrintReceiptSummary>;
  billFiscalOperation: (operationId: string) => Promise<FiscalBillingResult>;
  bootstrapCloudData: () => Promise<CloudBootstrapResult>;
  syncToCloud: () => Promise<SyncResult>;
  getCloudStatus: () => Promise<{ totalOperations: number; lastSync: string | null }>;
  isCloudConnected: () => Promise<boolean>;
  queryCache: (options: CacheQueryOptions) => Promise<CacheQueryResult<unknown>>;
  getDailyReport: (date: string) => Promise<DailyReport>;
  getMonthlyReport: (year: number, month: number) => Promise<MonthlyReport>;
  getReportHtml: (startDate: string, endDate: string) => Promise<string>;
  exportReportPdf: (startDate: string, endDate: string) => Promise<{ path: string } | null>;
  exportReportExcel: (startDate: string, endDate: string) => Promise<{ path: string } | null>;
  listReportRecipients: () => Promise<
    Array<{
      id: string;
      email: string | null;
      whatsappPhone: string | null;
      sendEmail: boolean;
      sendWhatsapp: boolean;
      scheduleFrequency: string;
      scheduleTime: string;
      displayName: string | null;
      isActive: boolean;
      syncStatus: "synced" | "pending" | "error";
      lastError: string | null;
      lastSyncedAt: string | null;
    }>
  >;
  createReportRecipient: (input: {
    email?: string | null;
    whatsappPhone?: string | null;
    sendEmail?: boolean;
    sendWhatsapp?: boolean;
    scheduleFrequency?: string;
    scheduleTime?: string;
    displayName?: string | null;
    isActive?: boolean;
  }) => Promise<unknown>;
  updateReportRecipient: (
    id: string,
    input: {
      email?: string | null;
      whatsappPhone?: string | null;
      sendEmail?: boolean;
      sendWhatsapp?: boolean;
      scheduleFrequency?: string;
      scheduleTime?: string;
      displayName?: string | null;
      isActive?: boolean;
    }
  ) => Promise<unknown>;
  deleteReportRecipient: (id: string) => Promise<void>;
  sendTestEmail: (to: string) => Promise<{ success: boolean; messageId?: string; error?: string }>;
  sendDailyReportEmail: (
    email: string,
    date: string
  ) => Promise<{ success: boolean; messageId?: string; error?: string }>;
  sendRangeReportEmail: (
    email: string,
    startDate: string,
    endDate: string
  ) => Promise<{ success: boolean; messageId?: string; error?: string }>;
  verifySmtpConfig: () => Promise<{ success: boolean; messageId?: string; error?: string }>;
  getReportByProduct: (
    startDate: string,
    endDate: string,
    limit?: number
  ) => Promise<ProductReport[]>;
  getReportByCustomer: (
    startDate: string,
    endDate: string,
    limit?: number
  ) => Promise<CustomerReport[]>;
  getDailySeries: (startDate: string, endDate: string) => Promise<DailySeriesPoint[]>;
  getOperationMix: (startDate: string, endDate: string) => Promise<OperationMix>;
  getPriceForCustomerProduct: (customerId: string, productId: string) => Promise<number | null>;
  getPriceDetailsForCustomerProduct: (
    customerId: string,
    productId: string
  ) => Promise<PriceDetails | null>;
  productDefaultPricesList: () => Promise<ProductDefaultPriceSummary[]>;
  productDefaultPricesUpsert: (input: {
    productId: string;
    unitPriceCents: number;
    unit?: string;
  }) => Promise<unknown>;
  customerSpecialPricesList: (customerId: string) => Promise<CustomerSpecialPriceSummary[]>;
  customerSpecialPricesSet: (input: {
    customerId: string;
    productId: string;
    unitPriceCents: number;
    unit?: string;
  }) => Promise<unknown>;
  customerSpecialPricesRemove: (customerId: string, productId: string) => Promise<void>;
  customerCreditBalance: (customerId: string) => Promise<number>;
  customerCreditMovements: (customerId: string, limit?: number) => Promise<CreditMovementRow[]>;
  quotationsCreate: (input: Omit<CreateQuotationInput, "companyId">) => Promise<QuotationRow>;
  quotationsCancel: (id: string) => Promise<void>;
  quotationsListOpenForCustomer: (customerId: string) => Promise<QuotationSummary[]>;
  customersCreate: (input: Omit<CreateCustomerInput, "companyId">) => Promise<unknown>;
  customersUpdate: (id: string, input: UpdateCustomerInput) => Promise<unknown>;
  customersDelete: (id: string) => Promise<void>;
  priceTablesCreate: (input: Omit<CreatePriceTableInput, "companyId">) => Promise<unknown>;
  priceTablesUpdateName: (id: string, name: string) => Promise<unknown>;
  priceTablesDelete: (id: string) => Promise<void>;
  priceTablesAddItem: (input: AddPriceTableItemInput) => Promise<unknown>;
  priceTablesUpdateItem: (id: string, input: UpdatePriceTableItemInput) => Promise<unknown>;
  priceTablesRemoveItem: (id: string) => Promise<void>;
  priceTablesLinkCustomer: (input: LinkCustomerToPriceTableInput) => Promise<unknown>;
  priceTablesUnlinkCustomer: (linkId: string) => Promise<void>;
  priceTablesList: () => Promise<unknown[]>;
  priceTablesListItems: (priceTableId: string) => Promise<unknown[]>;
  priceTablesListCustomerLinks: (priceTableId: string) => Promise<unknown[]>;
  vehiclesCreate: (input: Omit<CreateVehicleInput, "companyId">) => Promise<unknown>;
  vehiclesUpdate: (id: string, input: UpdateVehicleInput) => Promise<unknown>;
  vehiclesDelete: (id: string) => Promise<void>;
  vehiclesFindOrCreate: (plate: string) => Promise<unknown>;
  vehiclesGetCarriers: (
    vehicleId: string
  ) => Promise<Array<{ carrierId: string; carrierName: string; carrierDocument: string | null }>>;
  vehiclesLinkCarrier: (vehicleId: string, carrierId: string) => Promise<unknown>;
  customersByCarrier: (carrierId: string) => Promise<unknown[]>;
  driversCreate: (input: Omit<CreateDriverInput, "companyId">) => Promise<unknown>;
  driversUpdate: (id: string, input: UpdateDriverInput) => Promise<unknown>;
  driversDelete: (id: string) => Promise<void>;
  driversFindOrCreate: (name: string) => Promise<unknown>;
  carriersCreate: (input: Omit<CreateCarrierInput, "companyId">) => Promise<unknown>;
  carriersUpdate: (id: string, input: UpdateCarrierInput) => Promise<unknown>;
  carriersDelete: (id: string) => Promise<void>;
  carriersList: () => Promise<unknown[]>;
  carriersGetVehicles: (
    carrierId: string
  ) => Promise<Array<{ id: string; plate: string; description: string | null }>>;
  linkCustomerCarrier: (customerId: string, carrierId: string) => Promise<unknown>;
  unlinkCustomerCarrier: (customerId: string, carrierId: string) => Promise<void>;
  listCarriersByCustomer: (
    customerId: string
  ) => Promise<Array<{ id: string; name: string; document: string | null }>>;
  listCustomersByCarrier: (
    carrierId: string
  ) => Promise<Array<{ id: string; trade_name: string; legal_name: string }>>;
  linkDriverCarrier: (driverId: string, carrierId: string) => Promise<unknown>;
  unlinkDriverCarrier: (driverId: string, carrierId: string) => Promise<void>;
  listCarriersByDriver: (
    driverId: string
  ) => Promise<Array<{ id: string; name: string; document: string | null }>>;
  listDriversByCarrier: (
    carrierId: string
  ) => Promise<
    Array<{ id: string; name: string; document: string | null; is_independent: number }>
  >;
  listIndependentDrivers: () => Promise<
    Array<{ id: string; name: string; document: string | null }>
  >;
  getOmieStatus: () => Promise<{
    configured: boolean;
    appKeyMasked: string | null;
    hasSyncedData: boolean;
    totalCustomers: number;
    totalProducts: number;
    totalPaymentTerms: number;
    pendingPushCustomers: number;
    pendingOmieJobs: number;
    lastSyncAt: string | null;
  }>;
  scaleConnect: (config: ToledoTcpConfig) => Promise<void>;
  scaleDisconnect: () => Promise<void>;
  scaleRead: () => Promise<ScaleReading>;
  scaleReadSampled: () => Promise<ScaleReading>;
  scaleCaptureStable: (options: {
    operationType: "entry" | "exit";
    timeoutMs?: number;
  }) => Promise<{ captureId: string; reading: ScaleReading }>;
  scaleDiscover: () => Promise<{ host: string; port: number } | null>;
  scaleGetStatus: () => Promise<ToledoTcpAdapterStatus>;
  scaleGetConfig: () => Promise<ScaleConfiguration>;
  scaleSaveConfig: (input: ScaleConfigurationInput) => Promise<ScaleConfiguration>;
  virtualScaleSetWeight: (weightKg: number) => Promise<void>;
  virtualScaleConnect: () => Promise<void>;
  verifyPriceChangePassword: (password: string) => Promise<boolean>;
  omieConfig: () => Promise<{ configured: boolean; appKeyMasked: string | null }>;
  omieSync: () => Promise<{
    customersPulled: number;
    customersPushed: number;
    productsSynced: number;
    paymentTermsSynced: number;
    ordersProcessed: number;
    ordersFailed: number;
    customersPushFailed: number;
    errors: string[];
  }>;
  syncOmieDirect: (
    appKey: string,
    appSecret: string
  ) => Promise<{
    customersPulled: number;
    customersPushed: number;
    productsSynced: number;
    paymentTermsSynced: number;
    suppliersSynced: number;
    errors: string[];
  }>;
  resetOmieMaster: () => Promise<{
    customersCleared: number;
    carriersCleared: number;
    syncRunsCleared: number;
    syncQueueCleared: number;
  }>;
  syncOmieMasterData: (options?: unknown) => Promise<{
    success: boolean;
    startedAt: Date;
    finishedAt: Date;
    triggeredBy: "manual" | "automatic" | "startup";
    mode: "full" | "incremental";
    entities: Array<{
      entity: string;
      success: boolean;
      totalFetched: number;
      totalCreated: number;
      totalUpdated: number;
      totalSkipped: number;
      startedAt: Date;
      finishedAt: Date;
      errorMessage?: string;
    }>;
    runId: string;
  }>;
  getLastOmieSyncRun: () => Promise<{
    id: string;
    startedAt: string;
    finishedAt: string | null;
    success: boolean;
    mode: string;
    triggeredBy: string;
  } | null>;
  getOmieSyncEntitiesByRun: (runId: string) => Promise<
    Array<{
      entity: string;
      success: boolean;
      totalFetched: number;
      totalCreated: number;
      totalUpdated: number;
      totalSkipped: number;
      errorMessage: string | null;
    }>
  >;
  startOmieDataEntryLoop: () => Promise<{
    customersPulled: number;
    productsSynced: number;
    paymentTermsSynced: number;
    iterations: number;
    finished: boolean;
    errors: string[];
  }>;
  getOmieLoopStatus: () => Promise<{
    iteration: number;
    customersPulled: number;
    productsSynced: number;
    paymentTermsSynced: number;
    customersPage: number;
    productsPage: number;
    paymentTermsPage: number;
    inProgress: boolean;
    lastBatchCustomers: number;
    lastBatchProducts: number;
    lastBatchPaymentTerms: number;
    lastUpdatedAt?: string | null;
  } | null>;
  getOmieSchedulerStatus: () => Promise<{
    enabled: boolean;
    intervalMinutes: number;
    lastPullAt: string | null;
    nextPullAt: string | null;
  }>;
  setOmieSchedulerConfig: (config: { enabled?: boolean; intervalMinutes?: number }) => Promise<{
    enabled: boolean;
    intervalMinutes: number;
    lastPullAt: string | null;
    nextPullAt: string | null;
  }>;
  syncCloudNow: () => Promise<{
    success: boolean;
    synced: number;
    failed: number;
    errors: string[];
  }>;
  getCloudSyncSchedulerStatus: () => Promise<{
    enabled: boolean;
    intervalMinutes: number;
    lastRunAt: string | null;
    nextRunAt: string | null;
  }>;
  setCloudSyncConfig: (config: { enabled?: boolean; intervalMinutes?: number }) => Promise<{
    enabled: boolean;
    intervalMinutes: number;
    lastRunAt: string | null;
    nextRunAt: string | null;
  }>;
  probeConnectivity: () => Promise<{
    internetOnline: boolean;
    cloudReachable: boolean;
    omieReachable: boolean;
  }>;
  lookupCep: (cep: string) => Promise<{
    zipcode: string;
    street: string;
    complement: string;
    neighborhood: string;
    city: string;
    state: string;
  }>;
  onUpdateAvailable: (callback: (event: unknown, version: string) => void) => void;
  offUpdateAvailable: (callback: (event: unknown, version: string) => void) => void;
  onPlateScanned: (callback: (plate: string) => void) => void;
  onScaleReading: (callback: (reading: ParsedToledoReading) => void) => void;
  offScaleReading: (callback: (reading: ParsedToledoReading) => void) => void;
}
