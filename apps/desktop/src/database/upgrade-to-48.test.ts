import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "./migrate";
import { DESKTOP_MIGRATIONS } from "./migrations";
import { openDesktopDatabase } from "./sqlite";
import { ensureInitialDesktopIdentity } from "../services/bootstrap";
import { enqueueSyncJob, listRunnableSyncJobs } from "../services/sync-queue";
import {
  listCanceledWeighingOperations,
  listClosedWeighingOperations,
  listOpenWeighingOperations
} from "../services/weighing-operations";

/**
 * O caminho de atualizacao real: uma balanca que ja opera esta na versao 47 com dados; o
 * instalador novo sobe para a 48. Os demais testes migram sempre um banco VAZIO, entao nao
 * cobrem justamente o que preocupa numa atualizacao em producao.
 */
describe("atualizacao de um banco em uso (47 -> 48)", () => {
  it("aplica a migracao 48 sobre um banco com dados sem perder nada", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      // 1) Banco na versao anterior, como esta hoje nas balancas.
      const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 47);
      runDesktopMigrations(database, previous);
      expect(previous.at(-1)?.version).toBe(47);

      const identity = ensureInitialDesktopIdentity(database, {
        companyId: "c1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "u1",
        unitName: "Pedreira Principal",
        deviceId: "d1",
        deviceName: "PC Balanca",
        installationId: "i1"
      });

      // 2) Dados de operacao, incluindo uma linha apagada (deleted_at) porque os indices
      //    novos sao PARCIAIS em "deleted_at IS NULL" -- e o caso que poderia falhar.
      const insert = database.prepare(
        `INSERT INTO weighing_operations
           (id, company_id, unit_id, device_id, status, operation_type,
            entry_weight_kg, exit_weight_kg, net_weight_kg, total_cents,
            deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'invoice', 1000, 3000, 2000, 5000, ?, ?, ?)`
      );
      const rows: Array<[string, string, string | null]> = [
        ["op-open", "awaiting_exit", null],
        ["op-open-2", "entry_registered", null],
        ["op-closed", "synced", null],
        ["op-closed-2", "closed_local", null],
        ["op-cancelled", "cancelled", null],
        ["op-apagada", "synced", "2026-08-01T10:00:00.000Z"]
      ];
      for (const [id, status, deletedAt] of rows) {
        insert.run(
          id,
          identity.companyId,
          identity.unitId,
          identity.deviceId,
          status,
          deletedAt,
          "2026-08-01T09:00:00.000Z",
          "2026-08-01T09:00:00.000Z"
        );
      }

      const job = enqueueSyncJob(database, {
        target: "omie",
        action: "create_order",
        entityType: "weighing_operation",
        entityId: "op-closed",
        idempotencyKey: "omie:op-closed:create",
        payload: { operationId: "op-closed" }
      });

      // Estado ANTES da atualizacao.
      const before = {
        open: listOpenWeighingOperations(database).map((o) => o.id),
        closed: listClosedWeighingOperations(database).map((o) => o.id),
        canceled: listCanceledWeighingOperations(database).map((o) => o.id),
        runnable: listRunnableSyncJobs(database, { target: "omie" }).map((j) => j.id),
        totalOperacoes: database.prepare("SELECT COUNT(*) FROM weighing_operations").pluck().get()
      };

      // 3) A atualizacao propriamente dita.
      const applied = runDesktopMigrations(database);
      expect(applied.at(-1)?.version).toBe(48);

      // 4) Nada mudou para o operador: as mesmas linhas, na mesma ordem.
      expect(listOpenWeighingOperations(database).map((o) => o.id)).toEqual(before.open);
      expect(listClosedWeighingOperations(database).map((o) => o.id)).toEqual(before.closed);
      expect(listCanceledWeighingOperations(database).map((o) => o.id)).toEqual(before.canceled);
      expect(listRunnableSyncJobs(database, { target: "omie" }).map((j) => j.id)).toEqual(
        before.runnable
      );
      expect(database.prepare("SELECT COUNT(*) FROM weighing_operations").pluck().get()).toBe(
        before.totalOperacoes
      );

      // A operacao apagada continua fora das listas e continua no banco (soft delete).
      expect(before.closed).not.toContain("op-apagada");
      expect(
        database
          .prepare("SELECT deleted_at FROM weighing_operations WHERE id = 'op-apagada'")
          .pluck()
          .get()
      ).toBe("2026-08-01T10:00:00.000Z");

      // A fila preservou o job e a chave de idempotencia.
      expect(before.runnable).toContain(job.id);

      // 5) Os indices novos existem e o banco esta integro.
      const indexes = (
        database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'")
          .all() as { name: string }[]
      ).map((row) => row.name);
      for (const expected of [
        "idx_weighing_operations_live_status_updated",
        "idx_weighing_operations_live_status_created",
        "idx_sync_queue_target_status_next_attempt",
        "idx_sync_queue_target_status_created",
        "idx_sync_queue_status_updated"
      ]) {
        expect(indexes).toContain(expected);
      }

      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("permite voltar para o build anterior: a 48 so adiciona indice", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      // Banco ja atualizado...
      runDesktopMigrations(database);

      // ...e o operador volta para o instalador anterior, que so conhece ate a 47.
      // runDesktopMigrations itera a PROPRIA lista, entao a versao 48 gravada em
      // schema_migrations e simplesmente ignorada em vez de virar erro.
      const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 47);
      expect(() => runDesktopMigrations(database, previous)).not.toThrow();

      // O build antigo continua lendo o banco: a 48 nao criou coluna nem mexeu em dado,
      // so em indice, entao nao ha nada que o codigo anterior desconheca.
      expect(() => listOpenWeighingOperations(database)).not.toThrow();
      expect(() => listClosedWeighingOperations(database)).not.toThrow();
      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
    } finally {
      database.close();
    }
  });

  it("e reentrante: rodar a migracao de novo nao muda nada", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      const first = runDesktopMigrations(database);
      const second = runDesktopMigrations(database);

      expect(second).toEqual(first);
      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
    } finally {
      database.close();
    }
  });
});
