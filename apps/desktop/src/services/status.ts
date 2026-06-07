import type { DesktopDatabase } from "../database/sqlite";
import { getLocalDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";

export type InternetStatus = "online" | "offline";
export type IntegrationStatus = "not_configured" | "unknown" | "online" | "offline";
export type ScaleRuntimeStatus = "not_configured" | "unknown" | "connected" | "disconnected";

export interface DesktopStatusSnapshot {
  internet: InternetStatus;
  scale: ScaleRuntimeStatus;
  firebase: IntegrationStatus;
  omie: IntegrationStatus;
  pendingSyncJobs: number;
  lastBackupAt: string | null;
  databasePath: string;
  identity: LocalDesktopIdentity | null;
  generatedAt: string;
}

export interface GetDesktopStatusSnapshotOptions {
  databasePath: string;
  internetOnline?: boolean;
  now?: Date;
}

interface LocalSettingRow {
  value_json: string;
}

export function getDesktopStatusSnapshot(
  database: DesktopDatabase,
  options: GetDesktopStatusSnapshotOptions
): DesktopStatusSnapshot {
  return {
    internet: options.internetOnline === false ? "offline" : "online",
    scale: getScaleRuntimeStatus(database),
    firebase: getIntegrationStatus(database, "firebase_configured"),
    omie: getIntegrationStatus(database, "omie_configured"),
    pendingSyncJobs: countPendingSyncJobs(database),
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
