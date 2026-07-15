import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import {
  BLOCKED_NEXT_ATTEMPT_AT,
  deleteOmieQueueJob,
  enqueueSyncJob,
  getSyncJobById,
  listOmieQueueItems,
  listRunnableSyncJobs,
  markSyncJobBlocked,
  markSyncJobDone,
  markSyncJobFailed,
  resetOmieQueueJobForRetry
} from "./sync-queue";

describe("sync queue", () => {
  it("enqueues idempotent jobs", () => {
    const database = createMigratedDatabase();

    try {
      const firstJob = enqueueSyncJob(database, {
        id: "job-1",
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: "operation-1",
        idempotencyKey: "cloud:operation-1",
        payload: { operationId: "operation-1" }
      });
      const duplicateJob = enqueueSyncJob(database, {
        id: "job-2",
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: "operation-1",
        idempotencyKey: "cloud:operation-1",
        payload: { operationId: "operation-1" }
      });

      expect(duplicateJob.id).toBe(firstJob.id);
      expect(database.prepare("SELECT COUNT(*) FROM sync_queue").pluck().get()).toBe(1);
    } finally {
      database.close();
    }
  });

  it("lists runnable jobs by time and target", () => {
    const database = createMigratedDatabase();

    try {
      enqueueSyncJob(
        database,
        {
          id: "job-1",
          target: "cloud",
          action: "upsert_operation",
          entityType: "operation",
          entityId: "operation-1",
          idempotencyKey: "cloud:operation-1",
          payload: {},
          nextAttemptAt: new Date("2026-06-06T12:00:00.000Z")
        },
        new Date("2026-06-06T11:00:00.000Z")
      );
      enqueueSyncJob(
        database,
        {
          id: "job-2",
          target: "omie",
          action: "create_sales_order",
          entityType: "operation",
          entityId: "operation-2",
          idempotencyKey: "omie:operation-2",
          payload: {},
          nextAttemptAt: new Date("2026-06-06T13:00:00.000Z")
        },
        new Date("2026-06-06T11:00:00.000Z")
      );

      expect(
        listRunnableSyncJobs(database, {
          now: new Date("2026-06-06T12:30:00.000Z"),
          target: "cloud"
        }).map((job) => job.id)
      ).toEqual(["job-1"]);
    } finally {
      database.close();
    }
  });

  it("lists runnable jobs filtered by entityId (envio imediato pos-fechamento)", () => {
    const database = createMigratedDatabase();

    try {
      enqueueSyncJob(database, {
        id: "job-1",
        target: "omie",
        action: "create_order",
        entityType: "weighing_operation",
        entityId: "operation-1",
        idempotencyKey: "omie:operation-1",
        payload: {}
      });
      enqueueSyncJob(database, {
        id: "job-2",
        target: "omie",
        action: "create_order",
        entityType: "weighing_operation",
        entityId: "operation-2",
        idempotencyKey: "omie:operation-2",
        payload: {}
      });
      enqueueSyncJob(database, {
        id: "job-3",
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: "operation-1",
        idempotencyKey: "cloud:operation-1",
        payload: {}
      });

      expect(
        listRunnableSyncJobs(database, { target: "omie", entityId: "operation-1" }).map(
          (job) => job.id
        )
      ).toEqual(["job-1"]);
      expect(
        listRunnableSyncJobs(database, { entityId: "operation-1" })
          .map((job) => job.id)
          .sort()
      ).toEqual(["job-1", "job-3"]);
    } finally {
      database.close();
    }
  });

  it("tracks failures and completion", () => {
    const database = createMigratedDatabase();

    try {
      const job = enqueueSyncJob(database, {
        id: "job-1",
        target: "omie",
        action: "create_sales_order",
        entityType: "operation",
        entityId: "operation-1",
        idempotencyKey: "omie:operation-1",
        payload: {}
      });

      markSyncJobFailed(database, job.id, "OMIE offline\nretry", {
        now: new Date("2026-06-06T12:00:00.000Z"),
        retryAfterMs: 30_000
      });

      expect(getSyncJobById(database, job.id)).toMatchObject({
        status: "failed",
        attemptCount: 1,
        lastError: "OMIE offline retry",
        nextAttemptAt: "2026-06-06T12:00:30.000Z"
      });

      markSyncJobDone(database, job.id, new Date("2026-06-06T12:01:00.000Z"));

      expect(getSyncJobById(database, job.id)).toMatchObject({
        status: "done",
        lastError: null
      });
    } finally {
      database.close();
    }
  });
  it("lists, deletes and re-arms OMIE queue items (tela cloud)", () => {
    const database = createMigratedDatabase();

    try {
      // Empresa/unidade/dispositivo reais (FKs de weighing_operations).
      ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "Empresa",
        unitId: "unit-1",
        unitName: "Unidade",
        deviceId: "device-1",
        deviceName: "PC Balanca"
      });
      // Operacao fechada com dados para exibicao na fila.
      database
        .prepare(
          `INSERT INTO customers (id, company_id, source, legal_name, trade_name, created_at, updated_at)
           VALUES ('cust-1', 'company-1', 'local', 'Cliente LTDA', 'Cliente', datetime('now'), datetime('now'))`
        )
        .run();
      database
        .prepare(
          `INSERT INTO vehicles (id, company_id, plate, created_at, updated_at)
           VALUES ('veh-1', 'company-1', 'ABC1D23', datetime('now'), datetime('now'))`
        )
        .run();
      database
        .prepare(
          `INSERT INTO weighing_operations (
            id, company_id, unit_id, device_id, status, operation_type, customer_id, vehicle_id,
            total_cents, exit_weight_captured_at, created_at, updated_at
          ) VALUES ('op-1', 'company-1', 'unit-1', 'device-1', 'closed_local', 'invoice', 'cust-1', 'veh-1',
            25000, '2026-07-10T14:00:00.000Z', datetime('now'), datetime('now'))`
        )
        .run();

      const job = enqueueSyncJob(database, {
        target: "omie",
        action: "create_order",
        entityType: "weighing_operation",
        entityId: "op-1",
        idempotencyKey: "omie:op-1:create",
        payload: { operationId: "op-1" }
      });
      // Job de outra entidade ja concluido nao aparece na fila.
      const doneJob = enqueueSyncJob(database, {
        target: "omie",
        action: "create_order",
        entityType: "weighing_operation",
        entityId: "op-2",
        idempotencyKey: "omie:op-2:create",
        payload: { operationId: "op-2" }
      });
      markSyncJobDone(database, doneJob.id);

      const items = listOmieQueueItems(database);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: job.id,
        action: "create_order",
        status: "pending",
        operationId: "op-1",
        operationType: "invoice",
        customerName: "Cliente",
        plate: "ABC1D23",
        totalCents: 25000,
        closedAt: "2026-07-10T14:00:00.000Z"
      });

      // Re-arma um job morto: volta a pending com backoff zerado.
      markSyncJobFailed(database, job.id, "erro", { deadLetterAfterAttempts: 1 });
      expect(getSyncJobById(database, job.id)?.status).toBe("dead_letter");
      const rearmed = resetOmieQueueJobForRetry(database, job.id);
      expect(rearmed).toMatchObject({ status: "pending", attemptCount: 0 });
      expect(listRunnableSyncJobs(database, { target: "omie" }).map((j) => j.id)).toContain(job.id);

      // Excluir remove da fila de vez (o fechamento nao sera enviado).
      expect(deleteOmieQueueJob(database, job.id)).toBe(true);
      expect(getSyncJobById(database, job.id)).toBeNull();
      expect(listOmieQueueItems(database)).toHaveLength(0);
      // Job done nao e removivel por este caminho.
      expect(deleteOmieQueueJob(database, doneJob.id)).toBe(false);
    } finally {
      database.close();
    }
  });

  it("markSyncJobBlocked keeps the job re-runnable but out of the auto-retry loop", () => {
    const database = createMigratedDatabase();

    try {
      const job = enqueueSyncJob(database, {
        target: "omie",
        action: "create_and_bill_order",
        entityType: "weighing_operation",
        entityId: "op-1",
        idempotencyKey: "omie:op-1:bill",
        payload: { operationId: "op-1" }
      });
      // Simula job proximo do limite de dead_letter.
      database.prepare("UPDATE sync_queue SET attempt_count = 9 WHERE id = ?").run(job.id);

      markSyncJobBlocked(database, job.id, "Para emitir a NF-e falta preencher...");

      const blocked = getSyncJobById(database, job.id);
      expect(blocked).toMatchObject({ status: "failed", nextAttemptAt: BLOCKED_NEXT_ATTEMPT_AT });
      // Nao incrementa attempt_count -> nunca vira dead_letter.
      expect(blocked?.attemptCount).toBe(9);

      // O loop batch nao repega (next_attempt_at futuro), mas o status segue 'failed'
      // (re-executavel por processFiscalBillingNow, que ignora next_attempt_at).
      expect(listRunnableSyncJobs(database, { target: "omie" }).map((j) => j.id)).not.toContain(
        job.id
      );
    } finally {
      database.close();
    }
  });
});

function createMigratedDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  return database;
}
