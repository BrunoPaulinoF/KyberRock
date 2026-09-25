import { describe, expect, it, vi } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import { PricingService } from "./pricing";
import { createSimulatedWeighingOperation } from "./weighing-operations";

describe("PricingService", () => {
  function createMockDb(): DesktopDatabase {
    return {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn(),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn()
      })
    } as unknown as DesktopDatabase;
  }

  it("uses the product default price when no special price exists", () => {
    const db = createMockDb();
    const service = new PricingService(db);

    const mockGet = vi
      .fn()
      .mockReturnValueOnce({ id: "product-1", unit_price_cents: null })
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ id: "default-price-1", unit_price_cents: 15000 });

    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      get: mockGet,
      all: vi.fn().mockReturnValue([]),
      run: vi.fn()
    });

    const price = service.getPriceForCustomerProduct("customer-1", "product-1");

    expect(price).toBe(15000);
    expect(db.prepare).toHaveBeenCalled();
  });

  it("uses the customer special price before the product default price", () => {
    const db = createMockDb();
    const service = new PricingService(db);

    const mockGet = vi
      .fn()
      .mockReturnValueOnce({ id: "product-1", unit_price_cents: null })
      .mockReturnValueOnce({ id: "special-price-1", unit_price_cents: 12000 })
      .mockReturnValueOnce({ id: "default-price-1", unit_price_cents: 15000 });

    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      get: mockGet,
      all: vi.fn().mockReturnValue([]),
      run: vi.fn()
    });

    const details = service.getPriceDetailsForCustomerProduct("customer-1", "product-1");

    expect(details).toMatchObject({
      appliedUnitPriceCents: 12000,
      baseUnitPriceCents: 15000,
      source: "special",
      savingsPercent: 20
    });
  });

  it("returns null when no price table is found", () => {
    const db = createMockDb();
    const service = new PricingService(db);

    const mockGet = vi.fn().mockReturnValue(null);

    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      get: mockGet,
      all: vi.fn().mockReturnValue([]),
      run: vi.fn()
    });

    const price = service.getPriceForCustomerProduct("customer-1", "product-1");

    expect(price).toBeNull();
  });

  it("calculates total from net weight and unit price", () => {
    const db = createMockDb();
    const service = new PricingService(db);

    // 6.5 toneladas a R$ 150,00/ton = R$ 975,00
    const total = service.calculateTotal(6500, 15000); // kg, cents per ton

    expect(total).toBe(97500); // R$ 975,00 em centavos
  });

  it("returns zero when weight or price is zero", () => {
    const db = createMockDb();
    const service = new PricingService(db);

    expect(service.calculateTotal(0, 15000)).toBe(0);
    expect(service.calculateTotal(6500, 0)).toBe(0);
  });
});

describe("PricingService: a ultima operacao vem antes do cadastro", () => {
  function createDatabase(): DesktopDatabase {
    const database = openDesktopDatabase({ databasePath: ":memory:" });
    runDesktopMigrations(database);
    return database;
  }

  function seedLastOperation(database: DesktopDatabase) {
    const identity = ensureInitialDesktopIdentity(database, {
      companyId: "company-1",
      companyLegalName: "KyberRock Mineracao LTDA",
      unitId: "unit-1",
      unitName: "Pedreira Principal",
      deviceId: "device-1",
      deviceName: "PC Balanca",
      installationId: "install-1"
    });
    const operation = createSimulatedWeighingOperation(database, {
      identity,
      customerName: "Cliente Teste",
      plate: "ABC1D23",
      driverName: "Motorista Teste",
      productDescription: "Brita 1",
      unitPriceCents: 12_000,
      entryWeightKg: 12_000
    });
    const row = database
      .prepare("SELECT customer_id, product_id FROM weighing_operations WHERE id = ?")
      .get(operation.id) as { customer_id: string; product_id: string };
    // O cadastro diz outra coisa: preco especial de R$ 90,00 e padrao de R$ 100,00.
    database
      .prepare(
        `INSERT INTO customer_special_prices
           (id, company_id, customer_id, product_id, unit_price_cents, is_active, created_at, updated_at)
         VALUES ('special-1', 'company-1', ?, ?, 9000, 1, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`
      )
      .run(row.customer_id, row.product_id);
    database
      .prepare("UPDATE products SET unit_price_cents = 10000 WHERE id = ?")
      .run(row.product_id);
    return { operationId: operation.id, customerId: row.customer_id, productId: row.product_id };
  }

  it("usa o preco da ultima operacao do cliente com o produto, mesmo com preco cadastrado", () => {
    const database = createDatabase();
    try {
      const seeded = seedLastOperation(database);
      const details = new PricingService(database).getPriceDetailsForCustomerProduct(
        seeded.customerId,
        seeded.productId
      );
      expect(details).toMatchObject({
        appliedUnitPriceCents: 12_000,
        source: "last_used",
        lastOperationId: seeded.operationId,
        baseUnitPriceCents: 10_000
      });
    } finally {
      database.close();
    }
  });

  it("sem operacao anterior (ou so cancelada, ou a propria), vale o cadastro", () => {
    const database = createDatabase();
    try {
      const seeded = seedLastOperation(database);
      const service = new PricingService(database);
      // A operacao que esta sendo corrigida nao conta como "ultima".
      expect(
        service.getPriceDetailsForCustomerProduct(seeded.customerId, seeded.productId, {
          excludeOperationId: seeded.operationId
        })
      ).toMatchObject({ appliedUnitPriceCents: 9000, source: "special", lastOperationId: null });
      database
        .prepare("UPDATE weighing_operations SET status = 'cancelled' WHERE id = ?")
        .run(seeded.operationId);
      expect(
        service.getPriceDetailsForCustomerProduct(seeded.customerId, seeded.productId)
      ).toMatchObject({ appliedUnitPriceCents: 9000, source: "special" });
    } finally {
      database.close();
    }
  });
});
