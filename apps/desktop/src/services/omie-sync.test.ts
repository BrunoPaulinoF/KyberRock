import { describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate.js";
import { openDesktopDatabase } from "../database/sqlite.js";
import type { DesktopDatabase } from "../database/sqlite.js";
import type { OmieClient } from "@kyberrock/omie-client";
import {
  createOmieClient,
  OmieSyncService
} from "./omie-sync";

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

  it("rebuilds customers and carriers from ListarClientes tags after clearing local registrations", async () => {
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
      expect(
        db.prepare("SELECT COUNT(*) FROM customers WHERE company_id = ? AND deleted_at IS NULL").pluck().get("company-1")
      ).toBe(2);
      expect(
        db.prepare("SELECT COUNT(*) FROM carriers WHERE company_id = ? AND deleted_at IS NULL").pluck().get("company-1")
      ).toBe(2);
      expect(db.prepare("SELECT deleted_at IS NOT NULL FROM customers WHERE id = 'local-customer'").pluck().get()).toBe(1);
      expect(db.prepare("SELECT deleted_at IS NOT NULL FROM carriers WHERE id = 'local-carrier'").pluck().get()).toBe(1);
      expect(db.prepare("SELECT carrier_id FROM vehicles WHERE id = 'vehicle-1'").pluck().get()).toBeNull();
      expect(db.prepare("SELECT deleted_at IS NOT NULL FROM customer_carriers WHERE id = 'cc-1'").pluck().get()).toBe(1);
      expect(db.prepare("SELECT deleted_at IS NOT NULL FROM vehicle_carriers WHERE id = 'vc-1'").pluck().get()).toBe(1);
      expect(db.prepare("SELECT deleted_at IS NOT NULL FROM driver_carriers WHERE id = 'dc-1'").pluck().get()).toBe(1);
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
