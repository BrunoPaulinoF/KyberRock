import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "./migrate";
import { DESKTOP_MIGRATIONS } from "./migrations";
import { openDesktopDatabase, type DesktopDatabase } from "./sqlite";

/**
 * A migracao 39 limpa as duplicatas que ja estavam no banco. Para testar o "antes",
 * aplicamos todas as migracoes ate a 38, inserimos o estado duplicado e so entao
 * rodamos a limpeza.
 */
const DEDUP_MIGRATION_VERSION = 39;

describe("duplicate cadastro cleanup migration", () => {
  it("merges duplicate customers and repoints their references", () => {
    const database = createDatabaseBeforeDedup();

    try {
      seedCompany(database);
      // Cadastro original (mais antigo) e o gemeo que o pull do OMIE criou.
      insertCustomer(database, {
        id: "local-uuid",
        document: "26.463.463/0001-83",
        createdAt: "2026-07-01T10:00:00.000Z"
      });
      insertCustomer(database, {
        id: "omie_777",
        document: "26463463000183",
        omieCustomerId: 777,
        createdAt: "2026-07-20T10:00:00.000Z"
      });
      insertOperation(database, "op-1", "local-uuid");
      insertOperation(database, "op-2", "omie_777");
      insertCreditMovement(database, "mov-1", "local-uuid", "debit_product", 10_000);
      insertCreditMovement(database, "mov-2", "omie_777", "credit", 4_000);

      applyDedupMigration(database);

      const surviving = database
        .prepare("SELECT id FROM customers WHERE deleted_at IS NULL")
        .pluck()
        .all();
      // Sobrevive a linha vinculada ao OMIE, mesmo sendo a mais nova.
      expect(surviving).toEqual(["omie_777"]);

      // As operacoes das duas linhas passam a apontar para a sobrevivente.
      expect(
        database
          .prepare("SELECT COUNT(*) FROM weighing_operations WHERE customer_id = 'omie_777'")
          .pluck()
          .get()
      ).toBe(2);

      // Extrato unificado e saldo recalculado (-10.000 + 4.000).
      expect(
        database
          .prepare("SELECT COUNT(*) FROM customer_credit_movements WHERE customer_id = 'omie_777'")
          .pluck()
          .get()
      ).toBe(2);
      expect(
        database
          .prepare("SELECT balance_cents FROM customer_credit_balances WHERE customer_id = 'omie_777'")
          .pluck()
          .get()
      ).toBe(-6_000);
    } finally {
      database.close();
    }
  });

  it("keeps the oldest when neither duplicate is linked to OMIE", () => {
    const database = createDatabaseBeforeDedup();

    try {
      seedCompany(database);
      insertCustomer(database, {
        id: "primeiro",
        document: "26463463000183",
        createdAt: "2026-07-01T10:00:00.000Z"
      });
      insertCustomer(database, {
        id: "segundo",
        document: "26463463000183",
        createdAt: "2026-07-20T10:00:00.000Z"
      });

      applyDedupMigration(database);

      expect(
        database.prepare("SELECT id FROM customers WHERE deleted_at IS NULL").pluck().all()
      ).toEqual(["primeiro"]);
    } finally {
      database.close();
    }
  });

  it("leaves cadastros without a document untouched", () => {
    const database = createDatabaseBeforeDedup();

    try {
      seedCompany(database);
      insertCustomer(database, { id: "sem-doc-a", document: null });
      insertCustomer(database, { id: "sem-doc-b", document: null });

      applyDedupMigration(database);

      expect(
        database.prepare("SELECT COUNT(*) FROM customers WHERE deleted_at IS NULL").pluck().get()
      ).toBe(2);
    } finally {
      database.close();
    }
  });

  it("merges duplicate carriers and repoints their links", () => {
    const database = createDatabaseBeforeDedup();

    try {
      seedCompany(database);
      insertCarrier(database, {
        id: "carrier-local",
        document: "11222333000144",
        createdAt: "2026-07-01T10:00:00.000Z"
      });
      insertCarrier(database, {
        id: "carrier-omie",
        document: "11.222.333/0001-44",
        omieCustomerId: 888,
        createdAt: "2026-07-20T10:00:00.000Z"
      });
      insertCustomer(database, { id: "cliente-1", document: "26463463000183" });
      database
        .prepare(
          `INSERT INTO customer_carriers (id, customer_id, carrier_id, is_active, created_at, updated_at)
           VALUES ('cc-1', 'cliente-1', 'carrier-local', 1, ?, ?)`
        )
        .run(NOW, NOW);
      database
        .prepare("UPDATE customers SET default_carrier_id = 'carrier-local' WHERE id = 'cliente-1'")
        .run();

      applyDedupMigration(database);

      expect(
        database.prepare("SELECT id FROM carriers WHERE deleted_at IS NULL").pluck().all()
      ).toEqual(["carrier-omie"]);
      expect(
        database
          .prepare("SELECT carrier_id FROM customer_carriers WHERE id = 'cc-1'")
          .pluck()
          .get()
      ).toBe("carrier-omie");
      expect(
        database
          .prepare("SELECT default_carrier_id FROM customers WHERE id = 'cliente-1'")
          .pluck()
          .get()
      ).toBe("carrier-omie");
    } finally {
      database.close();
    }
  });

  it("drops the duplicated link instead of creating two identical ones", () => {
    const database = createDatabaseBeforeDedup();

    try {
      seedCompany(database);
      insertCustomer(database, { id: "cliente-1", document: "26463463000183" });
      insertCarrier(database, { id: "carrier-a", document: "11222333000144" });
      insertCarrier(database, {
        id: "carrier-b",
        document: "11222333000144",
        omieCustomerId: 888
      });
      // O mesmo cliente vinculado as duas linhas da mesma transportadora.
      database
        .prepare(
          `INSERT INTO customer_carriers (id, customer_id, carrier_id, is_active, created_at, updated_at)
           VALUES ('cc-a', 'cliente-1', 'carrier-a', 1, ?, ?), ('cc-b', 'cliente-1', 'carrier-b', 1, ?, ?)`
        )
        .run(NOW, NOW, NOW, NOW);

      applyDedupMigration(database);

      expect(
        database
          .prepare("SELECT COUNT(*) FROM customer_carriers WHERE deleted_at IS NULL")
          .pluck()
          .get()
      ).toBe(1);
    } finally {
      database.close();
    }
  });
});

