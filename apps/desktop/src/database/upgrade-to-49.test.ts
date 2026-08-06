import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "./migrate";
import { DESKTOP_MIGRATIONS } from "./migrations";
import { openDesktopDatabase, type DesktopDatabase } from "./sqlite";
import { ensureInitialDesktopIdentity } from "../services/bootstrap";
import { listOperationsPendingCloudPush } from "../services/supabase-sync";
import { listClosedWeighingOperations } from "../services/weighing-operations";
import { getWalletReport } from "../services/wallet";

/**
 * O caminho de atualizacao real do release seguinte: a balanca esta na 48 com dados e o
 * instalador novo sobe para a 49 — a tabela `payment_method_aliases` (as formas de
 * pagamento gemeas entre os computadores da pedreira) e a republicacao das vendas em
 * carteira que esta maquina ja tinha fechado. Os demais testes migram banco vazio.
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

      // A venda em carteira que ja estava fechada volta para a fila de publicacao
      // (cloud_synced_at zerado), para chegar as outras balancas.
      expect(
        database
          .prepare("SELECT cloud_synced_at FROM weighing_operations WHERE id = 'op-wallet'")
          .pluck()
          .get()
      ).toBeNull();
      expect(
        listOperationsPendingCloudPush(database, new Date("2026-08-06T12:00:00.000Z")).map(
          (operation) => operation.id
        )
      ).toEqual(["op-wallet"]);
      // A venda que nao e em carteira nao foi mexida: continua publicada.
      expect(
        database
          .prepare("SELECT cloud_synced_at FROM weighing_operations WHERE id = 'op-dinheiro'")
          .pluck()
          .get()
      ).toBe("2026-08-06T09:30:00.000Z");

      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("permite voltar para o build anterior: a 49 nao cria coluna nem apaga dado", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      seedWalletSale(database);

      // O operador volta para o instalador anterior, que so conhece ate a 48:
      // runDesktopMigrations itera a PROPRIA lista, entao a 49 gravada em
      // schema_migrations e ignorada, e a tabela extra fica inerte para o build antigo.
      // A unica marca que a 49 mexe (cloud_synced_at) o build antigo tambem entende:
      // ele simplesmente republica a operacao, como faz com qualquer pendencia.
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
      `INSERT INTO payment_methods
         (id, company_id, code, name, is_system, is_customer_credit, is_wallet, sort_order,
          is_active, created_at, updated_at)
       VALUES ('pm-cash', ?, 'cash-teste', 'Dinheiro', 1, 0, 0, 2, 1, ?, ?)`
    )
    .run(identity.companyId, at, at);
  // As duas ja publicadas na nuvem, como estao hoje nas balancas.
  const operation = database.prepare(
    `INSERT INTO weighing_operations
       (id, company_id, unit_id, device_id, status, operation_type, payment_method_id,
        entry_weight_kg, exit_weight_kg, net_weight_kg, total_cents,
        cloud_synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'synced', 'invoice', ?, 1000, 3000, 2000, 5000, ?, ?, ?)`
  );
  const syncedAt = "2026-08-06T09:30:00.000Z";
  operation.run(
    "op-wallet",
    identity.companyId,
    identity.unitId,
    identity.deviceId,
    "pm-wallet",
    syncedAt,
    at,
    at
  );
  operation.run(
    "op-dinheiro",
    identity.companyId,
    identity.unitId,
    identity.deviceId,
    "pm-cash",
    syncedAt,
    at,
    at
  );
}
