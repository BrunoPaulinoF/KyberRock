import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseConfig } from "../config/supabase-config";
import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import { enqueueSyncJob } from "./sync-queue";
import { createSimulatedWeighingOperation } from "./weighing-operations";
import {
  applyOmieReferenceData,
  initializeSupabase,
  isSupabaseInitialized,
  processOmieSyncQueue,
  pushOmieCustomersToCloud,
  syncOmieReferenceDataFromCloud
} from "./supabase-sync";

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

  it("pulls OMIE reference data through the secure cloud bridge", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      invokeMock.mockResolvedValueOnce({
        error: null,
        data: {
          customers: [{ id: 123, name: "Cliente OMIE", tradeName: null, document: null, phone: null, email: null }],
          products: [{ id: 456, code: "BRITA", description: "Brita", unit: "M3" }],
          paymentTerms: [{ id: 789, description: "30 dias" }]
        }
      });

      const result = await syncOmieReferenceDataFromCloud(database, identity);

      expect(invokeMock).toHaveBeenCalledWith("omie-sync", {
        body: {
          deviceId: "device-1",
          deviceToken: "device-token-1",
          action: "pull_reference_data",
          resume: {
            customersPage: 1,
            productsPage: 1,
            paymentTermsPage: 1
          }
        }
      });
      expect(result).toMatchObject({ customersPulled: 1, productsSynced: 1, paymentTermsSynced: 1 });
      expect(database.prepare("SELECT COUNT(*) FROM customers WHERE omie_customer_id = 123").pluck().get()).toBe(1);
    } finally {
      database.close();
    }
  });

  it("shows the real Edge Function error body when OMIE bridge rejects the request", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      invokeMock.mockResolvedValueOnce({
        error: createFunctionHttpError("OMIE nao configurado para esta empresa"),
        data: null
      });

      await expect(syncOmieReferenceDataFromCloud(database, identity)).rejects.toThrow(
        "OMIE nao configurado para esta empresa"
      );
    } finally {
      database.close();
    }
  });

  it("pushes pending local customers to OMIE through the cloud bridge", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertLocalCustomer(database, "customer-1");
      invokeMock.mockResolvedValueOnce({ error: null, data: { omieCustomerId: 321 } });

      const result = await pushOmieCustomersToCloud(database, identity);

      expect(invokeMock).toHaveBeenCalledWith("omie-sync", {
        body: expect.objectContaining({
          deviceId: "device-1",
          deviceToken: "device-token-1",
          action: "push_customer",
          payload: expect.objectContaining({
            localCustomerId: "customer-1",
            razaoSocial: "Cliente Local LTDA",
            nomeFantasia: "Cliente Local",
            cnpjCpf: "12345678000195"
          })
        })
      });
      expect(result).toEqual({ pushed: 1, failed: 0, errors: [] });
      expect(database.prepare("SELECT omie_customer_id FROM customers WHERE id = 'customer-1'").pluck().get()).toBe(321);
      expect(database.prepare("SELECT needs_push FROM customers WHERE id = 'customer-1'").pluck().get()).toBe(0);
    } finally {
      database.close();
    }
  });

  it("reports local customer push failures to the caller", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertLocalCustomer(database, "customer-1");
      invokeMock.mockResolvedValueOnce({ error: { message: "Credencial OMIE invalida" }, data: null });

      const result = await pushOmieCustomersToCloud(database, identity);

      expect(result).toMatchObject({ pushed: 0, failed: 1 });
      expect(result.errors[0]).toContain("Credencial OMIE invalida");
      expect(database.prepare("SELECT sync_status FROM customers WHERE id = 'customer-1'").pluck().get()).toBe("error");
    } finally {
      database.close();
    }
  });

  it("sends queued OMIE orders through the cloud bridge", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      enqueueSyncJob(database, {
        id: "omie-job-1",
        target: "omie",
        action: "create_order",
        entityType: "weighing_operation",
        entityId: "operation-1",
        idempotencyKey: "kyberrock:unit-1:operation-1:create_sales_order",
        payload: {
          operationId: "operation-1",
          operationType: "invoice",
          customerOmieId: 123,
          productOmieId: 456,
          quantity: 10,
          unitPrice: 25,
          issueDate: "2026-06-12"
        }
      });
      invokeMock.mockResolvedValueOnce({ error: null, data: { orderId: 987 } });

      const result = await processOmieSyncQueue(database, identity);

      expect(invokeMock).toHaveBeenCalledWith("omie-sync", {
        body: expect.objectContaining({
          action: "create_order",
          payload: expect.objectContaining({
            operationType: "invoice",
            customerOmieId: 123,
            productOmieId: 456,
            idempotencyKey: "kyberrock:unit-1:operation-1:create_sales_order"
          })
        })
      });
      expect(result).toEqual({ processed: 1, failed: 0, errors: [] });
      expect(database.prepare("SELECT omie_sales_order_id FROM weighing_operations WHERE id = 'operation-1'").pluck().get()).toBe(987);
      expect(database.prepare("SELECT status FROM sync_queue WHERE id = 'omie-job-1'").pluck().get()).toBe("done");
    } finally {
      database.close();
    }
  });

  it("resumes the OMIE pull from the checkpoint on the next call", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      invokeMock.mockResolvedValueOnce({
        error: null,
        data: {
          customers: Array.from({ length: 200 }, (_, i) => ({
            id: 1000 + i,
            name: `Cliente ${i}`,
            tradeName: null,
            document: null,
            phone: null,
            email: null
          })),
          products: [],
          paymentTerms: [],
          pageSize: 200,
          pagination: {
            customersPage: 1,
            productsPage: 1,
            paymentTermsPage: 1,
            customersReturned: 200,
            productsReturned: 0,
            paymentTermsReturned: 0,
            customersFinished: false,
            productsFinished: true,
            paymentTermsFinished: true
          }
        }
      });

      await syncOmieReferenceDataFromCloud(database, identity);
      const stateRow = database
        .prepare("SELECT value_json FROM local_settings WHERE key = 'omie_pull_state'")
        .pluck()
        .get() as string;
      const state = JSON.parse(stateRow) as {
        customersPage: number;
        productsPage: number;
        paymentTermsPage: number;
        inProgress: boolean;
      };
      expect(state.customersPage).toBe(2);
      expect(state.inProgress).toBe(true);

      invokeMock.mockResolvedValueOnce({
        error: null,
        data: {
          customers: Array.from({ length: 200 }, (_, i) => ({
            id: 2000 + i,
            name: `Cliente ${i}`,
            tradeName: null,
            document: null,
            phone: null,
            email: null
          })),
          products: [],
          paymentTerms: [],
          pageSize: 200,
          pagination: {
            customersPage: 2,
            productsPage: 1,
            paymentTermsPage: 1,
            customersReturned: 200,
            productsReturned: 0,
            paymentTermsReturned: 0,
            customersFinished: false,
            productsFinished: true,
            paymentTermsFinished: true
          }
        }
      });
      await syncOmieReferenceDataFromCloud(database, identity);

      const resumeCall = invokeMock.mock.calls[1]?.[1] as { body: { resume: { customersPage: number } } };
      expect(resumeCall.body.resume.customersPage).toBe(2);
    } finally {
      database.close();
    }
  });

  it("marks the pull complete when the cloud reports the page as finished", () => {
    const database = createDatabase();

    try {
      createIdentity(database);
      applyOmieReferenceData(database, "company-1", {
        customers: [{ id: 1, name: "X", tradeName: null, document: null, email: null, phone: null }],
        products: [{ id: 1, code: "P", description: "P", unit: "UN" }],
        paymentTerms: [],
        pageSize: 200,
        pagination: {
          customersPage: 5,
          productsPage: 1,
          paymentTermsPage: 1,
          customersReturned: 1,
          productsReturned: 1,
          paymentTermsReturned: 0,
          customersFinished: true,
          productsFinished: true,
          paymentTermsFinished: true
        }
      });

      const state = JSON.parse(
        database
          .prepare("SELECT value_json FROM local_settings WHERE key = 'omie_pull_state'")
          .pluck()
          .get() as string
      ) as { customersPage: number; productsPage: number; paymentTermsPage: number; inProgress: boolean };
      expect(state.customersPage).toBe(1);
      expect(state.productsPage).toBe(1);
      expect(state.inProgress).toBe(false);
    } finally {
      database.close();
    }
  });

  it("avanca cada entidade de forma independente (cliente parcial nao zera produtos)", () => {
    const database = createDatabase();

    try {
      createIdentity(database);
      applyOmieReferenceData(database, "company-1", {
        customers: Array.from({ length: 200 }, (_, i) => ({
          id: 100 + i,
          name: `C${i}`,
          tradeName: null,
          document: null,
          phone: null,
          email: null
        })),
        products: [{ id: 9, code: "P9", description: "P9", unit: "UN" }],
        paymentTerms: [],
        pageSize: 200,
        pagination: {
          customersPage: 1,
          productsPage: 4,
          paymentTermsPage: 2,
          customersReturned: 200,
          productsReturned: 1,
          paymentTermsReturned: 0,
          customersFinished: false,
          productsFinished: true,
          paymentTermsFinished: true
        }
      });

      const state = JSON.parse(
        database
          .prepare("SELECT value_json FROM local_settings WHERE key = 'omie_pull_state'")
          .pluck()
          .get() as string
      ) as { customersPage: number; productsPage: number; paymentTermsPage: number; inProgress: boolean };
      expect(state.customersPage).toBe(2);
      expect(state.productsPage).toBe(1);
      expect(state.paymentTermsPage).toBe(1);
      expect(state.inProgress).toBe(true);
    } finally {
      database.close();
    }
  });

  it("finaliza entidades quando finished=true explicito mesmo com pagina cheia", () => {
    const database = createDatabase();

    try {
      createIdentity(database);
      applyOmieReferenceData(database, "company-1", {
        customers: Array.from({ length: 200 }, (_, i) => ({
          id: 100 + i,
          name: `C${i}`,
          tradeName: null,
          document: null,
          phone: null,
          email: null
        })),
        products: Array.from({ length: 200 }, (_, i) => ({
          id: 100 + i,
          code: `P${i}`,
          description: `P${i}`,
          unit: "UN"
        })),
        paymentTerms: Array.from({ length: 200 }, (_, i) => ({
          id: 100 + i,
          description: `T${i}`
        })),
        pageSize: 200,
        pagination: {
          customersPage: 1,
          productsPage: 1,
          paymentTermsPage: 1,
          customersReturned: 200,
          productsReturned: 200,
          paymentTermsReturned: 200,
          customersFinished: true,
          productsFinished: true,
          paymentTermsFinished: true
        }
      });

      const state = JSON.parse(
        database
          .prepare("SELECT value_json FROM local_settings WHERE key = 'omie_pull_state'")
          .pluck()
          .get() as string
      ) as { customersPage: number; productsPage: number; paymentTermsPage: number; inProgress: boolean };
      expect(state.customersPage).toBe(1);
      expect(state.productsPage).toBe(1);
      expect(state.paymentTermsPage).toBe(1);
      expect(state.inProgress).toBe(false);
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

function insertLocalCustomer(database: DesktopDatabase, id: string): void {
  const now = "2026-06-12T12:00:00.000Z";
  database
    .prepare(
      `INSERT INTO customers (
        id, company_id, source, legal_name, trade_name, document, phone, email,
        sync_status, created_at, updated_at, needs_push
      ) VALUES (?, 'company-1', 'local', 'Cliente Local LTDA', 'Cliente Local', '12345678000195', '(11) 99999-9999', 'cliente@example.com', 'pending', ?, ?, 1)`
    )
    .run(id, now, now);
}

function insertWeighingOperation(database: DesktopDatabase): void {
  const now = "2026-06-12T12:00:00.000Z";
  database
    .prepare(
      `INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type,
        entry_weight_kg, exit_weight_kg, net_weight_kg, unit_price_cents,
        product_total_cents, total_cents, created_at, updated_at
      ) VALUES (
        'operation-1', 'company-1', 'unit-1', 'device-1', 'pending_omie', 'invoice',
        20, 10, 10, 2500, 25000, 25000, ?, ?
      )`
    )
    .run(now, now);
}

function createFunctionHttpError(message: string): Error & { context: unknown } {
  const error = new Error("Edge Function returned a non-2xx status code") as Error & {
    context: unknown;
  };
  error.name = "FunctionsHttpError";
  error.context = {
    statusText: "Bad Request",
    clone: () => ({
      json: async () => ({ error: message })
    })
  };
  return error;
}
