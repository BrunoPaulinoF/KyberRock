import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";
import { createOmieClient, OmieSyncService } from "./omie-sync.js";
import { readLocalSetting, writeLocalSetting } from "./local-settings.js";
import { readOmieSyncMapping } from "./omie-sync-config.js";
import {
  syncOmieDrivers as syncDriversFromSource,
  syncOmieVehicles as syncVehiclesFromSource
} from "./omie-sync-drivers-vehicles.js";

const OMIE_SYNC_LOCK_KEY = "omie_sync_lock";

export type SyncMode = "full" | "incremental";
export type SyncTriggeredBy = "manual" | "automatic" | "startup";

export interface EntitySyncResult {
  entity: string;
  success: boolean;
  totalFetched: number;
  totalCreated: number;
  totalUpdated: number;
  totalSkipped: number;
  startedAt: Date;
  finishedAt: Date;
  errorMessage?: string;
}

export interface OmieSyncResult {
  success: boolean;
  startedAt: Date;
  finishedAt: Date;
  triggeredBy: SyncTriggeredBy;
  mode: SyncMode;
  entities: EntitySyncResult[];
  runId: string;
}

export interface SyncOmieMasterDataOptions {
  mode?: SyncMode;
  triggeredBy?: SyncTriggeredBy;
  appKey?: string;
  appSecret?: string;
}

interface SyncLock {
  lockedAt: string;
  runId: string;
}

function isSyncLocked(database: DesktopDatabase): { locked: boolean; runId?: string } {
  const lock = readLocalSetting<SyncLock>(database, OMIE_SYNC_LOCK_KEY);
  if (!lock?.lockedAt) return { locked: false };
  const lockedAt = Date.parse(lock.lockedAt);
  if (Number.isNaN(lockedAt)) return { locked: false };
  // Auto-release lock after 30 minutes to avoid permanent deadlock
  if (Date.now() - lockedAt > 30 * 60 * 1000) return { locked: false };
  return { locked: true, runId: lock.runId };
}

function acquireSyncLock(database: DesktopDatabase, runId: string): void {
  writeLocalSetting(database, OMIE_SYNC_LOCK_KEY, { lockedAt: new Date().toISOString(), runId });
}

function releaseSyncLock(database: DesktopDatabase): void {
  database.prepare("DELETE FROM local_settings WHERE key = ?").run(OMIE_SYNC_LOCK_KEY);
}

function insertSyncRun(
  database: DesktopDatabase,
  runId: string,
  companyId: string,
  mode: SyncMode,
  triggeredBy: SyncTriggeredBy
): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO omie_sync_runs (id, company_id, started_at, mode, triggered_by, success, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(runId, companyId, now, mode, triggeredBy, now, now);
}

function finishSyncRun(
  database: DesktopDatabase,
  runId: string,
  success: boolean,
  errors: string[]
): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `UPDATE omie_sync_runs
       SET finished_at = ?, success = ?, errors_json = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(now, success ? 1 : 0, errors.length > 0 ? JSON.stringify(errors) : null, now, runId);
}

function insertSyncEntity(database: DesktopDatabase, result: EntitySyncResult & { runId: string }): void {
  const now = new Date().toISOString();
  database
    .prepare(
      `INSERT INTO omie_sync_entities
       (id, run_id, entity, success, total_fetched, total_created, total_updated, total_skipped,
        error_message, started_at, finished_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      result.runId,
      result.entity,
      result.success ? 1 : 0,
      result.totalFetched,
      result.totalCreated,
      result.totalUpdated,
      result.totalSkipped,
      result.errorMessage ?? null,
      result.startedAt.toISOString(),
      result.finishedAt.toISOString(),
      now,
      now
    );
}

