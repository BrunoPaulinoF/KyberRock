import { describe, expect, it } from "vitest";

import {
  FreightCalculator,
  FREIGHT_MODALITIES,
  freightModalityOmieCode,
  getFreightModalityInfo,
  isFreightModality,
  type FreightRule
} from "./freight";

describe("FreightCalculator", () => {
  const baseRule: FreightRule = {
    id: "rule-1",
    name: "Frete por Tonelada",
    type: "per_ton",
    baseValueCents: 1000, // R$ 10,00 por tonelada
    minValueCents: 5000, // R$ 50,00 mínimo
    unit: "ton"
  };

  it("calculates freight per ton", () => {
    const calculator = new FreightCalculator();

    // 15 toneladas a R$ 10,00/ton = R$ 150,00
    const result = calculator.calculate(15000, baseRule);

    expect(result).toBe(15000); // 150,00 em centavos
  });

  it("applies minimum value when freight is too low", () => {
    const calculator = new FreightCalculator();

    // 2 toneladas a R$ 10,00/ton = R$ 20,00 (abaixo do mínimo de R$ 50,00)
    const result = calculator.calculate(2000, baseRule);

    expect(result).toBe(5000); // R$ 50,00 mínimo
  });

  it("calculates freight per ton-km", () => {
    const calculator = new FreightCalculator();

    const rule: FreightRule = {
      ...baseRule,
      type: "per_ton_km",
      baseValueCents: 50, // R$ 0,50 por ton.km
      distanceKm: 100 // 100 km
    };

    // 15 ton * 100 km * R$ 0,50 = 1500 ton.km * R$ 0,50 = R$ 750,00
    const result = calculator.calculate(15000, rule);

    expect(result).toBe(75000);
  });

  it("calculates fixed + per ton freight", () => {
    const calculator = new FreightCalculator();

    const rule: FreightRule = {
      ...baseRule,
      type: "fixed_plus_ton",
      baseValueCents: 1000, // R$ 10,00 por tonelada
      fixedValueCents: 15000 // R$ 150,00 fixo por viagem
    };

    // R$ 150,00 + (15 ton * R$ 10,00) = R$ 300,00
    const result = calculator.calculate(15000, rule);

    expect(result).toBe(30000);
  });

  it("calculates freight by distance range", () => {
    const calculator = new FreightCalculator();

    const rule: FreightRule = {
      ...baseRule,
      type: "distance_range",
      distanceKm: 120,
      ranges: [
        { maxKm: 50, valueCents: 8000 },   // até 50km: R$ 80,00
        { maxKm: 100, valueCents: 12000 }, // 51-100km: R$ 120,00
        { maxKm: 200, valueCents: 18000 }  // 101-200km: R$ 180,00
      ]
    };

    // 120 km cai na faixa 101-200km = R$ 180,00
    const result = calculator.calculate(15000, rule);

    expect(result).toBe(18000);
  });

  it("returns zero when weight is zero", () => {
    const calculator = new FreightCalculator();

    const result = calculator.calculate(0, baseRule);

    expect(result).toBe(0);
  });

  it("allows freight modification after exit with audit trail", () => {
    const calculator = new FreightCalculator();

    const original = calculator.calculate(15000, baseRule);
    expect(original).toBe(15000);

    // Simula alteração pós-saída
    const newFreight = calculator.recalculateAfterExit(15000, baseRule, 1200); // R$ 12,00/ton
    expect(newFreight).toBe(18000); // 15 ton * R$ 12,00 = R$ 180,00
  });
});

describe("freight modalities", () => {
  it("maps each modality to the OMIE modalidade code (modFrete)", () => {
    expect(freightModalityOmieCode("cif")).toBe("0");
    expect(freightModalityOmieCode("fob")).toBe("1");
    expect(freightModalityOmieCode("third_party")).toBe("2");
    expect(freightModalityOmieCode("own_sender")).toBe("3");
    expect(freightModalityOmieCode("own_recipient")).toBe("4");
    expect(freightModalityOmieCode("none")).toBe("9");
  });

  it("falls back to sem frete (9) for unknown or missing modalities", () => {
    expect(freightModalityOmieCode(null)).toBe("9");
    expect(freightModalityOmieCode(undefined)).toBe("9");
    expect(freightModalityOmieCode("bogus")).toBe("9");
    expect(getFreightModalityInfo("bogus").key).toBe("none");
  });

  it("marks only the client's own transport as not using the Pedreira carrier", () => {
    const withoutCarrier = FREIGHT_MODALITIES.filter((modality) => !modality.usesCarrier);
    expect(withoutCarrier.map((modality) => modality.key)).toEqual(["own_recipient"]);
  });

  it("supports a freight charge only on billable modalities", () => {
    const chargeable = FREIGHT_MODALITIES.filter((modality) => modality.supportsCharge).map(
      (modality) => modality.key
    );
    expect(chargeable).toEqual(["cif", "fob", "third_party", "own_sender"]);
  });

  it("validates modality keys", () => {
    expect(isFreightModality("cif")).toBe(true);
    expect(isFreightModality("nope")).toBe(false);
    expect(isFreightModality(42)).toBe(false);
  });
});
