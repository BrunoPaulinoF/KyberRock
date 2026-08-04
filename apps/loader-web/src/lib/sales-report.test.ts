import { describe, expect, it } from "vitest";

import {
  aggregateSalesReport,
  buildSalesReportCsv,
  freightTypeLabel,
  isSalesFreightFilter,
  matchesFreightFilter,
  normalizeFreightType,
  SALES_FREIGHT_ALL,
  toReportDay,
  type SalesOperationRow
} from "./sales-report";

const rows: SalesOperationRow[] = [
  {
    customer_id: "c1",
    customer_name: "Construtora Alfa",
    product_id: "p1",
    product_description: "Brita 1",
    freight_type: "cif",
    net_weight_kg: 10_000,
    product_total_cents: 70_000,
    freight_total_cents: 10_000,
    total_cents: 80_000,
    created_at: "2026-07-20T12:00:00Z"
  },
  {
    customer_id: "c1",
    customer_name: "Construtora Alfa",
    product_id: "p2",
    product_description: "Areia",
    freight_type: "fob",
    net_weight_kg: 5_000,
    product_total_cents: 20_000,
    freight_total_cents: 0,
    total_cents: 20_000,
    created_at: "2026-07-20T15:00:00Z"
  },
  {
    customer_id: "c2",
    customer_name: "Obras Beta",
    product_id: "p1",
    product_description: "Brita 1",
    freight_type: "fob",
    net_weight_kg: 20_000,
    product_total_cents: 140_000,
    freight_total_cents: 30_000,
    total_cents: 170_000,
    created_at: "2026-07-21T13:00:00Z"
  }
];

describe("aggregateSalesReport", () => {
  it("agrupa por produto somando peso, valores e operacoes", () => {
    const { lines, totals } = aggregateSalesReport(rows, "product");
    expect(lines).toHaveLength(2);
    const brita = lines.find((line) => line.productDescription === "Brita 1");
    expect(brita).toMatchObject({
      operations: 2,
      netWeightKg: 30_000,
      productTotalCents: 210_000,
      totalCents: 250_000
    });
    // 210_000 centavos / 30 t = 7_000 centavos/t
    expect(brita?.avgPriceCentsPerTon).toBe(7_000);
    expect(totals.operations).toBe(3);
    expect(totals.totalCents).toBe(270_000);
  });

  it("agrupa por cliente ordenando pelo maior total", () => {
    const { lines } = aggregateSalesReport(rows, "customer");
    expect(lines.map((line) => line.customerName)).toEqual(["Obras Beta", "Construtora Alfa"]);
  });

  it("agrupa por cliente x produto", () => {
    const { lines } = aggregateSalesReport(rows, "customer_product");
    expect(lines).toHaveLength(3);
    expect(
      lines.find(
        (line) => line.customerName === "Construtora Alfa" && line.productDescription === "Areia"
      )?.netWeightKg
    ).toBe(5_000);
  });

  it("agrupa por dia no fuso de Brasilia, em ordem cronologica", () => {
    const { lines } = aggregateSalesReport(rows, "day");
    expect(lines.map((line) => line.day)).toEqual(["2026-07-20", "2026-07-21"]);
    expect(lines[0]?.operations).toBe(2);
  });

  it("usa media nula quando nao ha peso", () => {
    const { totals } = aggregateSalesReport([], "product");
    expect(totals.avgPriceCentsPerTon).toBeNull();
  });
});

describe("filtro por modalidade de frete", () => {
  it("normaliza modalidades desconhecidas/ausentes para 'none'", () => {
    // Valor na nota (fob), valor so no sistema (cif) e o transporte proprio legado
    // contam como "com frete"; so o transportador na nota (third_party) nao.
    expect(normalizeFreightType("cif")).toBe("cif");
    expect(normalizeFreightType("fob")).toBe("cif");
    expect(normalizeFreightType("own_sender")).toBe("cif");
    expect(normalizeFreightType("third_party")).toBe("none");
    expect(normalizeFreightType("own_recipient")).toBe("none");
    expect(normalizeFreightType(null)).toBe("none");
    expect(normalizeFreightType("modalidade-nova")).toBe("none");
  });

  it("rotula os dois tipos de frete", () => {
    expect(freightTypeLabel("cif")).toBe("Com frete");
    expect(freightTypeLabel("fob")).toBe("Com frete");
    expect(freightTypeLabel(undefined)).toBe("Sem frete");
  });

  it("aceita apenas valores do catalogo (ou 'all') como filtro", () => {
    expect(isSalesFreightFilter(SALES_FREIGHT_ALL)).toBe(true);
    expect(isSalesFreightFilter("cif")).toBe(true);
    expect(isSalesFreightFilter("qualquer")).toBe(false);
  });

  it("'all' mantem todas as linhas", () => {
    expect(rows.filter((row) => matchesFreightFilter(row, SALES_FREIGHT_ALL))).toHaveLength(3);
  });

  it("separa com frete de sem frete somando so as vendas do tipo", () => {
    // As tres linhas do cenario tem modalidade antiga (cif/fob) — todas com frete.
    const withFreight = aggregateSalesReport(
      rows.filter((row) => matchesFreightFilter(row, "cif")),
      "product"
    );
    expect(withFreight.totals.operations).toBe(3);
    expect(withFreight.totals.totalCents).toBe(270_000);

    const withoutFreight = aggregateSalesReport(
      rows.filter((row) => matchesFreightFilter(row, "none")),
      "product"
    );
    expect(withoutFreight.totals.operations).toBe(0);
  });

  it("trata operacao sem modalidade projetada como 'sem frete'", () => {
    const legacy: SalesOperationRow = { created_at: "2026-07-20T12:00:00Z" };
    expect(matchesFreightFilter(legacy, "none")).toBe(true);
    expect(matchesFreightFilter(legacy, "cif")).toBe(false);
  });
});

describe("toReportDay", () => {
  it("converte UTC para o dia local (-03:00)", () => {
    // 01:30 UTC de 21/07 ainda e 22:30 de 20/07 em Brasilia
    expect(toReportDay("2026-07-21T01:30:00Z")).toBe("2026-07-20");
    expect(toReportDay("data-invalida")).toBeNull();
  });
});

describe("buildSalesReportCsv", () => {
  it("gera CSV pt-BR com cabecalho, linhas e total", () => {
    const csv = buildSalesReportCsv(aggregateSalesReport(rows, "product"), "product");
    const linesOut = csv.split("\r\n");
    expect(linesOut[0]).toContain("Produto;Operacoes;Peso liquido (t)");
    expect(linesOut[1]).toContain("Brita 1;2;30,000");
    expect(linesOut.at(-1)).toContain("TOTAL;3;35,000");
    // decimal com virgula
    expect(csv).toContain("2500,00");
  });
});
