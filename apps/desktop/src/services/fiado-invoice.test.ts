import { describe, expect, it } from "vitest";

import {
  buildFiadoInvoiceDraft,
  buildFiadoInvoiceIdempotencyKey,
  FIADO_INVOICE_ACCOUNT_CODE
} from "./fiado-invoice.js";
import type { CreditClosingConfig } from "./credit-invoice.js";

const monthly: CreditClosingConfig = { periodicity: "monthly", closingDay: 15, boletoDays: 7 };

describe("buildFiadoInvoiceIdempotencyKey", () => {
  it("is deterministic per unit + customer + closing date", () => {
    const a = buildFiadoInvoiceIdempotencyKey("unit_1", "cust_1", "2026-03-15");
    const b = buildFiadoInvoiceIdempotencyKey("unit_1", "cust_1", "2026-03-15");
    expect(a).toBe(b);
    expect(a).toBe("kyberrock:unit_1:fiado_cust_1_2026-03-15:create_sales_order");
  });

  it("differs across closing dates so each period launches once", () => {
    expect(buildFiadoInvoiceIdempotencyKey("u", "c", "2026-03-15")).not.toBe(
      buildFiadoInvoiceIdempotencyKey("u", "c", "2026-04-15")
    );
  });
});

describe("buildFiadoInvoiceDraft", () => {
  it("consolidates the period operations into a single invoice via OMIE Cash", () => {
    const draft = buildFiadoInvoiceDraft({
      unitId: "unit_1",
      customerId: "cust_1",
      closingConfig: monthly,
      referenceDate: new Date(2026, 2, 10),
      operations: [
        { operationId: "op_1", amountCents: 10_000 },
        { operationId: "op_2", amountCents: 25_500 },
        { operationId: "op_3", amountCents: 4_500 }
      ]
    });

    expect(draft.totalCents).toBe(40_000);
    expect(draft.operationIds).toEqual(["op_1", "op_2", "op_3"]);
    expect(draft.closingDate).toBe("2026-03-15");
    expect(draft.dueDate).toBe("2026-03-22");
    expect(draft.accountCode).toBe(FIADO_INVOICE_ACCOUNT_CODE);
    expect(draft.accountCode).toBe("omie_cash");
    expect(draft.idempotencyKey).toBe(
      "kyberrock:unit_1:fiado_cust_1_2026-03-15:create_sales_order"
    );
  });

  it("gives the same idempotency key for operations that fall in the same closing", () => {
    const common = { unitId: "u", customerId: "c", closingConfig: monthly } as const;
    const first = buildFiadoInvoiceDraft({
      ...common,
      referenceDate: new Date(2026, 2, 3),
      operations: [{ operationId: "a", amountCents: 100 }]
    });
    const second = buildFiadoInvoiceDraft({
      ...common,
      referenceDate: new Date(2026, 2, 12),
      operations: [{ operationId: "b", amountCents: 200 }]
    });
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
  });

  it("rejects an empty period", () => {
    expect(() =>
      buildFiadoInvoiceDraft({
        unitId: "u",
        customerId: "c",
        closingConfig: monthly,
        referenceDate: new Date(2026, 2, 10),
        operations: []
      })
    ).toThrow(/nenhuma operacao/i);
  });

  it("rejects an invalid amount", () => {
    expect(() =>
      buildFiadoInvoiceDraft({
        unitId: "u",
        customerId: "c",
        closingConfig: monthly,
        referenceDate: new Date(2026, 2, 10),
        operations: [{ operationId: "op_x", amountCents: -1 }]
      })
    ).toThrow(/op_x/);
  });
});
