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
import { listOmieCategories } from "./omie-categories";
import { readOmieAdvanceConfig } from "./omie-advance-config";
import { BLOCKED_NEXT_ATTEMPT_AT, enqueueSyncJob } from "./sync-queue";
import {
  createSimulatedWeighingOperation,
  listClosedWeighingOperations
} from "./weighing-operations";
import {
  applyOmieReferenceData,
  initializeSupabase,
  initializeSupabaseFromSettings,
  isSupabaseInitialized,
  processCloudSyncQueue,
  pullDesktopDataFromCloud,
  processFiscalBillingNow,
  processOmieSyncQueue,
  pushOmieCarriersToCloud,
  pushOmieCustomersToCloud,
  readOmiePullState,
  readStoredSupabaseConfig,
  rearmOmieBillingForCustomer,
  reconcileOmieBillingFromOmie,
  syncCustomerAdvancesFromCloud,
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

  it("uses the bundled bootstrap key when neither env nor local_settings have a publishable key", () => {
    const database = createDatabase();
    const previousKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    resetSupabaseConfigCache();
    try {
      writeStoredSupabaseConfig(database, { publishableKey: null });
      initializeSupabaseFromSettings(database);
      expect(isSupabaseInitialized()).toBe(true);
      expect(isSupabaseConfigured()).toBe(true);
      expect(supabaseConfig.publishableKey).toMatch(/^sb_publishable_/);
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

  it("applies loader completions and cancellations pulled from the cloud", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
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

      const { applyLoaderCompletionRows } = await import("./supabase-sync");

      // Relativos ao relogio real: a linha local acabou de ser criada com
      // new Date().toISOString(), e updated_at local nunca anda para tras.
      const completedAt = new Date(Date.now() + 60_000).toISOString();
      const completedUpdatedAt = new Date(Date.now() + 61_000).toISOString();
      const revertedUpdatedAt = new Date(Date.now() + 120_000).toISOString();
      const applied = applyLoaderCompletionRows(database, [
        {
          id: requestId,
          status: "open",
          loader_completed_at: completedAt,
          updated_at: completedUpdatedAt
        }
      ]);
      expect(applied).toBe(1);
      expect(
        database
          .prepare("SELECT loader_completed_at FROM loading_requests WHERE id = ?")
          .pluck()
          .get(requestId)
      ).toBe(completedAt);

      // Reaplicar o mesmo estado nao conta como mudanca (evita re-render inutil).
      expect(
        applyLoaderCompletionRows(database, [
          {
            id: requestId,
            status: "open",
            loader_completed_at: completedAt,
            updated_at: completedUpdatedAt
          }
        ])
      ).toBe(0);

      // Cancelamento no loader-web: loader_completed_at volta a NULL no cloud e
      // o espelho local limpa a conclusao (a luz volta para "aguardando").
      const reverted = applyLoaderCompletionRows(database, [
        {
          id: requestId,
          status: "open",
          loader_completed_at: null,
          updated_at: revertedUpdatedAt
        }
      ]);
      expect(reverted).toBe(1);
      expect(
        database
          .prepare("SELECT loader_completed_at FROM loading_requests WHERE id = ?")
          .pluck()
          .get(requestId)
      ).toBeNull();
      // updated_at local so anda para frente (guard de push/pull das balancas).
      expect(
        database
          .prepare("SELECT updated_at FROM loading_requests WHERE id = ?")
          .pluck()
          .get(requestId)
      ).toBe(revertedUpdatedAt);

      // Linha desconhecida nao explode nem conta.
      expect(
        applyLoaderCompletionRows(database, [
          { id: "nao-existe", status: "open", loader_completed_at: completedAt, updated_at: null }
        ])
      ).toBe(0);
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
        // Condicoes de pagamento sao locais: o pull nao as persiste mais.
        paymentTermsSynced: 0,
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
      ).toBeUndefined();
      expect(
        database.prepare("SELECT name FROM carriers WHERE id = 'omie_supplier_321'").pluck().get()
      ).toBe("Transportadora OMIE");
    } finally {
      database.close();
    }
  });

  it("persists OMIE payment terms with a code, preserving leading zeros and skipping code-less", () => {
    const database = createDatabase();

    try {
      createIdentity(database);
      const result = applyOmieReferenceData(database, "company-1", {
        paymentTerms: [
          { id: 0, code: "000", description: "A vista", installmentCount: 1 },
          { id: 30, code: "030", description: "30 dias", installmentCount: 1 },
          { id: 99, description: "Sem codigo (ignorada)" }
        ]
      });

      expect(result.paymentTermsSynced).toBe(2);
      const rows = database
        .prepare(
          "SELECT code, description FROM omie_payment_terms WHERE company_id = 'company-1' ORDER BY code"
        )
        .all() as Array<{ code: string; description: string }>;
      expect(rows).toEqual([
        { code: "000", description: "A vista" },
        { code: "030", description: "30 dias" }
      ]);

      // Idempotente: reprocessar nao duplica nem altera contagem de linhas.
      applyOmieReferenceData(database, "company-1", {
        paymentTerms: [
          { id: 30, code: "030", description: "30 dias (novo texto)", installmentCount: 1 }
        ]
      });
      expect(
        database
          .prepare("SELECT COUNT(*) FROM omie_payment_terms WHERE company_id = 'company-1'")
          .pluck()
          .get()
      ).toBe(2);
      expect(
        database
          .prepare("SELECT description FROM omie_payment_terms WHERE id = 'omie_parcela_030'")
          .pluck()
          .get()
      ).toBe("30 dias (novo texto)");
    } finally {
      database.close();
    }
  });

  it("re-keys OMIE rows saved under a stale company id so registration screens see them", () => {
    const database = createDatabase();

    try {
      createIdentity(database);
      // Simula instalacao antiga: registros OMIE gravados sob a identidade
      // provisoria antes da ativacao do dispositivo.
      const now = "2026-06-12T12:00:00.000Z";
      database
        .prepare(
          `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
           VALUES ('setup-company', 'Config Inicial', 'Config Inicial', ?, ?)`
        )
        .run(now, now);
      database
        .prepare(
          `INSERT INTO customers (
            id, company_id, omie_customer_id, source, legal_name, trade_name,
            sync_status, needs_push, is_active, created_at, updated_at
          ) VALUES ('omie_123', 'setup-company', 123, 'omie', 'Cliente Antigo', 'Cliente Antigo', 'synced', 0, 1, ?, ?)`
        )
        .run(now, now);
      database
        .prepare(
          `INSERT INTO products (
            id, company_id, omie_product_id, code, description, unit, is_active, created_at, updated_at
          ) VALUES ('omie_456', 'setup-company', 456, 'BRITA1', 'Brita 1', 'M3', 1, ?, ?)`
        )
        .run(now, now);

      const result = applyOmieReferenceData(database, "company-1", {
        customers: [
          {
            id: 123,
            name: "Cliente Atual",
            tradeName: "Cliente Atual",
            document: null,
            phone: null,
            email: null
          }
        ],
        products: [{ id: 456, code: "BRITA1", description: "Brita 1", unit: "M3", itemType: "04" }],
        paymentTerms: [],
        suppliers: []
      });

      expect(result).toMatchObject({ customersPulled: 1, productsSynced: 1 });
      expect(
        database.prepare("SELECT company_id FROM customers WHERE id = 'omie_123'").pluck().get()
      ).toBe("company-1");
      expect(
        database.prepare("SELECT company_id FROM products WHERE id = 'omie_456'").pluck().get()
      ).toBe("company-1");
    } finally {
      database.close();
    }
  });

  it("restores soft-deleted OMIE customers by integration code", () => {
    const database = createDatabase();

    try {
      createIdentity(database);
      database
        .prepare(
          `INSERT INTO customers (
            id, company_id, omie_customer_id, omie_integration_code, source,
            legal_name, trade_name, is_active, deleted_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'omie', ?, ?, 0, datetime('now'), datetime('now'), datetime('now'))`
        )
        .run("omie_123", "company-1", 123, "CLI-001", "Cliente Antigo", "Cliente Antigo");

      applyOmieReferenceData(database, "company-1", {
        customers: [
          {
            id: 456,
            integrationCode: "CLI-001",
            name: "Cliente Restaurado",
            tradeName: "Cliente Restaurado",
            document: "12345678000195",
            phone: null,
            email: null
          }
        ],
        products: [],
        paymentTerms: [],
        suppliers: []
      });

      const restored = database
        .prepare(
          `SELECT id, omie_customer_id, legal_name, deleted_at
           FROM customers
           WHERE company_id = ? AND omie_integration_code = ?`
        )
        .get("company-1", "CLI-001") as {
        id: string;
        omie_customer_id: number;
        legal_name: string;
        deleted_at: string | null;
      };

      expect(restored).toMatchObject({
        id: "omie_123",
        omie_customer_id: 456,
        legal_name: "Cliente Restaurado",
        deleted_at: null
      });
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
            categoriesPage: 1,
            customersFinished: false,
            productsFinished: false,
            paymentTermsFinished: false,
            categoriesFinished: false
          }
        }
      });
      expect(result).toMatchObject({
        customersPulled: 1,
        productsSynced: 1,
        paymentTermsSynced: 0,
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

  // Sem o `details`, um 500 do desktop-sync chegava ao operador como a mesma
  // frase generica qualquer que fosse a causa — e a fila reenviava a operacao
  // para sempre sem ninguem saber qual upsert estava quebrando.
  it("mostra a causa por tabela que o desktop-sync devolve em details", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      enqueueSyncJob(database, {
        id: "cloud-operation-job",
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: "operation-1",
        idempotencyKey: "cloud:operation:operation-1",
        payload: { operationId: "operation-1" }
      });
      invokeMock.mockResolvedValueOnce({
        error: createFunctionHttpError("Falha ao persistir alguns payloads", [
          'weighing_operations: value "11488908941" is out of range for type integer (code=22003)'
        ]),
        data: null
      });

      const result = await processCloudSyncQueue(database, identity);

      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain("Falha ao persistir alguns payloads");
      expect(result.errors[0]).toContain("weighing_operations");
      expect(result.errors[0]).toContain("out of range for type integer");
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
        paymentTermsSynced: 0,
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

  // A transportadora vai pela acao `push_carrier`, nao pela `push_customer`: esta ultima
  // marca o cadastro como "cliente" no OMIE por definicao, e a transportadora voltaria na
  // sincronizacao seguinte para a lista de clientes da balanca.
  it("pushes local carriers to OMIE through the carrier action", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertLocalCarrier(database, "carrier-1");
      invokeMock.mockResolvedValueOnce({ error: null, data: { omieCustomerId: 654 } });

      const result = await pushOmieCarriersToCloud(database, identity);

      expect(invokeMock).toHaveBeenCalledWith("omie-sync", {
        body: expect.objectContaining({
          deviceId: "device-1",
          deviceToken: "device-token-1",
          action: "push_carrier",
          payload: expect.objectContaining({
            localCustomerId: "carrier:carrier-1",
            name: "Transportadora Local LTDA",
            cnpjCpf: "22222222000182"
          })
        })
      });
      expect(result).toEqual({ pushed: 1, failed: 0, errors: [] });
      expect(
        database
          .prepare("SELECT omie_customer_id FROM carriers WHERE id = 'carrier-1'")
          .pluck()
          .get()
      ).toBe(654);
      expect(
        database.prepare("SELECT needs_push FROM carriers WHERE id = 'carrier-1'").pluck().get()
      ).toBe(0);
      expect(
        database.prepare("SELECT sync_status FROM carriers WHERE id = 'carrier-1'").pluck().get()
      ).toBe("synced");
    } finally {
      database.close();
    }
  });

  it("skips the protected OMIE Cliente Consumidor without calling the bridge", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      // Registro do consumidor final padrao do OMIE, editado localmente (hybrid + needs_push).
      insertLocalCustomer(database, "omie_11455899069", {
        source: "hybrid",
        omieCustomerId: 11455899069,
        omieIntegrationCode: "CONSUMIDOR"
      });

      const result = await pushOmieCustomersToCloud(database, identity);

      expect(invokeMock).not.toHaveBeenCalled();
      expect(result).toEqual({ pushed: 0, failed: 0, errors: [] });
      // Sai da fila de push: o erro nao volta a cada sincronizacao.
      expect(
        database
          .prepare("SELECT needs_push FROM customers WHERE id = 'omie_11455899069'")
          .pluck()
          .get()
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("stops retrying a customer when OMIE rejects altering a protected record", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      // Registro protegido sem o codigo de integracao local (fallback pela mensagem do OMIE).
      insertLocalCustomer(database, "omie_11455899069", {
        source: "hybrid",
        omieCustomerId: 11455899069
      });
      invokeMock.mockResolvedValueOnce({
        error: createFunctionHttpError(
          "OMIE HTTP 500 em AlterarCliente (/geral/clientes/) - ERROR: Não é possível alterar esse código de integração (Cliente Consumidor)!"
        ),
        data: null
      });

      const result = await pushOmieCustomersToCloud(database, identity);

      expect(result).toEqual({ pushed: 0, failed: 0, errors: [] });
      expect(
        database
          .prepare("SELECT needs_push FROM customers WHERE id = 'omie_11455899069'")
          .pluck()
          .get()
      ).toBe(0);

      // Segunda passada nao chama mais o OMIE (sem repetir o erro).
      invokeMock.mockClear();
      await pushOmieCustomersToCloud(database, identity);
      expect(invokeMock).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("blocks local customers without CPF/CNPJ before calling OMIE", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertLocalCustomer(database, "customer-1", { document: null });

      const result = await pushOmieCustomersToCloud(database, identity);

      expect(invokeMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({ pushed: 0, failed: 1 });
      expect(result.errors[0]).toContain("CPF/CNPJ");
      expect(
        database
          .prepare("SELECT needs_push, sync_status FROM customers WHERE id = 'customer-1'")
          .get()
      ).toEqual({ needs_push: 0, sync_status: "error" });
    } finally {
      database.close();
    }
  });

  it("blocks local carriers without CPF/CNPJ before calling OMIE", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertLocalCarrier(database, "carrier-1", { document: null });

      const result = await pushOmieCarriersToCloud(database, identity);

      expect(invokeMock).not.toHaveBeenCalled();
      expect(result).toMatchObject({ pushed: 0, failed: 1 });
      expect(result.errors[0]).toContain("CPF/CNPJ");
      expect(
        database
          .prepare("SELECT needs_push, sync_status FROM carriers WHERE id = 'carrier-1'")
          .get()
      ).toEqual({ needs_push: 0, sync_status: "error" });

      // Segunda passada nao repete a chamada nem o erro.
      const again = await pushOmieCarriersToCloud(database, identity);
      expect(again).toEqual({ pushed: 0, failed: 0, errors: [] });
    } finally {
      database.close();
    }
  });

  it("stops retrying a carrier when OMIE demands the cnpj_cpf tag", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      // Documento presente porem invalido para o OMIE: passa o pre-check local e falha la.
      insertLocalCarrier(database, "carrier-1", { document: "22222222000182" });
      invokeMock.mockResolvedValueOnce({
        error: createFunctionHttpError(
          "OMIE HTTP 500 em IncluirCliente (/geral/clientes/) - ERROR: O preenchimento da tag [cnpj_cpf] é obrigatório!"
        ),
        data: null
      });

      const result = await pushOmieCarriersToCloud(database, identity);

      expect(result).toMatchObject({ pushed: 0, failed: 1 });
      expect(result.errors[0]).toContain("CPF/CNPJ");
      expect(
        database.prepare("SELECT needs_push FROM carriers WHERE id = 'carrier-1'").pluck().get()
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("does not store OMIE products when they are not sellable", () => {
    const database = createDatabase();

    try {
      createIdentity(database);
      const result = applyOmieReferenceData(database, "company-1", {
        customers: [],
        products: [
          { id: 456, code: "SERV", description: "Servico OMIE", unit: "UN", itemType: "99" }
        ],
        paymentTerms: [],
        suppliers: []
      });

      expect(result.productsSynced).toBe(0);
      expect(
        database.prepare("SELECT description FROM products WHERE id = 'omie_456'").pluck().get()
      ).toBeUndefined();
    } finally {
      database.close();
    }
  });

  // O pull da nuvem e o unico caminho de sincronizacao da pedreira; sem gravar as
  // categorias aqui, a tela Produtos ficava presa no aviso de "nenhuma categoria
  // sincronizada" e o pedido saia sempre na categoria fixa.
  it("mirrors OMIE categories returned by the cloud bridge", () => {
    const database = createDatabase();

    try {
      createIdentity(database);
      const result = applyOmieReferenceData(database, "company-1", {
        customers: [],
        products: [],
        paymentTerms: [],
        suppliers: [],
        categories: [
          { code: "1.01.01", description: "Venda de brita", categoryType: "R", isActive: true },
          {
            code: "1.01.02",
            description: "Venda de aterro",
            categoryType: "R",
            parentCode: "1.01",
            isActive: true
          },
          { code: "1.01", description: "Totalizadora", categoryType: "R", isActive: false }
        ]
      });

      expect(result.categoriesSynced).toBe(3);
      expect(listOmieCategories(database, "company-1").map((category) => category.code)).toEqual([
        "1.01.01",
        "1.01.02"
      ]);
      expect(
        database
          .prepare("SELECT parent_code FROM omie_categories WHERE company_id = ? AND code = ?")
          .pluck()
          .get("company-1", "1.01.02")
      ).toBe("1.01");
    } finally {
      database.close();
    }
  });

  it("updates mirrored OMIE categories in place instead of duplicating them", () => {
    const database = createDatabase();

    try {
      createIdentity(database);
      applyOmieReferenceData(database, "company-1", {
        categories: [{ code: "1.01.01", description: "Venda de brita", isActive: true }]
      });
      applyOmieReferenceData(database, "company-1", {
        categories: [{ code: "1.01.01", description: "Venda de agregados", isActive: true }]
      });

      const rows = database
        .prepare("SELECT description FROM omie_categories WHERE company_id = ? AND code = ?")
        .all("company-1", "1.01.01") as Array<{ description: string }>;
      expect(rows).toEqual([{ description: "Venda de agregados" }]);
    } finally {
      database.close();
    }
  });

  // Desktop novo + edge antigo: sem paginacao de categorias na resposta, o pull
  // nao pode ficar pedindo eternamente uma pagina que nunca vem.
  it("treats categories as finished when the cloud response has no category pagination", () => {
    const database = createDatabase();

    try {
      createIdentity(database);
      applyOmieReferenceData(database, "company-1", {
        customers: [],
        products: [],
        paymentTerms: [],
        suppliers: [],
        pageSize: 100,
        pagination: {
          customersPage: 1,
          productsPage: 1,
          paymentTermsPage: 1,
          customersReturned: 0,
          productsReturned: 0,
          paymentTermsReturned: 0
        }
      });

      const state = readOmiePullState(database);
      expect(state.categoriesFinished).toBe(true);
      expect(state.categoriesPage).toBe(1);
      expect(state.inProgress).toBe(false);
    } finally {
      database.close();
    }
  });

  it("keeps pulling while the cloud still has category pages", () => {
    const database = createDatabase();

    try {
      createIdentity(database);
      applyOmieReferenceData(database, "company-1", {
        categories: [{ code: "1.01.01", description: "Venda de brita" }],
        pageSize: 1,
        pagination: {
          customersPage: 1,
          productsPage: 1,
          paymentTermsPage: 1,
          categoriesPage: 1,
          customersReturned: 0,
          productsReturned: 0,
          paymentTermsReturned: 0,
          categoriesReturned: 1,
          categoriesFinished: false,
          categoriesTotalPages: 2
        }
      });

      const state = readOmiePullState(database);
      expect(state.categoriesFinished).toBe(false);
      expect(state.categoriesPage).toBe(2);
      expect(state.inProgress).toBe(true);
    } finally {
      database.close();
    }
  });

  it("keeps failed carrier pushes pending and visible for retry", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertLocalCarrier(database, "carrier-1");
      invokeMock.mockResolvedValueOnce({
        error: { message: "Documento invalido" },
        data: null
      });

      const result = await pushOmieCarriersToCloud(database, identity);

      expect(result).toMatchObject({ pushed: 0, failed: 1 });
      expect(result.errors[0]).toContain("Documento invalido");
      expect(
        database.prepare("SELECT needs_push FROM carriers WHERE id = 'carrier-1'").pluck().get()
      ).toBe(1);
      expect(
        database.prepare("SELECT sync_status FROM carriers WHERE id = 'carrier-1'").pluck().get()
      ).toBe("error");
    } finally {
      database.close();
    }
  });

  it("updates OMIE carriers when they already have omie_customer_id", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertLocalCarrier(database, "carrier-1", { omieCustomerId: 777 });
      invokeMock.mockResolvedValueOnce({ error: null, data: { omieCustomerId: 777 } });

      const result = await pushOmieCarriersToCloud(database, identity);

      expect(invokeMock).toHaveBeenCalledWith("omie-sync", {
        body: expect.objectContaining({
          action: "push_carrier",
          payload: expect.objectContaining({
            omieCustomerId: 777,
            name: "Transportadora Local LTDA"
          })
        })
      });
      expect(result).toMatchObject({ pushed: 1, failed: 0 });
      expect(
        database.prepare("SELECT needs_push FROM carriers WHERE id = 'carrier-1'").pluck().get()
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("limits local customer push batches to avoid OMIE request bursts", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      for (let index = 0; index < 12; index++) {
        insertLocalCustomer(database, `customer-${index}`);
      }
      invokeMock.mockResolvedValue({ error: null, data: { omieCustomerId: 321 } });

      const result = await pushOmieCustomersToCloud(database, identity, { delayMs: 0 });

      expect(result).toMatchObject({ pushed: 10, failed: 0 });
      expect(invokeMock).toHaveBeenCalledTimes(10);
      expect(
        database.prepare("SELECT COUNT(*) FROM customers WHERE needs_push = 1").pluck().get()
      ).toBe(2);
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

  it("forwards the order category and the carrier cadastro to the bridge", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      database
        .prepare(
          `INSERT INTO carriers (id, company_id, name, document, source, created_at, updated_at)
           VALUES ('carrier-1', 'company-1', 'Transportadora Nova', '11222333000144', 'local', datetime('now'), datetime('now'))`
        )
        .run();
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
          issueDate: "2026-06-12",
          omieCategoryCode: "1.01.02",
          localCarrierId: "carrier-1",
          carrier: {
            localCarrierId: "carrier-1",
            name: "Transportadora Nova",
            cnpjCpf: "11222333000144"
          }
        }
      });
      invokeMock.mockResolvedValueOnce({
        error: null,
        data: { orderId: 987, omieCarrierId: 555 }
      });

      await processOmieSyncQueue(database, identity);

      // A ponte monta o corpo campo a campo: um campo novo que nao entre aqui e
      // silenciosamente descartado e o edge cai no comportamento antigo.
      expect(invokeMock).toHaveBeenCalledWith("omie-sync", {
        body: expect.objectContaining({
          payload: expect.objectContaining({
            omieCategoryCode: "1.01.02",
            carrier: expect.objectContaining({ cnpjCpf: "11222333000144" })
          })
        })
      });
      // Transportadora criada no OMIE durante o envio: o codigo devolvido fica gravado
      // para os proximos pedidos ja irem vinculados.
      expect(
        database
          .prepare("SELECT omie_customer_id FROM carriers WHERE id = 'carrier-1'")
          .pluck()
          .get()
      ).toBe(555);
    } finally {
      database.close();
    }
  });

  // A ponte copia o payload campo a campo, e os dois campos abaixo ja nasceram (ou quase
  // nasceram) esquecidos: `invoiceEmails` era montado no fechamento e nunca chegava aqui,
  // e o do faturamento futuro corria o mesmo risco. Sem este teste, apagar uma das linhas
  // do `invoke` nao quebra nada — o pedido so sai mudo no OMIE.
  it("leva os e-mails da NF e a nota de entrega futura para o edge", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      enqueueSyncJob(database, {
        id: "omie-job-emails",
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
          issueDate: "2026-06-12",
          invoiceEmails: "fiscal@cliente.com, financeiro@cliente.com",
          futureBillingNfeNumber: "12345"
        }
      });
      invokeMock.mockResolvedValueOnce({ error: null, data: { orderId: 987 } });

      await processOmieSyncQueue(database, identity);

      expect(invokeMock).toHaveBeenCalledWith("omie-sync", {
        body: expect.objectContaining({
          payload: expect.objectContaining({
            invoiceEmails: "fiscal@cliente.com, financeiro@cliente.com",
            futureBillingNfeNumber: "12345"
          })
        })
      });
    } finally {
      database.close();
    }
  });

  it("omite os dois campos quando o cadastro nao tem nenhum dos dois", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      enqueueSyncJob(database, {
        id: "omie-job-sem-emails",
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
          issueDate: "2026-06-12",
          invoiceEmails: "",
          futureBillingNfeNumber: ""
        }
      });
      invokeMock.mockResolvedValueOnce({ error: null, data: { orderId: 987 } });

      await processOmieSyncQueue(database, identity);

      // String vazia vira `undefined`: o campo nao e enviado e o OMIE segue com o cadastro
      // do cliente, como sempre fez.
      const sent = invokeMock.mock.calls[0][1].body.payload as Record<string, unknown>;
      expect(sent.invoiceEmails).toBeUndefined();
      expect(sent.futureBillingNfeNumber).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("records the OMIE service order of an internal operation", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      database
        .prepare("UPDATE weighing_operations SET operation_type = 'internal' WHERE id = ?")
        .run("operation-1");
      enqueueSyncJob(database, {
        id: "omie-job-os",
        target: "omie",
        action: "create_order",
        entityType: "weighing_operation",
        entityId: "operation-1",
        idempotencyKey: "kyberrock:unit-1:operation-1:create_service_order",
        payload: {
          operationId: "operation-1",
          operationType: "internal",
          customerOmieId: 123,
          serviceDescription: "Brita 1",
          quantity: 10,
          unitPrice: 25,
          issueDate: "2026-06-12"
        }
      });
      invokeMock.mockResolvedValueOnce({ error: null, data: { orderId: 777 } });

      const result = await processOmieSyncQueue(database, identity);

      // O id da operacao acompanha o payload para a OS referenciar a pesagem no OMIE.
      expect(invokeMock).toHaveBeenCalledWith("omie-sync", {
        body: expect.objectContaining({
          payload: expect.objectContaining({
            operationType: "internal",
            localOperationId: "operation-1"
          })
        })
      });
      expect(result).toEqual({ processed: 1, failed: 0, errors: [] });
      expect(
        database
          .prepare(
            "SELECT omie_service_order_id, omie_billing_status FROM weighing_operations WHERE id = 'operation-1'"
          )
          .get()
      ).toMatchObject({
        omie_service_order_id: 777,
        omie_billing_status: "service_order_created"
      });
    } finally {
      database.close();
    }
  });

  it("records the failure on the internal operation when OMIE refuses the service order", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      database
        .prepare("UPDATE weighing_operations SET operation_type = 'internal' WHERE id = ?")
        .run("operation-1");
      enqueueSyncJob(database, {
        id: "omie-job-os-fail",
        target: "omie",
        action: "create_order",
        entityType: "weighing_operation",
        entityId: "operation-1",
        idempotencyKey: "kyberrock:unit-1:operation-1:create_service_order",
        payload: {
          operationId: "operation-1",
          operationType: "internal",
          customerOmieId: 123,
          serviceDescription: "Brita 1",
          quantity: 10,
          unitPrice: 25,
          issueDate: "2026-06-12"
        }
      });
      invokeMock.mockResolvedValueOnce({
        error: createFunctionHttpError("ERROR: - tag: [cCodServMun]"),
        data: null
      });

      const result = await processOmieSyncQueue(database, identity);

      expect(result.failed).toBe(1);
      // A operacao interna nao tem tela de faturamento: sem isto a OS recusada sumia.
      expect(
        database
          .prepare(
            "SELECT omie_billing_status, omie_billing_message FROM weighing_operations WHERE id = 'operation-1'"
          )
          .get()
      ).toMatchObject({ omie_billing_status: "service_order_failed" });
    } finally {
      database.close();
    }
  });

  /**
   * A venda com nota ficava MUDA numa recusa que a classificacao nao reconhece: o motivo
   * ia so para o job do sync_queue, e a tela de Concluidas le a operacao — entao o
   * fechamento seguia exibindo "sera enviado na proxima sincronizacao" ate morrer em
   * dead_letter sem ninguem ficar sabendo.
   */
  it("records on the invoice operation why OMIE refused it, without crying wolf on a retry", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertClosedOperationForNewCustomer(database);
      enqueueBillingJobForNewCustomer(database);
      invokeMock.mockResolvedValueOnce({
        error: createFunctionHttpError("ERROR: Consumo redundante detectado"),
        data: null
      });

      const result = await processOmieSyncQueue(database, identity);

      expect(result.failed).toBe(1);
      const operation = database
        .prepare(
          "SELECT omie_billing_status, omie_billing_message FROM weighing_operations WHERE id = 'operation-1'"
        )
        .get() as { omie_billing_status: string | null; omie_billing_message: string | null };
      expect(operation.omie_billing_message).toContain("Consumo redundante");
      // Ainda ha tentativa automatica sobrando: nada de vermelho (nem aviso sonoro).
      expect(operation.omie_billing_status).toBeNull();
      expect(
        database
          .prepare("SELECT status FROM sync_queue WHERE id = ?")
          .pluck()
          .get("omie-job-novo-cliente")
      ).toBe("failed");
    } finally {
      database.close();
    }
  });

  it("marks the invoice operation as failed once the automatic retries are exhausted", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertClosedOperationForNewCustomer(database);
      enqueueBillingJobForNewCustomer(database);
      // Ultima tentativa antes do dead_letter (markSyncJobFailed usa 10 por padrao).
      database
        .prepare("UPDATE sync_queue SET attempt_count = 9 WHERE id = 'omie-job-novo-cliente'")
        .run();
      invokeMock.mockResolvedValueOnce({
        error: createFunctionHttpError("ERROR: Consumo redundante detectado"),
        data: null
      });

      await processOmieSyncQueue(database, identity);

      // O envio parou de andar sozinho: e o unico caso que exige o operador.
      expect(
        database
          .prepare("SELECT status FROM sync_queue WHERE id = ?")
          .pluck()
          .get("omie-job-novo-cliente")
      ).toBe("dead_letter");
      expect(
        database
          .prepare("SELECT omie_billing_status FROM weighing_operations WHERE id = 'operation-1'")
          .pluck()
          .get()
      ).toBe("failed");
    } finally {
      database.close();
    }
  });

  it("clears the failure marker when a later attempt creates the order", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertClosedOperationForNewCustomer(database);
      enqueueBillingJobForNewCustomer(database);
      database
        .prepare(
          `UPDATE weighing_operations
             SET omie_billing_status = 'failed', omie_billing_message = 'ERROR: Consumo redundante detectado'
           WHERE id = 'operation-1'`
        )
        .run();
      invokeMock.mockResolvedValueOnce({ data: { orderId: 4242 }, error: null });

      await processOmieSyncQueue(database, identity);

      // Sem isto o pedido aparecia criado e o marcador vermelho da recusa anterior ficava
      // gravado na operacao para sempre.
      expect(
        database
          .prepare(
            "SELECT omie_sales_order_id, omie_billing_status, omie_billing_message FROM weighing_operations WHERE id = 'operation-1'"
          )
          .get()
      ).toMatchObject({
        omie_sales_order_id: 4242,
        omie_billing_status: null,
        omie_billing_message: null
      });
    } finally {
      database.close();
    }
  });

  it("refreshes the queued closing with the customer cadastro completed after the close", () => {
    const database = createDatabase();

    try {
      createIdentity(database);
      insertClosedOperationForNewCustomer(database);
      enqueueBillingJobForNewCustomer(database);
      // O app completa o cadastro do cliente depois do fechamento (e-mail padrao de
      // NF-e / busca por CNPJ); o job ja tinha sido montado sem esses dados.
      database
        .prepare("UPDATE customers SET email = 'nfe@pedreira.com.br' WHERE id = 'customer-novo'")
        .run();

      expect(rearmOmieBillingForCustomer(database, "customer-novo")).toBe(1);

      const payload = JSON.parse(
        database
          .prepare("SELECT payload_json FROM sync_queue WHERE id = 'omie-job-novo-cliente'")
          .pluck()
          .get() as string
      );
      // Sem isto o cliente subia ao OMIE sem e-mail e o IncluirCliente era recusado,
      // derrubando o pedido do fechamento junto.
      expect(payload.customer).toMatchObject({ email: "nfe@pedreira.com.br" });
    } finally {
      database.close();
    }
  });

  it("blocks the closing and points to the customer field OMIE refused", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertClosedOperationForNewCustomer(database);
      enqueueBillingJobForNewCustomer(database);
      invokeMock.mockResolvedValueOnce({
        error: createFunctionHttpError(
          "Cadastro do cliente recusado pelo OMIE (Cliente Local LTDA). Falta preencher: E-mail. " +
            "Complete o cadastro do cliente e reenvie. Detalhe OMIE: ERROR: O preenchimento da tag [email] e obrigatorio!"
        ),
        data: null
      });

      const result = await processOmieSyncQueue(database, identity);

      expect(result.failed).toBe(1);
      // Recusa de cadastro e deterministica: o job para de re-tentar (sem retry storm)
      // e continua re-executavel (attempt_count intacto).
      expect(
        database
          .prepare("SELECT next_attempt_at, attempt_count FROM sync_queue WHERE id = ?")
          .get("omie-job-novo-cliente")
      ).toMatchObject({ next_attempt_at: BLOCKED_NEXT_ATTEMPT_AT, attempt_count: 0 });
      const operation = database
        .prepare(
          "SELECT omie_billing_status, omie_billing_message FROM weighing_operations WHERE id = 'operation-1'"
        )
        .get() as { omie_billing_status: string; omie_billing_message: string };
      expect(operation.omie_billing_status).toBe("cadastro_incompleto");
      expect(operation.omie_billing_message).toContain("Falta preencher: E-mail");
      // Cadastro re-armado: a proxima sincronizacao tenta criar o cliente no OMIE.
      expect(
        database
          .prepare("SELECT needs_push FROM customers WHERE id = 'customer-novo'")
          .pluck()
          .get()
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it("clears the stale OMIE customer code the bridge could not fix and re-arms the cadastro", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertClosedOperationForNewCustomer(database);
      // Cliente ja "vinculado" a um codigo que nao existe mais na conta do OMIE.
      database
        .prepare("UPDATE customers SET omie_customer_id = 11455924790 WHERE id = 'customer-novo'")
        .run();
      enqueueBillingJobForNewCustomer(database, { customerOmieId: 11455924790 });
      invokeMock.mockResolvedValueOnce({
        error: createFunctionHttpError(
          "OMIE HTTP 500 em IncluirPedido (/produtos/pedido/) - ERROR: Cliente não cadastrado " +
            "para o Código [11455924790] ! - tag: [codigo_cliente]"
        ),
        data: null
      });

      const result = await processOmieSyncQueue(database, identity);

      expect(result.failed).toBe(1);
      // Re-tentar mandaria o MESMO codigo invalido: o job para (sem retry storm ate morrer).
      expect(
        database
          .prepare("SELECT next_attempt_at FROM sync_queue WHERE id = ?")
          .pluck()
          .get("omie-job-novo-cliente")
      ).toBe(BLOCKED_NEXT_ATTEMPT_AT);
      // Vinculo podre limpo e cliente de volta na fila de cadastro: o proximo ciclo cria
      // ele no OMIE com um codigo valido e rearma o fechamento sozinho.
      expect(
        database
          .prepare("SELECT omie_customer_id, needs_push FROM customers WHERE id = 'customer-novo'")
          .get()
      ).toMatchObject({ omie_customer_id: null, needs_push: 1 });
      expect(
        database
          .prepare("SELECT omie_billing_status FROM weighing_operations WHERE id = 'operation-1'")
          .pluck()
          .get()
      ).toBe("cadastro_incompleto");
    } finally {
      database.close();
    }
  });

  it("stores the customer code the bridge corrected while sending the closing", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertClosedOperationForNewCustomer(database);
      database
        .prepare("UPDATE customers SET omie_customer_id = 11455924790 WHERE id = 'customer-novo'")
        .run();
      enqueueBillingJobForNewCustomer(database, { customerOmieId: 11455924790 });
      // O edge recusou o codigo obsoleto, relocalizou o cliente e mandou o pedido com 8888.
      invokeMock.mockResolvedValueOnce({
        error: null,
        data: { orderId: 4242, omieCustomerId: 8888 }
      });

      const result = await processOmieSyncQueue(database, identity);

      expect(result).toMatchObject({ processed: 1, failed: 0 });
      // Sem regravar, o proximo fechamento do mesmo cliente repetiria a recusa.
      expect(
        database
          .prepare("SELECT omie_customer_id FROM customers WHERE id = 'customer-novo'")
          .pluck()
          .get()
      ).toBe(8888);
    } finally {
      database.close();
    }
  });

  it("resends the closing by itself once the customer lands in OMIE", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertClosedOperationForNewCustomer(database);
      enqueueBillingJobForNewCustomer(database);
      // Fechamento parado por causa do cliente (estado deixado pela recusa anterior).
      database
        .prepare(
          `UPDATE sync_queue SET status = 'failed', next_attempt_at = ?, last_error = 'Cadastro do cliente recusado pelo OMIE' WHERE id = ?`
        )
        .run(BLOCKED_NEXT_ATTEMPT_AT, "omie-job-novo-cliente");
      database
        .prepare(
          "UPDATE weighing_operations SET omie_billing_status = 'cadastro_incompleto' WHERE id = 'operation-1'"
        )
        .run();
      invokeMock.mockResolvedValueOnce({ error: null, data: { omieCustomerId: 4242 } });

      const result = await pushOmieCustomersToCloud(database, identity);

      expect(result).toMatchObject({ pushed: 1, failed: 0 });
      expect(
        database
          .prepare("SELECT omie_customer_id FROM customers WHERE id = 'customer-novo'")
          .pluck()
          .get()
      ).toBe(4242);
      // Job de volta na fila, com o codigo OMIE do cliente ja no payload: o fechamento
      // sai na mesma passada (a fila roda logo depois do push de cadastros).
      const job = database
        .prepare("SELECT status, payload_json FROM sync_queue WHERE id = 'omie-job-novo-cliente'")
        .get() as { status: string; payload_json: string };
      expect(job.status).toBe("pending");
      expect(JSON.parse(job.payload_json)).toMatchObject({ customerOmieId: 4242 });
      // Operacao sai da pendencia de cadastro.
      expect(
        database
          .prepare("SELECT omie_billing_status FROM weighing_operations WHERE id = 'operation-1'")
          .pluck()
          .get()
      ).toBeNull();
    } finally {
      database.close();
    }
  });

  it("limits OMIE queue batches to avoid long request bursts", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      for (let index = 0; index < 12; index++) {
        enqueueSyncJob(database, {
          id: `omie-job-${index}`,
          target: "omie",
          action: "create_order",
          entityType: "weighing_operation",
          entityId: `operation-${index}`,
          idempotencyKey: `kyberrock:unit-1:operation-${index}:create_sales_order`,
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
      }
      invokeMock.mockResolvedValue({ error: null, data: { orderId: 987 } });

      const result = await processOmieSyncQueue(database, identity, { delayMs: 0 });

      expect(result).toMatchObject({ processed: 10, failed: 0 });
      expect(invokeMock).toHaveBeenCalledTimes(10);
      expect(
        database.prepare("SELECT COUNT(*) FROM sync_queue WHERE status = 'pending'").pluck().get()
      ).toBe(2);
    } finally {
      database.close();
    }
  });

  it("processes only the closed operation's OMIE jobs when entityId is given", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      enqueueSyncJob(database, {
        id: "omie-job-other",
        target: "omie",
        action: "create_order",
        entityType: "weighing_operation",
        entityId: "operation-other",
        idempotencyKey: "kyberrock:unit-1:operation-other:create_sales_order",
        payload: {
          operationId: "operation-other",
          operationType: "invoice",
          customerOmieId: 123,
          productOmieId: 456,
          quantity: 5,
          unitPrice: 20,
          issueDate: "2026-06-12"
        }
      });
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

      const result = await processOmieSyncQueue(database, identity, {
        entityId: "operation-1",
        delayMs: 0
      });

      // Envia apenas o pedido da operacao fechada, sem varrer o resto da fila.
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ processed: 1, failed: 0, errors: [] });
      expect(
        database.prepare("SELECT status FROM sync_queue WHERE id = 'omie-job-1'").pluck().get()
      ).toBe("done");
      expect(
        database.prepare("SELECT status FROM sync_queue WHERE id = 'omie-job-other'").pluck().get()
      ).toBe("pending");
      expect(
        database
          .prepare("SELECT status FROM weighing_operations WHERE id = 'operation-1'")
          .pluck()
          .get()
      ).toBe("synced");
    } finally {
      database.close();
    }
  });

  /**
   * Relato da pedreira: depois de rodar o "Fazer fechamento" da quinzena, as pesagens
   * SUMIRAM da aba Concluidas. Operacao concluida nao pode sair dessa lista por causa do
   * faturamento — ela e o historico da balanca, e some so quando o operador exclui.
   */
  it("mantem a operacao na lista de Concluidas depois de faturar", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      enqueueSyncJob(database, {
        id: "omie-billing-job-keep",
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
      expect(listClosedWeighingOperations(database).map((row) => row.id)).toContain("operation-1");

      invokeMock.mockResolvedValueOnce({
        error: null,
        data: { orderId: 987, billed: true, billingStatusCode: "0", invoiceNumber: "28727" }
      });
      await processFiscalBillingNow(database, identity, "operation-1");

      const closed = listClosedWeighingOperations(database);
      expect(closed.map((row) => row.id)).toContain("operation-1");
      expect(
        database
          .prepare("SELECT status FROM weighing_operations WHERE id = 'operation-1'")
          .pluck()
          .get()
      ).toBe("pending_omie");
    } finally {
      database.close();
    }
  });

  /**
   * O mesmo, pelo caminho da recusa que a pedreira viu: "ja foi autorizado". Ele reconcilia
   * a situacao para faturada — e reconciliar nao pode custar a operacao na lista.
   */
  it("mantem a operacao nas Concluidas quando o OMIE diz que ja estava faturado", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      enqueueSyncJob(database, {
        id: "omie-billing-job-already",
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

      invokeMock.mockResolvedValueOnce({
        error: {
          message:
            "Nao foi possivel realizar o faturamento desse Pedido de Venda de Produto! " +
            "Nao e possivel faturar, pois o Pedido de Venda de Produto ja foi autorizado."
        },
        data: null
      });
      const result = await processFiscalBillingNow(database, identity, "operation-1");

      expect(result).toMatchObject({ billed: true, alreadyBilledInOmie: true });
      expect(listClosedWeighingOperations(database).map((row) => row.id)).toContain("operation-1");
    } finally {
      database.close();
    }
  });

  /**
   * A carga do vale 321 da pedreira apareceu no fechamento como "operacao fiscal sem
   * cliente vinculado" e sumiu de qualquer busca pelo nome do cliente na aba Concluidas:
   * o pull tinha APAGADO o `customer_id` dela, porque a projecao veio sem cliente e o
   * upsert gravava o vazio por cima.
   *
   * Nao existe pesagem sem cliente: um vazio vindo da nuvem nunca e "o operador tirou", e
   * sim a projecao que ainda nao sabe. Apagar ali custa a cobranca da carga.
   */
  it("nao apaga o cliente da operacao quando a projecao vem sem cliente", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);

      invokeMock.mockResolvedValueOnce({
        error: null,
        data: {
          operations: [
            {
              id: "operation-1",
              status: "synced",
              operation_type: "invoice",
              customer_id: null,
              product_id: null,
              updated_at: "2026-06-13T12:00:00.000Z"
            }
          ]
        }
      });
      await pullDesktopDataFromCloud(database, identity);

      expect(
        database
          .prepare("SELECT customer_id FROM weighing_operations WHERE id = 'operation-1'")
          .pluck()
          .get()
      ).toBe("sync-customer-1");
    } finally {
      database.close();
    }
  });

  it("aceita o cliente que a projecao manda quando ela tem um", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      insertLocalCustomer(database, "outro-cliente");

      invokeMock.mockResolvedValueOnce({
        error: null,
        data: {
          operations: [
            {
              id: "operation-1",
              status: "synced",
              operation_type: "invoice",
              customer_id: "outro-cliente",
              updated_at: "2026-06-13T12:00:00.000Z"
            }
          ]
        }
      });
      await pullDesktopDataFromCloud(database, identity);

      // Preservar o vazio nao pode virar "ignora o cliente da nuvem": a outra balanca
      // trocando o cliente da carga continua valendo aqui.
      expect(
        database
          .prepare("SELECT customer_id FROM weighing_operations WHERE id = 'operation-1'")
          .pluck()
          .get()
      ).toBe("outro-cliente");
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

  it("promotes an unbilled create_order job to billing on refature (same idempotency key)", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      // Fechamento com cadastro incompleto subiu o pedido sem faturar (job done).
      enqueueSyncJob(database, {
        id: "omie-create-only-1",
        target: "omie",
        action: "create_order",
        entityType: "weighing_operation",
        entityId: "operation-1",
        idempotencyKey: "kyberrock:unit-1:operation-1:create_sales_order",
        payload: {
          operationId: "operation-1",
          operationType: "invoice",
          customerOmieId: 777,
          quantity: 10,
          unitPrice: 25,
          issueDate: "2026-06-12"
        }
      });
      database
        .prepare("UPDATE sync_queue SET status = 'done' WHERE id = 'omie-create-only-1'")
        .run();
      invokeMock.mockResolvedValueOnce({
        error: null,
        data: { orderId: 777, billed: true, billingStatusCode: "0", billingStatusMessage: "ok" }
      });

      const result = await processFiscalBillingNow(database, identity, "operation-1");

      // O MESMO job (mesma chave) foi promovido para faturamento e processado.
      expect(result).toMatchObject({ orderId: 777, billed: true });
      expect(invokeMock).toHaveBeenCalledWith("omie-sync", {
        body: expect.objectContaining({
          action: "create_and_bill_order",
          payload: expect.objectContaining({
            idempotencyKey: "kyberrock:unit-1:operation-1:create_sales_order"
          })
        })
      });
      expect(
        database.prepare("SELECT COUNT(*) FROM sync_queue WHERE target = 'omie'").pluck().get()
      ).toBe(1);
      expect(
        database
          .prepare("SELECT action, status FROM sync_queue WHERE id = 'omie-create-only-1'")
          .get()
      ).toMatchObject({ action: "create_and_bill_order", status: "done" });
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

  it("processFiscalBillingNow returns blocked (no OMIE call) when the customer lacks NF-e fields", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      // Cliente sem Numero do Endereco / E-mail vinculado a operacao fiscal.
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, omie_customer_id, email, address_number, created_at, updated_at)
           VALUES ('cust-x', 'company-1', 'omie', 'Cliente X', 'Cliente X', 456, NULL, NULL, datetime('now'), datetime('now'))`
        )
        .run();
      database
        .prepare("UPDATE weighing_operations SET customer_id = 'cust-x' WHERE id = 'operation-1'")
        .run();

      const result = await processFiscalBillingNow(database, identity, "operation-1");

      expect(result.blocked).toBe(true);
      expect(result.billed).toBe(false);
      expect(invokeMock).not.toHaveBeenCalled();
      expect(
        database
          .prepare("SELECT omie_billing_status FROM weighing_operations WHERE id = 'operation-1'")
          .pluck()
          .get()
      ).toBe("cadastro_incompleto");
    } finally {
      database.close();
    }
  });

  it("processFiscalBillingNow resends the service order of an internal operation", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      // Operacao interna que fechou sem job (cliente sem documento) e depois teve o
      // CNPJ preenchido: o mesmo botao de "Retentar OMIE" precisa reenviar a OS.
      database
        .prepare(
          `UPDATE weighing_operations
           SET operation_type = 'internal', omie_billing_status = 'cadastro_incompleto'
           WHERE id = 'operation-1'`
        )
        .run();
      invokeMock.mockResolvedValueOnce({ error: null, data: { orderId: 4242 } });

      const result = await processFiscalBillingNow(database, identity, "operation-1");

      expect(result.blocked).toBeUndefined();
      expect(result.orderId).toBe(4242);
      expect(invokeMock).toHaveBeenCalledWith("omie-sync", {
        body: expect.objectContaining({
          action: "create_order",
          payload: expect.objectContaining({ operationType: "internal" })
        })
      });
      expect(
        database
          .prepare(
            "SELECT omie_service_order_id, omie_billing_status FROM weighing_operations WHERE id = 'operation-1'"
          )
          .get()
      ).toMatchObject({
        omie_service_order_id: 4242,
        omie_billing_status: "service_order_created"
      });
    } finally {
      database.close();
    }
  });

  it("processFiscalBillingNow does not resurrect the service order of a cancelled operation", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      database
        .prepare(
          "UPDATE weighing_operations SET operation_type = 'internal', status = 'cancelled' WHERE id = 'operation-1'"
        )
        .run();

      const result = await processFiscalBillingNow(database, identity, "operation-1");

      expect(result.blocked).toBe(true);
      expect(invokeMock).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("processFiscalBillingNow blocks the internal resend while the customer has no document", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, created_at, updated_at)
           VALUES ('cust-sem-doc', 'company-1', 'local', 'Cliente Sem Doc', 'Cliente Sem Doc', datetime('now'), datetime('now'))`
        )
        .run();
      database
        .prepare(
          `UPDATE weighing_operations
           SET operation_type = 'internal', customer_id = 'cust-sem-doc'
           WHERE id = 'operation-1'`
        )
        .run();

      const result = await processFiscalBillingNow(database, identity, "operation-1");

      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain("ordem de servico");
      expect(invokeMock).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("processOmieSyncQueue blocks (no storm) a billing job on the OMIE NF-e cadastro fault", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertWeighingOperation(database);
      const job = enqueueSyncJob(database, {
        target: "omie",
        action: "create_and_bill_order",
        entityType: "weighing_operation",
        entityId: "operation-1",
        idempotencyKey: "omie:operation-1:bill",
        payload: {
          operationId: "operation-1",
          operationType: "invoice",
          customerOmieId: 456,
          quantity: 10,
          unitPrice: 25,
          issueDate: "2026-06-12"
        }
      });

      invokeMock.mockResolvedValueOnce({
        error: createFunctionHttpError(
          "Nao foi possivel realizar o faturamento desse Pedido de Venda de Produto! Para emitir a NF-e falta preencher o Numero do Endereco e o E-mail."
        ),
        data: null
      });

      await processOmieSyncQueue(database, identity);

      const row = database
        .prepare("SELECT status, next_attempt_at, attempt_count FROM sync_queue WHERE id = ?")
        .get(job.id) as { status: string; next_attempt_at: string; attempt_count: number };
      expect(row.status).toBe("failed");
      expect(row.next_attempt_at).toBe(BLOCKED_NEXT_ATTEMPT_AT);
      expect(row.attempt_count).toBe(0);
      expect(
        database
          .prepare("SELECT omie_billing_status FROM weighing_operations WHERE id = 'operation-1'")
          .pluck()
          .get()
      ).toBe("cadastro_incompleto");

      // Segunda passada do batch nao repega o job bloqueado (sem storm).
      invokeMock.mockClear();
      await processOmieSyncQueue(database, identity);
      expect(invokeMock).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("espelha os adiantamentos do OMIE no extrato e recalcula o saldo", async () => {
    const database = createDatabase();
    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      initializeSupabase();
      insertLocalCustomer(database, "customer-1", { omieCustomerId: 42 });

      invokeMock.mockResolvedValueOnce({
        data: {
          ok: true,
          advances: 1,
          imported: 1,
          adjusted: 0,
          unchanged: 0,
          unknownCustomers: 0,
          categoryCodes: ["1.01.05"],
          finished: true,
          movements: [
            {
              id: "omie-adv-company-1-7001-0",
              customer_id: "customer-1",
              operation_id: null,
              movement_type: "credit",
              amount_cents: 150_000,
              balance_after_cents: 150_000,
              reason: "Adiantamento OMIE #7001",
              source: "omie",
              omie_title_id: 7001,
              created_at: "2026-07-20T10:00:00.000Z"
            }
          ]
        },
        error: null
      });

      const result = await syncCustomerAdvancesFromCloud(database, identity);

      expect(result).toMatchObject({
        imported: 1,
        movementsApplied: 1,
        finished: true,
        categoryCodes: ["1.01.05"]
      });
      const [, options] = invokeMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
      expect(options.body).toMatchObject({ action: "pull_customer_advances" });

      const movement = database
        .prepare("SELECT source, omie_title_id FROM customer_credit_movements WHERE id = ?")
        .get("omie-adv-company-1-7001-0") as { source: string; omie_title_id: number };
      expect(movement).toEqual({ source: "omie", omie_title_id: 7001 });

      const balance = database
        .prepare("SELECT balance_cents FROM customer_credit_balances WHERE customer_id = ?")
        .get("customer-1") as { balance_cents: number };
      expect(balance.balance_cents).toBe(150_000);
    } finally {
      database.close();
    }
  });

  it("nao soma o mesmo adiantamento duas vezes ao repetir o ciclo", async () => {
    const database = createDatabase();
    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      initializeSupabase();
      insertLocalCustomer(database, "customer-1", { omieCustomerId: 42 });

      const page = {
        data: {
          ok: true,
          advances: 1,
          imported: 1,
          categoryCodes: ["1.01.05"],
          finished: true,
          movements: [
            {
              id: "omie-adv-company-1-7001-0",
              customer_id: "customer-1",
              movement_type: "credit",
              amount_cents: 150_000,
              balance_after_cents: 150_000,
              source: "omie",
              omie_title_id: 7001,
              created_at: "2026-07-20T10:00:00.000Z"
            }
          ]
        },
        error: null
      };
      invokeMock.mockResolvedValueOnce(page).mockResolvedValueOnce(page);

      await syncCustomerAdvancesFromCloud(database, identity);
      const second = await syncCustomerAdvancesFromCloud(database, identity);

      // Movimento ja conhecido: nada e reaplicado e o saldo continua o mesmo.
      expect(second.movementsApplied).toBe(0);
      const total = database
        .prepare(
          "SELECT COUNT(*) AS rows, COALESCE(SUM(amount_cents), 0) AS cents FROM customer_credit_movements"
        )
        .get() as { rows: number; cents: number };
      expect(total).toEqual({ rows: 1, cents: 150_000 });

      // A segunda chamada ja vai com a janela incremental e as categorias conhecidas.
      const [, options] = invokeMock.mock.calls[1] as [string, { body: Record<string, unknown> }];
      expect(options.body).toMatchObject({
        payload: expect.objectContaining({ categoryCodes: ["1.01.05"] })
      });
      const payload = (options.body as { payload: Record<string, unknown> }).payload;
      expect(typeof payload.startDate).toBe("string");
    } finally {
      database.close();
    }
  });

  it("baixa no OMIE o adiantamento reservado pela operacao", async () => {
    const database = createDatabase();
    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      initializeSupabase();
      insertLocalCustomer(database, "customer-1", { omieCustomerId: 42 });
      const operation = createSimulatedWeighingOperation(database, {
        identity,
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });
      database
        .prepare(
          `UPDATE weighing_operations
             SET omie_advance_settle_cents = 78000, omie_advance_status = 'pending'
           WHERE id = ?`
        )
        .run(operation.id);
      enqueueSyncJob(database, {
        target: "omie",
        action: "settle_advance",
        entityType: "weighing_operation",
        entityId: operation.id,
        idempotencyKey: `omie:settle_advance:${operation.id}`,
        payload: {
          operationId: operation.id,
          customerOmieId: 42,
          omieOrderId: 888,
          amountCents: 78_000,
          issueDate: "2026-07-20"
        }
      });

      invokeMock.mockResolvedValueOnce({
        data: {
          ok: true,
          settledCents: 78_000,
          titles: [{ titleId: 3001, amountCents: 78_000 }],
          advanceAccountCode: 22,
          pendingReceivable: false
        },
        error: null
      });

      const result = await processOmieSyncQueue(database, identity);

      expect(result).toMatchObject({ processed: 1, failed: 0 });
      const row = database
        .prepare(
          `SELECT omie_advance_settled_cents, omie_advance_status
           FROM weighing_operations WHERE id = ?`
        )
        .get(operation.id) as { omie_advance_settled_cents: number; omie_advance_status: string };
      expect(row).toEqual({ omie_advance_settled_cents: 78_000, omie_advance_status: "settled" });
      // Conta corrente descoberta pelo OMIE fica guardada para os proximos jobs.
      expect(readOmieAdvanceConfig(database).accountCode).toBe(22);
    } finally {
      database.close();
    }
  });

  it("mantem a baixa na fila enquanto o pedido nao tem titulo no OMIE", async () => {
    const database = createDatabase();
    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      initializeSupabase();
      insertLocalCustomer(database, "customer-1", { omieCustomerId: 42 });
      const operation = createSimulatedWeighingOperation(database, {
        identity,
        customerName: "Cliente Teste",
        plate: "ABC1D23",
        driverName: "Motorista Teste",
        productDescription: "Brita 1",
        entryWeightKg: 12_000
      });
      database
        .prepare(
          `UPDATE weighing_operations
             SET omie_advance_settle_cents = 50000, omie_advance_status = 'pending'
           WHERE id = ?`
        )
        .run(operation.id);
      enqueueSyncJob(database, {
        target: "omie",
        action: "settle_advance",
        entityType: "weighing_operation",
        entityId: operation.id,
        idempotencyKey: `omie:settle_advance:${operation.id}`,
        payload: {
          operationId: operation.id,
          customerOmieId: 42,
          omieOrderId: 999,
          amountCents: 50_000
        }
      });

      invokeMock.mockResolvedValueOnce({
        data: { ok: true, settledCents: 0, pendingReceivable: true, advanceAccountCode: 22 },
        error: null
      });

      const result = await processOmieSyncQueue(database, identity);

      // Nao amortizado: o job volta para a fila em vez de dar a operacao como
      // acertada no OMIE.
      expect(result.failed).toBe(1);
      const row = database
        .prepare(
          `SELECT omie_advance_settled_cents, omie_advance_status
           FROM weighing_operations WHERE id = ?`
        )
        .get(operation.id) as { omie_advance_settled_cents: number; omie_advance_status: string };
      expect(row).toEqual({ omie_advance_settled_cents: 0, omie_advance_status: "pending" });
      const job = database
        .prepare("SELECT status FROM sync_queue WHERE entity_id = ? AND action = 'settle_advance'")
        .get(operation.id) as { status: string };
      expect(job.status).toBe("failed");
    } finally {
      database.close();
    }
  });

  it("retoma a varredura de adiantamentos na pagina onde o ciclo anterior parou", async () => {
    const database = createDatabase();
    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      initializeSupabase();

      // Tenant grande: o ciclo bate no teto de paginas sem terminar a varredura.
      invokeMock.mockResolvedValue({
        data: { ok: true, finished: false, categoryCodes: ["1.01.05"], movements: [] },
        error: null
      });
      const first = await syncCustomerAdvancesFromCloud(database, identity);
      expect(first.finished).toBe(false);
      const pagesScanned = first.pages;

      invokeMock.mockResolvedValue({
        data: { ok: true, finished: true, categoryCodes: ["1.01.05"], movements: [] },
        error: null
      });
      await syncCustomerAdvancesFromCloud(database, identity);

      const [, options] = invokeMock.mock.calls[pagesScanned] as [
        string,
        { body: { payload: Record<string, unknown> } }
      ];
      expect(options.body.payload.page).toBe(pagesScanned + 1);
    } finally {
      database.close();
    }
  });

  // ── Volta do faturamento do OMIE ──────────────────────────────────────────────────
  //
  // Quem fatura e uma pessoa dentro do OMIE, na coluna "Faturar". Sem perguntar, a
  // pesagem ficaria em "No OMIE, falta faturar" mesmo com a nota emitida ha semanas.

  it("vira para faturada a pesagem que o OMIE ja faturou", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, { id: "op-faturada", salesOrderId: 11489137846 });
      invokeMock.mockResolvedValueOnce({
        error: null,
        data: {
          ok: true,
          results: [
            {
              operationId: "op-faturada",
              orderType: "sales",
              omieOrderId: 11489137846,
              found: true,
              billed: true,
              orderNumber: "1234",
              invoiceNumber: "987",
              documentUrl: "https://omie.example/danfe.pdf",
              error: null
            }
          ]
        }
      });

      const result = await reconcileOmieBillingFromOmie(database, identity);

      expect(invokeMock).toHaveBeenCalledWith("omie-sync", {
        body: expect.objectContaining({
          action: "check_order_billing",
          payload: {
            orders: [
              {
                operationId: "op-faturada",
                orderNumber: null,
                orderType: "sales",
                omieOrderId: 11489137846
              }
            ],
            // A janela de emissao vai junto. As datas sao relativas a hoje (ver
            // `RECENT_ISO`), entao aqui so o formato do OMIE e fixado; que ela de fato
            // abrace a carga mais antiga da leva e o teste logo abaixo.
            invoiceSearchFrom: expect.stringMatching(/^\d{2}\/\d{2}\/\d{4}$/),
            invoiceSearchTo: expect.stringMatching(/^\d{2}\/\d{2}\/\d{4}$/)
          }
        })
      });
      expect(result).toMatchObject({ checked: 1, billed: 1, errors: [] });
      const row = database
        .prepare(
          `SELECT omie_billing_status, omie_billing_message, omie_order_number,
                  omie_document_url, omie_billed_at, omie_billing_checked_at, updated_at
             FROM weighing_operations WHERE id = 'op-faturada'`
        )
        .get() as Record<string, string | null>;
      expect(row.omie_billing_status).toBe("billed");
      expect(row.omie_billing_message).toBe("Faturado no OMIE — NF-e 987.");
      expect(row.omie_order_number).toBe("1234");
      expect(row.omie_document_url).toBe("https://omie.example/danfe.pdf");
      expect(row.omie_billed_at).not.toBeNull();
      expect(row.omie_billing_checked_at).not.toBeNull();
      // As colunas de faturamento sao locais: bumpar updated_at republicaria a operacao
      // inteira na nuvem a toa — na primeira passada, o acervo inteiro de uma vez.
      expect(row.updated_at).toBe(RECENT_ISO);
    } finally {
      database.close();
    }
  });

  it("marca a ordem de servico interna faturada como faturada tambem", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, {
        id: "op-interna",
        serviceOrderId: 11489138183,
        operationType: "internal"
      });
      invokeMock.mockResolvedValueOnce({
        error: null,
        data: {
          ok: true,
          results: [
            {
              operationId: "op-interna",
              orderType: "service",
              omieOrderId: 11489138183,
              found: true,
              billed: true,
              orderNumber: "000045",
              invoiceNumber: null,
              documentUrl: null,
              error: null
            }
          ]
        }
      });

      const result = await reconcileOmieBillingFromOmie(database, identity);

      // A OS vai como "service": a interna nao gera pedido de venda.
      const [, options] = invokeMock.mock.calls[0] as [
        string,
        { body: { payload: { orders: Array<Record<string, unknown>> } } }
      ];
      expect(options.body.payload.orders[0].orderType).toBe("service");
      expect(result).toMatchObject({ billed: 1 });
      const row = database
        .prepare(
          "SELECT omie_billing_status, omie_billing_message FROM weighing_operations WHERE id = 'op-interna'"
        )
        .get() as Record<string, string | null>;
      expect(row.omie_billing_status).toBe("billed");
      expect(row.omie_billing_message).toBe("Faturado no OMIE.");
    } finally {
      database.close();
    }
  });

  it("para de perguntar pelo pedido que sumiu do OMIE, sem dar por faturado", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, { id: "op-sumida", salesOrderId: 555 });
      invokeMock.mockResolvedValueOnce({
        error: null,
        data: {
          ok: true,
          results: [
            {
              operationId: "op-sumida",
              orderType: "sales",
              omieOrderId: 555,
              found: false,
              billed: false,
              orderNumber: null,
              invoiceNumber: null,
              documentUrl: null,
              error: null
            }
          ]
        }
      });

      const result = await reconcileOmieBillingFromOmie(database, identity);

      expect(result).toMatchObject({ checked: 1, billed: 0 });
      const row = database
        .prepare(
          "SELECT omie_billing_status, omie_billing_message FROM weighing_operations WHERE id = 'op-sumida'"
        )
        .get() as Record<string, string | null>;
      // A pesagem REALMENTE nao foi faturada, e agora nem pedido tem — mas o "nao existe"
      // do OMIE e definitivo (ele nao reaproveita o codigo interno de um registro
      // excluido), entao a conferencia guarda o fato em vez de so escrever a frase.
      expect(row.omie_billing_status).toBe("missing_in_omie");
      expect(row.omie_billing_message).toBe("Pedido 555 nao existe mais no OMIE.");

      // E a passada seguinte nao pergunta de novo. Sem isto, o rodizio (que ordena por
      // `omie_billing_checked_at ASC`) devolvia a mesma pesagem para a frente da fila a
      // cada passada: 24 documentos excluidos renderam 3.133 consultas recusadas em 24h,
      // e foi esse volume que fez o OMIE bloquear a integracao por consumo indevido.
      invokeMock.mockClear();
      const again = await reconcileOmieBillingFromOmie(database, identity, { force: true });

      expect(invokeMock).not.toHaveBeenCalled();
      expect(again).toMatchObject({ checked: 0, billed: 0 });
    } finally {
      database.close();
    }
  });

  it("volta a conferir a pesagem cujo documento sumiu depois de um documento novo", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, { id: "op-refeita", salesOrderId: 555 });
      // Estado deixado pela conferencia anterior: o documento tinha sumido do OMIE.
      database
        .prepare(
          `UPDATE weighing_operations
              SET omie_billing_status = 'missing_in_omie',
                  omie_billing_message = 'Pedido 555 nao existe mais no OMIE.'
            WHERE id = 'op-refeita'`
        )
        .run();

      // Reenviar o fechamento cria um documento NOVO no OMIE, e a criacao limpa o
      // marcador — senao a pesagem ficaria fora da conferencia para sempre.
      database
        .prepare(
          `UPDATE weighing_operations
             SET omie_billing_status = NULL, omie_billing_message = NULL
           WHERE id = ?
             AND omie_billing_status IN ('failed', 'cadastro_incompleto', 'service_order_failed',
                                         'missing_in_omie')`
        )
        .run("op-refeita");

      invokeMock.mockResolvedValueOnce({ error: null, data: { ok: true, results: [] } });
      await reconcileOmieBillingFromOmie(database, identity);

      expect(invokeMock).toHaveBeenCalledWith(
        "omie-sync",
        expect.objectContaining({
          body: expect.objectContaining({ action: "check_order_billing" })
        })
      );
    } finally {
      database.close();
    }
  });

  it("confere por rodizio: quem nunca foi conferido vem antes do conferido ha mais tempo", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, { id: "op-nunca", salesOrderId: 1 });
      insertSentOperation(database, { id: "op-antiga", salesOrderId: 2 });
      insertSentOperation(database, { id: "op-recente", salesOrderId: 3 });
      database
        .prepare("UPDATE weighing_operations SET omie_billing_checked_at = ? WHERE id = ?")
        .run("2026-01-01T00:00:00.000Z", "op-antiga");
      database
        .prepare("UPDATE weighing_operations SET omie_billing_checked_at = ? WHERE id = ?")
        .run("2026-08-01T00:00:00.000Z", "op-recente");
      invokeMock.mockResolvedValue({ error: null, data: { ok: true, results: [] } });

      await reconcileOmieBillingFromOmie(database, identity, { limit: 1, force: true });
      const [, first] = invokeMock.mock.calls[0] as [
        string,
        { body: { payload: { orders: Array<{ operationId: string }> } } }
      ];
      expect(first.body.payload.orders.map((order) => order.operationId)).toEqual(["op-nunca"]);

      // Sem resposta o rodizio nao anda: a proxima passada volta na mesma operacao. E o
      // que garante que uma falha do OMIE nao pula ninguem da fila.
      await reconcileOmieBillingFromOmie(database, identity, { limit: 2, force: true });
      const [, second] = invokeMock.mock.calls[1] as [
        string,
        { body: { payload: { orders: Array<{ operationId: string }> } } }
      ];
      expect(second.body.payload.orders.map((order) => order.operationId)).toEqual([
        "op-nunca",
        "op-antiga"
      ]);
    } finally {
      database.close();
    }
  });

  it("respeita o intervalo minimo entre conferencias", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, { id: "op-freio", salesOrderId: 1 });
      invokeMock.mockResolvedValue({ error: null, data: { ok: true, results: [] } });

      await reconcileOmieBillingFromOmie(database, identity);
      // syncCloudNow roda em segundo plano a cada fechamento e a cada alteracao de
      // operacao: sem o freio, uma pedreira movimentada gastaria a cota do OMIE
      // perguntando de novo pelas mesmas pesagens.
      const second = await reconcileOmieBillingFromOmie(database, identity);

      expect(second).toEqual({
        checked: 0,
        billed: 0,
        invoiceNumbers: 0,
        stillWithoutInvoiceNumber: 0,
        skipped: true,
        errors: []
      });
      expect(invokeMock).toHaveBeenCalledTimes(1);
    } finally {
      database.close();
    }
  });

  it("passada curta olha so o movimento recente; o acervo entra na passada completa", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, { id: "op-hoje", salesOrderId: 9001 });
      insertSentOperation(database, {
        id: "op-acervo",
        salesOrderId: 5001,
        createdAt: daysAgoIso(40)
      });
      invokeMock.mockResolvedValue({ error: null, data: { ok: true, results: [] } });

      // Curta: so o que e recente. O acervo tem codigo baixo no OMIE e obrigaria a
      // listagem — que vem do codigo maior para o menor — a varrer ate la.
      await reconcileOmieBillingFromOmie(database, identity, {
        force: true,
        includeBacklog: false
      });
      const [, short] = invokeMock.mock.calls[0] as [
        string,
        { body: { payload: { orders: Array<{ operationId: string }> } } }
      ];
      expect(short.body.payload.orders.map((order) => order.operationId)).toEqual(["op-hoje"]);

      // Completa: os dois, e o recente vem primeiro — se o lote acabar, quem fica de fora
      // e o registro velho.
      await reconcileOmieBillingFromOmie(database, identity, {
        force: true,
        includeBacklog: true
      });
      const [, full] = invokeMock.mock.calls[1] as [
        string,
        { body: { payload: { orders: Array<{ operationId: string }> } } }
      ];
      expect(full.body.payload.orders.map((order) => order.operationId)).toEqual([
        "op-hoje",
        "op-acervo"
      ]);
    } finally {
      database.close();
    }
  });

  it("põe o movimento do dia na frente do acervo nunca conferido", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      // O acervo nunca foi conferido e a de hoje ja foi: pelo rodizio puro, a velha viria
      // primeiro. Nao pode — e a de hoje que o operador esta olhando na tela.
      insertSentOperation(database, {
        id: "op-acervo-virgem",
        salesOrderId: 5001,
        createdAt: daysAgoIso(40)
      });
      insertSentOperation(database, { id: "op-hoje", salesOrderId: 9001 });
      database
        .prepare("UPDATE weighing_operations SET omie_billing_checked_at = ? WHERE id = ?")
        .run(new Date().toISOString(), "op-hoje");
      invokeMock.mockResolvedValue({ error: null, data: { ok: true, results: [] } });

      await reconcileOmieBillingFromOmie(database, identity, {
        force: true,
        includeBacklog: true
      });

      const [, options] = invokeMock.mock.calls[0] as [
        string,
        { body: { payload: { orders: Array<{ operationId: string }> } } }
      ];
      expect(options.body.payload.orders.map((order) => order.operationId)).toEqual([
        "op-hoje",
        "op-acervo-virgem"
      ]);
    } finally {
      database.close();
    }
  });

  it("nao pergunta pela pesagem ja faturada COM nota nem pela cancelada", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, { id: "op-ja-faturada", salesOrderId: 1 });
      insertSentOperation(database, { id: "op-cancelada", salesOrderId: 2 });
      insertSentOperation(database, { id: "op-sem-pedido" });
      database
        .prepare(
          `UPDATE weighing_operations
              SET omie_billing_status = 'billed', omie_invoice_number = '987'
            WHERE id = ?`
        )
        .run("op-ja-faturada");
      database
        .prepare("UPDATE weighing_operations SET status = 'cancelled' WHERE id = ?")
        .run("op-cancelada");

      const result = await reconcileOmieBillingFromOmie(database, identity);

      // Nenhuma sobra: faturada COM o numero da nota e estado final (sem o numero ela
      // continua na fila, senao a coluna Nota fiscal ficaria vazia para sempre), cancelada
      // saiu do fluxo e a que nunca chegou ao OMIE nao tem o que conferir la.
      expect(result).toEqual({
        checked: 0,
        billed: 0,
        invoiceNumbers: 0,
        stillWithoutInvoiceNumber: 0,
        errors: []
      });
      expect(invokeMock).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("conferencia dirigida pergunta pelas cargas pedidas, ordem de servico inclusive", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      // A quinzena que a atendente esta fechando tem venda interna (OS/NFS-e) e pesagem
      // com nota (pedido/NF-e), e parte dela e mais velha que a janela quente do rodizio.
      insertSentOperation(database, {
        id: "op-os",
        operationType: "internal",
        serviceOrderId: 11493172000,
        createdAt: daysAgoIso(20)
      });
      insertSentOperation(database, { id: "op-pedido", salesOrderId: 11493187126 });
      insertSentOperation(database, { id: "op-fora-da-tela", salesOrderId: 7777 });
      invokeMock.mockResolvedValue({ error: null, data: { ok: true, results: [] } });

      await reconcileOmieBillingFromOmie(database, identity, {
        operationIds: ["op-os", "op-pedido"]
      });

      const [, options] = invokeMock.mock.calls[0] as [
        string,
        {
          body: {
            payload: {
              orders: Array<{
                operationId: string;
                orderNumber: string | null;
                orderType: string;
                omieOrderId: number;
              }>;
            };
          };
        }
      ];
      // A OS entra junto do pedido: a nota da venda interna tambem nasce no OMIE, e sem
      // perguntar por ela a coluna "Nota fiscal" do relatorio sai vazia. E so as da tela.
      expect(options.body.payload.orders).toEqual([
        { operationId: "op-os", orderNumber: null, orderType: "service", omieOrderId: 11493172000 },
        {
          operationId: "op-pedido",
          orderNumber: null,
          orderType: "sales",
          omieOrderId: 11493187126
        }
      ]);
    } finally {
      database.close();
    }
  });

  it("conferencia dirigida nao espera a vez do rodizio", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, { id: "op-1", salesOrderId: 4001 });
      invokeMock.mockResolvedValue({ error: null, data: { ok: true, results: [] } });

      // A passada de fundo acabou de rodar e fechou a janela.
      await reconcileOmieBillingFromOmie(database, identity);
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(await reconcileOmieBillingFromOmie(database, identity)).toMatchObject({
        skipped: true
      });
      expect(invokeMock).toHaveBeenCalledTimes(1);

      // A tela do fechamento perguntando pelas cargas que estao nela e uma pergunta do
      // operador, nao a rotina de fundo: esperar o intervalo aqui e deixar a coluna "Nota
      // fiscal" com "-" e mandar o relatorio ao cliente sem o numero da nota.
      const targeted = await reconcileOmieBillingFromOmie(database, identity, {
        operationIds: ["op-1"]
      });

      expect(targeted.skipped).toBeUndefined();
      expect(invokeMock).toHaveBeenCalledTimes(2);
    } finally {
      database.close();
    }
  });

  it("continua perguntando pela pesagem faturada que ficou sem o numero da nota", async () => {
    // O caso que deixava o relatorio do cliente com "-" na coluna Nota fiscal: a conferencia
    // pela listagem reconhece o faturamento pela etapa do kanban e nao traz a NF-e junto.
    // Marcada como faturada, a pesagem saia da fila e o numero nunca mais era perguntado.
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, { id: "op-sem-numero", salesOrderId: 5001 });
      invokeMock.mockResolvedValueOnce({
        error: null,
        data: {
          ok: true,
          results: [
            {
              operationId: "op-sem-numero",
              orderType: "sales",
              omieOrderId: 5001,
              found: true,
              billed: true,
              orderNumber: "1234",
              invoiceNumber: null,
              documentUrl: null,
              error: null
            }
          ]
        }
      });

      const first = await reconcileOmieBillingFromOmie(database, identity);
      // Faturada e SEM numero: e exatamente este estado que a tela precisa enxergar para
      // saber que ainda ha o que perguntar.
      expect(first).toMatchObject({ billed: 1, invoiceNumbers: 0, stillWithoutInvoiceNumber: 1 });

      // Segunda passada: a pesagem tem de continuar na fila, e o numero que chegar agora
      // precisa ser gravado mesmo com a pesagem ja marcada como faturada.
      invokeMock.mockResolvedValueOnce({
        error: null,
        data: {
          ok: true,
          results: [
            {
              operationId: "op-sem-numero",
              orderType: "sales",
              omieOrderId: 5001,
              found: true,
              billed: true,
              orderNumber: "1234",
              invoiceNumber: "987",
              documentUrl: "https://omie.example/danfe.pdf",
              error: null
            }
          ]
        }
      });
      const second = await reconcileOmieBillingFromOmie(database, identity, { force: true });

      // Ja constava faturada: a contagem de "viraram nota agora" nao pode conta-la de novo.
      // Mas a contagem do NUMERO conta — e ela que a tela e o botao usam para saber se a
      // leva rendeu e se vale pedir a proxima.
      expect(second).toMatchObject({
        checked: 1,
        billed: 0,
        invoiceNumbers: 1,
        stillWithoutInvoiceNumber: 0
      });
      const row = database
        .prepare(
          `SELECT omie_invoice_number, omie_billing_status, omie_document_url
             FROM weighing_operations WHERE id = 'op-sem-numero'`
        )
        .get() as Record<string, string | null>;
      expect(row.omie_invoice_number).toBe("987");
      expect(row.omie_billing_status).toBe("billed");
      expect(row.omie_document_url).toBe("https://omie.example/danfe.pdf");
    } finally {
      database.close();
    }
  });

  it("para de perguntar assim que o numero da nota chega", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, { id: "op-com-nota", salesOrderId: 5002 });
      database
        .prepare(
          `UPDATE weighing_operations
              SET omie_billing_status = 'billed', omie_invoice_number = '987'
            WHERE id = 'op-com-nota'`
        )
        .run();
      invokeMock.mockResolvedValue({ error: null, data: { ok: true, results: [] } });

      await reconcileOmieBillingFromOmie(database, identity);

      // Faturada COM numero e assunto encerrado: nao volta a gastar chamada do OMIE.
      expect(invokeMock).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("pergunta pelo documento que a pesagem TEM, mesmo quando o tipo dela nao bate", async () => {
    // Operacao convertida depois de o documento ja existir no OMIE (interna virou com nota,
    // ou o contrario). O tipo pedia um pedido de venda que ela nao tem; descartada, ela
    // ficava com `omie_billing_checked_at` parado e voltava na FRENTE do rodizio em toda
    // passada, ocupando uma vaga do lote sem nunca ser conferida.
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, {
        id: "op-convertida",
        operationType: "invoice",
        salesOrderId: null,
        serviceOrderId: 7007
      });
      invokeMock.mockResolvedValueOnce({
        error: null,
        data: {
          ok: true,
          results: [
            {
              operationId: "op-convertida",
              orderType: "service",
              omieOrderId: 7007,
              found: true,
              billed: true,
              orderNumber: "000077",
              invoiceNumber: "551",
              documentUrl: null,
              error: null
            }
          ]
        }
      });

      const result = await reconcileOmieBillingFromOmie(database, identity);

      const body = invokeMock.mock.calls[0][1].body as {
        payload: { orders: Array<{ orderType: string; omieOrderId: number }> };
      };
      expect(body.payload.orders).toEqual([
        { operationId: "op-convertida", orderNumber: null, orderType: "service", omieOrderId: 7007 }
      ]);
      expect(result).toMatchObject({ checked: 1, invoiceNumbers: 1 });
      expect(
        (
          database
            .prepare(`SELECT omie_invoice_number FROM weighing_operations WHERE id = ?`)
            .get("op-convertida") as { omie_invoice_number: string | null }
        ).omie_invoice_number
      ).toBe("551");
    } finally {
      database.close();
    }
  });

  it("guarda o numero da nota mesmo quando o OMIE ainda nao deu por faturada", async () => {
    // O numero e prova de que a nota existe. Descarta-lo por causa da etapa do kanban
    // deixava a coluna "Nota fiscal" vazia com a nota ja na mao do cliente.
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, { id: "op-etapa-baixa", salesOrderId: 6001 });
      invokeMock.mockResolvedValueOnce({
        error: null,
        data: {
          ok: true,
          results: [
            {
              operationId: "op-etapa-baixa",
              orderType: "sales",
              omieOrderId: 6001,
              found: true,
              billed: false,
              orderNumber: "1234",
              invoiceNumber: "778",
              documentUrl: null,
              error: null
            }
          ]
        }
      });

      const result = await reconcileOmieBillingFromOmie(database, identity);

      const row = database
        .prepare(
          `SELECT omie_invoice_number, omie_billing_status FROM weighing_operations WHERE id = ?`
        )
        .get("op-etapa-baixa") as Record<string, string | null>;
      expect(row.omie_invoice_number).toBe("778");
      // A SITUACAO continua sendo decidida pelo OMIE — so o numero e aproveitado.
      expect(row.omie_billing_status).toBeNull();
      expect(result).toMatchObject({ invoiceNumbers: 1 });
    } finally {
      database.close();
    }
  });

  it("a conferencia pedida pela tela leva um teto maior de consultas do numero", async () => {
    // O rodizio de fundo divide a fila do OMIE com o envio dos fechamentos e fica com o teto
    // baixo do edge. Quando quem pede e a tela, existe alguem esperando o numero — e sem
    // este teto a leva voltava com dez numeros e o resto marcado como "ja perguntado".
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, { id: "op-1", salesOrderId: 8001 });
      invokeMock.mockResolvedValue({ error: null, data: { ok: true, results: [] } });

      await reconcileOmieBillingFromOmie(database, identity);
      const background = invokeMock.mock.calls[0][1].body as {
        payload: Record<string, unknown>;
      };
      expect(background.payload.invoiceNumberBudget).toBeUndefined();

      await reconcileOmieBillingFromOmie(database, identity, {
        operationIds: ["op-1"],
        invoiceNumberBudget: 20
      });
      const fromScreen = invokeMock.mock.calls[1][1].body as {
        payload: Record<string, unknown>;
      };
      expect(fromScreen.payload.invoiceNumberBudget).toBe(20);
    } finally {
      database.close();
    }
  });

  it("a conferencia dirigida tambem alcanca a faturada sem numero", async () => {
    // E o que o botao "Conferir notas no OMIE" faz. Antes ele nao tinha efeito nenhum
    // nessas cargas: a consulta que monta a fila as excluia por ja estarem faturadas.
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, { id: "op-sem-numero", salesOrderId: 5003 });
      database
        .prepare(
          `UPDATE weighing_operations
              SET omie_billing_status = 'billed', omie_order_number = '452'
            WHERE id = ?`
        )
        .run("op-sem-numero");
      invokeMock.mockResolvedValue({ error: null, data: { ok: true, results: [] } });

      await reconcileOmieBillingFromOmie(database, identity, {
        operationIds: ["op-sem-numero"]
      });

      const [, options] = invokeMock.mock.calls[0] as [
        string,
        { body: { payload: { orders: Array<Record<string, unknown>> } } }
      ];
      // O numero do pedido vai junto: a listagem de notas do OMIE reencontra a nota pelo
      // codigo interno do pedido, mas ha registro que so traz o numero impresso — e este a
      // balanca ja tem guardado, sem custar chamada nenhuma.
      expect(options.body.payload.orders).toEqual([
        { operationId: "op-sem-numero", orderNumber: "452", orderType: "sales", omieOrderId: 5003 }
      ]);
    } finally {
      database.close();
    }
  });

  it("a janela de emissao abraca a carga mais antiga da leva", async () => {
    // A janela existe porque o OMIE recusa a MESMA pergunta repetida ("Consumo redundante
    // detectado"), e a listagem de notas saia identica em toda passada: da segunda leva em
    // diante voltava recusada e a coluna "Nota fiscal" ficava vazia sem nada parecer
    // quebrado. Ela tem de comecar ANTES da carga mais velha da leva — se a nota cair fora
    // do periodo, estreitar a busca teria trocado um jeito de falhar por outro.
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      const antiga = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
      insertSentOperation(database, { id: "op-antiga", salesOrderId: 5001, createdAt: antiga });
      insertSentOperation(database, { id: "op-nova", salesOrderId: 5002 });
      invokeMock.mockResolvedValue({ error: null, data: { ok: true, results: [] } });

      await reconcileOmieBillingFromOmie(database, identity, {
        operationIds: ["op-antiga", "op-nova"]
      });

      const { payload } = (
        invokeMock.mock.calls[0][1] as { body: { payload: Record<string, string> } }
      ).body;
      const asDate = (br: string) => {
        const [day, month, year] = br.split("/");
        return new Date(`${year}-${month}-${day}T00:00:00Z`).getTime();
      };

      expect(asDate(payload.invoiceSearchFrom)).toBeLessThan(new Date(antiga).getTime());
      // E vai ate depois de hoje: a nota de hoje pode estar datada adiante pelo fuso.
      expect(asDate(payload.invoiceSearchTo)).toBeGreaterThan(Date.now());
    } finally {
      database.close();
    }
  });

  it("sem data legivel na leva, pergunta sem janela em vez de mandar periodo errado", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);
      insertSentOperation(database, { id: "op-sem-data", salesOrderId: 5004 });
      database
        .prepare("UPDATE weighing_operations SET created_at = '' WHERE id = ?")
        .run("op-sem-data");
      invokeMock.mockResolvedValue({ error: null, data: { ok: true, results: [] } });

      await reconcileOmieBillingFromOmie(database, identity, { operationIds: ["op-sem-data"] });

      const { payload } = (
        invokeMock.mock.calls[0][1] as { body: { payload: Record<string, unknown> } }
      ).body;
      // Varrer do mais novo para tras e pior que a janela, mas e correto. Mandar um periodo
      // inventado deixaria a nota FORA dele, e ai nao ha varredura que a ache.
      expect(payload.invoiceSearchFrom).toBeUndefined();
      expect(payload.invoiceSearchTo).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("conferencia dirigida sem carga alguma nao chama o OMIE", async () => {
    const database = createDatabase();

    try {
      const identity = createIdentity(database);
      createCloudSettings(database);

      expect(await reconcileOmieBillingFromOmie(database, identity, { operationIds: [] })).toEqual({
        checked: 0,
        billed: 0,
        invoiceNumbers: 0,
        stillWithoutInvoiceNumber: 0,
        errors: []
      });
      expect(invokeMock).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });
});

