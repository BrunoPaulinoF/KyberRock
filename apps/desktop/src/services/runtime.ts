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
  getDesktopStatusSnapshot,
  recordLastBackupAt,
  type DesktopStatusSnapshot
} from "./status.js";
import {
  cancelWeighingOperation,
  closeWeighingOperation,
  createWeighingOperation,
  listOpenWeighingOperations,
  type OperationType,
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
  initializeSupabase,
  syncOperationToSupabase,
  syncLoadingRequestToSupabase,
  getSupabaseSyncStatus,
  isSupabaseInitialized,
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
import {
  CacheStore,
  type CacheQueryOptions,
  type CacheQueryResult
} from "./cache-store.js";
import {
  createToledoTcpAdapter,
  type ToledoTcpAdapter,
  type ToledoTcpConfig,
  type ToledoTcpAdapterStatus,
  type ParsedToledoReading
} from "@kyberrock/scale-adapters";
import {
  createCustomer,
  deleteCustomer,
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
  updateCarrier,
  type CreateCarrierInput,
  type UpdateCarrierInput
} from "./carriers.js";

export interface StartSimulatedWeighingInput {
  operationType: OperationType;
  customerName: string;
  plate: string;
  driverName: string;
  productDescription: string;
  paymentTermName?: string;
  unitPriceCents?: number;
}

export class DesktopRuntime {
  private database: DesktopDatabase;
  private readonly paths: InitializedDesktopDatabase["paths"];
  private backupScheduler: BackupSchedulerHandle | null = null;
  private receiptPrinter: ReceiptPrinter = { printReceipt: async () => undefined };
  private cacheStore: CacheStore;
  private scaleAdapter: ToledoTcpAdapter = createToledoTcpAdapter();
  private simulatedScaleCursor = 0;
  private readonly simulatedScaleReadings = [12_000, 18_500, 12_250, 19_000];

  private constructor(initialized: InitializedDesktopDatabase) {
    this.database = initialized.database;
    this.paths = initialized.paths;
    this.cacheStore = new CacheStore(this.database);
    this.ensureIdentity();
    this.cacheStore.loadAll(this.ensureIdentity().companyId);
  }

  static initialize(baseDirectory?: string): DesktopRuntime {
    return new DesktopRuntime(initializeDesktopDatabase(baseDirectory));
  }

  getStatus(internetOnline?: boolean): DesktopStatusSnapshot {
    return getDesktopStatusSnapshot(this.database, {
      databasePath: this.paths.databasePath,
      internetOnline
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

  setReceiptPrinter(receiptPrinter: ReceiptPrinter): void {
    this.receiptPrinter = receiptPrinter;
  }

  async startWeighing(
    input: {
      operationType: OperationType;
      customerId: string;
      vehicleId: string;
      driverId: string;
      productId: string;
      paymentTermId?: string;
      unitPriceCents?: number;
    }
  ): Promise<WeighingOperationSummary> {
    this.assertDesktopAccess();
    const entryWeightKg = await this.readScaleWeight();

    return createWeighingOperation(this.database, {
      identity: this.ensureIdentity(),
      operationType: input.operationType,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      driverId: input.driverId,
      productId: input.productId,
      paymentTermId: input.paymentTermId,
      unitPriceCents: input.unitPriceCents,
      entryWeightKg
    });
  }

  async closeWeighing(operationId: string): Promise<WeighingOperationSummary> {
    this.assertDesktopAccess();
    const exitWeightKg = await this.readScaleWeight();

    return closeWeighingOperation(this.database, {
      operationId,
      exitWeightKg
    });
  }

  private async readScaleWeight(): Promise<number> {
    try {
      const reading = await this.scaleAdapter.read();
      return reading.weightKg;
    } catch {
      // Fallback to simulated if scale is not connected
      return this.readNextSimulatedScaleWeightKg();
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

  async syncToCloud(): Promise<SyncResult> {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const errors: string[] = [];
    let synced = 0;
    let failed = 0;

    try {
      initializeSupabase();

      // Sync open operations
      const openOperations = listOpenWeighingOperations(this.database);
      for (const operation of openOperations) {
        try {
          await syncOperationToSupabase(this.database, operation.id, identity);
          synced++;
        } catch (error) {
          failed++;
          errors.push(`Operation ${operation.id}: ${error instanceof Error ? error.message : "Unknown error"}`);
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
          errors.push(`Loading request ${request.id}: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }

      return { success: failed === 0, synced, failed, errors };
    } catch (error) {
      return {
        success: false,
        synced,
        failed,
        errors: [...errors, error instanceof Error ? error.message : "Cloud synchronization failed"]
      };
    }
  }

  async getCloudStatus(): Promise<{ totalOperations: number; lastSync: string | null }> {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    return getSupabaseSyncStatus(identity.companyId);
  }

  isCloudConnected(): boolean {
    return isSupabaseInitialized();
  }

  async connectScale(config: ToledoTcpConfig): Promise<void> {
    await this.scaleAdapter.connect(config);
  }

  disconnectScale(): void {
    this.scaleAdapter.disconnect();
  }

  async readScale(): Promise<{ weightKg: number; stable: boolean }> {
    return this.scaleAdapter.read();
  }

  getScaleStatus(): ToledoTcpAdapterStatus {
    return this.scaleAdapter.getStatus();
  }

  onScaleReading(callback: (reading: ParsedToledoReading) => void): () => void {
    return this.scaleAdapter.onReading(callback);
  }

  close(): void {
    this.backupScheduler?.stop();
    this.backupScheduler = null;
    this.database.close();
  }

  getDesktopAccessStatus(): DesktopAccessStatus {
    return getStoredDesktopAccessStatus(this.database);
  }

  validateDesktopAccess(internetOnline?: boolean, force?: boolean): Promise<DesktopAccessStatus> {
    return validateDesktopAccess(this.database, { internetOnline, force });
  }

  activateDesktop(input: ActivateDesktopInput): Promise<DesktopAccessStatus> {
    return activateDesktop(this.database, input);
  }

  logoutDesktop(): void {
    logoutDesktop(this.database);
  }

  queryCache(options: CacheQueryOptions): CacheQueryResult<unknown> {
    return this.cacheStore.query(options);
  }

  getPriceForCustomerProduct(customerId: string, productId: string): number | null {
    return this.cacheStore.getPriceForCustomerProduct(customerId, productId);
  }

  invalidateCache(
    entityType: CacheQueryOptions["entityType"]
  ): void {
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
    return result;
  }

  updateCustomer(
    id: string,
    input: UpdateCustomerInput
  ): unknown {
    this.assertDesktopAccess();
    const identity = this.ensureIdentity();
    const result = updateCustomer(this.database, id, input);
    this.cacheStore.invalidate("customer", identity.companyId);
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

  getOmieSyncStatus(): {
    configured: boolean;
    totalCustomers: number;
    totalProducts: number;
    totalPaymentTerms: number;
    pendingPushCustomers: number;
    lastSyncAt: string | null;
  } {
    const identity = this.ensureIdentity();

    const totalCustomers = this.database
      .prepare("SELECT COUNT(*) FROM customers WHERE company_id = ? AND deleted_at IS NULL AND source = 'omie'")
      .pluck().get(identity.companyId) as number;

    const totalProducts = this.database
      .prepare("SELECT COUNT(*) FROM products WHERE company_id = ? AND deleted_at IS NULL AND omie_product_id IS NOT NULL")
      .pluck().get(identity.companyId) as number;

    const totalPaymentTerms = this.database
      .prepare("SELECT COUNT(*) FROM payment_terms WHERE company_id = ? AND deleted_at IS NULL AND omie_code IS NOT NULL")
      .pluck().get(identity.companyId) as number;

    const pendingPushCustomers = this.database
      .prepare("SELECT COUNT(*) FROM customers WHERE company_id = ? AND deleted_at IS NULL AND needs_push = 1")
      .pluck().get(identity.companyId) as number;

    const lastSync = this.database
      .prepare("SELECT MAX(last_synced_at) FROM customers WHERE company_id = ? AND deleted_at IS NULL")
      .pluck().get(identity.companyId) as string | null;

    return {
      configured: totalCustomers > 0 || totalProducts > 0,
      totalCustomers,
      totalProducts,
      totalPaymentTerms,
      pendingPushCustomers,
      lastSyncAt: lastSync
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

  private assertDesktopAccess(): void {
    const access = getStoredDesktopAccessStatus(this.database);
    if (!access.canOperate) {
      throw new Error(access.message);
    }
  }

  private readNextSimulatedScaleWeightKg(): number {
    const index = Math.min(this.simulatedScaleCursor, this.simulatedScaleReadings.length - 1);
    this.simulatedScaleCursor += 1;

    return this.simulatedScaleReadings[index];
  }
}
