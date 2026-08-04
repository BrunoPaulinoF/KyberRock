import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "./migrate";
import { DESKTOP_MIGRATIONS } from "./migrations";
import { openDesktopDatabase, type DesktopDatabase } from "./sqlite";

/**
 * Primeira migracao que semeia contas para as empresas ja cadastradas. A pedreira
 * instalada tem a empresa no banco ANTES dela — e desse ponto que os seeds seguintes
 * (contas padrao, forma "Em carteira", contas BONIFICACAO/EM CARTEIRA e a forma
 * "Bonificacao") precisam alcancar a empresa.
 */
const FIRST_ACCOUNT_SEED_VERSION = 27;

/** Migracao que liga a carteira a conta propria e cria a forma "Bonificacao". */
const MIGRATION_VERSION = 47;

const NOW = "2026-08-04T12:00:00.000Z";

/**
 * Pedreira ja instalada: a empresa existe desde antes das contas BONIFICACAO/EM CARTEIRA,
 * com a venda em carteira lancando na OMIE Cash. E este banco — nao o de uma instalacao
 * nova — que a migracao precisa corrigir.
 */
function createDatabaseBeforeMigration(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(
    database,
    DESKTOP_MIGRATIONS.filter((migration) => migration.version < FIRST_ACCOUNT_SEED_VERSION)
  );
  database
    .prepare(
      `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
       VALUES ('company-1', 'Empresa Teste', 'Empresa', ?, ?)`
    )
    .run(NOW, NOW);
  // Com a empresa no banco, as migracoes seguintes a alcancam: e assim que ela chega ao
  // estado anterior a esta mudanca (contas padrao + carteira lancando na OMIE Cash).
  runDesktopMigrations(
    database,
    DESKTOP_MIGRATIONS.filter((migration) => migration.version < MIGRATION_VERSION)
  );
  return database;
}

function accountIdByCode(database: DesktopDatabase, code: string): string | null {
  return (
    (database
      .prepare("SELECT id FROM accounts WHERE company_id = 'company-1' AND code = ?")
      .pluck()
      .get(code) as string | undefined) ?? null
  );
}

function methodByCode(
  database: DesktopDatabase,
  code: string
): { account_id: string | null; omie_code: string | null; is_system: number } | undefined {
  return database
    .prepare(
      "SELECT account_id, omie_code, is_system FROM payment_methods WHERE company_id = 'company-1' AND code = ? AND deleted_at IS NULL"
    )
    .get(code) as
    | { account_id: string | null; omie_code: string | null; is_system: number }
    | undefined;
}

describe("migracao das contas BONIFICACAO e EM CARTEIRA", () => {
  it("cria as duas contas para a empresa que ja existia", () => {
    const database = createDatabaseBeforeMigration();

    try {
      runDesktopMigrations(database);

      expect(accountIdByCode(database, "bonificacao")).toBeTruthy();
      expect(accountIdByCode(database, "em_carteira")).toBeTruthy();
      expect(
        database
          .prepare("SELECT name FROM accounts WHERE company_id = 'company-1' AND code = ?")
          .pluck()
          .get("bonificacao")
      ).toBe("BONIFICAÇÃO");
    } finally {
      database.close();
    }
  });

  it("move a venda em carteira da OMIE Cash para a conta EM CARTEIRA", () => {
    const database = createDatabaseBeforeMigration();

    try {
      // Estado anterior: a carteira lancava na OMIE Cash (migracao 43).
      const wallet = methodByCode(database, "wallet");
      expect(wallet?.account_id).toBe(accountIdByCode(database, "omie_cash"));

      runDesktopMigrations(database);

      expect(methodByCode(database, "wallet")?.account_id).toBe(
        accountIdByCode(database, "em_carteira")
      );
    } finally {
      database.close();
    }
  });

  it("cria a forma Bonificacao ligada a conta de mesmo nome, sem gerar cobranca", () => {
    const database = createDatabaseBeforeMigration();

    try {
      expect(methodByCode(database, "bonificacao")).toBeUndefined();

      runDesktopMigrations(database);

      const method = methodByCode(database, "bonificacao");
      expect(method?.account_id).toBe(accountIdByCode(database, "bonificacao"));
      // tPag "99 - outros": a nota sai e nenhuma cobranca nasce dela.
      expect(method?.omie_code).toBe("99");
      expect(method?.is_system).toBe(1);
    } finally {
      database.close();
    }
  });

  it("nao duplica nada ao rodar de novo", () => {
    const database = createDatabaseBeforeMigration();

    try {
      runDesktopMigrations(database);
      runDesktopMigrations(database);

      const count = (table: string, code: string): number =>
        database
          .prepare(
            `SELECT COUNT(*) FROM ${table} WHERE company_id = 'company-1' AND code = ? AND deleted_at IS NULL`
          )
          .pluck()
          .get(code) as number;

      expect(count("accounts", "bonificacao")).toBe(1);
      expect(count("accounts", "em_carteira")).toBe(1);
      expect(count("payment_methods", "bonificacao")).toBe(1);
    } finally {
      database.close();
    }
  });
});
