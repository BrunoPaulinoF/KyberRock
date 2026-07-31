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

      // Cliente pagou: o credito volta pelo espelho do OMIE e libera o limite.
      insertOmieAdvance(database, {
        id: "omie-adv-pagamento",
        titleId: 8001,
        amountCents: 60_000,
        createdAt: "2026-07-30T13:00:00.000Z"
      });
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
      insertOmieAdvance(database, {
        id: "omie-adv-deposito",
        titleId: 8002,
        amountCents: 70_000,
        createdAt: "2026-07-30T13:00:00.000Z"
      });
      const service = new CreditService(database);

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

describe("adiantamentos espelhados do OMIE", () => {
  it("soma no resumo apenas o que veio do financeiro e abate as compras", () => {
    const database = createDatabase();

    try {
      // Pre-pago sem limite cadastrado: quem banca a compra e o adiantamento.
      insertCustomer(database, { creditLimitCents: 0, creditMode: "prepaid" });
      insertOmieAdvance(database, {
        id: "omie-adv-1",
        titleId: 7001,
        amountCents: 150_000,
        createdAt: "2026-07-20T10:00:00.000Z"
      });
      const service = new CreditService(database);

      expect(service.getSummary("customer-1")).toMatchObject({
        balanceCents: 150_000,
        availableCents: 150_000,
        omieAdvanceCents: 150_000,
        omieSyncedAt: "2026-07-20T10:00:00.000Z"
      });

      insertOperation(database, "operation-1");
      service.applyDebit("customer-1", "operation-1", 40_000, 10_000);

      // A compra sai do saldo do adiantamento; o total vindo do OMIE nao muda —
      // ele so muda quando o financeiro mudar la.
      expect(service.getSummary("customer-1")).toMatchObject({
        balanceCents: 100_000,
        availableCents: 100_000,
        omieAdvanceCents: 150_000
      });
      expect(service.validateDebit("customer-1", 100_001).allowed).toBe(false);
      expect(service.validateDebit("customer-1", 100_000).allowed).toBe(true);
    } finally {
      database.close();
    }
  });

  it("nao confunde lancamento manual com adiantamento do OMIE", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { creditLimitCents: 0, creditMode: "prepaid" });
      insertOmieAdvance(database, {
        id: "omie-adv-1",
        titleId: 7001,
        amountCents: 50_000,
        createdAt: "2026-07-20T10:00:00.000Z"
      });
      // Lancamento local herdado (o KyberRock nao cria mais credito): entra no
      // saldo, mas nao conta como adiantamento vindo do financeiro.
      insertLocalCredit(database, { id: "local-1", amountCents: 20_000 });
      const service = new CreditService(database);

      const summary = service.getSummary("customer-1");
      expect(summary.balanceCents).toBe(70_000);
      expect(summary.omieAdvanceCents).toBe(50_000);
    } finally {
      database.close();
    }
  });

  it("reduz o total do OMIE quando o adiantamento e cancelado la", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { creditLimitCents: 0, creditMode: "prepaid" });
      insertOmieAdvance(database, {
        id: "omie-adv-1",
        titleId: 7001,
        amountCents: 80_000,
        createdAt: "2026-07-20T10:00:00.000Z"
      });
      // Estorno espelhado do OMIE: acerto assinado sobre o mesmo titulo.
      insertOmieAdvance(database, {
        id: "omie-adv-2",
        titleId: 7001,
        amountCents: -80_000,
        movementType: "manual_adjustment",
        createdAt: "2026-07-25T10:00:00.000Z"
      });

      expect(new CreditService(database).getSummary("customer-1")).toMatchObject({
        balanceCents: 0,
        omieAdvanceCents: 0,
        omieSyncedAt: "2026-07-25T10:00:00.000Z"
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

/** Lancamento espelhado do financeiro do OMIE (o desktop nunca cria isso a mao). */
function insertOmieAdvance(
  database: DesktopDatabase,
  options: {
    id: string;
    titleId: number;
    amountCents: number;
    movementType?: "credit" | "manual_adjustment";
    createdAt: string;
  }
): void {
  database
    .prepare(
      `INSERT INTO customer_credit_movements (
        id, company_id, customer_id, operation_id, movement_type, amount_cents,
        balance_after_cents, reason, source, omie_title_id, created_at
      ) VALUES (?, 'company-1', 'customer-1', NULL, ?, ?, ?, ?, 'omie', ?, ?)`
    )
    .run(
      options.id,
      options.movementType ?? "credit",
      options.amountCents,
      options.amountCents,
      `Adiantamento OMIE #${options.titleId}`,
      options.titleId,
      options.createdAt
    );
  recalculateBalance(database, options.createdAt);
}

describe("reserva da baixa do adiantamento no OMIE", () => {
  it("limita a baixa ao adiantamento ainda nao amortizado la", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { creditLimitCents: 0, creditMode: "prepaid" });
      insertOmieAdvance(database, {
        id: "omie-adv-1",
        titleId: 7001,
        amountCents: 100_000,
        createdAt: "2026-07-20T10:00:00.000Z"
      });
      const service = new CreditService(database);
      expect(service.getAdvanceAvailableToSettleCents("customer-1")).toBe(100_000);

      // Venda anterior ja reservou (e baixou) 60,00 do adiantamento no OMIE.
      insertOperation(database, "operation-1");
      database
        .prepare(
          `UPDATE weighing_operations
             SET omie_advance_settle_cents = 60000, omie_advance_settled_cents = 60000,
                 omie_advance_status = 'settled'
           WHERE id = 'operation-1'`
        )
        .run();

      expect(service.getAdvanceAvailableToSettleCents("customer-1")).toBe(40_000);
    } finally {
      database.close();
    }
  });

  it("conta tambem a reserva que ainda esta na fila", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { creditLimitCents: 0, creditMode: "prepaid" });
      insertOmieAdvance(database, {
        id: "omie-adv-1",
        titleId: 7001,
        amountCents: 100_000,
        createdAt: "2026-07-20T10:00:00.000Z"
      });
      insertOperation(database, "operation-1");
      // Reservada, ainda sem baixa confirmada no OMIE.
      database
        .prepare(
          `UPDATE weighing_operations
             SET omie_advance_settle_cents = 30000, omie_advance_status = 'pending'
           WHERE id = 'operation-1'`
        )
        .run();

      expect(new CreditService(database).getAdvanceAvailableToSettleCents("customer-1")).toBe(
        70_000
      );
    } finally {
      database.close();
    }
  });

  it("nao reserva nada quando o cliente nao tem adiantamento espelhado", () => {
    const database = createDatabase();

    try {
      insertCustomer(database, { creditLimitCents: 100_000, creditMode: "normal" });
      expect(new CreditService(database).getAdvanceAvailableToSettleCents("customer-1")).toBe(0);
    } finally {
      database.close();
    }
  });
});

