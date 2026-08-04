import { describe, expect, it } from "vitest";

import {
  FreightCalculator,
  FREIGHT_CARRIER_ONLY,
  FREIGHT_MODALITIES,
  FREIGHT_MODALITY_DEFAULT,
  FREIGHT_MODALITY_NONE,
  FREIGHT_VALUE_INTERNAL_ONLY,
  FREIGHT_VALUE_ON_INVOICE,
  freightCarrierGoesToInvoice,
  freightModalityLookupKeys,
  freightModalityOmieCode,
  freightValueGoesToInvoice,
  getFreightModalityInfo,
  isFreightModality,
  isFreightModalityWithFreight,
  normalizeFreightModality,
  resolveFreightModality,
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
        { maxKm: 50, valueCents: 8000 }, // até 50km: R$ 80,00
        { maxKm: 100, valueCents: 12000 }, // 51-100km: R$ 120,00
        { maxKm: 200, valueCents: 18000 } // 101-200km: R$ 180,00
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
  it("maps the four situations to the OMIE modalidade code (modFrete)", () => {
    // As tres situacoes com transportador na nota sao FOB "1"; so "sem ocorrencia" e "9".
    expect(freightModalityOmieCode(FREIGHT_VALUE_ON_INVOICE)).toBe("1");
    expect(freightModalityOmieCode(FREIGHT_VALUE_INTERNAL_ONLY)).toBe("1");
    expect(freightModalityOmieCode(FREIGHT_CARRIER_ONLY)).toBe("1");
    expect(freightModalityOmieCode(FREIGHT_MODALITY_NONE)).toBe("9");
    // Transporte proprio legado mantem o codigo dele.
    expect(freightModalityOmieCode("own_sender")).toBe("3");
    expect(freightModalityOmieCode("own_recipient")).toBe("4");
  });

  it("falls back to sem frete (9) for unknown or missing modalities", () => {
    expect(freightModalityOmieCode(null)).toBe("9");
    expect(freightModalityOmieCode(undefined)).toBe("9");
    expect(freightModalityOmieCode("bogus")).toBe("9");
    expect(getFreightModalityInfo("bogus").key).toBe("none");
  });

  it("offers the four situations grouped in com frete / sem frete", () => {
    expect(FREIGHT_MODALITIES.map((modality) => modality.key)).toEqual([
      FREIGHT_VALUE_ON_INVOICE,
      FREIGHT_VALUE_INTERNAL_ONLY,
      FREIGHT_CARRIER_ONLY,
      FREIGHT_MODALITY_NONE
    ]);
    expect(FREIGHT_MODALITIES.map((modality) => modality.group)).toEqual([
      "with_freight",
      "with_freight",
      "without_freight",
      "without_freight"
    ]);
  });

  it("puts the freight value on the invoice only in situation 1", () => {
    expect(freightValueGoesToInvoice(FREIGHT_VALUE_ON_INVOICE)).toBe(true);
    expect(freightValueGoesToInvoice(FREIGHT_VALUE_INTERNAL_ONLY)).toBe(false);
    expect(freightValueGoesToInvoice(FREIGHT_CARRIER_ONLY)).toBe(false);
    expect(freightValueGoesToInvoice(FREIGHT_MODALITY_NONE)).toBe(false);
  });

  it("keeps the carrier out of the invoice only in situation 4", () => {
    expect(freightCarrierGoesToInvoice(FREIGHT_VALUE_ON_INVOICE)).toBe(true);
    expect(freightCarrierGoesToInvoice(FREIGHT_VALUE_INTERNAL_ONLY)).toBe(true);
    expect(freightCarrierGoesToInvoice(FREIGHT_CARRIER_ONLY)).toBe(true);
    expect(freightCarrierGoesToInvoice(FREIGHT_MODALITY_NONE)).toBe(false);
  });

  it("supports a freight value only in the com frete group", () => {
    const chargeable = FREIGHT_MODALITIES.filter((modality) => modality.supportsCharge).map(
      (modality) => modality.key
    );
    expect(chargeable).toEqual([FREIGHT_VALUE_ON_INVOICE, FREIGHT_VALUE_INTERNAL_ONLY]);
  });

  it("resolves the situation from the group plus the checkbox below it", () => {
    expect(resolveFreightModality({ group: "with_freight", valueOnInvoice: true })).toBe(
      FREIGHT_VALUE_ON_INVOICE
    );
    expect(resolveFreightModality({ group: "with_freight", valueOnInvoice: false })).toBe(
      FREIGHT_VALUE_INTERNAL_ONLY
    );
    expect(resolveFreightModality({ group: "without_freight", carrierOnInvoice: true })).toBe(
      FREIGHT_CARRIER_ONLY
    );
    expect(resolveFreightModality({ group: "without_freight", carrierOnInvoice: false })).toBe(
      FREIGHT_MODALITY_NONE
    );
  });

  it("validates modality keys, legacy ones included", () => {
    expect(isFreightModality("cif")).toBe(true);
    expect(isFreightModality("fob")).toBe(true);
    expect(isFreightModality("own_recipient")).toBe(true);
    expect(isFreightModality("nope")).toBe(false);
    expect(isFreightModality(42)).toBe(false);
  });

  it("normalizes legacy modalities into one of the four situations", () => {
    // Transporte proprio da Pedreira tinha valor de frete na nota -> situacao 1.
    expect(normalizeFreightModality("own_sender")).toBe(FREIGHT_VALUE_ON_INVOICE);
    // Transporte proprio do cliente nunca teve valor, mas levava transportador -> 3.
    expect(normalizeFreightModality("own_recipient")).toBe(FREIGHT_CARRIER_ONLY);
    expect(isFreightModalityWithFreight("own_sender")).toBe(true);
    expect(isFreightModalityWithFreight(FREIGHT_CARRIER_ONLY)).toBe(false);
    expect(normalizeFreightModality(null)).toBe(FREIGHT_MODALITY_NONE);
  });

  it("defaults an operation without a chosen freight type to carrier-on-invoice", () => {
    // Comportamento historico: o pedido sempre levava a transportadora.
    expect(FREIGHT_MODALITY_DEFAULT).toBe(FREIGHT_CARRIER_ONLY);
  });

  it("shares the customer's freight memory between the two com-frete situations", () => {
    // O valor de frete do cliente e o mesmo; muda so se ele sai na nota.
    expect(freightModalityLookupKeys(FREIGHT_VALUE_ON_INVOICE)).toEqual([
      FREIGHT_VALUE_ON_INVOICE,
      FREIGHT_VALUE_INTERNAL_ONLY,
      "own_sender",
      "own_recipient"
    ]);
    expect(freightModalityLookupKeys(FREIGHT_MODALITY_NONE)).toEqual([FREIGHT_MODALITY_NONE]);
  });
});
