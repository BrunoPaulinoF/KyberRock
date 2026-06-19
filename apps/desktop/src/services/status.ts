import type { DesktopDatabase } from "../database/sqlite.js";
import { getLocalDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap.js";
import { readCloudSyncLastRunAt } from "./cloud-scheduler.js";

export type InternetStatus = "online" | "offline";
export type IntegrationStatus = "not_configured" | "unknown" | "online" | "offline";
export type ScaleRuntimeStatus = "not_configured" | "unknown" | "connected" | "disconnected";

export interface DesktopStatusSnapshot {
  internet: InternetStatus;
  scale: ScaleRuntimeStatus;
  cloud: IntegrationStatus;
  omie: IntegrationStatus;
  pendingSyncJobs: number;
  pendingOmieJobs: number;
  pendingCloudJobs: number;
  cloudLastRunAt: string | null;
  cloudInitialized: boolean;
  cloudReachable: boolean;
  internetOnline: boolean;
  lastBackupAt: string | null;
  databasePath: string;
  identity: LocalDesktopIdentity | null;
  generatedAt: string;
}

export interface GetDesktopStatusSnapshotOptions {
  databasePath: string;
  internetOnline?: boolean;
  now?: Date;
  cloudInitialized?: boolean;
  cloudReachable?: boolean;
}

interface LocalSettingRow {
  value_json: string;
}

export function getDesktopStatusSnapshot(
  database: DesktopDatabase,
  options: GetDesktopStatusSnapshotOptions
): DesktopStatusSnapshot {
  const internetOnline = options.internetOnline !== false;
  return {
    internet: internetOnline ? "online" : "offline",
    scale: getScaleRuntimeStatus(database),
    cloud: getCloudStatus(database, {
      internetOnline,
      cloudInitialized: options.cloudInitialized,
      cloudReachable: options.cloudReachable
    }),
    omie: getIntegrationStatus(database, "omie_configured"),
    pendingSyncJobs: countPendingSyncJobs(database),
    pendingOmieJobs: countPendingOmieJobs(database),
    pendingCloudJobs: countPendingCloudJobs(database),
    cloudLastRunAt: readCloudSyncLastRunAt(database),
    cloudInitialized: options.cloudInitialized === true,
    cloudReachable: options.cloudReachable === true,
    internetOnline,
    lastBackupAt: readStringLocalSetting(database, "last_backup_at"),
    databasePath: options.databasePath,
    identity: getLocalDesktopIdentity(database),
    generatedAt: (options.now ?? new Date()).toISOString()
  };
}

export function recordLastBackupAt(database: DesktopDatabase, backupAt: Date = new Date()): void {
  writeLocalSetting(database, "last_backup_at", backupAt.toISOString(), backupAt.toISOString());
}

function countPendingSyncJobs(database: DesktopDatabase): number {
  const count = database
    .prepare("SELECT COUNT(*) FROM sync_queue WHERE status IN ('pending', 'running', 'failed')")
    .pluck()
    .get();

  return Number(count);
}

function countPendingOmieJobs(database: DesktopDatabase): number {
  const count = database
    .prepare(
      "SELECT COUNT(*) FROM sync_queue WHERE target = 'omie' AND status IN ('pending', 'running', 'failed')"
    )
    .pluck()
    .get();
  return Number(count);
}

function countPendingCloudJobs(database: DesktopDatabase): number {
  const count = database
    .prepare(
      "SELECT COUNT(*) FROM sync_queue WHERE target = 'cloud' AND status IN ('pending', 'running', 'failed')"
    )
    .pluck()
    .get();
  return Number(count);
}

function getCloudStatus(
  database: DesktopDatabase,
  options: { internetOnline: boolean; cloudInitialized?: boolean; cloudReachable?: boolean }
): IntegrationStatus {
  const configured = readBooleanLocalSetting(database, "cloud_configured");
  if (!configured) {
    return "not_configured";
  }
  if (options.cloudReachable === true) {
    return "online";
  }
  if (!options.internetOnline || options.cloudReachable === false) {
    return "offline";
  }
  return "unknown";
}

function getScaleRuntimeStatus(database: DesktopDatabase): ScaleRuntimeStatus {
  const activeScaleConfigs = database
    .prepare("SELECT COUNT(*) FROM scale_configs WHERE is_active = 1")
    .pluck()
    .get();

  return Number(activeScaleConfigs) > 0 ? "unknown" : "not_configured";
}

function getIntegrationStatus(database: DesktopDatabase, settingKey: string): IntegrationStatus {
  const configured = readBooleanLocalSetting(database, settingKey);

  return configured ? "unknown" : "not_configured";
}

function readBooleanLocalSetting(database: DesktopDatabase, key: string): boolean {
  const value = readLocalSetting(database, key);

  return value === true;
}

function readStringLocalSetting(database: DesktopDatabase, key: string): string | null {
  const value = readLocalSetting(database, key);

  return typeof value === "string" ? value : null;
}

function readLocalSetting(database: DesktopDatabase, key: string): unknown {
  const row = database.prepare("SELECT value_json FROM local_settings WHERE key = ?").get(key) as
    | LocalSettingRow
    | undefined;

  return row ? JSON.parse(row.value_json) : null;
}

function writeLocalSetting(
  database: DesktopDatabase,
  key: string,
  value: string,
  updatedAt: string
): void {
  database
    .prepare(
      `INSERT INTO local_settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value), updatedAt);
}
