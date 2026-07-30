import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { defaultFinancialTime, isSameHourAsKyberRock } from "./financial-report-schedule";

const rendererDir = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(resolve(rendererDir, file), "utf8");

describe("horario proprio do relatorio financeiro", () => {
  it("sugere a hora seguinte a dos relatorios do KyberRock", () => {
    expect(defaultFinancialTime(18)).toBe("19:00");
    expect(defaultFinancialTime(0)).toBe("01:00");
  });

  it("da a volta no dia quando os relatorios do KyberRock saem as 23h", () => {
    expect(defaultFinancialTime(23)).toBe("00:00");
  });

  it("cai num horario valido quando a hora do KyberRock e invalida", () => {
    expect(defaultFinancialTime(Number.NaN)).toBe("19:00");
    expect(defaultFinancialTime(-1)).toBe("19:00");
    expect(defaultFinancialTime(99)).toBe("19:00");
  });

  it("detecta colisao com o horario dos relatorios do KyberRock", () => {
    expect(isSameHourAsKyberRock("18:00", 18)).toBe(true);
    expect(isSameHourAsKyberRock("19:00", 18)).toBe(false);
    expect(isSameHourAsKyberRock(null, 18)).toBe(false);
  });
});

describe("FinancialReportSettings", () => {
  const source = read("FinancialReportSettings.tsx");

  it("lists the recipients so the OMIE report can be turned on per person", () => {
    expect(source).toContain("Relatorio financeiro (OMIE)");
    expect(source).toContain("Recebe o financeiro");
    expect(source).toContain("sendFinancial");
    expect(source).toContain('type="checkbox"');
  });

  it("always assigns the OMIE report its own whole hour, never the KyberRock one", () => {
    expect(source).toContain("Horario do OMIE");
    expect(source).toContain("defaultFinancialTime(kyberRockHour)");
    // Nada de "mesmo horario dos demais": o financeiro nunca herda a hora dos
    // relatorios do KyberRock.
    expect(source).not.toContain("Mesmo horario dos demais");
    // Hora cheia: o agendador da nuvem so olha a hora.
    expect(source).not.toContain('type="time"');
  });

  it("warns when a recipient collides with the KyberRock reports hour", () => {
    expect(source).toContain("isSameHourAsKyberRock");
    expect(source).toContain("mesmo horario dos relatorios");
    expect(source).toContain("getReportDispatchConfig");
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

  it("has a send-now button for testing the OMIE dispatch", () => {
    expect(source).toContain("sendFinancialReportNow");
    expect(source).toContain("Enviar financeiro agora");
    // Sem destinatario marcado nao ha o que enviar.
    expect(source).toContain("activeFinancial.length === 0");
  });

  it("is rendered by the reports view with the loaded recipients", () => {
    const reportsSource = read("ReportsView.tsx");

    expect(reportsSource).toContain("FinancialReportSettings");
    expect(reportsSource).toContain("recipients={recipients}");
    expect(reportsSource).toContain("onChanged={loadRecipients}");
  });

  it("owns the financial settings alone — the recipient form only points to it", () => {
    const reportsSource = read("ReportsView.tsx");

    // O formulario do destinatario nao edita mais o financeiro, para o gate de
    // senha do card ser o unico caminho para ligar o OMIE.
    expect(reportsSource).not.toContain("PriceChangePasswordDialog");
    expect(reportsSource).toContain('card &quot;Relatorio financeiro (OMIE)&quot;');
  });
});
