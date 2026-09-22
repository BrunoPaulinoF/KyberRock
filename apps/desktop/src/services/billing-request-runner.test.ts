import { describe, expect, it, vi } from "vitest";

import {
  outcomeFromBilling,
  outcomeFromError,
  runBillingRequests,
  type BillingRequestClaim
} from "./billing-request-runner";

const claim: BillingRequestClaim = { id: "r-1", operationId: "op-1" };

describe("outcomeFromBilling", () => {
  it("faturada vira done com a mensagem do OMIE", () => {
    expect(
      outcomeFromBilling(claim, { billed: true, billingStatusMessage: "Faturado — NF-e 28727." })
    ).toEqual({ id: "r-1", status: "done", message: "Faturado — NF-e 28727." });
  });

  it("ja faturada no OMIE tambem e done (nao ha o que refazer)", () => {
    expect(
      outcomeFromBilling(claim, {
        billed: true,
        alreadyBilledInOmie: true,
        billingStatusMessage: null
      })
    ).toMatchObject({ status: "done", message: "Ja estava faturada no OMIE." });
  });

  it("bloqueio por cadastro devolve o motivo acionavel", () => {
    expect(
      outcomeFromBilling(claim, {
        billed: false,
        blocked: true,
        blockReason: "Preencha o numero do endereco do cliente.",
        billingStatusMessage: null
      })
    ).toEqual({
      id: "r-1",
      status: "failed",
      message: "Preencha o numero do endereco do cliente."
    });
  });

  it("excecao vira failed com a mensagem, nunca some da fila", () => {
    expect(outcomeFromError(claim, new Error("OMIE fora do ar"))).toEqual({
      id: "r-1",
      status: "failed",
      message: "OMIE fora do ar"
    });
  });
});

describe("runBillingRequests", () => {
  it("sem pedido nao fatura nem reporta", async () => {
    const bill = vi.fn();
    const report = vi.fn();
    const result = await runBillingRequests({ claim: async () => [], bill, report });
    expect(result).toEqual({ claimed: 0, done: 0, failed: 0 });
    expect(bill).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("fatura cada pedido, sobe a operacao e devolve um relatorio so", async () => {
    const bill = vi
      .fn()
      .mockResolvedValueOnce({ billed: true, billingStatusMessage: "NF-e 1" })
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        billed: false,
        blocked: true,
        blockReason: "sem CNPJ",
        billingStatusMessage: null
      });
    const report = vi.fn().mockResolvedValue(undefined);
    const afterBilled = vi.fn();

    const result = await runBillingRequests({
      claim: async () => [
        { id: "r-1", operationId: "op-1" },
        { id: "r-2", operationId: "op-2" },
        { id: "r-3", operationId: "op-3" }
      ],
      bill,
      report,
      afterBilled
    });

    expect(result).toEqual({ claimed: 3, done: 1, failed: 2 });
    expect(afterBilled.mock.calls.map((c) => c[0])).toEqual(["op-1", "op-2", "op-3"]);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toEqual([
      { id: "r-1", status: "done", message: "NF-e 1" },
      { id: "r-2", status: "failed", message: "timeout" },
      { id: "r-3", status: "failed", message: "sem CNPJ" }
    ]);
  });
});
