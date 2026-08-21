import { describe, expect, it } from "vitest";

import {
  defaultInvoiceClosingPeriod,
  formatDayLabel,
  resolveInvoiceClosingPeriod,
  startOfWeek,
  toIsoDay,
  toIsoMonth
} from "./invoice-closing-period";
import type { InvoiceClosingPeriodSelection } from "./invoice-closing-period";

const NOW = new Date(2026, 7, 21); // 21/08/2026, sexta-feira

function selection(
  overrides: Partial<InvoiceClosingPeriodSelection> = {}
): InvoiceClosingPeriodSelection {
  return { ...defaultInvoiceClosingPeriod(NOW), ...overrides };
}

describe("resolveInvoiceClosingPeriod", () => {
  it("corta a quinzena em 1-15 e 16-fim do mes", () => {
    expect(resolveInvoiceClosingPeriod(selection({ half: 1 }), NOW)).toMatchObject({
      start: "2026-08-01",
      end: "2026-08-15",
      cycle: "biweekly"
    });
    expect(resolveInvoiceClosingPeriod(selection({ half: 2 }), NOW)).toMatchObject({
      start: "2026-08-16",
      end: "2026-08-31",
      cycle: "biweekly"
    });
  });

  it("a segunda quinzena termina no ultimo dia do mes, tambem em fevereiro bissexto", () => {
    expect(resolveInvoiceClosingPeriod(selection({ month: "2026-02", half: 2 }), NOW).end).toBe(
      "2026-02-28"
    );
    expect(resolveInvoiceClosingPeriod(selection({ month: "2028-02", half: 2 }), NOW).end).toBe(
      "2028-02-29"
    );
  });

  it("o mes vai do dia 1 ao ultimo — e nao 'ate hoje'", () => {
    // O preset de "mes atual" das outras telas para em hoje, que serve para acompanhar o
    // movimento. No fechamento isso cobraria meio mes: o mes fechado e o mes inteiro.
    expect(resolveInvoiceClosingPeriod(selection({ kind: "monthly" }), NOW)).toMatchObject({
      start: "2026-08-01",
      end: "2026-08-31",
      cycle: "monthly"
    });
  });

  it("a semana vai de segunda a domingo, mesmo escolhendo um domingo", () => {
    // 23/08/2026 e domingo: ele fecha a semana que comecou na segunda 17.
    expect(
      resolveInvoiceClosingPeriod(selection({ kind: "weekly", weekDay: "2026-08-23" }), NOW)
    ).toMatchObject({ start: "2026-08-17", end: "2026-08-23", cycle: "weekly" });
    expect(
      resolveInvoiceClosingPeriod(selection({ kind: "weekly", weekDay: "2026-08-17" }), NOW)
    ).toMatchObject({ start: "2026-08-17", end: "2026-08-23" });
  });

  it("o personalizado nao tem ciclo e destroca datas invertidas", () => {
    const range = resolveInvoiceClosingPeriod(
      selection({ kind: "custom", customStart: "2026-08-20", customEnd: "2026-08-05" }),
      NOW
    );
    expect(range).toMatchObject({ start: "2026-08-05", end: "2026-08-20", cycle: null });
  });

  it("campo vazio cai em hoje em vez de devolver periodo impossivel", () => {
    expect(
      resolveInvoiceClosingPeriod(
        selection({ kind: "custom", customStart: "", customEnd: "" }),
        NOW
      )
    ).toMatchObject({ start: "2026-08-21", end: "2026-08-21" });
    // Mes invalido cai no mes de hoje: a tela nunca fica sem periodo.
    expect(
      resolveInvoiceClosingPeriod(selection({ month: "abacaxi", half: 1 }), NOW)
    ).toMatchObject({ start: "2026-08-01", end: "2026-08-15" });
    expect(resolveInvoiceClosingPeriod(selection({ month: "2026-13", half: 1 }), NOW).start).toBe(
      "2026-08-01"
    );
  });

  it("a quinzena de estreia e a que contem hoje", () => {
    expect(defaultInvoiceClosingPeriod(new Date(2026, 7, 3))).toMatchObject({
      kind: "biweekly",
      month: "2026-08",
      half: 1
    });
    expect(defaultInvoiceClosingPeriod(new Date(2026, 7, 16)).half).toBe(2);
  });

  it("le a data pelo fuso LOCAL, e nao por UTC", () => {
    // `new Date("2026-08-16")` seria meia-noite UTC e, no Brasil, voltaria dia 15 — jogando
    // o primeiro dia da segunda quinzena para a primeira.
    const range = resolveInvoiceClosingPeriod(
      selection({ kind: "weekly", weekDay: "2026-08-16" }),
      NOW
    );
    // 16/08/2026 e domingo: a semana dele comecou na segunda 10.
    expect(range).toMatchObject({ start: "2026-08-10", end: "2026-08-16" });
  });
});

describe("auxiliares de data", () => {
  it("formata o dia e o mes locais", () => {
    expect(toIsoDay(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toIsoMonth(new Date(2026, 11, 31))).toBe("2026-12");
    expect(formatDayLabel("2026-08-16")).toBe("16/08/2026");
    expect(formatDayLabel("2026/08")).toBe("2026/08");
  });

  it("startOfWeek volta para a segunda-feira", () => {
    expect(toIsoDay(startOfWeek(new Date(2026, 7, 21)))).toBe("2026-08-17");
    expect(toIsoDay(startOfWeek(new Date(2026, 7, 17)))).toBe("2026-08-17");
    expect(toIsoDay(startOfWeek(new Date(2026, 7, 23)))).toBe("2026-08-17");
  });
});
