import { describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate.js";
import { openDesktopDatabase } from "../database/sqlite.js";
import type { DesktopDatabase } from "../database/sqlite.js";
import type { OmieClient } from "@kyberrock/omie-client";
import {
  createOmieClient,
  OmieSyncService
} from "./omie-sync";
import { ensureDefaultPaymentMethods } from "./payment-methods.js";
import { ensureDefaultAccounts } from "./accounts.js";

describe("createOmieClient", () => {
  it("creates client with credentials", () => {
    const client = createOmieClient({
      appKey: "key",
      appSecret: "secret"
    });

    expect(client).toBeDefined();
  });

  it("throws when credentials are empty", () => {
    expect(() =>
      createOmieClient({ appKey: "", appSecret: "secret" })
    ).toThrow();
  });
});

describe("OmieSyncService", () => {
  function createMockDb(): DesktopDatabase {
    return {
      prepare: vi.fn().mockReturnValue({
        run: vi.fn().mockImplementation(() => undefined),
        get: vi.fn().mockReturnValue(undefined),
        all: vi.fn().mockReturnValue([])
      }),
      transaction: vi.fn((fn: () => unknown) => fn)
    } as unknown as DesktopDatabase;
  }

  function createMockClient(): OmieClient {
    return {
      call: vi.fn().mockResolvedValue({})
    } as unknown as OmieClient;
  }

  it("syncs customers from OMIE to local database", async () => {
    const db = createMockDb();
    const client = createMockClient();

    const service = new OmieSyncService(client, db);

    vi.spyOn((service as unknown as Record<string, unknown>).customersService as unknown as { listAll: () => Promise<unknown[]> }, "listAll").mockResolvedValue([
      {
        id: 123,
        name: "ACME Ltda",
        tradeName: "ACME",
        document: "12345678000195",
        email: "acme@example.com",
        phone: "(11) 99999-9999",
        zipcode: "01001000",
        addressStreet: "Rua A",
        neighborhood: "Centro",
        city: "Sao Paulo",
        state: "SP",
        isActive: true,
        tags: { tags: ["Cliente"] }
      },
      {
        id: 124,
        name: "Transportadora Ltda",
        isActive: true,
        tags: { tags: ["Transportadora"] }
      }
    ]);

    const count = await service.pullCustomersFromOmie("company-1");

    expect(count).toBe(1);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO customers"));
  });

  it("syncs products from OMIE to local database", async () => {
    const db = createMockDb();
    const client = createMockClient();

    const service = new OmieSyncService(client, db);

     
    vi.spyOn((service as unknown as Record<string, unknown>).productsService as unknown as { listAll: () => Promise<unknown[]> }, "listAll").mockResolvedValue([
      {
        id: 456,
        description: "Brita 0",
        code: "BRITA0",
        unit: "M3",
        itemType: "04 - Produtos Acabados",
        isActive: true,
        blocked: false
      }
    ]);

    const count = await service.syncProducts("company-1");

    expect(count).toBe(1);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO products"));
  });

  it("rebuilds customers and carriers from ListarClientes tags while preserving local registrations", async () => {
    const db = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(db);
      db.exec(`
        INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
        VALUES ('company-1', 'Empresa Teste', 'Empresa', datetime('now'), datetime('now'));

        INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
        VALUES ('local-customer', 'company-1', 'local', 'Cliente Local', 'Cliente Local', 1, datetime('now'), datetime('now'));

        INSERT INTO carriers (id, company_id, name, source, is_active, created_at, updated_at)
        VALUES ('local-carrier', 'company-1', 'Transportadora Local', 'local', 1, datetime('now'), datetime('now'));

        INSERT INTO vehicles (id, company_id, plate, carrier_id, is_active, created_at, updated_at)
        VALUES ('vehicle-1', 'company-1', 'ABC1234', 'local-carrier', 1, datetime('now'), datetime('now'));

        INSERT INTO drivers (id, company_id, name, is_active, created_at, updated_at)
        VALUES ('driver-1', 'company-1', 'Motorista Local', 1, datetime('now'), datetime('now'));

        INSERT INTO customer_carriers (id, customer_id, carrier_id, is_active, created_at, updated_at)
        VALUES ('cc-1', 'local-customer', 'local-carrier', 1, datetime('now'), datetime('now'));

        INSERT INTO vehicle_carriers (id, vehicle_id, carrier_id, is_active, created_at, updated_at)
        VALUES ('vc-1', 'vehicle-1', 'local-carrier', 1, datetime('now'), datetime('now'));

        INSERT INTO driver_carriers (id, driver_id, carrier_id, is_active, created_at, updated_at)
        VALUES ('dc-1', 'driver-1', 'local-carrier', 1, datetime('now'), datetime('now'));
      `);

      const service = new OmieSyncService(createMockClient(), db);
      vi.spyOn(
        (service as unknown as Record<string, unknown>).customersService as { listAll: () => Promise<unknown[]> },
        "listAll"
      ).mockResolvedValue([
        {
          id: 101,
          name: "Cliente Tag Ltda",
          tradeName: "Cliente Tag",
          document: "11111111000191",
          email: "cliente@example.com",
          zipcode: "01001000",
          addressStreet: "Rua Cliente",
          neighborhood: "Centro",
          city: "Sao Paulo",
          state: "SP",
          isActive: true,
          tags: { tags: ["Cliente"] }
        },
        {
          id: 202,
          name: "Transportadora Tag Ltda",
          document: "22222222000182",
          email: "transportadora@example.com",
          zipcode: "02002000",
          addressStreet: "Rua Transportadora",
          neighborhood: "Industrial",
          city: "Campinas",
          state: "SP",
          isActive: true,
          tags: { tags: ["Transportadora"] }
        },
        {
          id: 303,
          name: "Cliente e Transportadora Ltda",
          document: "33333333000173",
          city: "Sorocaba",
          state: "SP",
          isActive: true,
          tags: { tags: ["Cliente", "Transportadora"] }
        },
        {
          id: 404,
          name: "Fornecedor Sem Tag Ltda",
          isActive: true,
          tags: { tags: ["Fornecedor"] }
        },
      ]);
      const result = await service.rebuildCustomersAndCarriersFromOmie("company-1");

      expect(result).toEqual({ customersPulled: 2, suppliersSynced: 2 });
      // 2 clientes OMIE (101, 303) + 1 cliente local preservado.
      expect(
        db.prepare("SELECT COUNT(*) FROM customers WHERE company_id = ? AND deleted_at IS NULL").pluck().get("company-1")
      ).toBe(3);
      // 2 transportadoras OMIE (202, 303) + 1 transportadora local preservada.
      expect(
        db.prepare("SELECT COUNT(*) FROM carriers WHERE company_id = ? AND deleted_at IS NULL").pluck().get("company-1")
      ).toBe(3);
      // Registros locais NAO sao apagados na reconciliacao.
      expect(db.prepare("SELECT deleted_at IS NOT NULL FROM customers WHERE id = 'local-customer'").pluck().get()).toBe(0);
      expect(db.prepare("SELECT deleted_at IS NOT NULL FROM carriers WHERE id = 'local-carrier'").pluck().get()).toBe(0);
      // Relacoes de uma transportadora local sao preservadas (nao apontam para transportadora OMIE removida).
      expect(db.prepare("SELECT carrier_id FROM vehicles WHERE id = 'vehicle-1'").pluck().get()).toBe("local-carrier");
      expect(db.prepare("SELECT deleted_at IS NOT NULL FROM customer_carriers WHERE id = 'cc-1'").pluck().get()).toBe(0);
      expect(db.prepare("SELECT deleted_at IS NOT NULL FROM vehicle_carriers WHERE id = 'vc-1'").pluck().get()).toBe(0);
      expect(db.prepare("SELECT deleted_at IS NOT NULL FROM driver_carriers WHERE id = 'dc-1'").pluck().get()).toBe(0);
      expect(
        db.prepare("SELECT email FROM customers WHERE id = 'omie_101' AND deleted_at IS NULL").pluck().get()
      ).toBe("cliente@example.com");
      expect(
        db.prepare("SELECT city FROM carriers WHERE id = 'omie_supplier_202' AND deleted_at IS NULL").pluck().get()
      ).toBe("Campinas");
      expect(db.prepare("SELECT id FROM customers WHERE id = 'omie_303' AND deleted_at IS NULL").pluck().get()).toBe("omie_303");
      expect(
        db.prepare("SELECT id FROM carriers WHERE id = 'omie_supplier_303' AND deleted_at IS NULL").pluck().get()
      ).toBe("omie_supplier_303");
      expect(db.prepare("SELECT id FROM customers WHERE id = 'omie_404' AND deleted_at IS NULL").get()).toBeUndefined();
      expect(db.prepare("SELECT id FROM carriers WHERE id = 'omie_supplier_404' AND deleted_at IS NULL").get()).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("pushes local carriers to OMIE as tagged customers and deduplicates by document", async () => {
    const db = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(db);
      db.exec(`
        INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
        VALUES ('company-1', 'Empresa Teste', 'Empresa', datetime('now'), datetime('now'));

        INSERT INTO carriers (
          id, company_id, name, document, source, sync_status, needs_push, is_active, created_at, updated_at
        ) VALUES (
          'carrier-1', 'company-1', 'Transportadora Local', '22222222000182', 'local', 'pending', 1, 1, datetime('now'), datetime('now')
        );
      `);

      const service = new OmieSyncService(createMockClient(), db);
      const customersService = (service as unknown as Record<string, unknown>).customersService as {
        listAll: () => Promise<unknown[]>;
        update: (input: unknown) => Promise<void>;
      };
      const listAll = vi.spyOn(customersService, "listAll").mockResolvedValue([
        {
          id: 654,
          name: "Transportadora OMIE",
          document: "22222222000182",
          isActive: true,
          tags: { tags: ["transportadora"] }
        }
      ]);
      const update = vi.spyOn(customersService, "update").mockResolvedValue(undefined);

      const pushed = await service.pushCarriersToOmie("company-1");

      expect(pushed).toBe(1);
      expect(listAll).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          codigoClienteOmie: 654,
          razaoSocial: "Transportadora Local",
          tags: [{ tag: "transportadora" }]
        })
      );
      expect(db.prepare("SELECT omie_customer_id FROM carriers WHERE id = 'carrier-1'").pluck().get()).toBe(654);
      expect(db.prepare("SELECT needs_push FROM carriers WHERE id = 'carrier-1'").pluck().get()).toBe(0);
    } finally {
      db.close();
    }
  });

  it("removes non-sellable products from KyberRock during OMIE sync", async () => {
    const db = createMockDb();
    const client = createMockClient();

    const service = new OmieSyncService(client, db);

    vi.spyOn((service as unknown as Record<string, unknown>).productsService as unknown as { listAll: () => Promise<unknown[]> }, "listAll").mockResolvedValue([
      {
        id: 457,
        description: "Produto nao acabado",
        code: "INSUMO",
        unit: "UN",
        itemType: "01",
        isActive: true,
        blocked: false
      }
    ]);

    const count = await service.syncProducts("company-1");

    expect(count).toBe(0);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("UPDATE products"));
  });

  it("no longer imports payment terms from OMIE (now managed locally)", async () => {
    const db = createMockDb();
    const client = createMockClient();

    const service = new OmieSyncService(client, db);

    const count = await service.syncPaymentTerms();

    expect(count).toBe(0);
    expect(db.prepare).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO payment_terms")
    );
  });

  it("pulls payment methods from OMIE adopting seeds and inserting new ones idempotently", async () => {
    const db = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(db);
      db.exec(`
        INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
        VALUES ('company-1', 'Empresa Teste', 'Empresa', datetime('now'), datetime('now'));
      `);
      ensureDefaultPaymentMethods(db, "company-1");
      // Simula vinculo local existente para garantir que o adote preserva campos locais.
      db.exec(`
        UPDATE payment_methods SET alias = 'PIX rapidinho' WHERE company_id = 'company-1' AND code = 'pix';
      `);

      const service = new OmieSyncService(createMockClient(), db);
      const listAll = vi
        .spyOn(
          (service as unknown as Record<string, unknown>)
            .paymentMethodsService as { listAll: () => Promise<unknown[]> },
          "listAll"
        )
        .mockResolvedValue([
          { code: "01", description: "Dinheiro", type: null },
          { code: "17", description: "PIX", type: null },
          { code: "90", description: "Sem pagamento", type: null }
        ]);

      const first = await service.syncPaymentMethods("company-1");

      // "cash"/"pix" ja vem com os codigos padrao (01/17) do seed -> ja presentes (skipped);
      // "90" entra como forma nova do OMIE.
      expect(first).toEqual({ fetched: 3, created: 1, updated: 0, skipped: 2 });
      expect(
        db.prepare(
          "SELECT omie_code FROM payment_methods WHERE company_id = 'company-1' AND code = 'cash'"
        ).pluck().get()
      ).toBe("01");
      expect(
        db.prepare(
          "SELECT alias FROM payment_methods WHERE company_id = 'company-1' AND code = 'pix'"
        ).pluck().get()
      ).toBe("PIX rapidinho");
      expect(
        db.prepare(
          "SELECT name FROM payment_methods WHERE company_id = 'company-1' AND omie_code = '90'"
        ).pluck().get()
      ).toBe("Sem pagamento");

      const countAfterFirst = db
        .prepare("SELECT COUNT(*) FROM payment_methods WHERE company_id = 'company-1'")
        .pluck()
        .get();

      // Segunda sincronizacao: nada acontece (idempotente).
      const second = await service.syncPaymentMethods("company-1");
      expect(second).toEqual({ fetched: 3, created: 0, updated: 0, skipped: 3 });
      expect(
        db.prepare("SELECT COUNT(*) FROM payment_methods WHERE company_id = 'company-1'").pluck().get()
      ).toBe(countAfterFirst);
      expect(listAll).toHaveBeenCalledTimes(2);
    } finally {
      db.close();
    }
  });

  it("pulls payment conditions from OMIE into the omie_payment_terms mirror without duplicating", async () => {
    const db = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(db);
      db.exec(`
        INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
        VALUES ('company-1', 'Empresa Teste', 'Empresa', datetime('now'), datetime('now'));
      `);

      const service = new OmieSyncService(createMockClient(), db);
      vi.spyOn(
        (service as unknown as Record<string, unknown>)
          .parcelasService as { listAll: () => Promise<unknown[]> },
        "listAll"
      ).mockResolvedValue([
        {
          id: 0,
          code: "000",
          description: "A Vista",
          firstInstallmentDays: 0,
          installmentIntervalDays: null,
          installmentCount: 1,
          installmentType: null,
          installmentDays: null,
          isActive: true,
          visible: true
        },
        {
          id: 212,
          code: "212",
          description: "7/14/21",
          firstInstallmentDays: 7,
          installmentIntervalDays: 7,
          installmentCount: 3,
          installmentType: null,
          installmentDays: [7, 14, 21],
          isActive: true,
          visible: true
        }
      ]);

      const first = await service.syncPaymentConditions("company-1");
      expect(first.fetched).toBe(2);
      expect(
        db.prepare("SELECT COUNT(*) FROM omie_payment_terms WHERE company_id = 'company-1'").pluck().get()
      ).toBe(2);
      expect(
        db
          .prepare("SELECT installment_days_json FROM omie_payment_terms WHERE code = '212'")
          .pluck()
          .get()
      ).toBe("[7,14,21]");

      // Re-sincronizar nao duplica (upsert por company_id + code).
      await service.syncPaymentConditions("company-1");
      expect(
        db.prepare("SELECT COUNT(*) FROM omie_payment_terms WHERE company_id = 'company-1'").pluck().get()
      ).toBe(2);
    } finally {
      db.close();
    }
  });

  it("pulls checking accounts from OMIE adopting same-name locals and skipping existing codes", async () => {
    const db = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(db);
      db.exec(`
        INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
        VALUES ('company-1', 'Empresa Teste', 'Empresa', datetime('now'), datetime('now'));
      `);
      ensureDefaultAccounts(db, "company-1");

      const service = new OmieSyncService(createMockClient(), db);
      vi.spyOn(
        (service as unknown as Record<string, unknown>)
          .checkingAccountsService as { listAll: () => Promise<unknown[]> },
        "listAll"
      ).mockResolvedValue([
        { code: 111, integrationCode: null, name: "caixinha", type: null, isActive: true },
        { code: 222, integrationCode: null, name: "Home Cash", type: null, isActive: true }
      ]);

      const first = await service.syncCheckingAccounts("company-1");

      // "Caixinha" (seed) adota o codigo por nome; "Home Cash" entra como conta nova.
      expect(first).toEqual({ fetched: 2, created: 1, updated: 1, skipped: 0 });
      expect(
        db.prepare(
          "SELECT omie_code FROM accounts WHERE company_id = 'company-1' AND code = 'caixinha'"
        ).pluck().get()
      ).toBe("111");
      expect(
        db.prepare(
          "SELECT name FROM accounts WHERE company_id = 'company-1' AND omie_code = '222'"
        ).pluck().get()
      ).toBe("Home Cash");

      const second = await service.syncCheckingAccounts("company-1");
      expect(second).toEqual({ fetched: 2, created: 0, updated: 0, skipped: 2 });
      expect(
        db.prepare(
          "SELECT COUNT(*) FROM accounts WHERE company_id = 'company-1' AND deleted_at IS NULL"
        ).pluck().get()
      ).toBe(4); // caixinha, omie_cash, getnet + Home Cash
    } finally {
      db.close();
    }
  });

  it("syncAll returns counts and collects errors", async () => {
    const db = createMockDb();
    const client = createMockClient();

    const service = new OmieSyncService(client, db);

    vi.spyOn(service, "rebuildCustomersAndCarriersFromOmie").mockResolvedValue({
      customersPulled: 5,
      suppliersSynced: 4
    });
    vi.spyOn(service, "syncProducts").mockRejectedValue(new Error("API error"));
    vi.spyOn(service, "syncPaymentTerms").mockResolvedValue(3);

    const result = await service.syncAll("company-1");

    expect(result.customersPulled).toBe(5);
    expect(result.customersPushed).toBe(0);
    expect(result.productsSynced).toBe(0);
    expect(result.paymentTermsSynced).toBe(3);
    expect(result.suppliersSynced).toBe(4);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Produtos");
  });
});
