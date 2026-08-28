import { beforeEach, describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import {
  collectDeviceHealth,
  DEVICE_HEALTH_MAX_ERROR_LENGTH,
  DEVICE_HEALTH_REFRESH_INTERVAL_MS,
  readDeviceHealthForHeartbeat,
  resetDeviceHealthCache
} from "./device-health";
import {
  enqueueSyncJob,
  markSyncJobBlocked,
  markSyncJobDone,
  markSyncJobFailed
} from "./sync-queue";

describe("device health", () => {
  beforeEach(() => {
    resetDeviceHealthCache();
  });

  it("fila vazia e uma balanca em dia, nao uma balanca sem dados", () => {
    const database = createMigratedDatabase();

    try {
      const health = collectDeviceHealth(database, new Date("2026-08-28T12:00:00.000Z"));

      expect(health.queuePending).toBe(0);
      expect(health.queueBlocked).toBe(0);
      expect(health.oldestPendingAt).toBeNull();
      expect(health.lastError).toBeNull();
      expect(health.collectedAt).toBe("2026-08-28T12:00:00.000Z");
    } finally {
      database.close();
    }
  });

  it("job entregue sai da conta", () => {
    const database = createMigratedDatabase();

    try {
      const job = enqueue(database, "cloud:entregue");
      markSyncJobDone(database, job.id);

      expect(collectDeviceHealth(database).queuePending).toBe(0);
    } finally {
      database.close();
    }
  });

  it("job em backoff continua contando como pendente: ele ainda anda sozinho", () => {
    const database = createMigratedDatabase();

    try {
      const job = enqueue(database, "omie:tentando");
      markSyncJobFailed(database, job.id, "OMIE fora do ar");

      const health = collectDeviceHealth(database);

      expect(health.queuePending).toBe(1);
      expect(health.queueBlocked).toBe(0);
      expect(health.lastError).toBe("OMIE fora do ar");
    } finally {
      database.close();
    }
  });

  it("job bloqueado por falha deterministica conta como PARADO, e nao como pendente", () => {
    const database = createMigratedDatabase();

    try {
      // `markSyncJobBlocked` mantem o status 'failed' e so empurra o
      // next_attempt_at para o ano 9999. Sem olhar essa data, o caso mais comum
      // de balanca travada (cadastro incompleto para NF-e) apareceria no painel
      // como fila normal andando.
      const job = enqueue(database, "omie:sem-cadastro");
      markSyncJobBlocked(database, job.id, "Cliente sem CEP para a NF-e");

      const health = collectDeviceHealth(database);

      expect(health.queueBlocked).toBe(1);
      expect(health.queuePending).toBe(0);
      expect(health.lastError).toBe("Cliente sem CEP para a NF-e");
    } finally {
      database.close();
    }
  });

  it("dead_letter conta como parado", () => {
    const database = createMigratedDatabase();

    try {
      const job = enqueue(database, "cloud:morto");
      markSyncJobFailed(database, job.id, "Recusado", { deadLetterAfterAttempts: 1 });

      const health = collectDeviceHealth(database);

      expect(health.queueBlocked).toBe(1);
      expect(health.queuePending).toBe(0);
    } finally {
      database.close();
    }
  });

  it("a data mais antiga e a do que entrou primeiro e nao foi entregue", () => {
    const database = createMigratedDatabase();

    try {
      enqueue(database, "cloud:antigo", new Date("2026-08-20T08:00:00.000Z"));
      enqueue(database, "cloud:novo", new Date("2026-08-28T08:00:00.000Z"));

      expect(collectDeviceHealth(database).oldestPendingAt).toBe("2026-08-20T08:00:00.000Z");
    } finally {
      database.close();
    }
  });

  it("a mensagem que viaja e a da recusa mais recente, truncada", () => {
    const database = createMigratedDatabase();

    try {
      const antigo = enqueue(database, "cloud:antigo", new Date("2026-08-20T08:00:00.000Z"));
      markSyncJobFailed(database, antigo.id, "erro antigo", {
        now: new Date("2026-08-20T08:01:00.000Z")
      });
      const recente = enqueue(database, "cloud:recente", new Date("2026-08-28T08:00:00.000Z"));
      markSyncJobFailed(database, recente.id, "x".repeat(1000), {
        now: new Date("2026-08-28T08:01:00.000Z")
      });

      const health = collectDeviceHealth(database);

      expect(health.lastError).toHaveLength(DEVICE_HEALTH_MAX_ERROR_LENGTH);
      expect(health.lastError?.endsWith("…")).toBe(true);
    } finally {
      database.close();
    }
  });

  it("o resumo do ping so e recalculado uma vez por minuto", () => {
    const database = createMigratedDatabase();

    try {
      const start = new Date("2026-08-28T12:00:00.000Z");
      expect(readDeviceHealthForHeartbeat(database, start)?.queuePending).toBe(0);

      enqueue(database, "cloud:novo");

      // O ping roda a cada 5 s; a fila nao muda nesse ritmo e a leitura varre a
      // tabela, entao o valor memorizado e reusado.
      const cincoSegundosDepois = new Date(start.getTime() + 5_000);
      expect(readDeviceHealthForHeartbeat(database, cincoSegundosDepois)?.queuePending).toBe(0);

      const umMinutoDepois = new Date(start.getTime() + DEVICE_HEALTH_REFRESH_INTERVAL_MS);
      expect(readDeviceHealthForHeartbeat(database, umMinutoDepois)?.queuePending).toBe(1);
    } finally {
      database.close();
    }
  });

  it("banco sem a tabela nao derruba o ping: o resumo simplesmente nao vai", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      // Sem migracao nao existe `sync_queue`. A validacao de acesso e o que
      // libera a operacao da balanca: ela nao pode cair por causa de um dado
      // que so serve para o suporte.
      expect(readDeviceHealthForHeartbeat(database)).toBeNull();
    } finally {
      database.close();
    }
  });
});

function enqueue(database: DesktopDatabase, idempotencyKey: string, now?: Date) {
  return enqueueSyncJob(
    database,
    {
      target: idempotencyKey.startsWith("omie") ? "omie" : "cloud",
      action: "upsert_operation",
      entityType: "operation",
      entityId: idempotencyKey,
      idempotencyKey,
      payload: {}
    },
    now
  );
}

function createMigratedDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  return database;
}
