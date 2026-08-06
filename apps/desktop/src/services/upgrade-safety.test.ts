import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { DESKTOP_MIGRATIONS } from "../database/migrations";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { assertDatabaseFileHealthy, pruneOldBackups } from "./backup";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import { DesktopRuntime } from "./runtime";
import {
  enqueueSyncJob,
  getSyncJobById,
  listRunnableSyncJobs,
  markSyncJobDone,
  markSyncJobFailed,
  pruneCompletedSyncJobs
} from "./sync-queue";
import { listClosedWeighingOperations, listOpenWeighingOperations } from "./weighing-operations";

/**
 * Bateria de seguranca da atualizacao: cobre os caminhos que a mudanca de fato tocou,
 * exercitados como na balanca (banco em arquivo, runtime real, backup real) em vez de
 * apenas em unidade.
 */

const temporaryDirectories: string[] = [];

function makeTempDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function seedIdentity(database: DesktopDatabase) {
  return ensureInitialDesktopIdentity(database, {
    companyId: "c1",
    companyLegalName: "KyberRock Mineracao LTDA",
    unitId: "u1",
    unitName: "Pedreira Principal",
    deviceId: "d1",
    deviceName: "PC Balanca",
    installationId: "i1"
  });
}

describe("atualizacao com volume de dados", () => {
  it("migra um banco com 5 mil operacoes e 3 mil jobs sem alterar o que a tela mostra", () => {
    const directory = makeTempDirectory("kyberrock-volume-");
    const databasePath = path.join(directory, "kyberrock.sqlite3");
    const database = openDesktopDatabase({ databasePath });

    try {
      runDesktopMigrations(
        database,
        DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 47)
      );
      const identity = seedIdentity(database);

      const insertOperation = database.prepare(
        `INSERT INTO weighing_operations
           (id, company_id, unit_id, device_id, status, operation_type,
            entry_weight_kg, exit_weight_kg, net_weight_kg, total_cents,
            deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'invoice', 1000, 3000, 2000, 5000, ?, ?, ?)`
      );
      database.transaction(() => {
        for (let index = 0; index < 5_000; index += 1) {
          const roll = index % 100;
          const status = roll < 86 ? "synced" : roll < 98 ? "cancelled" : "awaiting_exit";
          // 1 em cada 50 apagada, para o indice parcial ter o que excluir.
          const deletedAt = index % 50 === 0 ? "2026-08-01T10:00:00.000Z" : null;
          const timestamp = new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString();
          insertOperation.run(
            `op-${index}`,
            identity.companyId,
            identity.unitId,
            identity.deviceId,
            status,
            deletedAt,
            timestamp,
            timestamp
          );
        }
        for (let index = 0; index < 3_000; index += 1) {
          enqueueSyncJob(database, {
            target: index % 2 === 0 ? "cloud" : "omie",
            action: "upsert_operation",
            entityType: "operation",
            entityId: `op-${index}`,
            idempotencyKey: `key-${index}`,
            payload: { operationId: `op-${index}` }
          });
        }
      })();

      const before = {
        open: listOpenWeighingOperations(database).map((operation) => operation.id),
        closed: listClosedWeighingOperations(database).map((operation) => operation.id),
        runnable: listRunnableSyncJobs(database, { target: "omie", limit: 1_000 }).map(
          (job) => job.id
        )
      };
      expect(before.closed.length).toBeGreaterThan(4_000);

      const applied = runDesktopMigrations(database);
      // A ultima migracao da lista, seja qual for a do release: o que importa aqui e que
      // a atualizacao completa rodou sobre o volume sem mexer no que a tela mostra.
      expect(applied.at(-1)?.version).toBe(DESKTOP_MIGRATIONS.at(-1)?.version);

      expect(listOpenWeighingOperations(database).map((operation) => operation.id)).toEqual(
        before.open
      );
      expect(listClosedWeighingOperations(database).map((operation) => operation.id)).toEqual(
        before.closed
      );
      expect(
        listRunnableSyncJobs(database, { target: "omie", limit: 1_000 }).map((job) => job.id)
      ).toEqual(before.runnable);
      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("preserva o cadastro inteiro, nao so as operacoes", () => {
    const directory = makeTempDirectory("kyberrock-cadastro-");
    const database = openDesktopDatabase({ databasePath: path.join(directory, "k.sqlite3") });

    try {
      runDesktopMigrations(
        database,
        DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 47)
      );
      const identity = seedIdentity(database);
      const now = "2026-08-01T09:00:00.000Z";

      database.exec(`
        INSERT INTO customers (id, company_id, source, trade_name, legal_name, document, created_at, updated_at)
          VALUES ('cus-1', '${identity.companyId}', 'omie', 'Cliente Um', 'Cliente Um LTDA', '26463463000183', '${now}', '${now}');
        INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
          VALUES ('prd-1', '${identity.companyId}', 'BR1', 'Brita 1', 'TON', '${now}', '${now}');
        INSERT INTO vehicles (id, company_id, plate, created_at, updated_at)
          VALUES ('veh-1', '${identity.companyId}', 'ABC1D23', '${now}', '${now}');
        INSERT INTO drivers (id, company_id, name, created_at, updated_at)
          VALUES ('drv-1', '${identity.companyId}', 'Motorista Um', '${now}', '${now}');
        INSERT INTO carriers (id, company_id, name, source, created_at, updated_at)
          VALUES ('car-1', '${identity.companyId}', 'Transportadora Um', 'local', '${now}', '${now}');
      `);

      const countAll = () =>
        ["customers", "products", "vehicles", "drivers", "carriers"].map(
          (table) => database.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number
        );
      const before = countAll();

      runDesktopMigrations(database);

      expect(countAll()).toEqual(before);
      expect(
        database.prepare("SELECT trade_name FROM customers WHERE id = 'cus-1'").pluck().get()
      ).toBe("Cliente Um");
      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
    } finally {
      database.close();
    }
  });
});

describe("backup diario com a manutencao acoplada", () => {
  it("roda ponta a ponta num runtime real, repetidas vezes, sem perder dado", async () => {
    const directory = makeTempDirectory("kyberrock-runtime-backup-");
    const runtime = DesktopRuntime.initialize(directory);

    try {
      const database = (runtime as unknown as { database: DesktopDatabase }).database;
      const identity = seedIdentity(database);
      database
        .prepare(
          `INSERT INTO weighing_operations
             (id, company_id, unit_id, device_id, status, operation_type,
              entry_weight_kg, exit_weight_kg, net_weight_kg, total_cents, created_at, updated_at)
           VALUES ('op-1', ?, ?, ?, 'synced', 'invoice', 1000, 3000, 2000, 5000, ?, ?)`
        )
        .run(
          identity.companyId,
          identity.unitId,
          identity.deviceId,
          "2026-08-01T09:00:00.000Z",
          "2026-08-01T09:00:00.000Z"
        );
      const job = enqueueSyncJob(database, {
        target: "omie",
        action: "create_order",
        entityType: "weighing_operation",
        entityId: "op-1",
        idempotencyKey: "omie:op-1:create",
        payload: {}
      });

      // Tres dias seguidos de backup + manutencao.
      for (let day = 1; day <= 3; day += 1) {
        const backup = await runtime.runAutomaticBackup(new Date(Date.UTC(2026, 7, day, 3, 0, 0)));
        expect(existsSync(backup.backupPath)).toBe(true);
        assertDatabaseFileHealthy(backup.backupPath);
      }

      // A operacao, a fila e a integridade sobreviveram a todas as rodadas.
      expect(listClosedWeighingOperations(database).map((operation) => operation.id)).toEqual([
        "op-1"
      ]);
      expect(getSyncJobById(database, job.id)).not.toBeNull();
      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
      // Um backup por dia, e a retencao (30) nao removeu nenhum.
      const backups = readdirSync(path.join(directory, "KyberRock", "backups")).filter((name) =>
        name.endsWith(".sqlite3")
      );
      expect(backups).toHaveLength(3);
    } finally {
      runtime.close();
    }
  });

  it("faz o backup ANTES de podar: o que foi podado esta dentro do arquivo", async () => {
    const directory = makeTempDirectory("kyberrock-ordem-");
    const runtime = DesktopRuntime.initialize(directory);

    try {
      const database = (runtime as unknown as { database: DesktopDatabase }).database;
      seedIdentity(database);
      const job = enqueueSyncJob(database, {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: "op-antiga",
        idempotencyKey: "cloud:op-antiga",
        payload: {}
      });
      // Job concluido e velho o bastante para a poda de 90 dias pegar.
      markSyncJobDone(database, job.id, new Date("2026-01-01T00:00:00.000Z"));

      const backup = await runtime.runAutomaticBackup(new Date("2026-08-05T03:00:00.000Z"));

      // Sumiu do banco vivo...
      expect(getSyncJobById(database, job.id)).toBeNull();

      // ...mas esta preservado no backup daquele dia.
      const backupDatabase = openDesktopDatabase({
        databasePath: backup.backupPath,
        readonly: true,
        fileMustExist: true
      });
      try {
        expect(
          backupDatabase.prepare("SELECT COUNT(*) FROM sync_queue WHERE id = ?").pluck().get(job.id)
        ).toBe(1);
      } finally {
        backupDatabase.close();
      }
    } finally {
      runtime.close();
    }
  });

  it("abre conexao readonly normalmente com os pragmas novos", async () => {
    const directory = makeTempDirectory("kyberrock-readonly-");
    const runtime = DesktopRuntime.initialize(directory);

    try {
      const database = (runtime as unknown as { database: DesktopDatabase }).database;
      seedIdentity(database);
      const backup = await runtime.runAutomaticBackup(new Date("2026-08-05T03:00:00.000Z"));

      // E o caminho que a verificacao de backup usa; cache_size/temp_store rodam nele.
      const readonlyDatabase = openDesktopDatabase({
        databasePath: backup.backupPath,
        readonly: true,
        fileMustExist: true
      });
      try {
        expect(readonlyDatabase.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
        expect(readonlyDatabase.pragma("temp_store", { simple: true })).toBe(2); // MEMORY
      } finally {
        readonlyDatabase.close();
      }
    } finally {
      runtime.close();
    }
  });
});

describe("resiliencia da manutencao", () => {
  it("a poda de backup nao lanca quando o caminho nem e uma pasta", () => {
    const directory = makeTempDirectory("kyberrock-enotdir-");
    const notADirectory = path.join(directory, "arquivo.txt");
    writeFileSync(notADirectory, "x");

    // readdirSync lanca ENOTDIR; o catch precisa absorver, porque isso roda logo apos
    // o backup diario e nao pode derrubar a rotina.
    expect(() => pruneOldBackups(notADirectory)).not.toThrow();
    expect(pruneOldBackups(notADirectory)).toEqual([]);
  });

  it("podar um job concluido nao impede reenfileirar a mesma chave depois", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      const first = enqueueSyncJob(database, {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: "op-1",
        idempotencyKey: "cloud:op-1",
        payload: {}
      });
      markSyncJobDone(database, first.id, new Date("2026-01-01T00:00:00.000Z"));

      expect(pruneCompletedSyncJobs(database, { now: new Date("2026-08-05T00:00:00.000Z") })).toBe(
        1
      );

      // A chave voltou a ficar livre: reenfileirar cria um job novo em vez de estourar
      // o UNIQUE, e a fila continua com exatamente um job para essa chave.
      const second = enqueueSyncJob(database, {
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: "op-1",
        idempotencyKey: "cloud:op-1",
        payload: {}
      });
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe("pending");
      expect(
        database
          .prepare("SELECT COUNT(*) FROM sync_queue WHERE idempotency_key = 'cloud:op-1'")
          .pluck()
          .get()
      ).toBe(1);
    } finally {
      database.close();
    }
  });
});

