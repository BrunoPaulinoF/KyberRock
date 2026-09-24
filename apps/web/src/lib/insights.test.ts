import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import {
  addDays,
  dailySeries,
  formatShortDate,
  insightsReportHtml,
  monotonePath,
  niceTicks,
  operationMix,
  rangeSpreadsheetHtml,
  reportByCustomer,
  reportByProduct,
  resolveInsightsRange,
  saleDay,
  salesPivot,
  seriesTotals,
  tickIndexes,
  type InsightsOperation
} from "./insights";

function op(partial: Partial<InsightsOperation>): InsightsOperation {
  return {
    id: partial.id ?? Math.random().toString(36),
    status: "synced",
    operation_type: "invoice",
    customer_id: "c1",
    customer_name: "CLIENTE UM",
    product_id: "p1",
    product_description: "BRITA 1",
    net_weight_kg: 10000,
    product_total_cents: 60000,
    freight_total_cents: 10000,
    total_cents: 70000,
    closed_at: "2026-09-11T15:00:00Z",
    created_at: "2026-09-11T12:00:00Z",
    ...partial
  };
}

const RANGE = { start: "2026-09-10", end: "2026-09-12" };

describe("resolveInsightsRange", () => {
  // 24/09/2026 as 02:00 UTC ainda e dia 23 em Brasilia.
  const now = new Date("2026-09-24T02:00:00Z");

  it("usa o dia de Brasilia para os presets", () => {
    expect(resolveInsightsRange("today", "", "", now)).toEqual({
      start: "2026-09-23",
      end: "2026-09-23",
      label: "Hoje"
    });
    expect(resolveInsightsRange("7d", "", "", now)).toMatchObject({
      start: "2026-09-17",
      end: "2026-09-23"
    });
    expect(resolveInsightsRange("30d", "", "", now).start).toBe("2026-08-25");
    expect(resolveInsightsRange("month", "", "", now)).toMatchObject({
      start: "2026-09-01",
      end: "2026-09-23"
    });
    expect(resolveInsightsRange("lastMonth", "", "", now)).toEqual({
      start: "2026-08-01",
      end: "2026-08-31",
      label: "Mes anterior"
    });
  });

  it("personalizado: campo vazio vira hoje e datas invertidas trocam de lugar", () => {
    expect(resolveInsightsRange("custom", "2026-09-20", "2026-09-10", now)).toMatchObject({
      start: "2026-09-10",
      end: "2026-09-20"
    });
    expect(resolveInsightsRange("custom", "", "", now)).toMatchObject({
      start: "2026-09-23",
      end: "2026-09-23"
    });
  });

  it("mes anterior de janeiro cai em dezembro do ano anterior", () => {
    expect(
      resolveInsightsRange("lastMonth", "", "", new Date("2026-01-15T15:00:00Z"))
    ).toMatchObject({ start: "2025-12-01", end: "2025-12-31" });
  });
});

describe("saleDay", () => {
  it("usa o fechamento no fuso da pedreira e cai na criacao quando nao ha fechamento", () => {
    // 01:30 UTC do dia 12 = 22:30 do dia 11 em Brasilia.
    expect(saleDay({ closed_at: "2026-09-12T01:30:00Z", created_at: "2026-09-09T12:00:00Z" })).toBe(
      "2026-09-11"
    );
    expect(saleDay({ closed_at: null, created_at: "2026-09-09T12:00:00Z" })).toBe("2026-09-09");
  });
});

