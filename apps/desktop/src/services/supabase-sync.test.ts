import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  isSupabaseConfigured,
  resetSupabaseConfigCache,
  setSupabaseConfigCache,
  supabaseConfig
} from "../config/supabase-config";
import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import { enqueueSyncJob } from "./sync-queue";
import { createSimulatedWeighingOperation } from "./weighing-operations";
import {
  applyOmieReferenceData,
  initializeSupabase,
  initializeSupabaseFromSettings,
  isSupabaseInitialized,
  processCloudSyncQueue,
  processFiscalBillingNow,
  processOmieSyncQueue,
  pushOmieCustomersToCloud,
  readStoredSupabaseConfig,
  syncOmieReferenceDataFromCloud,
  writeStoredSupabaseConfig
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

  it("falls back to the bundled project URL when SUPABASE_URL is empty", () => {
    const previous = process.env.SUPABASE_URL;
    delete process.env.SUPABASE_URL;
    setSupabaseConfigCache(null, null);
    try {
      expect(supabaseConfig.url).toMatch(/^https:\/\/vksihzfrgqoemcqpquit\.supabase\.co$/);
    } finally {
      if (previous) process.env.SUPABASE_URL = previous;
      setSupabaseConfigCache(null, null);
    }
  });

  it("persists the supabase url and publishable key in local_settings", () => {
    const database = createDatabase();
    try {
      writeStoredSupabaseConfig(database, {
        url: "https://pedreira.supabase.co",
        publishableKey: "sb_publishable_pedreira_key"
      });
      const stored = readStoredSupabaseConfig(database);
      expect(stored).toEqual({
        url: "https://pedreira.supabase.co",
        publishableKey: "sb_publishable_pedreira_key"
      });
    } finally {
      database.close();
    }
  });

  it("uses the stored publishable key when initializing from settings", () => {
    const database = createDatabase();
    const previousUrl = process.env.SUPABASE_URL;
    const previousKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_URL = "https://example.supabase.co";
    setSupabaseConfigCache(null, null);
    resetSupabaseConfigCache();
    try {
      writeStoredSupabaseConfig(database, {
        url: "https://example.supabase.co",
        publishableKey: "sb_publishable_pedreira"
      });
      initializeSupabaseFromSettings(database);
      expect(isSupabaseInitialized()).toBe(true);
      expect(supabaseConfig.publishableKey).toBe("sb_publishable_pedreira");
    } finally {
      if (previousUrl) process.env.SUPABASE_URL = previousUrl;
      else delete process.env.SUPABASE_URL;
      if (previousKey) process.env.SUPABASE_PUBLISHABLE_KEY = previousKey;
      resetSupabaseConfigCache();
      database.close();
    }
  });

  it("reports not configured when neither env nor local_settings have a publishable key", () => {
    const database = createDatabase();
    const previousKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    resetSupabaseConfigCache();
    try {
      writeStoredSupabaseConfig(database, { publishableKey: null });
      initializeSupabaseFromSettings(database);
      expect(isSupabaseInitialized()).toBe(false);
      expect(isSupabaseConfigured()).toBe(false);
    } finally {
      if (previousKey) process.env.SUPABASE_PUBLISHABLE_KEY = previousKey;
      resetSupabaseConfigCache();
      database.close();
    }
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
      const body = invokeMock.mock.calls[0]?.[1]?.body as {
        loadingRequests?: Array<Record<string, unknown>>;
      };
      expect(body.loadingRequests?.[0]).not.toHaveProperty("customer_id");
      expect(body.loadingRequests?.[0]).not.toHaveProperty("product_id");
    } finally {
      database.close();
    }
  });

  it("processes queued cloud jobs for operations and receipts", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      insertPrintReceipt(database);
      enqueueSyncJob(database, {
        id: "cloud-operation-job",
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: "operation-1",
        idempotencyKey: "cloud:operation:operation-1",
        payload: { operationId: "operation-1" }
      });
      enqueueSyncJob(database, {
        id: "cloud-receipt-job",
        target: "cloud",
        action: "upsert_print_receipt",
        entityType: "print_receipt",
        entityId: "receipt-1",
        idempotencyKey: "cloud:print_receipt:receipt-1",
        payload: { receiptId: "receipt-1" }
      });

      const result = await processCloudSyncQueue(database, identity);

      expect(result).toEqual({ processed: 2, failed: 0, errors: [] });
      expect(invokeMock).toHaveBeenCalledWith("desktop-sync", {
        body: expect.objectContaining({
          operations: [expect.objectContaining({ id: "operation-1" })]
        })
      });
      expect(invokeMock).toHaveBeenCalledWith("desktop-sync", {
        body: expect.objectContaining({
          printReceipts: [expect.objectContaining({ id: "receipt-1" })]
        })
      });
      expect(
        database.prepare("SELECT COUNT(*) FROM sync_queue WHERE status = 'done'").pluck().get()
      ).toBe(2);
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
            unit: "M3",
            itemType: "04 - Produtos Acabados"
          }
        ],
        paymentTerms: [
          {
            id: 789,
            description: "30 dias"
          }
        ],
        suppliers: [
          {
            id: 321,
            name: "Transportadora OMIE",
            document: "11222333000144",
            isActive: true
          }
        ]
      });

      expect(result).toMatchObject({
        customersPulled: 1,
        customersPushed: 0,
        productsSynced: 1,
        paymentTermsSynced: 1,
        suppliersSynced: 1,
        errors: []
      });
      expect(
        database.prepare("SELECT legal_name FROM customers WHERE id = 'omie_123'").pluck().get()
      ).toBe("Pedreira Cliente LTDA");
      expect(
        database.prepare("SELECT description FROM products WHERE id = 'omie_456'").pluck().get()
      ).toBe("Brita 1");
      expect(
        database.prepare("SELECT name FROM payment_terms WHERE id = 'omie_789'").pluck().get()
      ).toBe("30 dias");
      expect(
        database.prepare("SELECT name FROM carriers WHERE id = 'omie_supplier_321'").pluck().get()
      ).toBe("Transportadora OMIE");
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
          customers: [
            {
              id: 123,
              name: "Cliente OMIE",
              tradeName: null,
              document: null,
              phone: null,
              email: null
            }
          ],
          products: [{ id: 456, code: "BRITA", description: "Brita", unit: "M3", itemType: "04" }],
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
            paymentTermsPage: 1,
            suppliersPage: 1
          }
        }
      });
      expect(result).toMatchObject({
        customersPulled: 1,
        productsSynced: 1,
        paymentTermsSynced: 1,
        suppliersSynced: 0
      });
      expect(
        database
          .prepare("SELECT COUNT(*) FROM customers WHERE omie_customer_id = 123")
          .pluck()
          .get()
      ).toBe(1);
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

  it("retries on OMIE redundant error from the cloud bridge before throwing", async () => {
    vi.useFakeTimers();
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);

      invokeMock.mockResolvedValueOnce({
        error: createFunctionHttpError(
          "OMIE HTTP 500: Internal Server Error em ListarClientes (/geral/clientes/) - ERROR: Consumo redundante detectado. Aguarde 48 segundos para tentar novamente (REDUNDANT)"
        ),
        data: null
      });
      invokeMock.mockResolvedValueOnce({
        error: null,
        data: {
          customers: [
            {
              id: 123,
              name: "Cliente OMIE",
              tradeName: null,
              document: null,
              phone: null,
              email: null
            }
          ],
          products: [{ id: 456, code: "BRITA", description: "Brita", unit: "M3", itemType: "04" }],
          paymentTerms: [{ id: 789, description: "30 dias" }]
        }
      });

      const promise = syncOmieReferenceDataFromCloud(database, identity);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(invokeMock).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({
        customersPulled: 1,
        productsSynced: 1,
        paymentTermsSynced: 1,
        suppliersSynced: 0
      });
    } finally {
      vi.useRealTimers();
      database.close();
    }
  });

  it("throws after exhausting OMIE redundant retries on the desktop side", async () => {
    vi.useFakeTimers();
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);

      const redundantMessage =
        "OMIE HTTP 500: Internal Server Error em ListarClientes (/geral/clientes/) - ERROR: Consumo redundante detectado. Aguarde 48 segundos para tentar novamente (REDUNDANT)";
      invokeMock.mockResolvedValueOnce({
        error: createFunctionHttpError(redundantMessage),
        data: null
      });
      invokeMock.mockResolvedValueOnce({
        error: createFunctionHttpError(redundantMessage),
        data: null
      });
      invokeMock.mockResolvedValueOnce({
        error: createFunctionHttpError(redundantMessage),
        data: null
      });

      const promise = syncOmieReferenceDataFromCloud(database, identity);
      const rejectionExpect = expect(promise).rejects.toThrow(/Consumo redundante|REDUNDANT/);
      await vi.runAllTimersAsync();
      await rejectionExpect;
    } finally {
      vi.useRealTimers();
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
      expect(
        database
          .prepare("SELECT omie_customer_id FROM customers WHERE id = 'customer-1'")
          .pluck()
          .get()
      ).toBe(321);
      expect(
        database.prepare("SELECT needs_push FROM customers WHERE id = 'customer-1'").pluck().get()
      ).toBe(0);
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
      invokeMock.mockResolvedValueOnce({
        error: { message: "Credencial OMIE invalida" },
        data: null
      });

      const result = await pushOmieCustomersToCloud(database, identity);

      expect(result).toMatchObject({ pushed: 0, failed: 1 });
      expect(result.errors[0]).toContain("Credencial OMIE invalida");
      expect(
        database.prepare("SELECT sync_status FROM customers WHERE id = 'customer-1'").pluck().get()
      ).toBe("error");
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
      expect(
        database
          .prepare("SELECT omie_sales_order_id FROM weighing_operations WHERE id = 'operation-1'")
          .pluck()
          .get()
      ).toBe(987);
      expect(
        database.prepare("SELECT status FROM sync_queue WHERE id = 'omie-job-1'").pluck().get()
      ).toBe("done");
    } finally {
      database.close();
    }
  });

  it("processes immediate fiscal billing and prints returned document URL", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      enqueueSyncJob(database, {
        id: "omie-billing-job-1",
        target: "omie",
        action: "create_and_bill_order",
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
      const printDocument = vi.fn().mockResolvedValue({ printed: true, error: null });
      invokeMock.mockResolvedValueOnce({
        error: null,
        data: {
          orderId: 987,
          billed: true,
          billingStatusCode: "0",
          billingStatusMessage: "Pedido faturado",
          documentUrl: "https://example.test/danfe.pdf"
        }
      });

      const result = await processFiscalBillingNow(
        database,
        identity,
        "operation-1",
        printDocument
      );

      expect(invokeMock).toHaveBeenCalledWith("omie-sync", {
        body: expect.objectContaining({
          action: "create_and_bill_order",
          payload: expect.objectContaining({
            idempotencyKey: "kyberrock:unit-1:operation-1:create_sales_order"
          })
        })
      });
      expect(printDocument).toHaveBeenCalledWith("https://example.test/danfe.pdf");
      expect(result).toMatchObject({ orderId: 987, billed: true, documentPrinted: true });
      expect(
        database
          .prepare("SELECT omie_sales_order_id FROM weighing_operations WHERE id = 'operation-1'")
          .pluck()
          .get()
      ).toBe(987);
      expect(
        database
          .prepare("SELECT omie_billing_status FROM weighing_operations WHERE id = 'operation-1'")
          .pluck()
          .get()
      ).toBe("billed");
      expect(
        database
          .prepare("SELECT status FROM sync_queue WHERE id = 'omie-billing-job-1'")
          .pluck()
          .get()
      ).toBe("done");
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

      const resumeCall = invokeMock.mock.calls[1]?.[1] as {
        body: { resume: { customersPage: number } };
      };
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
        customers: [
          { id: 1, name: "X", tradeName: null, document: null, email: null, phone: null }
        ],
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
      ) as {
        customersPage: number;
        productsPage: number;
        paymentTermsPage: number;
        inProgress: boolean;
      };
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
      ) as {
        customersPage: number;
        productsPage: number;
        paymentTermsPage: number;
        inProgress: boolean;
      };
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
      ) as {
        customersPage: number;
        productsPage: number;
        paymentTermsPage: number;
        inProgress: boolean;
      };
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

function insertPrintReceipt(database: DesktopDatabase): void {
  const now = "2026-06-12T12:00:00.000Z";
  database
    .prepare(
      `INSERT INTO print_receipts (
        id, operation_id, unit_id, receipt_number, copy_number, content_snapshot_json,
        printed_at, printer_name, status, created_at, updated_at
      ) VALUES (
        'receipt-1', 'operation-1', 'unit-1', 1, 1, '{"lines":[]}',
        ?, 'TERMICA-80', 'printed', ?, ?
      )`
    )
    .run(now, now, now);
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