describe("a fila continua funcionando com o backoff novo", () => {
  it("falha, espera o atraso e volta a ser executavel ate concluir", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      const job = enqueueSyncJob(database, {
        target: "omie",
        action: "create_order",
        entityType: "weighing_operation",
        entityId: "op-1",
        idempotencyKey: "omie:op-1:create",
        payload: {}
      });

      const failedAt = new Date("2026-08-05T12:00:00.000Z");
      markSyncJobFailed(database, job.id, "OMIE indisponivel", { now: failedAt });

      // Logo apos a falha nao e repescado...
      expect(
        listRunnableSyncJobs(database, { target: "omie", now: failedAt }).map((item) => item.id)
      ).not.toContain(job.id);

      // ...e volta assim que o atraso passa (o teto e 15 min, entao 16 min cobre
      // qualquer tentativa, inclusive com o jitter no pior caso).
      const later = new Date(failedAt.getTime() + 16 * 60_000);
      expect(
        listRunnableSyncJobs(database, { target: "omie", now: later }).map((item) => item.id)
      ).toContain(job.id);

      markSyncJobDone(database, job.id, later);
      expect(getSyncJobById(database, job.id)?.status).toBe("done");
      expect(
        listRunnableSyncJobs(database, { target: "omie", now: later }).map((item) => item.id)
      ).not.toContain(job.id);
    } finally {
      database.close();
    }
  });

  it("nunca ultrapassa o teto, mesmo na ultima tentativa antes do dead_letter", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      const job = enqueueSyncJob(database, {
        target: "omie",
        action: "create_order",
        entityType: "weighing_operation",
        entityId: "op-1",
        idempotencyKey: "omie:op-1:create",
        payload: {}
      });

      const now = new Date("2026-08-05T12:00:00.000Z");
      for (let attempt = 1; attempt <= 9; attempt += 1) {
        markSyncJobFailed(database, job.id, "OMIE indisponivel", { now });
        const current = getSyncJobById(database, job.id);
        expect(current?.attemptCount).toBe(attempt);
        // Nenhum atraso pode passar do teto + jitter (15 min * 1.2 = 18 min).
        const waitMs = Date.parse(current?.nextAttemptAt ?? "") - now.getTime();
        expect(waitMs).toBeGreaterThan(0);
        expect(waitMs).toBeLessThanOrEqual(18 * 60_000);
      }

      // A decima falha ainda encerra em dead_letter, como antes.
      markSyncJobFailed(database, job.id, "OMIE indisponivel", { now });
      expect(getSyncJobById(database, job.id)?.status).toBe("dead_letter");
    } finally {
      database.close();
    }
  });
});