describe("dailySeries e KPIs", () => {
  const ops = [
    op({ closed_at: "2026-09-10T13:00:00Z", net_weight_kg: 5000, total_cents: 1000 }),
    // Entrou no dia 09, fechou no 11: conta no 11 (a data do OMIE).
    op({
      created_at: "2026-09-09T13:00:00Z",
      closed_at: "2026-09-11T13:00:00Z",
      net_weight_kg: 7000,
      total_cents: 3000
    }),
    op({ status: "cancelled", closed_at: null, created_at: "2026-09-11T13:00:00Z" }),
    op({ status: "open", closed_at: null, created_at: "2026-09-11T13:00:00Z" }),
    op({ closed_at: "2026-09-13T13:00:00Z" })
  ];

  it("tem um ponto por dia, inclusive os vazios, e so conta concluidas do periodo", () => {
    expect(dailySeries(ops, RANGE)).toEqual([
      { date: "2026-09-10", totalOperations: 1, totalNetWeightKg: 5000, totalCents: 1000 },
      { date: "2026-09-11", totalOperations: 1, totalNetWeightKg: 7000, totalCents: 3000 },
      { date: "2026-09-12", totalOperations: 0, totalNetWeightKg: 0, totalCents: 0 }
    ]);
  });

  it("soma o total (produto + frete) e arredonda o ticket medio", () => {
    expect(seriesTotals(dailySeries(ops, RANGE))).toEqual({
      operations: 2,
      weightKg: 12000,
      totalCents: 4000,
      ticketCents: 2000
    });
    expect(seriesTotals([])).toEqual({ operations: 0, weightKg: 0, totalCents: 0, ticketCents: 0 });
  });

  it("devolve vazio para intervalo invalido", () => {
    expect(dailySeries(ops, { start: "2026-09-12", end: "2026-09-10" })).toEqual([]);
  });
});

describe("operationMix", () => {
  it("separa com nota, interna e canceladas do periodo", () => {
    const mix = operationMix(
      [
        op({ total_cents: 100 }),
        op({ operation_type: "internal", total_cents: 50, net_weight_kg: 2000 }),
        op({ status: "cancelled", closed_at: null, net_weight_kg: 3000 }),
        op({ status: "open", closed_at: null }),
        op({ closed_at: "2026-10-01T12:00:00Z" })
      ],
      RANGE
    );
    expect(mix).toEqual({
      invoice: { count: 1, weightKg: 10000, totalCents: 100 },
      internal: { count: 1, weightKg: 2000, totalCents: 50 },
      cancelled: { count: 1, weightKg: 3000 }
    });
  });
});

describe("produto e cliente", () => {
  const ops = [
    op({ product_id: "p1", product_description: "BRITA 1", net_weight_kg: 1000 }),
    op({ product_id: "p2", product_description: "PEDRISCO", net_weight_kg: 3000 }),
    op({ product_id: "p1", product_description: "BRITA 1", net_weight_kg: 1500 }),
    op({ product_id: null, product_description: null, net_weight_kg: null })
  ];

  it("agrupa por produto do maior peso para o menor e soma so o valor do material", () => {
    const report = reportByProduct(ops, RANGE, new Map([["p2", "PED"]]));
    expect(report.map((r) => [r.productDescription, r.productCode, r.totalWeightKg])).toEqual([
      ["PEDRISCO", "PED", 3000],
      ["BRITA 1", "N/A", 2500],
      ["N/A", "N/A", 0]
    ]);
    expect(report[1].totalValueCents).toBe(120000);
    expect(report[1].totalOperations).toBe(2);
  });

  it("agrupa por cliente do maior valor para o menor", () => {
    const report = reportByCustomer(
      [
        op({ customer_id: "c1", customer_name: "UM", product_total_cents: 100 }),
        op({ customer_id: "c2", customer_name: "DOIS", product_total_cents: 500 }),
        op({ customer_id: "c1", customer_name: "UM", product_total_cents: 100 })
      ],
      RANGE
    );
    expect(report.map((r) => [r.customerName, r.totalValueCents, r.totalOperations])).toEqual([
      ["DOIS", 500, 1],
      ["UM", 200, 2]
    ]);
  });
});