/** Data recente fixa: a reconciliacao so olha os ultimos 120 dias. */
const RECENT_ISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

/** Uma data de N dias atras, para separar o movimento recente do acervo. */
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Pesagem fechada que ja tem pedido (ou OS) no OMIE e ainda nao consta faturada. */
function insertSentOperation(
  database: DesktopDatabase,
  options: {
    id: string;
    salesOrderId?: number | null;
    serviceOrderId?: number | null;
    operationType?: "invoice" | "internal";
    /** Idade da pesagem. Padrao: ontem — dentro da janela quente. */
    createdAt?: string;
  }
): void {
  const createdAt = options.createdAt ?? RECENT_ISO;
  database
    .prepare(
      `INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type,
        entry_weight_kg, exit_weight_kg, net_weight_kg, unit_price_cents,
        product_total_cents, total_cents, omie_sales_order_id, omie_service_order_id,
        created_at, updated_at
      ) VALUES (?, 'company-1', 'unit-1', 'device-1', 'synced', ?, 20, 10, 10, 2500, 25000, 25000, ?, ?, ?, ?)`
    )
    .run(
      options.id,
      options.operationType ?? "invoice",
      options.salesOrderId ?? null,
      options.serviceOrderId ?? null,
      createdAt,
      createdAt
    );
}

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

