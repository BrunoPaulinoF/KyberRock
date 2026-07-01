import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { DesktopDatabase } from "../database/sqlite";
import { DesktopRuntime } from "./runtime";
import { writeLocalSetting, readLocalSetting } from "./local-settings";
import { ensureInitialDesktopIdentity } from "./bootstrap";

describe("DesktopRuntime OMIE status", () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports OMIE configured when cloud credentials are present", () => {
    const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-runtime-"));
    tempDirectories.push(baseDirectory);
    const runtime = DesktopRuntime.initialize(baseDirectory);

    try {
      const database = (runtime as unknown as { database: DesktopDatabase }).database;
      writeLocalSetting(database, "cloud_company_id", "company-1");
      writeLocalSetting(database, "cloud_unit_id", "unit-1");
      writeLocalSetting(database, "cloud_device_id", "device-1");
      writeLocalSetting(database, "cloud_device_token", "token-1");
      writeLocalSetting(database, "cloud_configured", true);

      expect(runtime.getOmieSyncStatus()).toMatchObject({
        configured: true,
        hasSyncedData: false,
        totalCustomers: 0,
        totalProducts: 0,
        totalPaymentTerms: 0
      });
    } finally {
      runtime.close();
    }
  });

  it("resets OMIE master data, clearing reference data and sync state", () => {
    const baseDirectory = mkdtempSync(path.join(tmpdir(), "kyberrock-runtime-"));
    tempDirectories.push(baseDirectory);
    const runtime = DesktopRuntime.initialize(baseDirectory);

    try {
      const database = (runtime as unknown as { database: DesktopDatabase }).database;

      // Insert test company
      database.prepare(`INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
        VALUES ('company-1', 'Test Co', 'Test', datetime('now'), datetime('now'))`).run();

      // Insert local customers
      database.prepare(`INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
        VALUES ('cust-1', 'company-1', 'local', 'Cliente A', 'Cliente A', 1, datetime('now'), datetime('now'))`).run();
      database.prepare(`INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
        VALUES ('cust-2', 'company-1', 'local', 'Cliente B', 'Cliente B', 1, datetime('now'), datetime('now'))`).run();

      // Insert local carriers
      database.prepare(`INSERT INTO carriers (id, company_id, name, source, is_active, created_at, updated_at)
        VALUES ('car-1', 'company-1', 'Transportadora A', 'local', 1, datetime('now'), datetime('now'))`).run();

      database.prepare(`INSERT INTO products (id, company_id, omie_product_id, code, description, unit, is_active, created_at, updated_at)
        VALUES ('prod-1', 'company-1', 123, 'P123', 'Produto A', 'UN', 1, datetime('now'), datetime('now'))`).run();

      database.prepare(`INSERT INTO payment_terms (id, company_id, omie_code, name, rules_json, is_active, created_at, updated_at)
        VALUES ('term-1', 'company-1', '30', '30 dias', '{}', 1, datetime('now'), datetime('now'))`).run();

      // Insert OMIE sync runs
      database.prepare(`INSERT INTO omie_sync_runs (id, company_id, started_at, mode, triggered_by, success, created_at, updated_at)
        VALUES ('run-1', 'company-1', datetime('now'), 'full', 'manual', 1, datetime('now'), datetime('now'))`).run();

      // Insert sync state
      writeLocalSetting(database, "omie_pull_state", {
        customersPage: 5, productsPage: 3, paymentTermsPage: 2, suppliersPage: 1,
        customersFinished: true, productsFinished: true, paymentTermsFinished: true, suppliersFinished: true,
        inProgress: true
      });
      writeLocalSetting(database, "omie_sync_lock", { lockedAt: new Date().toISOString(), runId: "run-1" });

      // Insert OMIE sync queue jobs
      database.prepare(`INSERT INTO sync_queue (id, target, action, entity_type, entity_id, idempotency_key, payload_json, status, attempt_count, next_attempt_at, created_at, updated_at)
        VALUES ('job-1', 'omie', 'send_order', 'weighing_operation', 'op-1', 'kyberrock:unit-1:op-1:create_sales_order', '{}', 'pending', 0, datetime('now'), datetime('now'), datetime('now'))`).run();

      // Set identity so ensureIdentity picks company-1
      ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "Test Co",
        companyTradeName: "Test",
        unitId: "unit-1",
        unitName: "Unidade",
        deviceId: "device-1",
        deviceName: "Desktop"
      });

      const result = runtime.resetOmieMasterData();

      expect(result.customersCleared).toBe(2);
      expect(result.carriersCleared).toBe(1);
      expect(result.syncRunsCleared).toBe(1);
      expect(result.syncQueueCleared).toBe(1);

      // Verify soft delete
      const activeCustomers = database.prepare(`SELECT COUNT(*) FROM customers WHERE company_id = 'company-1' AND deleted_at IS NULL`).pluck().get() as number;
      const activeCarriers = database.prepare(`SELECT COUNT(*) FROM carriers WHERE company_id = 'company-1' AND deleted_at IS NULL`).pluck().get() as number;
      const activeProducts = database.prepare(`SELECT COUNT(*) FROM products WHERE company_id = 'company-1' AND deleted_at IS NULL`).pluck().get() as number;
      const activePaymentTerms = database.prepare(`SELECT COUNT(*) FROM payment_terms WHERE company_id = 'company-1' AND deleted_at IS NULL`).pluck().get() as number;
      expect(activeCustomers).toBe(0);
      expect(activeCarriers).toBe(0);
      expect(activeProducts).toBe(0);
      expect(activePaymentTerms).toBe(0);

      // Verify sync state cleared
      const pullState = readLocalSetting<Record<string, unknown>>(database, "omie_pull_state");
      const syncLock = readLocalSetting<Record<string, unknown>>(database, "omie_sync_lock");
      expect(pullState).toBeNull();
      expect(syncLock).toBeNull();

      // Verify sync queue cleared
      const queueCount = database.prepare(`SELECT COUNT(*) FROM sync_queue WHERE target = 'omie'`).pluck().get() as number;
      expect(queueCount).toBe(0);
    } finally {
      runtime.close();
    }
  });
});
