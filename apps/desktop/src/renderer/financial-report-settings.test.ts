import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const rendererDir = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(rendererDir, file), "utf8");

describe("FinancialReportSettings", () => {
  const source = read("FinancialReportSettings.tsx");

  it("lists the recipients so the OMIE report can be turned on per person", () => {
    expect(source).toContain("Relatorio financeiro (OMIE)");
    expect(source).toContain("Recebe o financeiro");
    expect(source).toContain("sendFinancial");
    expect(source).toContain('type="checkbox"');
  });

  it("offers a whole-hour schedule per recipient, falling back to the general one", () => {
    expect(source).toContain("Horario do envio");
    expect(source).toContain("Mesmo horario dos demais relatorios");
    expect(source).toContain("financialScheduleTime");
    // O agendador da nuvem so olha a hora cheia; nada de input de minutos.
    expect(source).not.toContain('type="time"');
  });

  it("saves each change through the recipient update API", () => {
    expect(source).toContain("updateReportRecipient");
    expect(source).toContain("onChanged");
  });

  it("requires the unit password before releasing the financial report", () => {
    expect(source).toContain("PriceChangePasswordDialog");
    expect(source).toContain("verifyPriceChangePassword");
    // Desligar nao pede senha; ligar em lote pede uma vez so.
    expect(source).toContain("if (!unlocked)");
  });

  it("clears the specific hour when the financial report is turned off", () => {
    expect(source).toContain("sendFinancial: false, financialScheduleTime: null");
  });

  it("is rendered by the reports view with the loaded recipients", () => {
    const reportsSource = read("ReportsView.tsx");

    expect(reportsSource).toContain("FinancialReportSettings");
    expect(reportsSource).toContain("recipients={recipients}");
    expect(reportsSource).toContain("onChanged={loadRecipients}");
  });

  it("keeps the recipient form hour picker on whole hours too", () => {
    const reportsSource = read("ReportsView.tsx");

    expect(reportsSource).toContain("FINANCIAL_HOURS");
    expect(reportsSource).toContain("Mesmo horario dos demais relatorios");
  });
});
