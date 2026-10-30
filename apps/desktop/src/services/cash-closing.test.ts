import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { noCustomerIdFor } from "@kyberrock/shared";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureDefaultAccounts } from "./accounts";
import { ensureInitialDesktopIdentity, type LocalDesktopIdentity } from "./bootstrap";
import { NO_ACCOUNT_KEY, getCashClosingReport, saveCashClosing } from "./cash-closing";
import { renderCashClosingHtml } from "./cash-closing-render";
import { applyDefaultAccountBindings, ensureDefaultPaymentMethods } from "./payment-methods";
import { createPaymentTerm } from "./payment-terms";

// 30/10/2026 em Sao Paulo: 13h local = 16h UTC.
const DAY = "2026-10-30";
const AT = "2026-10-30T16:00:00.000Z";

describe("fechamento do caixa do dia", () => {
  it("separa o recebido de cada conta, o que fica a receber e o que nao entra dinheiro", () => {
    const { database, identity } = createMachine();

    try {
      insertSale(database, { method: "cash", productCents: 50_000 });
      insertSale(database, { method: "cash", productCents: 25_000 });
      insertSale(database, { method: "pix", productCents: 30_000 });
      insertSale(database, { method: "debit_card", productCents: 20_000 });
      insertSale(database, { method: "boleto", productCents: 100_000 });
      insertSale(database, { method: "wallet", productCents: 40_000 });
      insertSale(database, { method: "customer_credit", productCents: 25_000 });
      insertSale(database, { method: "bonificacao", productCents: 10_000 });
      insertSale(database, {
        method: "cash",
        productCents: 0,
        customerId: noCustomerIdFor("company-1")
      });

      const report = getCashClosingReport(database, identity.unitId, DAY);

      expect(report.operations).toBe(9);
      expect(report.soldCents).toBe(300_000);
      expect(report.receivedCents).toBe(125_000);
      expect(accountsByName(report)).toEqual({
        Caixinha: 75_000,
        GetNet: 20_000,
        "OMIE Cash": 30_000
      });
      const caixinha = report.accounts.find((account) => account.accountName === "Caixinha");
      expect(caixinha?.sales).toEqual([
        { paymentMethodName: "Dinheiro", operations: 2, totalCents: 75_000 }
      ]);
      expect(report.receivables.map((line) => [line.kind, line.totalCents])).toEqual([
        ["boleto", 100_000],
        ["carteira", 40_000],
        ["fiado", 25_000]
      ]);
      expect(report.receivableCents).toBe(165_000);
      expect(report.noCharge.map((line) => [line.kind, line.operations, line.totalCents])).toEqual([
        ["bonificacao", 1, 10_000],
        ["sem_cobranca", 1, 0]
      ]);
      // Cada centavo vendido cai em exatamente um bloco.
      expect(report.receivedCents + report.receivableCents + report.noChargeCents).toBe(
        report.soldCents
      );
    } finally {
      database.close();
    }
  });

  it("condicao a prazo nao e caixa; a entrada da condicao entra no caixa do dia", () => {
    const { database, identity } = createMachine();

    try {
      const thirty = createPaymentTerm(database, {
        companyId: identity.companyId,
        name: "30 dias",
        condition: "30"
      });
      const withEntry = createPaymentTerm(database, {
        companyId: identity.companyId,
        name: "Entrada + 30",
        condition: "A Vista/30"
      });
      insertSale(database, { method: "pix", productCents: 60_000, paymentTermId: thirty.id });
      insertSale(database, { method: "pix", productCents: 100_000, paymentTermId: withEntry.id });

      const report = getCashClosingReport(database, identity.unitId, DAY);

      expect(accountsByName(report)).toEqual({ "OMIE Cash": 50_000 });
      expect(report.receivables).toEqual([
        { kind: "a_prazo", paymentMethodName: "Pix", operations: 2, totalCents: 110_000 }
      ]);
    } finally {
      database.close();
    }
  });

  it("o frete que fica so no sistema nao e cobrado no caixa", () => {
    const { database, identity } = createMachine();

    try {
      insertSale(database, {
        method: "cash",
        productCents: 50_000,
        freightCents: 10_000,
        freightType: "fob"
      });
      insertSale(database, {
        method: "cash",
        productCents: 50_000,
        freightCents: 10_000,
        freightType: "cif"
      });

      const report = getCashClosingReport(database, identity.unitId, DAY);

      expect(report.soldCents).toBe(110_000);
      expect(accountsByName(report)).toEqual({ Caixinha: 110_000 });
    } finally {
      database.close();
    }
  });

  it("a parte paga com o adiantamento nao entra no caixa nem fica a receber", () => {
    const { database, identity } = createMachine();

    try {
      insertSale(database, { method: "wallet", productCents: 40_000, advanceCents: 40_000 });
      insertSale(database, { method: "wallet", productCents: 50_000, advanceCents: 20_000 });

      const report = getCashClosingReport(database, identity.unitId, DAY);

      expect(report.receivables).toEqual([
        { kind: "carteira", paymentMethodName: "Em carteira", operations: 1, totalCents: 30_000 }
      ]);
      expect(report.noCharge).toEqual([
        { kind: "adiantamento", operations: 2, totalCents: 60_000 }
      ]);
    } finally {
      database.close();
    }
  });

  it("carteira paga hoje entra na conta da forma de recebimento", () => {
    const { database, identity } = createMachine();

    try {
      // Venda de dias atras, acertada hoje em dinheiro e hoje com boleto para 15 dias.
      insertSale(database, {
        method: "wallet",
        productCents: 70_000,
        exitAt: "2026-10-20T15:00:00.000Z",
        settledWith: "cash",
        settledAt: "2026-10-30T18:00:00.000Z"
      });
      insertSale(database, {
        method: "wallet",
        productCents: 80_000,
        exitAt: "2026-10-20T15:00:00.000Z",
        settledWith: "boleto",
        settledAt: "2026-10-30T18:00:00.000Z",
        settlementDueDate: "2026-11-14"
      });

      const report = getCashClosingReport(database, identity.unitId, DAY);

      expect(report.operations).toBe(0);
      expect(accountsByName(report)).toEqual({ Caixinha: 70_000 });
      expect(report.accounts[0].walletSettlements).toEqual([
        { paymentMethodName: "Dinheiro", operations: 1, totalCents: 70_000 }
      ]);
    } finally {
      database.close();
    }
  });

  it("o dia e o de Sao Paulo: a venda das 22h fica no proprio dia", () => {
    const { database, identity } = createMachine();

    try {
      // 22h30 de 30/10 em Sao Paulo = 01h30 de 31/10 em UTC.
      insertSale(database, {
        method: "cash",
        productCents: 10_000,
        exitAt: "2026-10-31T01:30:00Z"
      });
      // 23h de 29/10 em Sao Paulo = 02h de 30/10 em UTC: e do dia anterior.
      insertSale(database, {
        method: "cash",
        productCents: 99_000,
        exitAt: "2026-10-30T02:00:00Z"
      });

      expect(getCashClosingReport(database, identity.unitId, DAY).soldCents).toBe(10_000);
      expect(getCashClosingReport(database, identity.unitId, "2026-10-29").soldCents).toBe(99_000);
    } finally {
      database.close();
    }
  });

  it("venda cancelada nao entra; forma sem conta aparece separada", () => {
    const { database, identity } = createMachine();

    try {
      insertSale(database, { method: "cash", productCents: 50_000, status: "cancelled" });
      database
        .prepare("UPDATE payment_methods SET account_id = NULL WHERE code = 'debit_card'")
        .run();
      insertSale(database, { method: "debit_card", productCents: 15_000 });

      const report = getCashClosingReport(database, identity.unitId, DAY);

      expect(report.operations).toBe(1);
      expect(report.accounts).toHaveLength(1);
      expect(report.accounts[0]).toMatchObject({
        key: NO_ACCOUNT_KEY,
        accountName: "Sem conta vinculada",
        expectedCents: 15_000
      });
    } finally {
      database.close();
    }
  });

  it("salva a conferencia, substitui ao salvar de novo e registra na auditoria", () => {
    const { database, identity } = createMachine();

    try {
      insertSale(database, { method: "cash", productCents: 50_000 });
      const caixinha = getCashClosingReport(database, identity.unitId, DAY).accounts[0];

      saveCashClosing(database, {
        identity,
        date: DAY,
        countedCents: { [caixinha.key]: 49_000 },
        notes: "Faltou troco"
      });
      saveCashClosing(database, {
        identity,
        date: DAY,
        countedCents: { [caixinha.key]: 50_000 },
        notes: "Achado o troco"
      });

      const report = getCashClosingReport(database, identity.unitId, DAY);
      expect(report.saved).toMatchObject({
        countedCents: { [caixinha.key]: 50_000 },
        notes: "Achado o troco"
      });
      expect(
        database
          .prepare("SELECT COUNT(*) FROM audit_logs WHERE action = 'cash_closing_saved'")
          .pluck()
          .get()
      ).toBe(2);
      expect(() =>
        saveCashClosing(database, { identity, date: DAY, countedCents: { x: -1 } })
      ).toThrow("Valor conferido invalido.");

      const html = renderCashClosingHtml(report, "Pedreira Principal");
      expect(html).toContain("Fechamento do caixa");
      expect(html).toContain("Caixinha");
      expect(html).toContain("Achado o troco");
      expect(html).toContain("Responsavel pelo caixa");
    } finally {
      database.close();
    }
  });
});