function insertLocalCustomer(
  database: DesktopDatabase,
  id: string,
  options: {
    document?: string | null;
    omieCustomerId?: number;
    omieIntegrationCode?: string;
    source?: string;
  } = {}
): void {
  const now = "2026-06-12T12:00:00.000Z";
  database
    .prepare(
      `INSERT INTO customers (
        id, company_id, source, omie_customer_id, omie_integration_code, legal_name, trade_name, document, phone, email,
        sync_status, created_at, updated_at, needs_push
      ) VALUES (?, 'company-1', ?, ?, ?, 'Cliente Local LTDA', 'Cliente Local', ?, '(11) 99999-9999', 'cliente@example.com', 'pending', ?, ?, 1)`
    )
    .run(
      id,
      options.source ?? "local",
      options.omieCustomerId ?? null,
      options.omieIntegrationCode ?? null,
      options.document === undefined ? "12345678000195" : options.document,
      now,
      now
    );
}

function insertLocalCarrier(
  database: DesktopDatabase,
  id: string,
  options: { omieCustomerId?: number; document?: string | null } = {}
): void {
  const now = "2026-06-12T12:00:00.000Z";
  database
    .prepare(
      `INSERT INTO carriers (
        id, company_id, omie_customer_id, name, document, phone, email,
        source, is_active, sync_status, needs_push, created_at, updated_at
      ) VALUES (?, 'company-1', ?, 'Transportadora Local LTDA', ?, '(19) 3333-4444', 'transporte@example.com',
        'local', 1, 'pending', 1, ?, ?)`
    )
    .run(
      id,
      options.omieCustomerId ?? null,
      options.document === undefined ? "22222222000182" : options.document,
      now,
      now
    );
}

