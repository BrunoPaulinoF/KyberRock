import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
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

/** Quantos backups automaticos manter por pedreira (~1 por dia = ~1 mes de historico). */
export const DEFAULT_BACKUP_RETENTION_COUNT = 30;

// Nome gerado por createAutomaticBackup: kyberrock-{unitId}-{YYYYMMDD}-{HHMMSS}.sqlite3.
// O unitId e um UUID e carrega hifens, entao o grupo 1 e guloso e o carimbo de tempo,
// ancorado no fim, e quem delimita os dois.
const AUTOMATIC_BACKUP_PATTERN = /^kyberrock-(.+)-(\d{8}-\d{6})\.sqlite3$/;

/**
 * Apaga os backups automaticos mais antigos, mantendo os `keep` mais recentes DE CADA
 * pedreira. Nada era podado antes e a pasta crescia sem limite (um arquivo do tamanho do
 * banco por dia).
 *
 * A contagem e por unidade porque um mesmo desktop pode trocar de pedreira (o nome do
 * arquivo carrega o unitId): contar a pasta inteira apagaria todo o historico da pedreira
 * antiga assim que a nova acumulasse `keep` backups.
 *
 * Best-effort por design: e chamado depois de um backup bem-sucedido, entao falhar em
 * apagar um arquivo antigo nunca pode derrubar a rotina de backup.
 */
export function pruneOldBackups(
  backupDirectory: string,
  options: { keep?: number } = {}
): string[] {
  const keep = Math.max(1, options.keep ?? DEFAULT_BACKUP_RETENTION_COUNT);

  let entries: string[];
  try {
    entries = readdirSync(backupDirectory);
  } catch {
    return [];
  }

  const byUnit = new Map<string, string[]>();
  for (const entry of entries) {
    const match = AUTOMATIC_BACKUP_PATTERN.exec(entry);
    if (!match) continue;
    const unitId = match[1];
    const group = byUnit.get(unitId);
    if (group) {
      group.push(entry);
    } else {
      byUnit.set(unitId, [entry]);
    }
  }

  const removed: string[] = [];
  for (const group of byUnit.values()) {
    // O carimbo de tempo e UTC e de largura fixa, entao ordem alfabetica == cronologica.
    group.sort();
    for (const entry of group.slice(0, Math.max(0, group.length - keep))) {
      try {
        rmSync(path.join(backupDirectory, entry), { force: true });
        removed.push(entry);
      } catch {
        // best-effort: o proximo backup tenta de novo
      }
    }
  }

  return removed;
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
