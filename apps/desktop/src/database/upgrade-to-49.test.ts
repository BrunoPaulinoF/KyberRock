import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "./migrate";
import { DESKTOP_MIGRATIONS } from "./migrations";
import { openDesktopDatabase, type DesktopDatabase } from "./sqlite";
import { ensureInitialDesktopIdentity } from "../services/bootstrap";
import { listClosedWeighingOperations } from "../services/weighing-operations";
import { getWalletReport } from "../services/wallet";

/**
 * O caminho de atualizacao real do release seguinte: a balanca esta na 48 com dados e o
 * instalador novo sobe para a 49 (tabela `payment_method_aliases`, as formas de pagamento
 * gemeas entre os computadores da pedreira). Os demais testes migram banco vazio.
 */
describe("atualizacao de um banco em uso (48 -> 49)", () => {
  it("aplica a migracao 49 sobre um banco com dados sem perder nada", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 48);
      runDesktopMigrations(database, previous);
      expect(previous.at(-1)?.version).toBe(48);
      seedWalletSale(database);

      const before = listClosedWeighingOperations(database).map((operation) => operation.id);
      const walletBefore = getWalletReport(database, { status: "open" }).summary;

      const applied = runDesktopMigrations(database);
      expect(applied.at(-1)?.version).toBe(49);

      // Nada mudou para o operador: as mesmas vendas, a mesma carteira.
      expect(listClosedWeighingOperations(database).map((operation) => operation.id)).toEqual(
        before
      );
      expect(getWalletReport(database, { status: "open" }).summary).toEqual(walletBefore);

      // A tabela nova existe e aceita a equivalencia entre a forma de pagamento daqui e
      // a gemea da outra balanca (a FK aponta para a local).
      database
        .prepare(
          `INSERT INTO payment_method_aliases (remote_id, company_id, local_id, created_at, updated_at)
           VALUES ('pm-da-outra-balanca', 'c1', 'pm-wallet', ?, ?)`
        )
        .run("2026-08-06T10:00:00.000Z", "2026-08-06T10:00:00.000Z");
      expect(
        database
          .prepare("SELECT local_id FROM payment_method_aliases WHERE remote_id = ?")
          .pluck()
          .get("pm-da-outra-balanca")
      ).toBe("pm-wallet");

      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("permite voltar para o build anterior: a 49 so adiciona tabela", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      seedWalletSale(database);

      // O operador volta para o instalador anterior, que so conhece ate a 48:
      // runDesktopMigrations itera a PROPRIA lista, entao a 49 gravada em
      // schema_migrations e ignorada, e a tabela extra fica inerte para o build antigo.
      const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 48);
      expect(() => runDesktopMigrations(database, previous)).not.toThrow();
      expect(() => listClosedWeighingOperations(database)).not.toThrow();
      expect(getWalletReport(database, { status: "open" }).summary.openCount).toBe(1);
      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
    } finally {
      database.close();
    }
  });

  it("aplica sobre um banco em ARQUIVO com WAL, como nas balancas", () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-upgrade-49-"));
    const databasePath = path.join(tempDirectory, "data", "kyberrock.sqlite3");

    try {
      let database = openDesktopDatabase({ databasePath });
      runDesktopMigrations(
        database,
        DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 48)
      );
      expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
      seedWalletSale(database);

      // Fecha e reabre, como o app faz entre um uso e o proximo.
      database.close();
      database = openDesktopDatabase({ databasePath });

      const applied = runDesktopMigrations(database);
      expect(applied.at(-1)?.version).toBe(49);
      expect(getWalletReport(database, { status: "open" }).summary.openCount).toBe(1);
      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
      database.close();
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});

/** Uma venda em carteira fechada, como a balanca tem antes de atualizar. */
function seedWalletSale(database: DesktopDatabase): void {
  const identity = ensureInitialDesktopIdentity(database, {
    companyId: "c1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "u1",
    unitName: "Pedreira Principal",
    deviceId: "d1",
    deviceName: "PC Balanca",
    installationId: "i1"
  });
  const at = "2026-08-06T09:00:00.000Z";
  database
    .prepare(
      `INSERT INTO payment_methods
         (id, company_id, code, name, is_system, is_customer_credit, is_wallet, sort_order,
          is_active, created_at, updated_at)
       VALUES ('pm-wallet', ?, 'wallet-teste', 'Em carteira', 1, 0, 1, 1, 1, ?, ?)`
    )
    .run(identity.companyId, at, at);
  database
    .prepare(
      `INSERT INTO weighing_operations
         (id, company_id, unit_id, device_id, status, operation_type, payment_method_id,
          entry_weight_kg, exit_weight_kg, net_weight_kg, total_cents, created_at, updated_at)
       VALUES ('op-wallet', ?, ?, ?, 'synced', 'invoice', 'pm-wallet', 1000, 3000, 2000, 5000, ?, ?)`
    )
    .run(identity.companyId, identity.unitId, identity.deviceId, at, at);
}