interface SaleInput {
  method: string;
  productCents: number;
  freightCents?: number;
  freightType?: string;
  advanceCents?: number;
  paymentTermId?: string;
  customerId?: string;
  exitAt?: string;
  status?: string;
  settledWith?: string;
  settledAt?: string;
  settlementDueDate?: string;
}

function insertSale(database: DesktopDatabase, input: SaleInput): void {
  const methodId = (code: string) =>
    database.prepare("SELECT id FROM payment_methods WHERE code = ?").pluck().get(code) as string;
  const exitAt = input.exitAt ?? AT;
  const freight = input.freightCents ?? 0;
  database
    .prepare(
      `INSERT INTO weighing_operations (
         id, company_id, unit_id, device_id, status, operation_type, customer_id,
         payment_method_id, payment_term_id, entry_weight_kg, exit_weight_kg, net_weight_kg,
         exit_weight_captured_at, product_total_cents, freight_total_cents, freight_type,
         total_cents, omie_advance_settle_cents, wallet_settlement_method_id,
         wallet_settled_at, wallet_settlement_due_date, created_at, updated_at
       ) VALUES (?, 'company-1', 'unit-1', 'device-1', ?, 'invoice', ?, ?, ?, 12000, 18000, 6000,
         ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      randomUUID(),
      input.status ?? "closed_local",
      input.customerId ?? "customer-1",
      methodId(input.method),
      input.paymentTermId ?? null,
      exitAt,
      input.productCents,
      freight,
      input.freightType ?? "none",
      input.productCents + freight,
      input.advanceCents ?? 0,
      input.settledWith ? methodId(input.settledWith) : null,
      input.settledAt ?? null,
      input.settlementDueDate ?? null,
      exitAt,
      exitAt
    );
}

function accountsByName(report: ReturnType<typeof getCashClosingReport>): Record<string, number> {
  return Object.fromEntries(
    report.accounts.map((account) => [account.accountName, account.expectedCents])
  );
}

function createMachine(): { database: DesktopDatabase; identity: LocalDesktopIdentity } {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  const identity = ensureInitialDesktopIdentity(database, {
    companyId: "company-1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "unit-1",
    unitName: "Pedreira Principal",
    deviceId: "device-1",
    deviceName: "PC Balanca",
    installationId: "install-1"
  });
  ensureDefaultAccounts(database, identity.companyId);
  ensureDefaultPaymentMethods(database, identity.companyId);
  applyDefaultAccountBindings(database, identity.companyId);
  database
    .prepare(
      `INSERT INTO customers (id, company_id, source, legal_name, trade_name, is_active, created_at, updated_at)
       VALUES ('customer-1', 'company-1', 'local', 'Cliente LTDA', 'Cliente', 1, ?, ?),
              (?, 'company-1', 'local', 'SEM CLIENTE', 'SEM CLIENTE', 1, ?, ?)`
    )
    .run(AT, AT, noCustomerIdFor("company-1"), AT, AT);
  return { database, identity };
}
