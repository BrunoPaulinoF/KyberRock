import { describe, expect, it } from "vitest";

import { buildClosingTotalPreview } from "./closing-total";

function freightJson(rule: Record<string, unknown>): string {
  return JSON.stringify({ payer: "customer", rule, destination: null, showOnReceipt: true });
}

describe("buildClosingTotalPreview", () => {
  it("multiplica o peso liquido em toneladas pelo preco do cliente", () => {
    const preview = buildClosingTotalPreview({
      netWeightKg: 22_910,
      unitPriceCents: 8195,
      freightJson: null,
      freightModality: "third_party"
    });

    // 22,910 t x R$ 81,95 = R$ 1.877,47
    expect(preview.productTotalCents).toBe(187_747);
    expect(preview.freightTotalCents).toBe(0);
    expect(preview.totalCents).toBe(187_747);
    expect(preview.freightPending).toBe(false);
    expect(preview.freightError).toBeNull();
  });

  it("soma o frete por tonelada gravado na operacao", () => {
    const preview = buildClosingTotalPreview({
      netWeightKg: 20_000,
      unitPriceCents: 10_000,
      freightJson: freightJson({
        id: "f1",
        name: "Frete",
        type: "per_ton",
        baseValueCents: 2500,
        unit: "ton"
      }),
      freightModality: "fob"
    });

    expect(preview.productTotalCents).toBe(200_000);
    expect(preview.freightTotalCents).toBe(50_000);
    expect(preview.totalCents).toBe(250_000);
  });

  it("sem preco lancado nao inventa total", () => {
    const preview = buildClosingTotalPreview({
      netWeightKg: 20_000,
      unitPriceCents: null,
      freightJson: freightJson({
        id: "f1",
        name: "Frete",
        type: "per_ton",
        baseValueCents: 2500,
        unit: "ton"
      }),
      freightModality: "fob"
    });

    expect(preview.productTotalCents).toBeNull();
    expect(preview.totalCents).toBeNull();
    expect(preview.freightTotalCents).toBe(50_000);
  });

  it("avisa quando a operacao e com frete mas a regra nao esta gravada", () => {
    const preview = buildClosingTotalPreview({
      netWeightKg: 20_000,
      unitPriceCents: 10_000,
      freightJson: null,
      freightModality: "fob"
    });

    expect(preview.freightPending).toBe(true);
    expect(preview.freightTotalCents).toBe(0);
    expect(preview.totalCents).toBe(200_000);
  });

  it("regra de frete invalida nao derruba a previa do produto", () => {
    const preview = buildClosingTotalPreview({
      netWeightKg: 20_000,
      unitPriceCents: 10_000,
      freightJson: "{nao e json",
      freightModality: "fob"
    });

    expect(preview.freightError).not.toBeNull();
    expect(preview.freightTotalCents).toBe(0);
    expect(preview.productTotalCents).toBe(200_000);
  });
});
