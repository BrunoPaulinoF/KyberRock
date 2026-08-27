import { describe, expect, it } from "vitest";

import { formatCouponNumber } from "./invoice-closing-cycle";
import {
  invoiceClosingFileBaseName,
  renderInvoiceClosingHtml,
  renderInvoiceClosingSpreadsheet
} from "./invoice-closing-render";
import type {
  InvoiceClosingInvoice,
  InvoiceClosingLine,
  InvoiceClosingReport
} from "./invoice-closing";

function line(overrides: Partial<InvoiceClosingLine> = {}): InvoiceClosingLine {
  return {
    operationId: "op-1",
    couponNumber: 4321,
    date: "2026-07-22",
    closedAt: "2026-07-22 14:35:00",
    closingDate: "2026-08-01",
    dueDate: "2026-08-22",
    invoiceNumber: "000028727",
    omieOrderNumber: "50139",
    omieSalesOrderId: 4_017_998_231,
    omieServiceOrderId: null,
    customerId: "cust-1",
    customerName: "JOSE CORDEIRO",
    customerDocument: "11222333000155",
    plate: "CVP7E80",
    carrierName: "Transportes Silva",
    driverName: "Joao",
    productCode: "B1",
    productDescription: "Brita 1",
    netWeightKg: 31_000,
    unitPriceCents: 4_839,
    priceUnit: "ton",
    productTotalCents: 150_000,
    freightTotalCents: 16_194,
    totalCents: 166_194,
    operationType: "invoice",
    operationTypeLabel: "Com nota",
    situation: "billed",
    situationLabel: "Faturada",
    situationDetail: "Faturado no OMIE — NF-e 28727.",
    ...overrides
  };
}

function invoice(overrides: Partial<InvoiceClosingInvoice> = {}): InvoiceClosingInvoice {
  const lines = overrides.lines ?? [line()];
  return {
    customerId: "cust-1",
    customerName: "JOSE CORDEIRO",
    customerDocument: "11222333000155",
    plate: null,
    cycle: "biweekly",
    cycleLabel: "Quinzenal",
    closingDate: "2026-08-01",
    dueDate: "2026-08-22",
    lines,
    totals: {
      operations: lines.length,
      netWeightKg: 31_000,
      productCents: 150_000,
      freightCents: 16_194,
      totalCents: 166_194
    },
    operationsWithoutInvoice: 0,
    ...overrides
  };
}

function report(overrides: Partial<InvoiceClosingReport> = {}): InvoiceClosingReport {
  const invoices = overrides.invoices ?? [invoice()];
  return {
    startDate: "2026-07-16",
    endDate: "2026-07-31",
    periodLabel: "Quinzena",
    filters: { cycles: ["biweekly"], customerId: null, plates: [], search: null },
    invoices,
    totals: {
      operations: 1,
      netWeightKg: 31_000,
      productCents: 150_000,
      freightCents: 16_194,
      totalCents: 166_194
    },
    customers: 1,
    withoutInvoice: {
      operations: 0,
      netWeightKg: 0,
      productCents: 0,
      freightCents: 0,
      totalCents: 0
    },
    byCarrier: [
      {
        carrierName: "Transportes Silva",
        trips: 1,
        netWeightKg: 31_000,
        freightCents: 16_194,
        totalCents: 166_194,
        plates: [
          {
            plate: "CVP7E80",
            trips: 1,
            netWeightKg: 31_000,
            freightCents: 16_194,
            totalCents: 166_194
          }
        ]
      }
    ],
    pendingSetup: [],
    duplicates: [],
    duplicateTotals: {
      operations: 0,
      netWeightKg: 0,
      productCents: 0,
      freightCents: 0,
      totalCents: 0
    },
    availablePlates: ["CVP7E80"],
    rows: invoices.flatMap((entry) => entry.lines),
    rowTotals: {
      operations: 1,
      netWeightKg: 31_000,
      productCents: 150_000,
      freightCents: 16_194,
      totalCents: 166_194
    },
    ...overrides
  };
}

