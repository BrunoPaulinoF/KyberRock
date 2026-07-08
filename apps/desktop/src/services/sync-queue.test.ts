import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import {
  BLOCKED_NEXT_ATTEMPT_AT,
  enqueueSyncJob,
  getSyncJobById,
  listRunnableSyncJobs,
  markSyncJobBlocked,
  markSyncJobDone,
  markSyncJobFailed
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
