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
    invoiceNumber: "000028727",
    omieOrderNumber: "50139",
    customerId: "cust-1",
    customerName: "JOSE CORDEIRO",
    plate: "CVP7E80",
    carrierName: "Transportes Silva",
    driverName: "Joao",
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
    availablePlates: ["CVP7E80"],
    rows: invoices.flatMap((entry) => entry.lines),
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
      expect(document).toContain("Preco unit.");
      // A unidade vai junto do preco: R$ 48,39 por tonelada e por quilo sao contas
      // mil vezes diferentes. (O "R$" sai com espaco fino, entao a busca e pelo numero.)
      expect(document).toContain("48,39/t");
      expect(document).toContain("JOSE CORDEIRO");
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

  it("o vale sai com os mesmos seis digitos do cupom", () => {
    expect(formatCouponNumber(123)).toBe("000123");
    expect(formatCouponNumber(1_234_567)).toBe("1234567");
    expect(formatCouponNumber(null)).toBe("-");
  });
});
