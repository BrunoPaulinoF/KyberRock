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

  it("calculates price from price table for customer and product", () => {
    const db = createMockDb();
    const service = new PricingService(db);

    const mockGet = vi.fn().mockReturnValue({
      unit_price_cents: 15000 // R$ 150,00
    });

    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      get: mockGet,
      all: vi.fn().mockReturnValue([]),
      run: vi.fn()
    });

    const price = service.getPriceForCustomerProduct("customer-1", "product-1");

    expect(price).toBe(15000);
    expect(db.prepare).toHaveBeenCalled();
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
    const total = service.calculateTotal(6500, 15000); // kg, cents per kg

    expect(total).toBe(97500); // R$ 975,00 em centavos
  });

  it("returns zero when weight or price is zero", () => {
    const db = createMockDb();
    const service = new PricingService(db);

    expect(service.calculateTotal(0, 15000)).toBe(0);
    expect(service.calculateTotal(6500, 0)).toBe(0);
  });
});
