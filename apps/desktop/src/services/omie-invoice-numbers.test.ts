import { describe, expect, it } from "vitest";

import {
  OMIE_INVOICE_NUMBER_ASK_LIMIT,
  selectInvoiceNumbersToAsk,
  selectOperationsMissingInvoiceNumber
} from "./omie-invoice-numbers";
import type { InvoiceClosingLine } from "./invoice-closing";

/**
 * As linhas do fechamento sao a forma real que chega a estas funcoes: elas sao chamadas
 * com o que a tela ja tem em maos, e nao com uma consulta propria.
 */
function line(overrides: Partial<InvoiceClosingLine> = {}): InvoiceClosingLine {
  return {
    operationId: "op-1",
    customerId: "cust-1",
    customerName: "Alfa",
    customerDocument: null,
    couponNumber: 7,
    date: "2026-08-17",
    closedAt: null,
    closingDate: "2026-08-31",
    dueDate: "2026-08-31",
    invoiceNumber: null,
    omieOrderNumber: null,
    omieSalesOrderId: null,
    omieServiceOrderId: null,
    plate: "ABC1D23",
    carrierName: "Silva",
    driverName: "Joao",
    productCode: "B0",
    productDescription: "Brita 0",
    netWeightKg: 10_000,
    unitPriceCents: 4_200,
    priceUnit: "ton",
    productTotalCents: 90_000,
    freightTotalCents: 10_000,
    totalCents: 100_000,
    operationType: "invoice",
    operationTypeLabel: "Com nota",
    situation: "sent",
    situationLabel: "No OMIE, falta faturar",
    situationDetail: null,
    ...overrides
  };
}

describe("selectOperationsMissingInvoiceNumber", () => {
  it("pergunta pela ordem de servico tambem, e nao so pelo pedido de venda", () => {
    // A venda interna vira OS no OMIE e a nota dela e uma NFS-e, emitida la do mesmo jeito.
    // Perguntar so pelos pedidos deixava a coluna "Nota fiscal" vazia justamente nas
    // internas — que em alguns dias sao a maioria do movimento.
    const ids = selectOperationsMissingInvoiceNumber([
      line({ operationId: "pedido", omieSalesOrderId: 11493187126 }),
      line({
        operationId: "os",
        operationType: "internal",
        operationTypeLabel: "Interna",
        omieServiceOrderId: 11493172000
      })
    ]);

    expect(ids).toEqual(["pedido", "os"]);
  });

  it("nao pergunta pela carga que ja tem o numero da nota aqui", () => {
    const ids = selectOperationsMissingInvoiceNumber([
      line({ operationId: "com-nota", omieSalesOrderId: 900, invoiceNumber: "28727" }),
      line({ operationId: "sem-nota", omieSalesOrderId: 901 })
    ]);

    expect(ids).toEqual(["sem-nota"]);
  });

  it("nao pergunta pela carga que ainda nao chegou ao OMIE", () => {
    // Sem documento la nao ha o que conferir: perguntar por ela so gastaria a chamada.
    const ids = selectOperationsMissingInvoiceNumber([
      line({ operationId: "so-local" }),
      line({ operationId: "no-omie", omieSalesOrderId: 902 })
    ]);

    expect(ids).toEqual(["no-omie"]);
  });
});

describe("selectInvoiceNumbersToAsk", () => {
  it("nao repete a pergunta que a sessao ja fez", () => {
    // Filtrar por placa ou digitar na busca refaz a lista da tela. Sem essa memoria, cada
    // tecla viraria uma chamada ao OMIE pela mesma fila que envia os pedidos.
    const rows = [
      line({ operationId: "ja-perguntada", omieSalesOrderId: 900 }),
      line({ operationId: "nova", omieSalesOrderId: 901 })
    ];

    expect(selectInvoiceNumbersToAsk(rows, new Set(["ja-perguntada"]))).toEqual(["nova"]);
    expect(selectInvoiceNumbersToAsk(rows, new Set(["ja-perguntada", "nova"]))).toEqual([]);
  });

  it("pergunta por tudo quando a sessao ainda nao perguntou nada", () => {
    const rows = [
      line({ operationId: "a", omieSalesOrderId: 900 }),
      line({ operationId: "b", operationType: "internal", omieServiceOrderId: 901 })
    ];

    expect(selectInvoiceNumbersToAsk(rows, new Set())).toEqual(["a", "b"]);
  });

  it("corta no teto do lote em vez de mandar o periodo inteiro de uma vez", () => {
    // Um relatorio anual tem milhares de cargas. A pergunta usa a MESMA fila do envio dos
    // pedidos: sem teto, abrir o relatorio atrasaria o faturamento de quem esta ao lado.
    const rows = Array.from({ length: OMIE_INVOICE_NUMBER_ASK_LIMIT + 25 }, (_, index) =>
      line({ operationId: `op-${index}`, omieSalesOrderId: 1_000 + index })
    );

    const asked = selectInvoiceNumbersToAsk(rows, new Set());

    expect(asked).toHaveLength(OMIE_INVOICE_NUMBER_ASK_LIMIT);
    // O que sobra nao se perde: cai na proxima abertura da tela e na conferencia de fundo.
    expect(asked[0]).toBe("op-0");
    expect(asked.at(-1)).toBe(`op-${OMIE_INVOICE_NUMBER_ASK_LIMIT - 1}`);
  });

  it("tela vazia nao gera pergunta alguma", () => {
    expect(selectInvoiceNumbersToAsk([], new Set())).toEqual([]);
  });
});
