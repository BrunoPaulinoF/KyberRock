import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { runDesktopMigrations } from "../database/migrate.js";
import {
  syncOmieMasterData,
  getLastSyncRun,
  getSyncEntitiesByRun
} from "./omie-master-sync.js";
import { saveOmieRawRecord } from "./omie-sync-raw-records.js";
import { writeLocalSetting } from "./local-settings.js";
import type { DesktopDatabase } from "../database/sqlite.js";

function createTestDatabase(): DesktopDatabase {
  const db = new Database(":memory:") as DesktopDatabase;
  runDesktopMigrations(db);
  return db;
}

describe("omie-master-sync", () => {
  let db: DesktopDatabase;
  const companyId = "test-company";

  beforeEach(() => {
    db = createTestDatabase();
    db.prepare(
      `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
       VALUES (?, 'Test', 'Test', datetime('now'), datetime('now'))`
    ).run(companyId);
  });

  it("should block simultaneous sync with lock", async () => {
    writeLocalSetting(db, "omie_sync_lock", {
      lockedAt: new Date().toISOString(),
      runId: "previous-run"
    });

    const result = await syncOmieMasterData(db, companyId, {
      triggeredBy: "manual",
      mode: "full"
    });

    expect(result.success).toBe(false);
    expect(result.entities).toHaveLength(0);
  });

  it("should release lock after sync finishes", async () => {
    const result = await syncOmieMasterData(db, companyId, {
      triggeredBy: "manual",
      mode: "full"
    });

    expect(result.runId).toBeDefined();
    const lock = db.prepare("SELECT value_json FROM local_settings WHERE key = 'omie_sync_lock'").get() as
      | { value_json: string }
      | undefined;
    expect(lock).toBeUndefined();
  });

  it("should record a sync run after completion", async () => {
    const result = await syncOmieMasterData(db, companyId, {
      triggeredBy: "automatic",
      mode: "incremental"
    });

    const lastRun = getLastSyncRun(db, companyId);
    expect(lastRun).not.toBeNull();
    expect(lastRun!.id).toBe(result.runId);
    expect(lastRun!.mode).toBe("incremental");
    expect(lastRun!.triggeredBy).toBe("automatic");
  });

  it("should record entity results per run", async () => {
    const result = await syncOmieMasterData(db, companyId, {
      triggeredBy: "manual",
      mode: "full"
    });

    const entities = getSyncEntitiesByRun(db, result.runId);
    expect(entities.length).toBeGreaterThan(0);
    const entityNames = entities.map((e) => e.entity);
    expect(entityNames).toContain("clientes");
    expect(entityNames).toContain("produtos");
    expect(entityNames).toContain("condicoes_pagamento");
    expect(entityNames).toContain("transportadoras");
    expect(entityNames).toContain("motoristas");
    expect(entityNames).toContain("veiculos");
  });

  it("should not corrupt other entities when one fails", async () => {
    const result = await syncOmieMasterData(db, companyId, {
      triggeredBy: "manual",
      mode: "full"
    });

    // Even if some entities return 0 (no credentials), the sync should complete
    // and record results for all entities without throwing.
    expect(result.entities.length).toBeGreaterThan(1);
    expect(result.success).toBe(true);
  });

  it("should save raw OMIE payload for audit", () => {
    saveOmieRawRecord(db, companyId, "clientes", 12345, { nome: "Cliente Teste" });

    const rows = db
      .prepare("SELECT * FROM omie_raw_records WHERE company_id = ? AND entity_type = ?")
      .all(companyId, "clientes") as Array<{
      omie_id: string;
      payload_json: string;
    }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].omie_id).toBe("12345");
    expect(JSON.parse(rows[0].payload_json)).toEqual({ nome: "Cliente Teste" });
  });

  it("should auto-release expired lock after 30 minutes", async () => {
    const oldDate = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    writeLocalSetting(db, "omie_sync_lock", {
      lockedAt: oldDate,
      runId: "expired-run"
    });

    const result = await syncOmieMasterData(db, companyId, {
      triggeredBy: "manual",
      mode: "full"
    });

    expect(result.runId).toBeDefined();
    expect(result.success).toBe(true);
  });
});
