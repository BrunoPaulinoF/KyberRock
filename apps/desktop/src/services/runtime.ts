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
  createSimulatedWeighingOperation,
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
  private simulatedScaleCursor = 0;
  private readonly simulatedScaleReadings = [12_000, 18_500, 12_250, 19_000];

  private constructor(initialized: InitializedDesktopDatabase) {
    this.database = initialized.database;
    this.paths = initialized.paths;
    this.ensureIdentity();
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

  async startSimulatedWeighing(
    input: StartSimulatedWeighingInput
  ): Promise<WeighingOperationSummary> {
    const entryWeightKg = this.readNextSimulatedScaleWeightKg();

    return createSimulatedWeighingOperation(this.database, {
      identity: this.ensureIdentity(),
      operationType: input.operationType,
      customerName: input.customerName,
      plate: input.plate,
      driverName: input.driverName,
      productDescription: input.productDescription,
      paymentTermName: input.paymentTermName,
      unitPriceCents: input.unitPriceCents,
      entryWeightKg
    });
  }

  async closeSimulatedWeighing(operationId: string): Promise<WeighingOperationSummary> {
    const exitWeightKg = this.readNextSimulatedScaleWeightKg();

    return closeWeighingOperation(this.database, {
      operationId,
      exitWeightKg
    });
  }

  cancelWeighing(operationId: string, reason: string): WeighingOperationSummary {
    return cancelWeighingOperation(this.database, { operationId, reason });
  }

  listOpenWeighingOperations(): WeighingOperationSummary[] {
    return listOpenWeighingOperations(this.database);
  }

  configureReceiptPrintProfile(
    input: Omit<ConfigureReceiptPrintProfileInput, "identity">
  ): PrintProfileSummary {
    return configureReceiptPrintProfile(this.database, {
      ...input,
      identity: this.ensureIdentity()
    });
  }

  listPrintProfiles(): PrintProfileSummary[] {
    return listPrintProfiles(this.database);
  }

  listPrintReceipts(): PrintReceiptSummary[] {
    return listPrintReceipts(this.database);
  }

  printReceipt(operationId: string): Promise<PrintReceiptSummary> {
    return printWeighingReceipt(
      this.database,
      { operationId, identity: this.ensureIdentity() },
      this.receiptPrinter
    );
  }

  reprintReceipt(receiptId: string): Promise<PrintReceiptSummary> {
    return reprintWeighingReceipt(
      this.database,
      { receiptId, identity: this.ensureIdentity() },
      this.receiptPrinter
    );
  }

  printTestReceipt(): Promise<PrintReceiptSummary> {
    return printTestReceipt(
      this.database,
      { identity: this.ensureIdentity() },
      this.receiptPrinter
    );
  }

  async syncToCloud(): Promise<SyncResult> {
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
    const identity = this.ensureIdentity();
    return getSupabaseSyncStatus(identity.companyId);
  }

  isCloudConnected(): boolean {
    return isSupabaseInitialized();
  }

  close(): void {
    this.backupScheduler?.stop();
    this.backupScheduler = null;
    this.database.close();
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

  private readNextSimulatedScaleWeightKg(): number {
    const index = Math.min(this.simulatedScaleCursor, this.simulatedScaleReadings.length - 1);
    this.simulatedScaleCursor += 1;

    return this.simulatedScaleReadings[index];
  }
}
