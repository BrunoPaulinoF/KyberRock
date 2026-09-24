import { describe, expect, it } from "vitest";

import {
  centsPerTon,
  dailyCsv,
  dailyLines,
  dailySeries,
  filterByUnit,
  monthRange,
  periodCsv,
  hasFreight,
  pivotCsv,
  presetRange,
  reportLines,
  saleDay,
  salesPivot,
  sumLines,
  sumSeries,
  type ReportOperation
} from "./reports";

function op(partial: Partial<ReportOperation> & { id: string }): ReportOperation {
  return {
    unit_id: "u1",
    customer_id: "c1",
    customer_name: "Cliente A",
    product_id: "p1",
    product_description: "Brita 1",
    net_weight_kg: 10_000,
    product_total_cents: 50_000,
    freight_total_cents: 10_000,
    total_cents: 60_000,
    freight_type: "fob",
    closed_at: "2026-09-11T13:00:00Z",
    created_at: "2026-09-11T12:00:00Z",
    ...partial
  };
}

describe("data da venda", () => {
  it("usa o FECHAMENTO, nao a abertura", () => {
    // Entrou dia 10 e fechou dia 11: e venda do dia 11 (a data que vai ao OMIE).
    expect(
      saleDay(
        op({ id: "a", created_at: "2026-09-10T20:00:00Z", closed_at: "2026-09-11T12:00:00Z" })
      )
    ).toBe("2026-09-11");
  });

  it("cai na criacao quando a operacao antiga nao tem fechamento", () => {
    expect(saleDay(op({ id: "a", closed_at: null, created_at: "2026-09-09T15:00:00Z" }))).toBe(
      "2026-09-09"
    );
  });

  it("usa o dia de Brasilia, nao o de UTC", () => {
    // 01:30 UTC do dia 12 = 22:30 do dia 11 em Brasilia.
    expect(saleDay(op({ id: "a", closed_at: "2026-09-12T01:30:00Z" }))).toBe("2026-09-11");
  });
});

describe("fechamento diario e periodo", () => {
  const ops = [
    op({ id: "b", closed_at: "2026-09-11T18:00:00Z", customer_name: null }),
    op({ id: "a", closed_at: "2026-09-11T11:00:00Z" }),
    op({ id: "c", closed_at: "2026-09-12T11:00:00Z", unit_id: "u2" })
  ];

  it("ordena pelo fechamento e troca nome vazio por N/A", () => {
    const lines = reportLines(ops);
    expect(lines.map((line) => line.id)).toEqual(["a", "b", "c"]);
    expect(lines[1].customerName).toBe("N/A");
  });

  it("recorta o dia e soma", () => {
    const lines = dailyLines(ops, "2026-09-11");
    expect(lines).toHaveLength(2);
    expect(sumLines(lines)).toEqual({
      operations: 2,
      netWeightKg: 20_000,
      productTotalCents: 100_000,
      freightTotalCents: 20_000,
      totalCents: 120_000
    });
  });

  it("filtra por unidade (vazio = todas)", () => {
    expect(filterByUnit(ops, "u2").map((o) => o.id)).toEqual(["c"]);
    expect(filterByUnit(ops, "")).toHaveLength(3);
  });

  it("valor por tonelada sai do total da linha; sem peso e null", () => {
    expect(centsPerTon(50_000, 10_000)).toBe(5_000);
    expect(centsPerTon(50_000, 0)).toBeNull();
  });

  it("CSV diario em pt-BR: BOM, ponto e virgula, virgula decimal e TOTAL", () => {
    const csv = dailyCsv("2026-09-11", dailyLines(ops, "2026-09-11"));
    expect(csv.startsWith("\uFEFF")).toBe(true);
    const rows = csv.slice(1).split("\r\n");
    expect(rows[0]).toBe(
      "Data;Cliente;Produto;Peso Liquido (kg);Valor Produto (R$);Frete (R$);Total (R$)"
    );
    expect(rows[1]).toBe("11/09/2026;Cliente A;Brita 1;10000;500,00;100,00;600,00");
    expect(rows[3]).toBe("TOTAL;;;20000;1000,00;200,00;1200,00");
  });

  it("CSV do periodo leva R$/t e protege texto com ponto e virgula", () => {
    const csv = periodCsv(reportLines([op({ id: "a", customer_name: 'Areia; "Boa"' })]));
    const rows = csv.slice(1).split("\r\n");
    expect(rows[1]).toBe(
      '11/09/2026;"Areia; ""Boa""";Brita 1;10000;50,00;500,00;10,00;100,00;600,00'
    );
    expect(rows[2]).toBe("TOTAL;;;10000;50,00;500,00;10,00;100,00;600,00");
  });
});

describe("atalhos de periodo", () => {
  it("contam o dia de hoje e atravessam a virada do mes e do ano", () => {
    expect(presetRange("today", "2026-09-24")).toEqual({ start: "2026-09-24", end: "2026-09-24" });
    expect(presetRange("7d", "2026-09-03")).toEqual({ start: "2026-08-28", end: "2026-09-03" });
    expect(presetRange("30d", "2026-09-24")).toEqual({ start: "2026-08-26", end: "2026-09-24" });
    expect(presetRange("month", "2026-09-24")).toEqual({ start: "2026-09-01", end: "2026-09-24" });
    expect(presetRange("lastMonth", "2026-01-15")).toEqual({
      start: "2025-12-01",
      end: "2025-12-31"
    });
  });
});

