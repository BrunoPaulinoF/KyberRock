import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { upsertCloudCustomers } from "./supabase-sync";

/**
 * A condicao de pagamento padrao do cliente e o que a Nova entrada preenche. Ela precisa ser
 * a mesma em todas as balancas: a nuvem ja recebia o valor no push do cadastro, mas o pull
 * nao lia a coluna — cada maquina ficava com a sua.
 */
describe("pull do cadastro: condicao de pagamento padrao do cliente", () => {
  function createDatabase(): DesktopDatabase {
    const database = openDesktopDatabase({ databasePath: ":memory:" });
    runDesktopMigrations(database);
    database
      .prepare(
        `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
         VALUES ('company-1', 'KyberRock LTDA', 'KyberRock', datetime('now'), datetime('now'))`
      )
      .run();
    return database;
  }

  function cloudRow(overrides: Record<string, unknown> = {}) {
    return {
      id: "customer-1",
      legal_name: "CONSTRUTORA ALFA LTDA",
      trade_name: "Alfa",
      is_active: true,
      updated_at: "2026-09-25T12:00:00.000Z",
      created_at: "2026-09-01T12:00:00.000Z",
      default_payment_term_id: "term-30",
      ...overrides
    };
  }

  function readTerm(database: DesktopDatabase): unknown {
    return database
      .prepare("SELECT default_payment_term_id FROM customers WHERE id = 'customer-1'")
      .pluck()
      .get();
  }

  it("grava a condicao que veio da nuvem, no cliente novo e no que ja existia", () => {
    const database = createDatabase();
    upsertCloudCustomers(database, "company-1", [cloudRow()]);
    expect(readTerm(database)).toBe("term-30");

    upsertCloudCustomers(database, "company-1", [cloudRow({ default_payment_term_id: "term-60" })]);
    expect(readTerm(database)).toBe("term-60");
    database.close();
  });

  it("nulo da nuvem nao apaga a condicao daqui", () => {
    const database = createDatabase();
    upsertCloudCustomers(database, "company-1", [cloudRow()]);
    upsertCloudCustomers(database, "company-1", [cloudRow({ default_payment_term_id: null })]);
    expect(readTerm(database)).toBe("term-30");
    database.close();
  });

  it("edicao local ainda nao enviada nao e sobrescrita", () => {
    const database = createDatabase();
    upsertCloudCustomers(database, "company-1", [cloudRow()]);
    database
      .prepare(
        "UPDATE customers SET default_payment_term_id = 'term-local', needs_push = 1 WHERE id = 'customer-1'"
      )
      .run();
    upsertCloudCustomers(database, "company-1", [cloudRow({ default_payment_term_id: "term-60" })]);
    expect(readTerm(database)).toBe("term-local");
    database.close();
  });
});