const NOW = "2026-07-30T12:00:00.000Z";

/** Banco com o schema anterior a limpeza, para montar o estado duplicado. */
function createDatabaseBeforeDedup(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(
    database,
    DESKTOP_MIGRATIONS.filter((migration) => migration.version < DEDUP_MIGRATION_VERSION)
  );
  return database;
}

function applyDedupMigration(database: DesktopDatabase): void {
  runDesktopMigrations(database);
}

function seedCompany(database: DesktopDatabase): void {
  database
    .prepare(
      `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
       VALUES ('company-1', 'Empresa Teste', 'Empresa', ?, ?)`
    )
    .run(NOW, NOW);
  database
    .prepare(
      `INSERT INTO units (id, company_id, name, timezone, created_at, updated_at)
       VALUES ('unit-1', 'company-1', 'Unidade', 'America/Sao_Paulo', ?, ?)`
    )
    .run(NOW, NOW);
  database
    .prepare(
      `INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, created_at, updated_at)
       VALUES ('device-1', 'company-1', 'unit-1', 'Balanca', 'desktop_scale', 'install-1', ?, ?)`
    )
    .run(NOW, NOW);
}

function insertCustomer(
  database: DesktopDatabase,
  options: {
    id: string;
    document: string | null;
    omieCustomerId?: number;
    createdAt?: string;
  }
): void {
  database
    .prepare(
      `INSERT INTO customers (
        id, company_id, source, legal_name, trade_name, document, omie_customer_id, created_at, updated_at
      ) VALUES (?, 'company-1', 'local', 'Apenas Teste LTDA', 'Apenas Teste', ?, ?, ?, ?)`
    )
    .run(
      options.id,
      options.document,
      options.omieCustomerId ?? null,
      options.createdAt ?? NOW,
      options.createdAt ?? NOW
    );
}

function insertCarrier(
  database: DesktopDatabase,
  options: {
    id: string;
    document: string | null;
    omieCustomerId?: number;
    createdAt?: string;
  }
): void {
  database
    .prepare(
      `INSERT INTO carriers (id, company_id, name, document, omie_customer_id, source, created_at, updated_at)
       VALUES (?, 'company-1', 'Transportes Alfa', ?, ?, 'local', ?, ?)`
    )
    .run(
      options.id,
      options.document,
      options.omieCustomerId ?? null,
      options.createdAt ?? NOW,
      options.createdAt ?? NOW
    );
}

function insertOperation(database: DesktopDatabase, id: string, customerId: string): void {
  database
    .prepare(
      `INSERT INTO weighing_operations (
        id, company_id, unit_id, device_id, status, operation_type, customer_id, created_at, updated_at
      ) VALUES (?, 'company-1', 'unit-1', 'device-1', 'closed_local', 'internal', ?, ?, ?)`
    )
    .run(id, customerId, NOW, NOW);
}

function insertCreditMovement(
  database: DesktopDatabase,
  id: string,
  customerId: string,
  movementType: string,
  amountCents: number
): void {
  database
    .prepare(
      `INSERT INTO customer_credit_movements (
        id, company_id, customer_id, movement_type, amount_cents, balance_after_cents, created_at
      ) VALUES (?, 'company-1', ?, ?, ?, 0, ?)`
    )
    .run(id, customerId, movementType, amountCents, NOW);
}