describe("tabela dinamica de vendas", () => {
  const ops = [
    op({ id: "1", customer_id: "c1", customer_name: "Alfa", product_id: "p1" }),
    op({
      id: "2",
      customer_id: "c2",
      customer_name: "Beta",
      product_id: "p2",
      product_description: "Areia",
      net_weight_kg: 20_000,
      product_total_cents: 200_000,
      total_cents: 210_000,
      freight_type: "third_party",
      closed_at: "2026-09-12T13:00:00Z"
    }),
    op({
      id: "3",
      customer_id: "c1",
      customer_name: "Alfa",
      product_id: "p2",
      product_description: "Areia"
    })
  ];

  it("agrupa por cliente, soma o valor do PRODUTO e ordena pelo valor", () => {
    const result = salesPivot(ops, "customer");
    expect(result.rows.map((row) => [row.customerName, row.totalOperations])).toEqual([
      ["Beta", 1],
      ["Alfa", 2]
    ]);
    expect(result.rows[1].totalValueCents).toBe(100_000);
    // 1.000,00 em 20 t = 50,00/t
    expect(result.rows[1].avgPriceCentsPerTon).toBe(5_000);
    expect(result.totals).toEqual({
      totalOperations: 3,
      totalWeightKg: 40_000,
      totalValueCents: 300_000,
      freightCents: 30_000,
      grandTotalCents: 330_000,
      avgPriceCentsPerTon: 7_500
    });
  });

  it("agrupa por cliente + produto e por dia (pelo fechamento)", () => {
    expect(salesPivot(ops, "customer_product").rows).toHaveLength(3);
    const byDay = salesPivot(ops, "day").rows;
    expect(byDay.map((row) => row.date)).toEqual(["2026-09-12", "2026-09-11"]);
  });

  it("filtra por cliente e produto, mas as opcoes continuam as do periodo", () => {
    const result = salesPivot(ops, "product", { customerId: "c1", productId: "p2" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].productDescription).toBe("Areia");
    expect(result.customers.map((c) => c.name)).toEqual(["Alfa", "Beta"]);
    expect(result.products.map((p) => p.name)).toEqual(["Areia", "Brita 1"]);
  });

  it("cliente ausente vira um grupo proprio", () => {
    const result = salesPivot(
      [op({ id: "x", customer_id: null, customer_name: null })],
      "customer"
    );
    expect(result.rows[0].customerName).toBeNull();
    expect(pivotCsv(result, "customer").slice(1).split("\r\n")[1]).toBe(
      "N/A;1;10,000;50,00;500,00;100,00;600,00"
    );
  });

  it("sem id do cadastro, agrupa pelo nome gravado na pesagem", () => {
    const result = salesPivot(
      [
        op({ id: "x", customer_id: null, customer_name: "Avulso 1" }),
        op({ id: "y", customer_id: null, customer_name: "Avulso 2" })
      ],
      "customer"
    );
    expect(result.rows.map((row) => row.customerName).sort()).toEqual(["Avulso 1", "Avulso 2"]);
    // So cadastro com id entra na lista de filtro.
    expect(result.customers).toEqual([]);
  });

  it("CSV de cliente + produto tem as duas colunas e o TOTAL alinhado", () => {
    const rows = pivotCsv(salesPivot(ops, "customer_product"), "customer_product")
      .slice(1)
      .split("\r\n");
    expect(rows[0]).toBe(
      "Cliente;Produto;Operacoes;Quantidade (t);Preco medio (R$/t);Valor produto (R$);Frete (R$);Total (R$)"
    );
    expect(rows.at(-1)).toBe("TOTAL;;3;40,000;75,00;3000,00;300,00;3300,00");
  });

  it("filtra com frete (valor na nota ou so no sistema) e sem frete", () => {
    const withFreight = salesPivot(ops, "customer", { freight: "with" });
    expect(withFreight.totals.totalOperations).toBe(2);
    const without = salesPivot(ops, "customer", { freight: "without" });
    expect(without.rows.map((row) => row.customerName)).toEqual(["Beta"]);
    expect(salesPivot(ops, "customer", { freight: "all" }).totals.totalOperations).toBe(3);
    expect(hasFreight("cif")).toBe(true);
    expect(hasFreight("own_sender")).toBe(true);
    expect(hasFreight("third_party")).toBe(false);
    expect(hasFreight(null)).toBe(false);
  });
});

describe("mensal", () => {
  it("vai do primeiro ao ultimo dia do mes, inclusive fevereiro", () => {
    expect(monthRange("2026-09")).toEqual({ start: "2026-09-01", end: "2026-09-30" });
    expect(monthRange("2028-02")).toEqual({ start: "2028-02-01", end: "2028-02-29" });
  });

  it("preenche os dias sem venda e soma o mes", () => {
    const series = dailySeries(
      [op({ id: "a" }), op({ id: "b", closed_at: "2026-09-03T12:00:00Z" })],
      "2026-09-01",
      "2026-09-30"
    );
    expect(series).toHaveLength(30);
    expect(series[0].operations).toBe(0);
    expect(series[2].operations).toBe(1);
    expect(series[10].totalCents).toBe(60_000);
    expect(sumSeries(series).operations).toBe(2);
  });
});
