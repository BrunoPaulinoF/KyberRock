import { describe, expect, it } from "vitest";

import { quarryToday, summarizeOpenReceivables } from "./omie-open-receivables.ts";

const TODAY = "2026-09-29";

describe("summarizeOpenReceivables", () => {
  it("soma o que falta receber e separa o vencido", () => {
    const summary = summarizeOpenReceivables(
      [
        // Vencido e sem baixa.
        {
          codigo_lancamento_omie: 1,
          valor_documento: 1000,
          data_vencimento: "10/09/2026",
          status_titulo: "ATRASADO"
        },
        // Baixa parcial: falta 300.
        {
          codigo_lancamento_omie: 2,
          valor_documento: 500,
          valor_pago: 200,
          data_vencimento: "15/10/2026",
          status_titulo: "A VENCER"
        },
        // Vence hoje: ainda nao e vencido.
        {
          codigo_lancamento_omie: 3,
          valor_documento: 100,
          data_vencimento: "29/09/2026",
          status_titulo: "VENCE HOJE"
        }
      ],
      TODAY
    );
    expect(summary).toEqual({
      openCents: 140_000,
      openTitles: 3,
      overdueCents: 100_000,
      overdueTitles: 1,
      nextDueDate: "2026-09-29"
    });
  });

  it("titulo quitado, cancelado ou repetido nao entra", () => {
    const summary = summarizeOpenReceivables(
      [
        { codigo_lancamento_omie: 1, valor_documento: 800, status_titulo: "RECEBIDO" },
        { codigo_lancamento_omie: 2, valor_documento: 800, status_titulo: "CANCELADO" },
        { codigo_lancamento_omie: 3, valor_documento: 50, data_vencimento: "01/10/2026" },
        { codigo_lancamento_omie: 3, valor_documento: 50, data_vencimento: "01/10/2026" },
        { valor_documento: 999 }
      ],
      TODAY
    );
    expect(summary).toMatchObject({ openCents: 5_000, openTitles: 1, overdueTitles: 0 });
  });

  it("sem titulo nenhum e tudo zero", () => {
    expect(summarizeOpenReceivables([], TODAY)).toEqual({
      openCents: 0,
      openTitles: 0,
      overdueCents: 0,
      overdueTitles: 0,
      nextDueDate: null
    });
  });
});

describe("quarryToday", () => {
  it("usa o fuso da pedreira, nao o UTC", () => {
    // 01:30 UTC do dia 30 ainda e dia 29 em Sao Paulo.
    expect(quarryToday(new Date("2026-09-30T01:30:00Z"))).toBe("2026-09-29");
    expect(quarryToday(new Date("2026-09-30T12:00:00Z"))).toBe("2026-09-30");
  });
});
