import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import { CreditService } from "./credit";

describe("credit service", () => {
  it("banks a credit sale with the customer credit limit", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { creditLimitCents: 2_000_000, creditMode: "prepaid" });
      const service = new CreditService(database);

      // O bug relatado: limite de 20.000 cadastrado, saldo do extrato zerado e o
      // fechamento acusava "Credito insuficiente. Disponivel: R$ 0,00".
      expect(service.validateDebit("customer-1", 11_424)).toMatchObject({
        allowed: true,
        availableBalanceCents: 2_000_000
      });

      const summary = service.getSummary("customer-1");
      expect(summary).toMatchObject({
        creditLimitCents: 2_000_000,
        balanceCents: 0,
        usedCents: 0,
        availableCents: 2_000_000
      });
    } finally {
      database.close();
    }
  });

  it("consumes the limit as sales are debited and frees it when paid", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { creditLimitCents: 100_000, creditMode: "prepaid" });
      const service = new CreditService(database);
      insertOperation(database, "operation-1");

      service.applyDebit("customer-1", "operation-1", 60_000, 0);
      expect(service.getSummary("customer-1")).toMatchObject({
        balanceCents: -60_000,
        usedCents: 60_000,
        availableCents: 40_000
      });
      expect(service.validateDebit("customer-1", 50_000).allowed).toBe(false);

      // Cliente pagou a fatura: o credito volta e libera o limite para novas compras.
      service.applyCredit("customer-1", 60_000, "boleto pago");
      expect(service.getSummary("customer-1")).toMatchObject({
        balanceCents: 0,
        usedCents: 0,
        availableCents: 100_000
      });
      expect(service.validateDebit("customer-1", 50_000).allowed).toBe(true);
    } finally {
      database.close();
    }
  });

  it("explains the block when the limit is exhausted", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { creditLimitCents: 10_000, creditMode: "prepaid" });
      const service = new CreditService(database);
      insertOperation(database, "operation-1");
      service.applyDebit("customer-1", "operation-1", 10_000, 0);

      const result = service.validateDebit("customer-1", 5_000);
      expect(result.allowed).toBe(false);
      expect(result.message).toContain("limite R$ 100.00");
      expect(result.message).toContain("utilizado R$ 100.00");
    } finally {
      database.close();
    }
  });

  it("keeps prepaid customers without a limit capped by their balance", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { creditLimitCents: null, creditMode: "prepaid" });
      const service = new CreditService(database);
      service.applyCredit("customer-1", 70_000, "deposito");

      expect(service.validateDebit("customer-1", 70_000).allowed).toBe(true);
      expect(service.validateDebit("customer-1", 78_000).allowed).toBe(false);
      expect(service.getSummary("customer-1").availableCents).toBe(70_000);
    } finally {
      database.close();
    }
  });

  it("does not cap a customer without a credit limit outside prepaid mode", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { creditLimitCents: null, creditMode: "normal" });
      const service = new CreditService(database);

      expect(service.validateDebit("customer-1", 500_000).allowed).toBe(true);
      expect(service.getSummary("customer-1").availableCents).toBeNull();
    } finally {
      database.close();
    }
  });

  it("treats a zero credit limit as no limit at all", () => {
    const database = createDatabase();

    try {
      // Cadastro vindo do OMIE costuma chegar com limite zero: isso significa
      // "sem limite cadastrado", nao "bloquear todas as vendas no credito".
      insertCustomer(database, { creditLimitCents: 0, creditMode: "normal" });
      const service = new CreditService(database);
      insertOperation(database, "operation-1");
      service.applyDebit("customer-1", "operation-1", 90_000, 0);

      expect(service.validateDebit("customer-1", 500_000).allowed).toBe(true);
      // O consumo continua registrado no extrato para a cobranca posterior.
      expect(service.getSummary("customer-1")).toMatchObject({
        usedCents: 90_000,
        availableCents: null
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

function insertCustomer(
  database: DesktopDatabase,
  options: { creditLimitCents: number | null; creditMode: "normal" | "prepaid" }
): void {
  const now = "2026-07-30T12:00:00.000Z";
  database
    .prepare(
      `INSERT INTO customers (
        id, company_id, source, legal_name, trade_name, credit_limit_cents, credit_mode,
        credit_account_enabled, created_at, updated_at
      ) VALUES ('customer-1', 'company-1', 'local', 'Cliente Teste LTDA', 'Cliente Teste', ?, ?, 1, ?, ?)`
    )
    .run(options.creditLimitCents, options.creditMode, now, now);
}

/** Operacao minima so para o vinculo do movimento de credito (FK operation_id). */
function insertOperation(database: DesktopDatabase, id: string): void {
  const now = "2026-07-30T12:00:00.000Z";
  database
    .prepare(
      `INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type, customer_id, created_at, updated_at
      ) VALUES (?, 'company-1', 'unit-1', 'device-1', 'closed_local', 'internal', 'customer-1', ?, ?)`
    )
    .run(id, now, now);
}