/** Movimento local antigo, de quando o KyberRock ainda lancava credito. */
function insertLocalCredit(
  database: DesktopDatabase,
  options: { id: string; amountCents: number }
): void {
  database
    .prepare(
      `INSERT INTO customer_credit_movements (
        id, company_id, customer_id, operation_id, movement_type, amount_cents,
        balance_after_cents, reason, source, omie_title_id, created_at
      ) VALUES (?, 'company-1', 'customer-1', NULL, 'credit', ?, ?, 'lancamento antigo', 'local', NULL, ?)`
    )
    .run(options.id, options.amountCents, options.amountCents, "2026-07-21T10:00:00.000Z");
  recalculateBalance(database, "2026-07-21T10:00:00.000Z");
}

/** Saldo = soma do log, como o desktop recalcula a cada movimento recebido. */
function recalculateBalance(database: DesktopDatabase, timestamp: string): void {
  database
    .prepare(
      `INSERT INTO customer_credit_balances (customer_id, balance_cents, updated_at)
       VALUES ('customer-1', (
         SELECT COALESCE(SUM(
           CASE WHEN movement_type IN ('debit_product', 'debit_freight')
             THEN -amount_cents ELSE amount_cents END
         ), 0) FROM customer_credit_movements WHERE customer_id = 'customer-1'
       ), ?)
       ON CONFLICT(customer_id) DO UPDATE SET
         balance_cents = excluded.balance_cents,
         updated_at = excluded.updated_at`
    )
    .run(timestamp);
}
