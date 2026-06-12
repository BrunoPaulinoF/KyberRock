import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseConfig } from "../config/supabase-config";
import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import { createSimulatedWeighingOperation } from "./weighing-operations";
import { applyOmieReferenceData, initializeSupabase, isSupabaseInitialized } from "./supabase-sync";

const invokeMock = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    functions: {
      invoke: invokeMock
    }
  }))
}));

describe("supabase sync", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ error: null });
  });

  it("initializes supabase without errors", () => {
    expect(() => initializeSupabase()).not.toThrow();
    expect(isSupabaseInitialized()).toBe(true);
  });

  it("has a valid desktop publishable key without requiring a runtime .env file", () => {
    expect(supabaseConfig.publishableKey).toMatch(/^sb_publishable_/);
  });

  it("includes the operation entry weight when syncing loading requests", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      const operation = createSimulatedWeighingOperation(database, {
        identity,
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });
      const requestId = database
        .prepare("SELECT id FROM loading_requests WHERE operation_id = ?")
        .pluck()
        .get(operation.id) as string;

      const { syncLoadingRequestToSupabase } = await import("./supabase-sync");
      await syncLoadingRequestToSupabase(database, requestId, identity);

      expect(invokeMock).toHaveBeenCalledWith("desktop-sync", {
        body: expect.objectContaining({
          loadingRequests: [expect.objectContaining({ entry_weight_kg: 12_000 })]
        })
      });
    } finally {
      database.close();
    }
  });

  it("applies OMIE reference data returned by the cloud bridge", () => {
    const database = createDatabase();

    try {
      createIdentity(database);
      const result = applyOmieReferenceData(database, "company-1", {
        customers: [
          {
            id: 123,
            name: "Pedreira Cliente LTDA",
            tradeName: "Pedreira Cliente",
            document: "12345678000195",
            phone: "(11) 99999-9999",
            email: "cliente@example.com"
          }
        ],
        products: [
          {
            id: 456,
            code: "BRITA1",
            description: "Brita 1",
            unit: "M3"
          }
        ],
        paymentTerms: [
          {
            id: 789,
            description: "30 dias"
          }
        ]
      });

      expect(result).toMatchObject({
        customersPulled: 1,
        customersPushed: 0,
        productsSynced: 1,
        paymentTermsSynced: 1,
        errors: []
      });
      expect(database.prepare("SELECT legal_name FROM customers WHERE id = 'omie_123'").pluck().get()).toBe("Pedreira Cliente LTDA");
      expect(database.prepare("SELECT description FROM products WHERE id = 'omie_456'").pluck().get()).toBe("Brita 1");
      expect(database.prepare("SELECT name FROM payment_terms WHERE id = 'omie_789'").pluck().get()).toBe("30 dias");
    } finally {
      database.close();
    }
  });
});

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  return database;
}

function createIdentity(database: DesktopDatabase): LocalDesktopIdentity {
  return ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: "device-1",
    deviceName: "PC Balanca",
    installationId: "install-1"
  });
}

function createCloudSettings(database: DesktopDatabase): void {
  const now = new Date("2026-06-06T12:00:00.000Z").toISOString();
  const settings = [
    ["cloud_company_id", "company-1"],
    ["cloud_unit_id", "unit-1"],
    ["cloud_device_id", "device-1"],
    ["cloud_device_token", "device-token-1"]
  ];

  for (const [key, value] of settings) {
    database
      .prepare("INSERT INTO local_settings (key, value_json, updated_at) VALUES (?, ?, ?)")
      .run(key, JSON.stringify(value), now);
  }
}