describe("salesPivot", () => {
  const ops = [
    op({
      customer_id: "c1",
      customer_name: "ALFA",
      product_id: "p1",
      product_description: "BRITA 1",
      net_weight_kg: 10000,
      product_total_cents: 65000
    }),
    op({
      customer_id: "c2",
      customer_name: "BETA",
      product_id: "p1",
      product_description: "BRITA 1",
      net_weight_kg: 20000,
      product_total_cents: 140000,
      closed_at: "2026-09-12T12:00:00Z"
    }),
    op({
      customer_id: "c1",
      customer_name: "ALFA",
      product_id: "p2",
      product_description: "PEDRISCO",
      net_weight_kg: 5000,
      product_total_cents: 30000
    }),
    op({ status: "cancelled", customer_id: "c3", customer_name: "GAMA" })
  ];

  it("agrupa por cliente do maior valor para o menor, com preco medio por tonelada", () => {
    const pivot = salesPivot(ops, RANGE, "customer");
    expect(
      pivot.rows.map((r) => [r.customerName, r.totalValueCents, r.avgPriceCentsPerTon])
    ).toEqual([
      ["BETA", 140000, 7000],
      ["ALFA", 95000, 6333]
    ]);
    expect(pivot.totals).toEqual({
      totalOperations: 3,
      totalWeightKg: 35000,
      totalValueCents: 235000,
      avgPriceCentsPerTon: 6714
    });
    expect(pivot.customers).toEqual([
      { id: "c1", name: "ALFA" },
      { id: "c2", name: "BETA" }
    ]);
    expect(pivot.products.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("filtra por cliente e produto sem mexer nas opcoes dos filtros", () => {
    const pivot = salesPivot(ops, RANGE, "customer_product", { customerId: "c1", productId: "p2" });
    expect(pivot.rows).toHaveLength(1);
    expect(pivot.rows[0]).toMatchObject({ customerName: "ALFA", productDescription: "PEDRISCO" });
    expect(pivot.customers).toHaveLength(2);
  });

  it("agrupa por dia de fechamento", () => {
    const pivot = salesPivot(ops, RANGE, "day");
    expect(pivot.rows.map((r) => [r.date, r.totalOperations])).toEqual([
      ["2026-09-12", 1],
      ["2026-09-11", 2]
    ]);
  });
});

describe("grafico", () => {
  it("marcas redondas do eixo", () => {
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(66680)).toEqual([0, 20000, 40000, 60000, 80000]);
    expect(niceTicks(600000)).toEqual([0, 150000, 300000, 450000, 600000]);
    expect(niceTicks(440000)).toEqual([0, 150000, 300000, 450000, 600000]);
    expect(niceTicks(800000)).toEqual([0, 200000, 400000, 600000, 800000]);
  });

  it("legendas do eixo X cabem e terminam no ultimo dia", () => {
    expect(tickIndexes(7, 10)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const ticks = tickIndexes(30, 7);
    expect(ticks.length).toBeLessThanOrEqual(7);
    expect(ticks[ticks.length - 1]).toBe(29);
  });

  it("curva monotone passa pelos pontos", () => {
    expect(monotonePath([])).toBe("");
    expect(
      monotonePath([
        { x: 0, y: 0 },
        { x: 10, y: 5 }
      ])
    ).toBe("M0,0L10,5");
    const path = monotonePath([
      { x: 0, y: 10 },
      { x: 10, y: 0 },
      { x: 20, y: 10 }
    ]);
    expect(path.startsWith("M0,10C")).toBe(true);
    expect(path.endsWith(",20,10")).toBe(true);
  });

  it("datas curtas", () => {
    expect(formatShortDate("2026-09-11")).toBe("11/09");
    expect(formatShortDate("2026-09-11T12:00:00.000Z")).toBe("11/09");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("exportacao", () => {
  const range = { ...RANGE, label: "Periodo personalizado" };
  const ops = [op({ customer_name: "A & B <LTDA>" })];

  it("PDF traz os blocos do painel e escapa o texto", () => {
    const html = insightsReportHtml(ops, range, new Map(), new Date("2026-09-12T12:00:00Z"));
    expect(html).toContain("Painel de Insights");
    expect(html).toContain("10/09/2026 a 12/09/2026");
    expect(html).toContain("Top 5 produtos por peso");
    expect(html).toContain("A &amp; B &lt;LTDA&gt;");
    expect(html).toContain("R$ 700,00");
  });

  it("planilha traz as cargas com preco por tonelada", () => {
    const html = rangeSpreadsheetHtml(ops, range, new Date("2026-09-12T12:00:00Z"));
    expect(html).toContain("Carregamentos do periodo");
    expect(html).toContain("11/09/2026");
    expect(html).toContain("R$ 60,00/t");
  });
});
