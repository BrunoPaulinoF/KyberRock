import { describe, expect, it } from "vitest";

import { creditMovementSignedCents, filterCarriersBySearch } from "./CustomersView";

describe("customer carrier search", () => {
  const carriers = [
    { id: "1", name: "Transportadora São João" },
    { id: "2", name: "TRANSPORTES ALFA" },
    { id: "3", name: "Cliente Teste (padrão)" }
  ];

  it("returns every carrier when the search is empty", () => {
    expect(filterCarriersBySearch(carriers, "")).toHaveLength(3);
    expect(filterCarriersBySearch(carriers, "   ")).toHaveLength(3);
  });

  it("matches ignoring case and accents", () => {
    expect(filterCarriersBySearch(carriers, "sao joao").map((c) => c.id)).toEqual(["1"]);
    expect(filterCarriersBySearch(carriers, "alfa").map((c) => c.id)).toEqual(["2"]);
    expect(filterCarriersBySearch(carriers, "transport").map((c) => c.id)).toEqual(["1", "2"]);
  });

  it("returns nothing when no carrier matches", () => {
    expect(filterCarriersBySearch(carriers, "inexistente")).toEqual([]);
  });
});

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
