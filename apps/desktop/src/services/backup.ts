import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { assertDesktopDatabaseHealthy } from "../database/migrate.js";
import type { DesktopDatabase } from "../database/sqlite.js";

export interface CreateAutomaticBackupOptions {
  database: DesktopDatabase;
  databasePath: string;
  backupDirectory: string;
  unitId: string;
  now?: Date;
}

export interface BackupResult {
  backupPath: string;
  createdAt: string;
}

export async function createAutomaticBackup(
  options: CreateAutomaticBackupOptions
): Promise<BackupResult> {
  const now = options.now ?? new Date();
  const backupPath = path.join(
    options.backupDirectory,
    `kyberrock-${sanitizePathPart(options.unitId)}-${formatBackupTimestamp(now)}.sqlite3`
  );

  await copyHealthyDatabase(options.database, backupPath);

  return {
    backupPath,
    createdAt: now.toISOString()
  };
}

export async function exportManualBackup(
  database: DesktopDatabase,
  destinationPath: string
): Promise<BackupResult> {
  const now = new Date();
  await copyHealthyDatabase(database, destinationPath);

  return {
    backupPath: destinationPath,
    createdAt: now.toISOString()
  };
}

export function restoreBackup(backupPath: string, databasePath: string): void {
  assertDatabaseFileHealthy(backupPath);
  mkdirSync(path.dirname(databasePath), { recursive: true });
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
  copyFileSync(backupPath, databasePath);
  assertDatabaseFileHealthy(databasePath);
}

export function assertDatabaseFileHealthy(databasePath: string): void {
  const database = new Database(databasePath, { fileMustExist: true, readonly: true });

  try {
    assertDesktopDatabaseHealthy(database);
  } finally {
    database.close();
  }
}

async function copyHealthyDatabase(
  database: DesktopDatabase,
  destinationPath: string
): Promise<void> {
  assertDesktopDatabaseHealthy(database);
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  database.pragma("wal_checkpoint(FULL)");
  await database.backup(destinationPath);
  assertDatabaseFileHealthy(destinationPath);
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "unit";
}

function formatBackupTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hour = pad(date.getUTCHours());
  const minute = pad(date.getUTCMinutes());
  const second = pad(date.getUTCSeconds());

  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
