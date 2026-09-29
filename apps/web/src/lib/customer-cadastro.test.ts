import { describe, expect, it } from "vitest";

import {
  customerFreightEntries,
  defaultPriceByProduct,
  normalizeNfeNumber,
  parseTotalWeightKg
} from "./customer-cadastro";

describe("preco padrao do produto", () => {
  it("tabela padrao vence o valor do OMIE; sem preco ou zero fica de fora", () => {
    const map = defaultPriceByProduct(
      [
        { id: "p-1", unit_price_cents: 5000 },
        { id: "p-2", unit_price_cents: 4000 },
        { id: "p-3", unit_price_cents: null },
        { id: "p-4", unit_price_cents: 0 }
      ],
      [{ product_id: "p-1", unit_price_cents: 6500 }]
    );
    expect([...map]).toEqual([
      ["p-1", 6500],
      ["p-2", 4000]
    ]);
  });
});

describe("quadro de frete do cliente", () => {
  const names = new Map([
    ["p-1", "Brita 1"],
    ["p-2", "Areia"]
  ]);

  it("uma linha por valor: regra antiga, cadastro e memoria; todos os produtos primeiro", () => {
    const entries = customerFreightEntries(
      [
        {
          id: "r-2",
          product_id: "p-1",
          is_active: true,
          deleted_at: null,
          rule_json: {
            baseValueCents: 0,
            modalities: { cif: { baseValueCents: 2000, source: "manual" } }
          }
        },
        {
          id: "r-1",
          product_id: null,
          is_active: true,
          deleted_at: null,
          rule_json: JSON.stringify({
            baseValueCents: 900,
            modalities: { cif: { baseValueCents: 1200, source: "last_used" } }
          })
        },
        {
          id: "r-3",
          product_id: "p-2",
          is_active: true,
          deleted_at: "2026-01-01",
          rule_json: { baseValueCents: 500 }
        }
      ],
      names
    );

    expect(
      entries.map((e) => [e.scopeLabel, e.modality, e.modalityLabel, e.baseValueCents, e.source])
    ).toEqual([
      ["Todos os produtos", null, "Qualquer tipo", 900, "manual"],
      ["Todos os produtos", "cif", "Valor so no sistema", 1200, "last_used"],
      ["Brita 1", "cif", "Valor so no sistema", 2000, "manual"]
    ]);
  });

  it("JSON quebrado ou valor sem numero nao vira linha", () => {
    expect(
      customerFreightEntries(
        [
          { id: "r", product_id: null, is_active: true, deleted_at: null, rule_json: "{x" },
          {
            id: "s",
            product_id: null,
            is_active: true,
            deleted_at: null,
            rule_json: { modalities: { cif: { baseValueCents: "abc" } } }
          }
        ],
        names
      )
    ).toEqual([]);
  });
});

describe("nota de entrega futura", () => {
  it("numero so com digitos", () => {
    expect(normalizeNfeNumber(" 12.345-6 ")).toBe("123456");
  });

  it("total em kg: vazio, zero e lixo sao sem controle de saldo", () => {
    expect(parseTotalWeightKg("30000")).toBe(30000);
    expect(parseTotalWeightKg("30.000")).toBe(30000);
    expect(parseTotalWeightKg("30000,5")).toBe(30000.5);
    expect(parseTotalWeightKg("")).toBeNull();
    expect(parseTotalWeightKg("0")).toBeNull();
    expect(parseTotalWeightKg("abc")).toBeNull();
  });
});
