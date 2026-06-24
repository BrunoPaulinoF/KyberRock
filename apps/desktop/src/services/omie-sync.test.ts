import { describe, expect, it, vi } from "vitest";

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
      })
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
        phone: "(11) 99999-9999"
      }
    ]);

     
    vi.spyOn((service as unknown as Record<string, unknown>).receivablesService as unknown as { getTotalOpenAmountForClient: () => Promise<number> }, "getTotalOpenAmountForClient").mockResolvedValue(500);

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

  it("removes non-finished products from KyberRock during OMIE sync", async () => {
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

  it("syncs payment terms from OMIE to local database", async () => {
    const db = createMockDb();
    const client = createMockClient();

    const service = new OmieSyncService(client, db);

     
    vi.spyOn((service as unknown as Record<string, unknown>).paymentTermsService as unknown as { listAll: () => Promise<unknown[]> }, "listAll").mockResolvedValue([
      {
        id: 789,
        description: "30/60/90 dias"
      }
    ]);

    const count = await service.syncPaymentTerms("company-1");

    expect(count).toBe(1);
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO payment_terms"));
  });

  it("syncAll returns counts and collects errors", async () => {
    const db = createMockDb();
    const client = createMockClient();

    const service = new OmieSyncService(client, db);

    vi.spyOn(service, "syncCustomersBidirectional").mockResolvedValue({ pulled: 5, pushed: 2 });
    vi.spyOn(service, "syncProducts").mockRejectedValue(new Error("API error"));
    vi.spyOn(service, "syncPaymentTerms").mockResolvedValue(3);
    vi.spyOn(service, "syncSuppliers").mockResolvedValue(4);

    const result = await service.syncAll("company-1");

    expect(result.customersPulled).toBe(5);
    expect(result.customersPushed).toBe(2);
    expect(result.productsSynced).toBe(0);
    expect(result.paymentTermsSynced).toBe(3);
    expect(result.suppliersSynced).toBe(4);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Produtos");
  });
});
