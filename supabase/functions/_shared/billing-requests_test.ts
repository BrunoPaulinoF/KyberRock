import { describe, expect, it } from "vitest";

import {
  BILLING_REQUEST_CLAIM_TIMEOUT_MS,
  isStaleClaim,
  selectOperationsForBillingRequest
} from "./billing-requests";

const invoice = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  operation_type: "invoice",
  status: "synced",
  omie_billing_status: null,
  omie_invoice_number: null,
  ...extra
});

describe("selectOperationsForBillingRequest", () => {
  it("aceita a venda com nota concluida e sem nota emitida", () => {
    expect(selectOperationsForBillingRequest([invoice("op-1")], [])).toEqual({
      eligible: ["op-1"],
      skipped: []
    });
  });

  it("nunca refatura: quem tem NF-e ou ja esta billed sai com o motivo", () => {
    const result = selectOperationsForBillingRequest(
      [
        invoice("op-1", { omie_invoice_number: "28727" }),
        invoice("op-2", { omie_billing_status: "billed" })
      ],
      []
    );
    expect(result.eligible).toEqual([]);
    expect(result.skipped[0].reason).toContain("28727");
    expect(result.skipped[1].reason).toContain("faturada");
  });

  it("venda interna, cancelada e em andamento ficam de fora", () => {
    const result = selectOperationsForBillingRequest(
      [
        invoice("op-1", { operation_type: "internal" }),
        invoice("op-2", { status: "cancelled" }),
        invoice("op-3", { status: "open" })
      ],
      []
    );
    expect(result.eligible).toEqual([]);
    expect(result.skipped.map((s) => s.operationId)).toEqual(["op-1", "op-2", "op-3"]);
  });

  it("pesagem com pedido pendente ou em processamento nao entra de novo; concluido pode", () => {
    const result = selectOperationsForBillingRequest(
      [invoice("op-1"), invoice("op-2"), invoice("op-3")],
      [
        { operation_id: "op-1", status: "pending" },
        { operation_id: "op-2", status: "processing" },
        { operation_id: "op-3", status: "failed" }
      ]
    );
    expect(result.eligible).toEqual(["op-3"]);
  });

  it("id repetido no pedido conta uma vez", () => {
    const result = selectOperationsForBillingRequest([invoice("op-1"), invoice("op-1")], []);
    expect(result.eligible).toEqual(["op-1"]);
  });
});

describe("isStaleClaim", () => {
  const now = new Date("2026-09-22T15:00:00.000Z");

  it("pedido pego ha pouco continua com a balanca", () => {
    expect(isStaleClaim("2026-09-22T14:50:00.000Z", now)).toBe(false);
  });

  it("pedido abandonado volta para a fila", () => {
    const old = new Date(now.getTime() - BILLING_REQUEST_CLAIM_TIMEOUT_MS - 1).toISOString();
    expect(isStaleClaim(old, now)).toBe(true);
    expect(isStaleClaim(null, now)).toBe(true);
    expect(isStaleClaim("nao e data", now)).toBe(true);
  });
});
