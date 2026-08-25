import { describe, expect, it } from "vitest";

import {
  renderWeighingBillingReportHtml,
  renderWeighingBillingReportSpreadsheet
} from "./weighing-billing-report-render";
import type { WeighingBillingReport, WeighingBillingRow } from "./weighing-billing-report";

/**
 * A "Conferencia de faturamento" e um dos dois documentos em que o cliente e o contador
 * dele procuram o NUMERO DA NOTA. O que estes testes seguram e o que quebra calado num
 * documento: uma coluna a mais no cabecalho sem a celula correspondente no rodape, e a
 * coluna da nota sumindo do arquivo exportado.
 */
function row(overrides: Partial<WeighingBillingRow> = {}): WeighingBillingRow {
  return {
    operationId: "op-1",
    operationCode: 123,
    date: "2026-08-14",
    closedAt: "2026-08-14T10:00:00.000Z",
    customerId: "c1",
    customerName: "Levisa",
    customerDocument: "12345678000190",
    productCode: "BR1",
    productDescription: "Brita 1",
    plate: "ABC1D23",
    netWeightKg: 32_000,
    unitPriceCents: 4_200,
    priceUnit: "ton",
    productTotalCents: 134_400,
    freightTotalCents: 0,
    totalCents: 134_400,
    operationType: "invoice",
    operationTypeLabel: "Com nota",
    omieSalesOrderId: 11493237629,
    omieServiceOrderId: null,
    omieOrderNumber: "416",
    omieInvoiceNumber: "28727",
    omieBilledAt: "2026-08-15T09:00:00.000Z",
    situation: "billed",
    situationLabel: "Faturada",
    situationDetail: null,
    ...overrides
  };
}

function report(rows: WeighingBillingRow[] = [row()]): WeighingBillingReport {
  const totals = {
    operations: rows.length,
    netWeightKg: rows.reduce((sum, item) => sum + item.netWeightKg, 0),
    productCents: rows.reduce((sum, item) => sum + item.productTotalCents, 0),
    freightCents: rows.reduce((sum, item) => sum + item.freightTotalCents, 0),
    totalCents: rows.reduce((sum, item) => sum + item.totalCents, 0)
  };
  return {
    startDate: "2026-08-01",
    endDate: "2026-08-15",
    periodLabel: "1 a 15 de agosto",
    rows,
    totals,
    bySituation: [
      {
        situation: "billed",
        label: "Faturada",
        operations: totals.operations,
        netWeightKg: totals.netWeightKg,
        totalCents: totals.totalCents
      }
    ],
    unbilled: { operations: 0, netWeightKg: 0, productCents: 0, freightCents: 0, totalCents: 0 },
    filters: { customerId: null, situations: [], search: null }
  };
}

/** As celulas de cada `<tr>` da tabela pesagem a pesagem — a que tem a coluna da nota. */
function rowCellCounts(html: string): number[] {
  const table = html
    .split("<table")
    .slice(1)
    .find((chunk) => chunk.includes("Nota fiscal"));
  if (!table) throw new Error("tabela pesagem a pesagem nao encontrada no documento");
  // `<tr class="total">` no rodape e `<tr class="alt">` nas linhas pares: a classe faz
  // parte do markup da planilha, e casar so `<tr>` deixaria justamente o total de fora.
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(
    (match) => [...match[1].matchAll(/<t[dh][^>]*>/g)].length
  );
}

describe("conferencia de faturamento — documento", () => {
  it("o rodape TOTAL tem uma celula por coluna do cabecalho", () => {
    // Tinha treze celulas para catorze colunas: a linha do total saia curta e o rodape
    // ficava deslocado em relacao a tabela — no PDF e no Excel, sem erro nenhum aparecer.
    const html = renderWeighingBillingReportSpreadsheet(report());
    const counts = rowCellCounts(html);

    expect(counts.length).toBeGreaterThan(2);
    const header = counts[0];
    for (const count of counts) {
      expect(count).toBe(header);
    }
  });

  it("a coluna Nota fiscal sai no PDF e na planilha, com o numero da nota", () => {
    const html = renderWeighingBillingReportHtml(report());
    const sheet = renderWeighingBillingReportSpreadsheet(report());

    for (const document of [html, sheet]) {
      expect(document).toContain("Nota fiscal");
      expect(document).toContain("28727");
    }
  });

  it("pesagem ainda sem nota sai com o mesmo tracinho da tela", () => {
    const html = renderWeighingBillingReportSpreadsheet(
      report([row({ omieInvoiceNumber: null, situation: "unbilled", situationLabel: "Sem nota" })])
    );

    expect(html).toContain("Nota fiscal");
    expect(html).not.toContain("28727");
  });
});
