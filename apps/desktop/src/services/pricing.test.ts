import { describe, expect, it, vi } from "vitest";

import type { DesktopDatabase } from "../database/sqlite.js";
import { PricingService } from "./pricing";

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
