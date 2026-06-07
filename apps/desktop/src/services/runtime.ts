import { initializeDesktopDatabase, type InitializedDesktopDatabase } from "../database/initialize";
import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import {
  createAutomaticBackup,
  exportManualBackup,
  restoreBackup,
  type BackupResult
} from "./backup";
import {
  ensureInitialDesktopIdentity,
  getLocalDesktopIdentity,
  type LocalDesktopIdentity
} from "./bootstrap";
import {
  startDailyBackupScheduler,
  type BackupSchedulerHandle,
  type StartDailyBackupSchedulerOptions
} from "./backup-scheduler";
import { getDesktopStatusSnapshot, recordLastBackupAt, type DesktopStatusSnapshot } from "./status";

export class DesktopRuntime {
  private database: DesktopDatabase;
  private readonly paths: InitializedDesktopDatabase["paths"];
  private backupScheduler: BackupSchedulerHandle | null = null;

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
}
