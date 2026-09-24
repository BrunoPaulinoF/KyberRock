import { describe, expect, it } from "vitest";

import type { Customer, Operation } from "./queries";
import { buildWalletReport, splitSelection, toWalletOperation } from "./wallet";

function op(id: string, extra: Partial<Operation> = {}): Operation {
  return {
    id,
    status: "synced",
    customer_id: "c1",
    customer_name: "CLIENTE UM",
    plate: "ABC1D23",
    product_description: "PEDRISCO",
    net_weight_kg: 26000,
    total_cents: 100000,
    omie_advance_settle_cents: null,
    created_at: "2026-09-10T12:00:00.000Z",
    closed_at: "2026-09-10T13:00:00.000Z",
    wallet_settled_at: null,
    wallet_settlement_method_id: null,
    wallet_settlement_due_date: null,
    wallet_settlement_note: null,
    ...extra
  } as Operation;
}

const customers = [
  { id: "c1", trade_name: "ALFA", document: "12.345.678/0001-90", omie_customer_id: null },
  { id: "c1b", trade_name: "ALFA (BALANCA)", document: "12345678000190", omie_customer_id: null },
  { id: "c2", trade_name: "BETA", document: null, omie_customer_id: null }
] as Customer[];

const methods = [{ id: "pix", name: "PIX", alias: "Pix na conta" }];

describe("carteira", () => {
  it("separa o que o adiantamento cobriu do que ainda ha para receber", () => {
    const row = toWalletOperation(
      op("o1", { omie_advance_settle_cents: 30000 }),
      undefined,
      new Map()
    );
    expect(row.advanceAppliedCents).toBe(30000);
    expect(row.openAmountCents).toBe(70000);
    // Adiantamento maior que a venda nao vira "a receber" negativo.
    expect(
      toWalletOperation(op("o2", { omie_advance_settle_cents: 999999 }), undefined, new Map())
        .openAmountCents
    ).toBe(0);
  });

  it("quitada pelo adiantamento: fechada sem forma de recebimento", () => {
    const row = toWalletOperation(
      op("o1", { omie_advance_settle_cents: 100000, wallet_settled_at: "2026-09-10T13:00:00Z" }),
      undefined,
      new Map()
    );
    expect(row.settledByAdvance).toBe(true);
  });

  it("agrupa pelo cliente real, maior total primeiro, e soma o resumo", () => {
    const report = buildWalletReport(
      [
        op("o1", { total_cents: 50000 }),
        op("o2", { customer_id: "c1b", total_cents: 70000, omie_advance_settle_cents: 20000 }),
        op("o3", {
          customer_id: "c2",
          total_cents: 90000,
          wallet_settled_at: "2026-09-12T10:00:00Z",
          wallet_settlement_method_id: "pix"
        }),
        op("o4", { status: "cancelled" })
      ],
      { customers, methods }
    );
    expect(report.groups.map((group) => group.customerName)).toEqual(["ALFA", "BETA"]);
    expect(report.groups[0]).toMatchObject({ totalCents: 120000, openTotalCents: 100000 });
    expect(report.groups[1].operations[0].settlementMethodName).toBe("Pix na conta");
    expect(report.summary).toEqual({
      openCount: 2,
      openTotalCents: 100000,
      settledCount: 1,
      settledTotalCents: 90000,
      advanceAppliedTotalCents: 20000
    });
  });

  it("busca por cliente, placa ou produto", () => {
    const report = buildWalletReport(
      [op("o1"), op("o2", { customer_id: "c2", plate: "XYZ9K88" })],
      { customers, methods, search: "xyz-9k88" }
    );
    expect(report.groups.map((group) => group.customerName)).toEqual(["BETA"]);
  });

  it("fechar leva so as em aberto; reabrir, so as fechadas a mao", () => {
    const rows = [
      op("open"),
      op("settled", {
        wallet_settled_at: "2026-09-12T10:00:00Z",
        wallet_settlement_method_id: "pix"
      }),
      op("advance", {
        wallet_settled_at: "2026-09-12T10:00:00Z",
        omie_advance_settle_cents: 100000
      })
    ].map((row) => toWalletOperation(row, undefined, new Map()));
    expect(splitSelection(rows)).toMatchObject({
      openIds: ["open"],
      reopenIds: ["settled"]
    });
  });
});
