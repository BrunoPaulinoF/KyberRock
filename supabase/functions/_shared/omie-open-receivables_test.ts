import { describe, expect, it } from "vitest";

import {
  quarryToday,
  receivableInvoiceNumber,
  summarizeOpenReceivables
} from "./omie-open-receivables.ts";

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
    expect(summary).toMatchObject({
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
      nextDueDate: null,
      byInvoice: []
    });
  });

  it("separa o saldo por nota fiscal: maior primeiro, os sem nota no fim", () => {
    const summary = summarizeOpenReceivables(
      [
        // NF 4101, duas parcelas: uma vencida, outra a vencer.
        {
          codigo_lancamento_omie: 1,
          numero_documento_fiscal: "000004101",
          valor_documento: 500_000,
          data_emissao: "01/09/2026",
          data_vencimento: "20/09/2026"
        },
        {
          codigo_lancamento_omie: 2,
          numero_documento_fiscal: "4101",
          valor_documento: 500_000,
          data_emissao: "01/09/2026",
          data_vencimento: "20/10/2026"
        },
        // NF 4200 so pela chave de acesso.
        {
          codigo_lancamento_omie: 3,
          chave_nfe: "35260912345678000190550010000042001123456789",
          valor_documento: 500_000,
          data_emissao: "05/09/2026",
          data_vencimento: "05/10/2026"
        },
        // Sem nota nenhuma.
        { codigo_lancamento_omie: 4, valor_documento: 150, data_vencimento: "01/09/2026" }
      ],
      TODAY
    );
    expect(summary.openCents).toBe(150_015_000);
    expect(summary.byInvoice).toEqual([
      {
        invoiceNumber: "4101",
        issueDate: "2026-09-01",
        openCents: 100_000_000,
        openTitles: 2,
        overdueCents: 50_000_000,
        overdueTitles: 1,
        nextDueDate: "2026-10-20"
      },
      {
        invoiceNumber: "4200",
        issueDate: "2026-09-05",
        openCents: 50_000_000,
        openTitles: 1,
        overdueCents: 0,
        overdueTitles: 0,
        nextDueDate: "2026-10-05"
      },
      {
        invoiceNumber: null,
        issueDate: null,
        openCents: 15_000,
        openTitles: 1,
        overdueCents: 15_000,
        overdueTitles: 1,
        nextDueDate: null
      }
    ]);
  });
});

describe("receivableInvoiceNumber", () => {
  it("campo proprio, depois a chave de acesso; sem os zeros a esquerda", () => {
    expect(receivableInvoiceNumber({ numero_documento_fiscal: "000029490" })).toBe("29490");
    expect(
      receivableInvoiceNumber({ chave_nfe: "35260912345678000190550010000294901123456789" })
    ).toBe("29490");
    expect(receivableInvoiceNumber({ chave_nfe: "123" })).toBeNull();
    expect(receivableInvoiceNumber({ numero_documento_fiscal: "0" })).toBeNull();
  });
});

describe("quarryToday", () => {
  it("usa o fuso da pedreira, nao o UTC", () => {
    // 01:30 UTC do dia 30 ainda e dia 29 em Sao Paulo.
    expect(quarryToday(new Date("2026-09-30T01:30:00Z"))).toBe("2026-09-29");
    expect(quarryToday(new Date("2026-09-30T12:00:00Z"))).toBe("2026-09-30");
  });
});
