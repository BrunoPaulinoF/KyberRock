import { describe, expect, it } from "vitest";

import {
  FREIGHT_WITH_VALUE_KEY,
  readFreightRulePayload,
  withManualFreightValue,
  withoutFreightValue
} from "./customer-freight-rule";

const NOW = "2026-09-29T12:00:00.000Z";

describe("frete do cadastro do cliente (rule_json)", () => {
  it("sem regra, nasce no formato da balanca com o valor como cadastro", () => {
    expect(withManualFreightValue(null, 1500, NOW)).toEqual({
      id: "default",
      name: "Frete do cliente",
      type: "per_ton",
      baseValueCents: 0,
      unit: "ton",
      modalities: {
        [FREIGHT_WITH_VALUE_KEY]: {
          type: "per_ton",
          baseValueCents: 1500,
          destination: null,
          source: "manual",
          updatedAt: NOW
        }
      }
    });
  });

  it("preserva a regra antiga, a memoria dos outros tipos e o destino/cupom da ultima venda", () => {
    const current = JSON.stringify({
      id: "x",
      name: "Frete fixo",
      type: "per_ton",
      baseValueCents: 900,
      unit: "ton",
      modalities: {
        cif: {
          type: "per_ton",
          baseValueCents: 1200,
          destination: "Obra Centro",
          showOnReceipt: false,
          source: "last_used",
          updatedAt: "2026-09-01T00:00:00.000Z"
        },
        own_sender: { type: "per_ton", baseValueCents: 800, source: "last_used" }
      }
    });

    const next = withManualFreightValue(current, 1800, NOW);

    expect(next.baseValueCents).toBe(900);
    expect(next.name).toBe("Frete fixo");
    expect(next.modalities).toEqual({
      cif: {
        type: "per_ton",
        baseValueCents: 1800,
        destination: "Obra Centro",
        showOnReceipt: false,
        source: "manual",
        updatedAt: NOW
      },
      own_sender: { type: "per_ton", baseValueCents: 800, source: "last_used" }
    });
  });

  it("remover um tipo de frete mantem os outros; vazio e sem regra antiga exclui a linha", () => {
    const current = {
      baseValueCents: 0,
      modalities: { cif: { baseValueCents: 1500 }, none: { baseValueCents: 0 } }
    };
    expect(withoutFreightValue(current, "cif")).toEqual({
      baseValueCents: 0,
      modalities: { none: { baseValueCents: 0 } }
    });
    expect(withoutFreightValue({ baseValueCents: 0, modalities: { cif: {} } }, "cif")).toBeNull();
  });

  it("com regra antiga de valor, remover o ultimo tipo mantem a linha", () => {
    expect(withoutFreightValue({ baseValueCents: 700, modalities: { cif: {} } }, "cif")).toEqual({
      baseValueCents: 700,
      modalities: {}
    });
  });

  it("remover a regra antiga (sem tipo) exclui a linha, como a balanca", () => {
    expect(withoutFreightValue({ baseValueCents: 700 }, null)).toBeNull();
  });

  it("JSON quebrado vale como regra vazia", () => {
    expect(readFreightRulePayload("{nao e json")).toBeNull();
    expect(readFreightRulePayload("[1,2]")).toBeNull();
    expect(withManualFreightValue("{quebrado", 100, NOW).modalities).toEqual({
      cif: {
        type: "per_ton",
        baseValueCents: 100,
        destination: null,
        source: "manual",
        updatedAt: NOW
      }
    });
  });
});
