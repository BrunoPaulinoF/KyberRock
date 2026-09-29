import { beforeEach, describe, expect, it, vi } from "vitest";

const callWebApi = vi.fn();
vi.mock("./api", () => ({ callWebApi: (...args: unknown[]) => callWebApi(...args) }));

const { creditBalance, loadOmieBalance, parseOmieBalance, signedCreditCents } =
  await import("./customer-balance");

describe("credito no KyberRock", () => {
  it("venda no credito tira, adiantamento e acerto poem (mesma conta da balanca)", () => {
    expect(signedCreditCents({ movement_type: "debit_product", amount_cents: 500 })).toBe(-500);
    expect(signedCreditCents({ movement_type: "debit_freight", amount_cents: 100 })).toBe(-100);
    expect(signedCreditCents({ movement_type: "credit", amount_cents: 1000 })).toBe(1000);
    expect(
      creditBalance([
        { movement_type: "credit", amount_cents: 10_000 },
        { movement_type: "debit_product", amount_cents: 6_500 },
        { movement_type: "refund_product", amount_cents: 500 },
        { movement_type: "manual_adjustment", amount_cents: -1_000 }
      ])
    ).toEqual({ balanceCents: 3_000, movements: 4 });
  });
});

describe("saldo no OMIE", () => {
  it("le a resposta ok campo a campo", () => {
    expect(
      parseOmieBalance({
        status: "ok",
        openCents: "150000",
        openTitles: 2,
        overdueCents: 100000,
        overdueTitles: 1,
        nextDueDate: "2026-10-15",
        byInvoice: [
          { invoiceNumber: "4101", issueDate: "2026-09-01", openCents: "100000", openTitles: 1 },
          { invoiceNumber: "", openCents: 50000 },
          null
        ],
        truncated: true,
        checkedAt: "2026-09-29T12:00:00Z"
      })
    ).toEqual({
      status: "ok",
      openCents: 150000,
      openTitles: 2,
      overdueCents: 100000,
      overdueTitles: 1,
      nextDueDate: "2026-10-15",
      byInvoice: [
        {
          invoiceNumber: "4101",
          issueDate: "2026-09-01",
          openCents: 100000,
          openTitles: 1,
          overdueCents: 0,
          overdueTitles: 0,
          nextDueDate: null
        },
        {
          invoiceNumber: null,
          issueDate: null,
          openCents: 50000,
          openTitles: 0,
          overdueCents: 0,
          overdueTitles: 0,
          nextDueDate: null
        }
      ],
      truncated: true,
      checkedAt: "2026-09-29T12:00:00Z"
    });
  });

  it("sem codigo OMIE e resposta estranha", () => {
    expect(parseOmieBalance({ status: "not_linked" })).toEqual({ status: "not_linked" });
    expect(parseOmieBalance({ status: "unavailable", message: "fora do ar" })).toEqual({
      status: "unavailable",
      message: "fora do ar"
    });
    expect(parseOmieBalance({})).toMatchObject({ status: "unavailable" });
  });
});

describe("loadOmieBalance", () => {
  beforeEach(() => callWebApi.mockReset());

  it("guarda a resposta por 2 minutos; forcar pergunta de novo", async () => {
    callWebApi.mockResolvedValue({ status: "ok", openCents: 100 });
    await loadOmieBalance("c-cache", { now: 0 });
    await loadOmieBalance("c-cache", { now: 60_000 });
    expect(callWebApi).toHaveBeenCalledTimes(1);
    await loadOmieBalance("c-cache", { now: 60_000, force: true });
    await loadOmieBalance("c-cache", { now: 200_000 });
    expect(callWebApi).toHaveBeenCalledTimes(3);
  });

  it("falha nao fica guardada", async () => {
    callWebApi.mockRejectedValueOnce(new Error("fora do ar"));
    expect(await loadOmieBalance("c-falha", { now: 0 })).toEqual({
      status: "unavailable",
      message: "fora do ar"
    });
    callWebApi.mockResolvedValueOnce({ status: "not_linked" });
    expect(await loadOmieBalance("c-falha", { now: 1_000 })).toEqual({ status: "not_linked" });
    expect(callWebApi).toHaveBeenCalledTimes(2);
  });
});