describe("invoice-closing-render", () => {
  it("o nome do arquivo diz o ciclo e o periodo", () => {
    expect(invoiceClosingFileBaseName(report())).toBe(
      "fechamento-faturas-quinzenal-2026-07-16-a-2026-07-31"
    );
    expect(
      invoiceClosingFileBaseName(
        report({ filters: { cycles: [], customerId: null, plates: [], search: null } })
      )
    ).toBe("fechamento-faturas-todos-2026-07-16-a-2026-07-31");
  });

  it("o nome do arquivo diz tambem as placas escolhidas, e vira contagem quando sao muitas", () => {
    expect(
      invoiceClosingFileBaseName(
        report({
          filters: { cycles: ["biweekly"], customerId: null, plates: ["CVP7E80"], search: null }
        })
      )
    ).toBe("fechamento-faturas-quinzenal-cvp7e80-2026-07-16-a-2026-07-31");
    expect(
      invoiceClosingFileBaseName(
        report({
          filters: {
            cycles: [],
            customerId: null,
            plates: ["AAA1A11", "BBB2B22", "CCC3C33", "DDD4D44"],
            search: null
          }
        })
      )
    ).toBe("fechamento-faturas-todos-4-placas-2026-07-16-a-2026-07-31");
  });

  it("os documentos trazem a lista pesagem a pesagem, com cliente e preco unitario em cada linha", () => {
    for (const document of [
      renderInvoiceClosingSpreadsheet(report()),
      renderInvoiceClosingHtml(report())
    ]) {
      expect(document).toContain("Pesagem a pesagem (1)");
      // A lista completa da operacao, na mesma estrutura da Conferencia de faturamento.
      for (const header of [
        "Vale",
        "CNPJ/CPF",
        "Transportador",
        "Motorista",
        "Preco unit.",
        "Tipo",
        "Pedido/OS OMIE",
        "Fechamento",
        "Vencimento"
      ]) {
        expect(document).toContain(header);
      }
      expect(document).toContain("004321");
      expect(document).toContain("B1 - Brita 1");
      expect(document).toContain("11222333000155");
      expect(document).toContain("Transportes Silva");
      expect(document).toContain("Pedido 4017998231 (nº 50139)");
      // A fatura em que a carga caiu: e o que se responde quando o cliente contesta.
      expect(document).toContain("22/08/2026");
      // A unidade vai junto do preco: R$ 48,39 por tonelada e por quilo sao contas
      // mil vezes diferentes. (O "R$" sai com espaco fino, entao a busca e pelo numero.)
      expect(document).toContain("48,39/t");
      expect(document).toContain("JOSE CORDEIRO");
    }
  });

  it("a carga fora do fechamento sai na lista marcada, e o rodape soma o periodo inteiro", () => {
    const fora = line({
      operationId: "op-fora",
      customerName: "BETA PAVIMENTACAO",
      closingDate: null,
      dueDate: null,
      invoiceNumber: null,
      totalCents: 100_000,
      netWeightKg: 20_000,
      productTotalCents: 100_000,
      freightTotalCents: 0
    });
    const withOutside = report({
      rows: [line(), fora],
      rowTotals: {
        operations: 2,
        netWeightKg: 51_000,
        productCents: 250_000,
        freightCents: 16_194,
        totalCents: 266_194
      }
    });

    for (const document of [
      renderInvoiceClosingSpreadsheet(withOutside),
      renderInvoiceClosingHtml(withOutside)
    ]) {
      // O titulo avisa antes de alguem comparar os dois totais e achar um deles errado.
      expect(document).toContain("Pesagem a pesagem (2) - 1 fora do fechamento");
      expect(document).toContain("Fora do fechamento");
      expect(document).toContain("BETA PAVIMENTACAO");
      // O rodape fecha com as LINHAS da lista, nao com o total a faturar das faturas.
      expect(document).toContain("TOTAL DO PERIODO");
      expect(document).toContain("2.661,94");
    }
  });

  it("separado por placa, os documentos ganham a coluna Placa e dizem de qual caminhao e cada fatura", () => {
    const byPlate = report({
      filters: { cycles: ["biweekly"], customerId: null, plates: ["CVP7E80"], search: null },
      invoices: [invoice({ plate: "CVP7E80" })]
    });

    for (const document of [
      renderInvoiceClosingSpreadsheet(byPlate),
      renderInvoiceClosingHtml(byPlate)
    ]) {
      expect(document).toContain("Faturas do periodo, por placa");
      // O titulo do bloco da fatura diz cliente E placa: quem rola o arquivo ate o meio
      // precisa saber de qual caminhao e a lista sem voltar ao topo.
      expect(document).toContain("JOSE CORDEIRO — CVP7E80 — Quinzenal");
      expect(document).toContain("placas CVP7E80");
    }

    // Sem placa escolhida, o arquivo continua o de sempre: nem coluna nem placa no titulo.
    const plain = renderInvoiceClosingSpreadsheet(report());
    expect(plain).toContain("Faturas do periodo");
    expect(plain).not.toContain("Faturas do periodo, por placa");
    expect(plain).toContain("JOSE CORDEIRO — Quinzenal");
  });

  it("a planilha traz nota, vale, placa e transportador de cada carga", () => {
    const sheet = renderInvoiceClosingSpreadsheet(report());
    for (const header of [
      "Nota fiscal",
      "Vale",
      "Placa",
      "Transportador",
      "Motorista",
      "Pedido OMIE"
    ]) {
      expect(sheet).toContain(header);
    }
    expect(sheet).toContain("000028727");
    // O vale sai como sai no cupom, com os zeros a esquerda.
    expect(sheet).toContain("004321");
    expect(sheet).toContain("CVP7E80");
    expect(sheet).toContain("Transportes Silva");
  });

  it("cada fatura vira um bloco com cliente, ciclo, fechamento e vencimento", () => {
    const sheet = renderInvoiceClosingSpreadsheet(report());
    expect(sheet).toContain("JOSE CORDEIRO");
    expect(sheet).toContain("Quinzenal");
    expect(sheet).toContain("fecha 01/08/2026");
    expect(sheet).toContain("vence 22/08/2026");
  });

  it("o PDF e a planilha mostram as mesmas faturas", () => {
    const source = report({
      invoices: [
        invoice(),
        invoice({ customerId: "cust-2", customerName: "POLIMIX CONCRETO", cycleLabel: "Mensal" })
      ]
    });
    const html = renderInvoiceClosingHtml(source);
    const sheet = renderInvoiceClosingSpreadsheet(source);
    for (const document of [html, sheet]) {
      expect(document).toContain("JOSE CORDEIRO");
      expect(document).toContain("POLIMIX CONCRETO");
      // A nota sai escapada no HTML, entao a conferencia e por um trecho sem sinal algum.
      expect(document).toContain("A NOTA FISCAL e o BOLETO sao emitidos no OMIE");
    }
  });

  it("o resumo do transportador lista as placas embaixo dele", () => {
    const sheet = renderInvoiceClosingSpreadsheet(report());
    expect(sheet).toContain("Transportadores e placas");
    expect(sheet).toContain("Viagens");
    expect(sheet.indexOf("Transportes Silva")).toBeLessThan(sheet.lastIndexOf("CVP7E80"));
  });

  it("avisa quando um cliente ficou fora do fechamento por falta de cadastro", () => {
    const source = report({
      pendingSetup: [
        { customerId: "cust-9", customerName: "SEM CICLO", operations: 3, totalCents: 250_000 }
      ]
    });
    const sheet = renderInvoiceClosingSpreadsheet(source);
    expect(sheet).toContain("Clientes fora do fechamento");
    expect(sheet).toContain("SEM CICLO");
    expect(renderInvoiceClosingHtml(source)).toContain("falta habilitar o credito");
    // Sem pendencia, o bloco nem aparece: uma secao vazia so gasta a atencao de quem le.
    expect(renderInvoiceClosingSpreadsheet(report())).not.toContain("Clientes fora do fechamento");
  });

  it("lista as pesagens repetidas e diz que elas ficaram fora da fatura", () => {
    const source = report({
      duplicates: [
        {
          key: "grupo-1",
          customerName: "BEDROX MATERIAIS",
          plate: "BKU4E47",
          productDescription: "Brita 2",
          entryWeightKg: 7_640,
          exitWeightKg: 16_970,
          kept: [
            {
              operationId: "op-certa",
              couponNumber: 1126,
              date: "2026-08-21",
              totalCents: 36_042,
              operationTypeLabel: "Com nota",
              invoiceNumber: null,
              inPeriod: true
            }
          ],
          repeats: [
            {
              operationId: "op-errada",
              couponNumber: 970,
              date: "2026-08-19",
              totalCents: 42_526,
              operationTypeLabel: "Com nota",
              invoiceNumber: null,
              inPeriod: true
            }
          ],
          removedTotalCents: 42_526,
          billedMoreThanOnce: false
        }
      ]
    });

    for (const document of [
      renderInvoiceClosingSpreadsheet(source),
      renderInvoiceClosingHtml(source)
    ]) {
      expect(document).toContain("Pesagens repetidas (1)");
      expect(document).toContain("BKU4E47");
      expect(document).toContain("425,26");
    }
    expect(renderInvoiceClosingHtml(source)).toContain("cobrar a mesma carga duas vezes");
    // Sem repetidas, o bloco nem aparece.
    expect(renderInvoiceClosingSpreadsheet(report())).not.toContain("Pesagens repetidas");
  });

  it("o periodo sem fechamento nenhum ainda gera documento, e ele diz que esta vazio", () => {
    const source = report({
      invoices: [],
      totals: {
        operations: 0,
        netWeightKg: 0,
        productCents: 0,
        freightCents: 0,
        totalCents: 0
      },
      customers: 0,
      byCarrier: []
    });
    expect(renderInvoiceClosingHtml(source)).toContain("Nenhum cliente com fechamento no periodo.");
    expect(renderInvoiceClosingSpreadsheet(source)).toContain("Fechamento de faturas");
  });

  /**
   * O comercial fecha a fatura conferindo quanto deu a tonelada — do material e do frete.
   * O valor e derivado do total da propria linha, entao vale tambem para frete fixo e para
   * preco digitado a mao na operacao.
   */
  it("cada carga diz quanto deu a tonelada, no material e no frete", () => {
    const sheet = renderInvoiceClosingSpreadsheet(report());

    expect(sheet).toContain("Produto (R$/t)");
    expect(sheet).toContain("Frete (R$/t)");
    // 31 t por R$ 1.500,00 de material -> R$ 48,39/t; R$ 161,94 de frete -> R$ 5,22/t.
    expect(sheet).toContain("48,39/t");
    expect(sheet).toContain("5,22/t");
  });

  /**
   * Cabecalho e celula fora de sincronia deslocam a planilha inteira, e o erro so aparece
   * quando alguem soma a coluna errada no fechamento. Este teste conta as colunas de cada
   * tabela do arquivo — inclusive o rodape, que e escrito a parte.
   */
  it("toda tabela da planilha tem cabecalho, linha e rodape com o mesmo numero de colunas", () => {
    const sheet = renderInvoiceClosingSpreadsheet(report());

    const tables = sheet.split("<table").slice(1);
    expect(tables.length).toBeGreaterThan(0);
    for (const chunk of tables) {
      const rows = [...chunk.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(
        (match) => (match[1].match(/<t[hd][^>]*>/g) ?? []).length
      );
      const cells = rows.filter((count) => count > 1);
      // Linhas de uma celula so (o "Sem dados no periodo", que usa colspan) ficam de fora.
      expect(new Set(cells).size).toBe(1);
    }
  });

  it("o vale sai com os mesmos seis digitos do cupom", () => {
    expect(formatCouponNumber(123)).toBe("000123");
    expect(formatCouponNumber(1_234_567)).toBe("1234567");
    expect(formatCouponNumber(null)).toBe("-");
  });
});
