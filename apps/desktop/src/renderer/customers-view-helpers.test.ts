import { describe, expect, it } from "vitest";

import { creditMovementSignedCents, toCustomerFreightEntries } from "./CustomersView";
import type { CustomerFreightRule } from "../services/customer-freight-rules";

describe("credit statement amounts", () => {
  it("shows sales as negative and payments as positive", () => {
    expect(creditMovementSignedCents({ movement_type: "debit_product", amount_cents: 7_800 })).toBe(
      -7_800
    );
    expect(creditMovementSignedCents({ movement_type: "debit_freight", amount_cents: 6_500 })).toBe(
      -6_500
    );
    expect(creditMovementSignedCents({ movement_type: "credit", amount_cents: 7_800 })).toBe(7_800);
    expect(
      creditMovementSignedCents({ movement_type: "refund_product", amount_cents: 7_800 })
    ).toBe(7_800);
    expect(
      creditMovementSignedCents({ movement_type: "manual_adjustment", amount_cents: -500 })
    ).toBe(-500);
  });
});

describe("lista de fretes do cliente", () => {
  function rule(overrides: Partial<CustomerFreightRule>): CustomerFreightRule {
    return {
      id: "rule-1",
      customerId: "customer-1",
      productId: null,
      productDescription: null,
      rule: { id: "r", name: "Frete", type: "per_ton", baseValueCents: 0, unit: "ton" },
      modalities: {},
      isActive: true,
      createdAt: "",
      updatedAt: "",
      ...overrides
    };
  }

  it("lista uma linha por tipo de frete, marcando o que veio da ultima venda", () => {
    const entries = toCustomerFreightEntries([
      rule({
        modalities: {
          fob: {
            type: "per_ton",
            baseValueCents: 9_000,
            source: "manual",
            updatedAt: "2026-07-01T00:00:00.000Z"
          },
          cif: {
            type: "per_ton",
            baseValueCents: 12_000,
            source: "last_used",
            updatedAt: "2026-07-02T00:00:00.000Z"
          }
        }
      })
    ]);

    expect(entries.map((entry) => [entry.modality, entry.baseValueCents, entry.source])).toEqual([
      ["fob", 9_000, "manual"],
      ["cif", 12_000, "last_used"]
    ]);
    expect(entries[0].modalityLabel).toBe("Valor na nota");
    expect(entries[0].scopeLabel).toBe("Frete fixo");
  });

  it("mantem a regra unica antiga na lista e ignora a regra so com valores por tipo", () => {
    const legacy = toCustomerFreightEntries([
      rule({
        productId: "product-1",
        productDescription: "Brita 1",
        rule: { id: "r", name: "Frete", type: "per_ton", baseValueCents: 5_000, unit: "ton" }
      })
    ]);
    expect(legacy).toEqual([
      {
        ruleId: "rule-1",
        modalityLabel: "Qualquer tipo",
        scopeLabel: "Brita 1",
        baseValueCents: 5_000,
        source: "manual"
      }
    ]);

    expect(toCustomerFreightEntries([rule({})])).toEqual([]);
  });
});