function insertWeighingOperation(database: DesktopDatabase): void {
  const now = "2026-06-12T12:00:00.000Z";
  // Cliente com cadastro fiscal completo (email + numero do endereco), exigido pelo
  // gate de pre-validacao de NF-e do faturamento imediato.
  database
    .prepare(
      `INSERT OR IGNORE INTO customers (
        id, company_id, source, omie_customer_id, legal_name, trade_name, email, address_number, created_at, updated_at
      ) VALUES ('sync-customer-1', 'company-1', 'omie', 777, 'Cliente Sync LTDA', 'Cliente Sync', 'sync@example.com', '10', ?, ?)`
    )
    .run(now, now);
  database
    .prepare(
      `INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type, customer_id,
        entry_weight_kg, exit_weight_kg, net_weight_kg, unit_price_cents,
        product_total_cents, total_cents, created_at, updated_at
      ) VALUES (
        'operation-1', 'company-1', 'unit-1', 'device-1', 'pending_omie', 'invoice', 'sync-customer-1',
        20, 10, 10, 2500, 25000, 25000, ?, ?
      )`
    )
    .run(now, now);
}

/** Operacao ja fechada de um cliente que ainda nao existe no OMIE (sem codigo, com CNPJ). */
function insertClosedOperationForNewCustomer(database: DesktopDatabase): void {
  const now = "2026-06-12T12:00:00.000Z";
  insertLocalCustomer(database, "customer-novo");
  insertWeighingOperation(database);
  database
    .prepare(
      `UPDATE weighing_operations
       SET customer_id = 'customer-novo', status = 'closed_local', exit_weight_captured_at = ?
       WHERE id = 'operation-1'`
    )
    .run(now);
}

