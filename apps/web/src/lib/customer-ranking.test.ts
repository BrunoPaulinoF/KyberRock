import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import {
  buildCustomerRanking,
  customerInfoLine,
  daysInRange,
  filterRankingRows,
  formatChange,
  formatShare,
  movementLabel,
  previousRankingRange,
  rankingReportHtml,
  rankingSpreadsheetHtml,
  relativeChange,
  resolveRankingRange,
  type RankingOperation
} from "./customer-ranking";

function op(partial: Partial<RankingOperation>): RankingOperation {
  return {
    customer_id: "c1",
    customer_name: "CLIENTE UM",
    product_id: "p1",
    product_description: "BRITA 1",
    operation_type: "invoice",
    net_weight_kg: 10000,
    product_total_cents: 60000,
    freight_total_cents: 10000,
    total_cents: 70000,
    closed_at: "2026-09-11T15:00:00Z",
    created_at: "2026-09-11T12:00:00Z",
    ...partial
  };
}

const CURRENT = { start: "2026-09-01", end: "2026-09-30" };
const PREVIOUS = { start: "2026-08-01", end: "2026-08-31" };
const RANGES = { current: CURRENT, previous: PREVIOUS };

describe("periodo do ranking", () => {
  it("90 dias e ano atual contam ate hoje", () => {
    expect(resolveRankingRange("90d", "", "", "2026-10-01")).toMatchObject({
      start: "2026-07-04",
      end: "2026-10-01"
    });
    expect(resolveRankingRange("year", "", "", "2026-10-01")).toMatchObject({
      start: "2026-01-01",
      end: "2026-10-01"
    });
  });

  it("os atalhos do Insights continuam valendo, inclusive o personalizado invertido", () => {
    expect(resolveRankingRange("today", "", "", "2026-10-01")).toMatchObject({
      start: "2026-10-01",
      end: "2026-10-01"
    });
    expect(resolveRankingRange("lastMonth", "", "", "2026-10-01")).toMatchObject({
      start: "2026-09-01",
      end: "2026-09-30"
    });
    expect(resolveRankingRange("custom", "2026-09-20", "2026-09-10", "2026-10-01")).toMatchObject({
      start: "2026-09-10",
      end: "2026-09-20"
    });
  });

  it("conta os dias com o fim incluido", () => {
    expect(daysInRange({ start: "2026-09-01", end: "2026-09-01" })).toBe(1);
    expect(daysInRange({ start: "2026-09-01", end: "2026-09-30" })).toBe(30);
    expect(daysInRange({ start: "2026-09-30", end: "2026-09-01" })).toBe(0);
  });

  it("mes atual compara com o mesmo pedaco do mes anterior", () => {
    const range = { start: "2026-10-01", end: "2026-10-15", label: "Mês atual" };
    expect(previousRankingRange("month", range)).toMatchObject({
      start: "2026-09-01",
      end: "2026-09-15"
    });
    // 31/03 nao existe em fevereiro: o fim vira o ultimo dia dele.
    expect(
      previousRankingRange("month", { start: "2026-03-01", end: "2026-03-31", label: "" })
    ).toMatchObject({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("mes anterior compara com o mes inteiro antes dele", () => {
    expect(
      previousRankingRange("lastMonth", { start: "2026-09-01", end: "2026-09-30", label: "" })
    ).toMatchObject({ start: "2026-08-01", end: "2026-08-31" });
  });

  it("ano atual compara com o mesmo pedaco do ano anterior", () => {
    expect(
      previousRankingRange("year", { start: "2026-01-01", end: "2026-10-01", label: "" })
    ).toMatchObject({ start: "2025-01-01", end: "2025-10-01" });
    expect(
      previousRankingRange("year", { start: "2028-01-01", end: "2028-02-29", label: "" })
    ).toMatchObject({ start: "2027-01-01", end: "2027-02-28" });
  });

  it("os outros comparam com os mesmos tantos dias logo antes", () => {
    expect(
      previousRankingRange("7d", { start: "2026-09-24", end: "2026-09-30", label: "" })
    ).toMatchObject({ start: "2026-09-17", end: "2026-09-23", label: "7 dias anteriores" });
    expect(
      previousRankingRange("today", { start: "2026-10-01", end: "2026-10-01", label: "" })
    ).toMatchObject({ start: "2026-09-30", end: "2026-09-30", label: "Dia anterior" });
  });
});

describe("buildCustomerRanking", () => {
  const current = [
    op({ customer_id: "a", customer_name: "ALFA", total_cents: 100000, net_weight_kg: 20000 }),
    op({ customer_id: "a", customer_name: "ALFA", total_cents: 50000, net_weight_kg: 5000 }),
    op({ customer_id: "b", customer_name: "BETA", total_cents: 120000, net_weight_kg: 10000 }),
    op({ customer_id: "c", customer_name: "GAMA", total_cents: 30000, net_weight_kg: 30000 }),
    // Fora do periodo: fechou em agosto.
    op({ customer_id: "c", customer_name: "GAMA", closed_at: "2026-08-20T15:00:00Z" })
  ];
  const previous = [
    op({
      customer_id: "b",
      customer_name: "BETA",
      total_cents: 200000,
      closed_at: "2026-08-10T15:00:00Z"
    }),
    op({
      customer_id: "a",
      customer_name: "ALFA",
      total_cents: 100000,
      closed_at: "2026-08-10T15:00:00Z"
    }),
    op({
      customer_id: "z",
      customer_name: "ZETA",
      total_cents: 90000,
      closed_at: "2026-08-25T15:00:00Z"
    })
  ];

  it("ordena pelo faturamento e soma cargas, peso e dinheiro", () => {
    const ranking = buildCustomerRanking(current, previous, RANGES, "value");
    expect(ranking.rows.map((row) => [row.position, row.name, row.totalCents, row.loads])).toEqual([
      [1, "ALFA", 150000, 2],
      [2, "BETA", 120000, 1],
      [3, "GAMA", 30000, 1]
    ]);
    expect(ranking.totals).toMatchObject({ customers: 3, loads: 4, totalCents: 300000 });
    expect(ranking.rows[0].share).toBeCloseTo(0.5);
    expect(ranking.rows[2].cumulativeShare).toBeCloseTo(1);
  });

  it("a ordem muda com a metrica: peso e cargas", () => {
    expect(buildCustomerRanking(current, [], RANGES, "weight").rows.map((row) => row.name)).toEqual(
      ["GAMA", "ALFA", "BETA"]
    );
    // Cargas empatadas desempatam pelo faturamento.
    expect(buildCustomerRanking(current, [], RANGES, "loads").rows.map((row) => row.name)).toEqual([
      "ALFA",
      "BETA",
      "GAMA"
    ]);
  });

  it("compara com o periodo anterior: movimento, variacao, novos e quem parou", () => {
    const ranking = buildCustomerRanking(current, previous, RANGES, "value");
    const [alfa, beta, gama] = ranking.rows;
    expect(alfa.previous?.position).toBe(2);
    expect(alfa.movement).toBe(1);
    expect(alfa.change).toBeCloseTo(0.5);
    expect(beta.movement).toBe(-1);
    expect(beta.change).toBeCloseTo(-0.4);
    expect(gama.previous).toBeNull();
    expect(gama.movement).toBeNull();
    expect(ranking.newCustomers).toBe(1);
    expect(ranking.lost.map((lost) => [lost.name, lost.previousPosition, lost.lastDay])).toEqual([
      ["ZETA", 3, "2026-08-25"]
    ]);
    expect(ranking.previousTotals.totalCents).toBe(390000);
  });

  it("curva ABC olha o acumulado antes do cliente: o primeiro e sempre A", () => {
    const ops = [
      op({ customer_id: "a", total_cents: 8500 }),
      op({ customer_id: "b", total_cents: 600 }),
      op({ customer_id: "c", total_cents: 500 }),
      op({ customer_id: "d", total_cents: 400 })
    ];
    const ranking = buildCustomerRanking(ops, [], RANGES, "value");
    expect(ranking.rows.map((row) => row.abc)).toEqual(["A", "B", "B", "C"]);
    expect(ranking.abcCounts).toEqual({ A: 1, B: 2, C: 1 });
  });

  it("filtra por produto e por tipo de venda nos dois periodos", () => {
    const ops = [
      op({ customer_id: "a", product_id: "p1", operation_type: "invoice" }),
      op({
        customer_id: "b",
        product_id: "p2",
        product_description: "PO DE PEDRA",
        operation_type: "internal"
      })
    ];
    expect(
      buildCustomerRanking(ops, [], RANGES, "value", { productId: "p2" }).rows.map(
        (row) => row.customerId
      )
    ).toEqual(["b"]);
    expect(
      buildCustomerRanking(ops, [], RANGES, "value", { type: "invoice" }).rows.map(
        (row) => row.customerId
      )
    ).toEqual(["a"]);
    // As opcoes do filtro de produto nao dependem do filtro aplicado.
    expect(
      buildCustomerRanking(ops, [], RANGES, "value", { productId: "p2" }).products.map(
        (product) => product.name
      )
    ).toEqual(["BRITA 1", "PO DE PEDRA"]);
  });

  it("usa o nome da pesagem mais recente e junta pesagem sem cadastro pelo nome", () => {
    const ops = [
      op({ customer_id: "a", customer_name: "NOME ANTIGO", closed_at: "2026-09-02T12:00:00Z" }),
      op({ customer_id: "a", customer_name: "NOME NOVO", closed_at: "2026-09-20T12:00:00Z" }),
      op({ customer_id: null, customer_name: "AVULSO" }),
      op({ customer_id: null, customer_name: "AVULSO " })
    ];
    const ranking = buildCustomerRanking(ops, [], RANGES, "value");
    expect(ranking.rows.map((row) => row.name).sort()).toEqual(["AVULSO", "NOME NOVO"]);
    expect(ranking.rows.find((row) => row.name === "AVULSO")?.loads).toBe(2);
  });

  it("detalhe do cliente: dias, primeira/ultima compra, preco medio e materiais", () => {
    const ops = [
      op({ closed_at: "2026-09-05T12:00:00Z", product_id: "p1", net_weight_kg: 10000 }),
      op({ closed_at: "2026-09-05T18:00:00Z", product_id: "p1", net_weight_kg: 10000 }),
      op({
        closed_at: "2026-09-20T12:00:00Z",
        product_id: "p2",
        product_description: "AREIA",
        net_weight_kg: 5000,
        product_total_cents: 30000
      })
    ];
    const [row] = buildCustomerRanking(ops, [], RANGES, "value").rows;
    expect(row.activeDays).toBe(2);
    expect(row.firstDay).toBe("2026-09-05");
    expect(row.lastDay).toBe("2026-09-20");
    expect(row.mainProduct).toBe("BRITA 1");
    expect(row.products.map((product) => [product.name, product.loads])).toEqual([
      ["BRITA 1", 2],
      ["AREIA", 1]
    ]);
    // 150.000 centavos de material / 25 t = R$ 60,00/t.
    expect(row.avgPriceCentsPerTon).toBe(6000);
    expect(row.ticketCents).toBe(70000);
  });

  it("periodo vazio nao quebra", () => {
    const ranking = buildCustomerRanking([], [], RANGES, "value");
    expect(ranking.rows).toEqual([]);
    expect(ranking.top10Share).toBe(0);
    expect(ranking.lost).toEqual([]);
  });
});

describe("formatacao", () => {
  it("participacao e variacao", () => {
    expect(formatShare(0.1234)).toBe("12,3%");
    expect(formatChange(0.25)).toBe("+25,0%");
    expect(formatChange(-0.04)).toBe("-4,0%");
    expect(formatChange(0)).toBe("0,0%");
    expect(formatChange(null)).toBe("—");
    expect(relativeChange(150, 100)).toBeCloseTo(0.5);
    expect(relativeChange(10, 0)).toBeNull();
  });

  it("movimento no ranking", () => {
    expect(movementLabel(null)).toBe("Novo");
    expect(movementLabel(2)).toBe("Subiu 2");
    expect(movementLabel(-1)).toBe("Caiu 1");
    expect(movementLabel(0)).toBe("Manteve");
  });

  it("documento e cidade do cadastro", () => {
    expect(customerInfoLine({ document: "12345678000195", city: "Ibiúna", state: "SP" })).toBe(
      "12.345.678/0001-95 · Ibiúna/SP"
    );
    expect(customerInfoLine({ document: null, city: null, state: "SP" })).toBe("SP");
    expect(customerInfoLine(undefined)).toBe("");
  });

  it("busca por nome sem acento nem caixa", () => {
    const rows = [{ name: "Construtora São João" }, { name: "Areial Bom Jesus" }];
    expect(filterRankingRows(rows, "sao joao")).toEqual([rows[0]]);
    expect(filterRankingRows(rows, "  ")).toEqual(rows);
  });
});

describe("exportacao", () => {
  const ranking = buildCustomerRanking(
    [op({ customer_id: "a", customer_name: "A & B <LTDA>" })],
    [op({ customer_id: "z", customer_name: "SUMIU", closed_at: "2026-08-10T15:00:00Z" })],
    RANGES,
    "value"
  );
  const input = {
    ranking,
    range: { ...CURRENT, label: "Mês anterior" },
    previousRange: { ...PREVIOUS, label: "Mês retrasado" },
    metric: "value" as const,
    filtersLabel: "Com nota",
    info: new Map([["a", { document: "12345678000195", city: "Ibiúna", state: "SP" }]]),
    generatedAt: new Date("2026-10-01T12:00:00Z")
  };

  it("PDF traz o periodo, a comparacao, o cliente escapado e quem parou", () => {
    const html = rankingReportHtml(input);
    expect(html).toContain("Ranking de clientes");
    expect(html).toContain("01/09/2026 a 30/09/2026");
    expect(html).toContain("comparado com 01/08/2026 a 31/08/2026");
    expect(html).toContain("Com nota");
    expect(html).toContain("A &amp; B &lt;LTDA&gt;");
    expect(html).toContain("12.345.678/0001-95 · Ibiúna/SP");
    expect(html).toContain("SUMIU");
  });

  it("planilha traz todas as colunas e o total", () => {
    const html = rankingSpreadsheetHtml(input);
    expect(html).toContain("Classe ABC");
    expect(html).toContain("Produto principal");
    expect(html).toMatch(/R\$\s700,00/);
    expect(html).toContain("TOTAL");
    expect(html).toContain("Compraram no periodo anterior e nao compraram neste");
  });
});