export async function syncOmieMasterData(
  database: DesktopDatabase,
  companyId: string,
  options: SyncOmieMasterDataOptions = {}
): Promise<OmieSyncResult> {
  const mode = options.mode ?? "full";
  const triggeredBy = options.triggeredBy ?? "manual";
  const runId = randomUUID();
  const startedAt = new Date();

  const lockStatus = isSyncLocked(database);
  if (lockStatus.locked) {
    return {
      success: false,
      startedAt,
      finishedAt: new Date(),
      triggeredBy,
      mode,
      entities: [],
      runId
    };
  }

  acquireSyncLock(database, runId);
  insertSyncRun(database, runId, companyId, mode, triggeredBy);

  const entities: EntitySyncResult[] = [];
  const errors: string[] = [];

  try {
    const mapping = readOmieSyncMapping(database);
    let taggedSupplierResult: { customersPulled: number; suppliersSynced: number } | null = null;

    // 1. Customers
    entities.push(await syncEntity("clientes", async () => {
      if (options.appKey && options.appSecret) {
        const client = createOmieClient({ appKey: options.appKey, appSecret: options.appSecret });
        const service = new OmieSyncService(client, database);
        taggedSupplierResult = await service.rebuildCustomersAndCarriersFromOmie(companyId);
        return { fetched: taggedSupplierResult.customersPulled, created: taggedSupplierResult.customersPulled, updated: 0, skipped: 0 };
      }
      // Cloud sync path is handled by the scheduler; for master data we focus on direct/local when credentials provided
      return { fetched: 0, created: 0, updated: 0, skipped: 0 };
    }));

    // 2. Products
    entities.push(await syncEntity("produtos", async () => {
      if (options.appKey && options.appSecret) {
        const client = createOmieClient({ appKey: options.appKey, appSecret: options.appSecret });
        const service = new OmieSyncService(client, database);
        const fetched = await service.syncProducts(companyId);
        return { fetched, created: fetched, updated: 0, skipped: 0 };
      }
      return { fetched: 0, created: 0, updated: 0, skipped: 0 };
    }));

    // 3. Payment terms — cadastradas localmente no KyberRock, nao vem mais do OMIE.
    entities.push(await syncEntity("condicoes_pagamento", async () => {
      return { fetched: 0, created: 0, updated: 0, skipped: 0 };
    }));

    // 4. Carriers (transportadoras)
    entities.push(await syncEntity("transportadoras", async () => {
      if (options.appKey && options.appSecret) {
        const fetched = taggedSupplierResult?.suppliersSynced ?? 0;
        return { fetched, created: fetched, updated: 0, skipped: 0 };
      }
      return { fetched: 0, created: 0, updated: 0, skipped: 0 };
    }));

    // 5. Drivers (motoristas) - prepared structure, source must be configured
    entities.push(await syncEntity("motoristas", async () => {
      const result = await syncDriversFromSource(database, companyId, mapping.motoristas);
      return result;
    }));

    // 6. Vehicles (veiculos) - prepared structure, source must be configured
    entities.push(await syncEntity("veiculos", async () => {
      const result = await syncVehiclesFromSource(database, companyId, mapping.veiculos);
      return result;
    }));

    // 7. Payment methods (meios de pagamento) — nome + codigo OMIE, idempotente.
    entities.push(await syncEntity("meios_pagamento", async () => {
      if (options.appKey && options.appSecret) {
        const client = createOmieClient({ appKey: options.appKey, appSecret: options.appSecret });
        const service = new OmieSyncService(client, database);
        return await service.syncPaymentMethods(companyId);
      }
      return { fetched: 0, created: 0, updated: 0, skipped: 0 };
    }));

    // 8. Checking accounts (contas correntes) — nome + nCodCC, idempotente.
    entities.push(await syncEntity("contas_correntes", async () => {
      if (options.appKey && options.appSecret) {
        const client = createOmieClient({ appKey: options.appKey, appSecret: options.appSecret });
        const service = new OmieSyncService(client, database);
        return await service.syncCheckingAccounts(companyId);
      }
      return { fetched: 0, created: 0, updated: 0, skipped: 0 };
    }));

    const success = entities.every((e) => e.success);
    const finishedAt = new Date();

    for (const entity of entities) {
      insertSyncEntity(database, { ...entity, runId });
    }

    finishSyncRun(database, runId, success, errors);
    releaseSyncLock(database);

    return {
      success,
      startedAt,
      finishedAt,
      triggeredBy,
      mode,
      entities,
      runId
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync master failed";
    errors.push(message);
    finishSyncRun(database, runId, false, errors);
    releaseSyncLock(database);

    return {
      success: false,
      startedAt,
      finishedAt: new Date(),
      triggeredBy,
      mode,
      entities,
      runId
    };
  }
}

async function syncEntity(
  entityName: string,
  executor: () => Promise<{ fetched: number; created: number; updated: number; skipped: number }>
): Promise<EntitySyncResult> {
  const startedAt = new Date();
  try {
    const result = await executor();
    return {
      entity: entityName,
      success: true,
      totalFetched: result.fetched,
      totalCreated: result.created,
      totalUpdated: result.updated,
      totalSkipped: result.skipped,
      startedAt,
      finishedAt: new Date()
    };
  } catch (error) {
    return {
      entity: entityName,
      success: false,
      totalFetched: 0,
      totalCreated: 0,
      totalUpdated: 0,
      totalSkipped: 0,
      startedAt,
      finishedAt: new Date(),
      errorMessage: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

export function getLastSyncRun(
  database: DesktopDatabase,
  companyId: string
): {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  success: boolean;
  mode: string;
  triggeredBy: string;
} | null {
  const row = database
    .prepare(
      `SELECT id, started_at, finished_at, success, mode, triggered_by
       FROM omie_sync_runs
       WHERE company_id = ?
       ORDER BY started_at DESC
       LIMIT 1`
    )
    .get(companyId) as
    | {
        id: string;
        started_at: string;
        finished_at: string | null;
        success: number;
        mode: string;
        triggered_by: string;
      }
    | undefined;

  if (!row) return null;
  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    success: Boolean(row.success),
    mode: row.mode,
    triggeredBy: row.triggered_by
  };
}

export function getSyncEntitiesByRun(
  database: DesktopDatabase,
  runId: string
): Array<{
  entity: string;
  success: boolean;
  totalFetched: number;
  totalCreated: number;
  totalUpdated: number;
  totalSkipped: number;
  errorMessage: string | null;
}> {
  const rows = database
    .prepare(
      `SELECT entity, success, total_fetched, total_created, total_updated, total_skipped, error_message
       FROM omie_sync_entities
       WHERE run_id = ?
       ORDER BY started_at ASC`
    )
    .all(runId) as Array<{
    entity: string;
    success: number;
    totalFetched: number;
    totalCreated: number;
    totalUpdated: number;
    totalSkipped: number;
    errorMessage: string | null;
  }>;

  return rows.map((row) => ({
    entity: row.entity,
    success: Boolean(row.success),
    totalFetched: row.totalFetched,
    totalCreated: row.totalCreated,
    totalUpdated: row.totalUpdated,
    totalSkipped: row.totalSkipped,
    errorMessage: row.errorMessage
  }));
}
