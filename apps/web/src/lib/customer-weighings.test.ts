import { describe, expect, it } from "vitest";

import {
  creditLabel,
  customerAddress,
  customerCityLine,
  groupWeighingsByProduct,
  sumWeighings,
  type CustomerWeighingOperation
} from "./customer-weighings";

function op(overrides: Partial<CustomerWeighingOperation>): CustomerWeighingOperation {
  return {
    id: "op",
    operation_code: 1,
    unit_id: "u1",
    customer_id: "c1",
    customer_name: "Cliente",
    product_id: "p1",
    product_description: "Brita 1",
    plate: "ABC1D23",
    driver_name: null,
    net_weight_kg: 10_000,
    unit_price_cents: 5_000,
    product_total_cents: 50_000,
    freight_total_cents: 0,
    total_cents: 50_000,
    closed_at: "2026-09-10T12:00:00Z",
    created_at: "2026-09-10T11:00:00Z",
    ...overrides
  };
}

describe("groupWeighingsByProduct", () => {
  it("separa por produto, mais vendido primeiro, pesagem mais recente no topo", () => {
    const groups = groupWeighingsByProduct([
      op({ id: "a", closed_at: "2026-09-01T12:00:00Z" }),
      op({ id: "b", closed_at: "2026-09-05T12:00:00Z" }),
      op({
        id: "c",
        product_id: "p2",
        product_description: "Po de pedra",
        net_weight_kg: 30_000,
        product_total_cents: 60_000,
        freight_total_cents: 30_000,
        total_cents: 90_000
      })
    ]);
    expect(groups.map((group) => group.productDescription)).toEqual(["Brita 1", "Po de pedra"]);
    expect(groups[0].weighings.map((item) => item.id)).toEqual(["b", "a"]);
    expect(groups[0].totals).toMatchObject({
      operations: 2,
      netWeightKg: 20_000,
      totalCents: 100_000,
      avgPriceCentsPerTon: 5_000
    });
    // Preco medio e do PRODUTO: o frete nao entra.
    expect(groups[1].totals.avgPriceCentsPerTon).toBe(2_000);
  });

  it("pesagem sem id de produto agrupa pelo nome", () => {
    const groups = groupWeighingsByProduct([
      op({ id: "a", product_id: null, product_description: "Areia" }),
      op({ id: "b", product_id: null, product_description: "Areia" })
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("nome:Areia");
  });
});

describe("sumWeighings", () => {
  it("soma e calcula o preco medio; sem peso o medio e 0", () => {
    expect(sumWeighings([op({}), op({ id: "b" })])).toMatchObject({
      operations: 2,
      netWeightKg: 20_000,
      productTotalCents: 100_000,
      avgPriceCentsPerTon: 5_000
    });
    expect(sumWeighings([]).avgPriceCentsPerTon).toBe(0);
  });
});

describe("cartao Info", () => {
  it("monta endereco, cidade e credito", () => {
    expect(
      customerAddress({
        address_street: "Rua A",
        address_number: "120",
        address_complement: null,
        neighborhood: "Centro"
      })
    ).toBe("Rua A, 120 - Centro");
    expect(customerCityLine({ city: "Ibiuna", state: "SP", zipcode: "18150000" })).toBe(
      "Ibiuna/SP - CEP 18150-000"
    );
    expect(customerCityLine({ city: null, state: null, zipcode: null })).toBe("");
    expect(creditLabel({ credit_account_enabled: true, credit_mode: "prepaid" })).toBe("Pre-pago");
    expect(creditLabel({ credit_account_enabled: true, credit_mode: "normal" })).toBe("Fiado");
    expect(creditLabel({ credit_account_enabled: false, credit_mode: "normal" })).toBe("Nao usa");
  });
});
