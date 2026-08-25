import { describe, expect, it, vi } from "vitest";

import {
  countBillableCandidates,
  runInvoiceClosing,
  selectInvoiceClosingCandidates
} from "./invoice-closing-run";
import type { InvoiceClosingBillOutcome, InvoiceClosingRunCandidate } from "./invoice-closing-run";
import type { InvoiceClosingLine } from "./invoice-closing";

function candidate(
  overrides: Partial<InvoiceClosingRunCandidate> = {}
): InvoiceClosingRunCandidate {
  return {
    operationId: "op-1",
    couponNumber: 1,
    customerName: "Alfa",
    operationType: "invoice",
    invoiceNumber: null,
    alreadyBilled: false,
    hasCustomer: true,
    isDuplicate: false,
    totalCents: 100_000,
    ...overrides
  };
}

const BILLED: InvoiceClosingBillOutcome = {
  billed: true,
  billingStatusMessage: "Pedido faturado no OMIE."
};

describe("runInvoiceClosing", () => {
  it("fatura no OMIE as pesagens que ainda nao tem nota", async () => {
    const bill = vi.fn(async () => BILLED);

    const result = await runInvoiceClosing(
      [candidate({ operationId: "op-1" }), candidate({ operationId: "op-2" })],
      bill
    );

    expect(bill.mock.calls.map(([id]) => id)).toEqual(["op-1", "op-2"]);
    expect(result).toMatchObject({ requested: 2, billed: 2, failed: 0, blocked: 0 });
    expect(result.billedTotalCents).toBe(200_000);
  });

  it("NAO reenvia a pesagem que ja tem nota — refaturar duplicaria a NF-e do cliente", async () => {
    const bill = vi.fn(async () => BILLED);

    const result = await runInvoiceClosing(
      [
        candidate({ operationId: "ja-faturada", alreadyBilled: true, invoiceNumber: "28727" }),
        candidate({ operationId: "op-2" })
      ],
      bill
    );

    expect(bill).toHaveBeenCalledTimes(1);
    expect(bill).toHaveBeenCalledWith("op-2");
    expect(result).toMatchObject({ billed: 1, alreadyBilled: 1 });
    expect(result.items[0].message).toContain("28727");
    // O valor da que ja tinha nota nao entra no total DESTA passada.
    expect(result.billedTotalCents).toBe(100_000);
  });

  it("deixa a venda interna de fora, mas diz que deixou", async () => {
    const bill = vi.fn(async () => BILLED);

    const result = await runInvoiceClosing(
      [candidate({ operationId: "interna", operationType: "internal" })],
      bill
    );

    expect(bill).not.toHaveBeenCalled();
    expect(result).toMatchObject({ billed: 0, skipped: 1 });
    // Some-la em silencio faria o total do fechamento nao bater com o da tela.
    expect(result.items[0].message).toContain("ordem de servico");
  });

  it("uma pesagem recusada nao derruba a passada inteira", async () => {
    const bill = vi.fn(async (operationId: string) => {
      if (operationId === "op-2") {
        return {
          billed: false,
          blocked: true,
          blockReason: "Falta Numero do Endereco do cliente.",
          billingStatusMessage: null
        };
      }
      return BILLED;
    });

    const result = await runInvoiceClosing(
      [
        candidate({ operationId: "op-1" }),
        candidate({ operationId: "op-2", customerName: "Beta" }),
        candidate({ operationId: "op-3" })
      ],
      bill
    );

    expect(bill).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ requested: 3, billed: 2, blocked: 1 });
    expect(result.items[1]).toMatchObject({
      status: "blocked",
      message: "Falta Numero do Endereco do cliente."
    });
  });

  it("um erro de rede vira falha daquela pesagem, e nao excecao da passada", async () => {
    const bill = vi.fn(async (operationId: string) => {
      if (operationId === "op-1") throw new Error("Sem internet");
      return BILLED;
    });

    const result = await runInvoiceClosing(
      [candidate({ operationId: "op-1" }), candidate({ operationId: "op-2" })],
      bill
    );

    expect(result).toMatchObject({ billed: 1, failed: 1 });
    expect(result.items[0]).toMatchObject({ status: "failed", message: "Sem internet" });
  });

  it("o OMIE que responde sem confirmar o faturamento conta como falha", async () => {
    const result = await runInvoiceClosing([candidate()], async () => ({
      billed: false,
      billingStatusMessage: null
    }));

    expect(result).toMatchObject({ billed: 0, failed: 1 });
    expect(result.items[0].message).toContain("nao confirmou");
  });

  it("informa o andamento contando so o que de fato vai ao OMIE", async () => {
    const progress: Array<{ done: number; total: number }> = [];

    await runInvoiceClosing(
      [
        candidate({ operationId: "ja-faturada", alreadyBilled: true }),
        candidate({ operationId: "op-2" }),
        candidate({ operationId: "op-3" })
      ],
      async () => BILLED,
      (step) => progress.push({ done: step.done, total: step.total })
    );

    // O total e o que vai ao OMIE (2), e nao as 3 linhas da tela: a ja faturada nao sobe.
    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 }
    ]);
  });

  it("o OMIE dizendo 'ja foi autorizado' e conciliacao, nao falha", async () => {
    // A atendente ja tinha faturado na coluna "Faturar" do OMIE. Antes isso voltava como
    // erro vermelho e o fechamento parecia ter quebrado, quando na verdade estava pronto.
    const result = await runInvoiceClosing([candidate()], async () => ({
      billed: true,
      alreadyBilledInOmie: true,
      billingStatusMessage: "Ja faturada no OMIE (o pedido la ja estava autorizado)."
    }));

    expect(result).toMatchObject({ billed: 0, alreadyBilled: 1, failed: 0, blocked: 0 });
    // Nao entra no total DESTA passada: ela nao faturou esse dinheiro agora.
    expect(result.billedTotalCents).toBe(0);
  });

  it("carga sem cliente nao vai ao OMIE e volta com o conserto na mensagem", async () => {
    const bill = vi.fn(async () => BILLED);

    const result = await runInvoiceClosing(
      [candidate({ operationId: "orfa", hasCustomer: false }), candidate({ operationId: "op-2" })],
      bill
    );

    expect(bill).toHaveBeenCalledTimes(1);
    expect(bill).toHaveBeenCalledWith("op-2");
    expect(result).toMatchObject({ billed: 1, blocked: 1 });
    expect(result.items[0]).toMatchObject({ status: "blocked" });
    expect(result.items[0].message).toContain("Vincule o cliente");
  });

  it("lista vazia devolve zeros em vez de estourar", async () => {
    const result = await runInvoiceClosing([], async () => BILLED);
    expect(result).toMatchObject({ requested: 0, billed: 0, items: [] });
  });

  it("NAO fatura a carga repetida — seriam duas notas da mesma carga", async () => {
    const bill = vi.fn(async () => BILLED);

    const result = await runInvoiceClosing(
      [
        candidate({ operationId: "repetida", couponNumber: 970, isDuplicate: true }),
        candidate({ operationId: "op-certa", couponNumber: 1126 })
      ],
      bill
    );

    expect(bill).toHaveBeenCalledTimes(1);
    expect(bill).toHaveBeenCalledWith("op-certa");
    expect(result).toMatchObject({ billed: 1, skipped: 1 });
    expect(result.items[0]?.message).toContain("repetida");
  });

  it("a repetida nao entra na contagem que a confirmacao mostra", () => {
    expect(
      countBillableCandidates([
        candidate({ operationId: "repetida", isDuplicate: true }),
        candidate({ operationId: "op-certa" })
      ])
    ).toBe(1);
  });
});

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
    isDuplicate: false,
    duplicateOfCouponNumber: null,
    ...overrides
  };
}

describe("selectInvoiceClosingCandidates", () => {
  it("marca como ja faturada tanto pela situacao quanto pelo numero da nota", () => {
    const candidates = selectInvoiceClosingCandidates([
      line({ operationId: "a", situation: "billed" }),
      // Nota conciliada com o OMIE sem a situacao ter virado: o numero manda.
      line({ operationId: "b", invoiceNumber: "28727" }),
      line({ operationId: "c" })
    ]);

    expect(candidates.map((item) => item.alreadyBilled)).toEqual([true, true, false]);
    expect(countBillableCandidates(candidates)).toBe(1);
  });

  it("a carga sem cliente nao conta como faturavel", () => {
    const candidates = selectInvoiceClosingCandidates([
      line({ operationId: "a", customerId: "" }),
      line({ operationId: "b" })
    ]);

    expect(candidates[0].hasCustomer).toBe(false);
    expect(countBillableCandidates(candidates)).toBe(1);
  });

  it("a venda interna nao conta como faturavel", () => {
    const candidates = selectInvoiceClosingCandidates([
      line({ operationId: "a", operationType: "internal" }),
      line({ operationId: "b" })
    ]);

    expect(countBillableCandidates(candidates)).toBe(1);
  });
});