/** Job do fechamento que leva o cadastro do cliente para o edge criar no OMIE. */
function enqueueBillingJobForNewCustomer(
  database: DesktopDatabase,
  options: { customerOmieId?: number } = {}
): void {
  enqueueSyncJob(database, {
    id: "omie-job-novo-cliente",
    target: "omie",
    action: "create_order",
    entityType: "weighing_operation",
    entityId: "operation-1",
    idempotencyKey: "kyberrock:unit-1:operation-1:create_sales_order",
    payload: {
      operationId: "operation-1",
      operationType: "invoice",
      customerOmieId: options.customerOmieId ?? 0,
      localCustomerId: "customer-novo",
      customer: {
        localCustomerId: "customer-novo",
        razaoSocial: "Cliente Local LTDA",
        cnpjCpf: "12345678000195"
      },
      productOmieId: 55,
      quantity: 10,
      unitPrice: 25,
      issueDate: "2026-06-12"
    }
  });
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

function createFunctionHttpError(message: string, details?: unknown): Error & { context: unknown } {
  const error = new Error("Edge Function returned a non-2xx status code") as Error & {
    context: unknown;
  };
  error.name = "FunctionsHttpError";
  error.context = {
    statusText: "Bad Request",
    clone: () => ({
      json: async () => ({ error: message, ...(details === undefined ? {} : { details }) })
    })
  };
  return error;
}
