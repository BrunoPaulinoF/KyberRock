import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import { orderInstallmentPlan, resolveOrderPaymentSchedule } from "./order-installments";
import { createPaymentTerm } from "./payment-terms";

describe("orderInstallmentPlan", () => {
  it("soma os dias da condicao a emissao", () => {
    expect(
      orderInstallmentPlan(
        { issueDate: "2026-10-20", installmentDays: [45], installmentCount: 1 },
        78_000
      )
    ).toEqual([{ number: 1, dueDate: "2026-12-04", valueCents: 78_000 }]);
  });

  it("sem condicao e a vista: uma parcela vencendo na propria emissao", () => {
    expect(
      orderInstallmentPlan(
        { issueDate: "2026-10-20", installmentDays: null, installmentCount: null },
        78_000
      )
    ).toEqual([{ number: 1, dueDate: "2026-10-20", valueCents: 78_000 }]);
  });

  it("rateia o total entre as parcelas e a ultima absorve o arredondamento", () => {
    const plan = orderInstallmentPlan(
      { issueDate: "2026-10-20", installmentDays: [30, 60, 90], installmentCount: 3 },
      78_000
    );

    expect(plan).toEqual([
      { number: 1, dueDate: "2026-11-19", valueCents: 25_997 },
      { number: 2, dueDate: "2026-12-19", valueCents: 25_997 },
      { number: 3, dueDate: "2027-01-18", valueCents: 26_006 }
    ]);
    expect(plan.reduce((sum, installment) => sum + installment.valueCents, 0)).toBe(78_000);
  });

  it("so com a quantidade de parcelas, vence de 30 em 30 dias como no omie-sync", () => {
    expect(
      orderInstallmentPlan(
        { issueDate: "2026-10-20", installmentDays: null, installmentCount: 2 },
        10_000
      ).map((installment) => installment.dueDate)
    ).toEqual(["2026-11-19", "2026-12-19"]);
  });
});

describe("resolveOrderPaymentSchedule", () => {
  it("emite no dia em que a pesagem fechou, com os dias da condicao", () => {
    const database = createDatabase();

    try {
      const term = createPaymentTerm(database, {
        companyId: "company-1",
        name: "1 parcela em 45 dias",
        condition: "45"
      });

      expect(
        resolveOrderPaymentSchedule(database, term.id, "2026-10-20T13:00:00.000Z")
      ).toMatchObject({ issueDate: "2026-10-20", installmentDays: [45], installmentCount: 1 });
    } finally {
      database.close();
    }
  });

  // O horario da saida e gravado em UTC: 22h de 20/10 em Sao Paulo e 01h de 21/10 em UTC.
  // Cortando o texto, o pedido ia ao OMIE emitido em 21/10 e todo vencimento caia um dia
  // depois do que o operador via no cupom ("Saida: 20/10").
  it("a saida as 22h de Sao Paulo emite no proprio dia, nao no dia seguinte de UTC", () => {
    const database = createDatabase();

    try {
      const term = createPaymentTerm(database, {
        companyId: "company-1",
        name: "1 parcela em 45 dias",
        condition: "45"
      });

      const schedule = resolveOrderPaymentSchedule(database, term.id, "2026-10-21T01:00:00.000Z");
      expect(schedule.issueDate).toBe("2026-10-20");
      expect(orderInstallmentPlan(schedule, 78_000)).toEqual([
        { number: 1, dueDate: "2026-12-04", valueCents: 78_000 }
      ]);

      // Meia-noite em Sao Paulo (03h UTC) ja e o dia seguinte.
      expect(
        resolveOrderPaymentSchedule(database, term.id, "2026-10-21T03:00:00.000Z").issueDate
      ).toBe("2026-10-21");
    } finally {
      database.close();
    }
  });

  it("le os dias do rules_json quando a condicao chegou pela nuvem sem as colunas", () => {
    const database = createDatabase();

    try {
      const now = "2026-06-06T12:00:00.000Z";
      database
        .prepare(
          `INSERT INTO payment_terms (id, company_id, name, rules_json, is_active, created_at, updated_at)
           VALUES ('term-nuvem', 'company-1', '1 parcela em 45 dias', ?, 1, ?, ?)`
        )
        .run(JSON.stringify({ raw: "45", installments: [{ number: 1, dueDays: 45 }] }), now, now);

      expect(
        resolveOrderPaymentSchedule(database, "term-nuvem", "2026-10-20T13:00:00.000Z")
          .installmentDays
      ).toEqual([45]);
    } finally {
      database.close();
    }
  });

  it("sem condicao, nao ha prazo: o pedido sai a vista", () => {
    const database = createDatabase();

    try {
      expect(resolveOrderPaymentSchedule(database, null, "2026-10-20T13:00:00.000Z")).toEqual({
        issueDate: "2026-10-20",
        paymentTermOmieCode: null,
        installmentCount: null,
        installmentDays: null
      });
    } finally {
      database.close();
    }
  });
});

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: "device-1",
    deviceName: "PC Balanca",
    installationId: "install-1"
  });
  return database;
}
