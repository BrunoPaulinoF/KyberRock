import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import {
  enqueueSyncJob,
  getSyncJobById,
  listRunnableSyncJobs,
  markSyncJobDone,
  markSyncJobFailed
} from "./sync-queue";

describe("sync queue", () => {
  it("enqueues idempotent jobs", () => {
    const database = createMigratedDatabase();

    try {
      const firstJob = enqueueSyncJob(database, {
        id: "job-1",
        target: "firebase",
        action: "upsert_operation",
        entityType: "operation",
        entityId: "operation-1",
        idempotencyKey: "firebase:operation-1",
        payload: { operationId: "operation-1" }
      });
      const duplicateJob = enqueueSyncJob(database, {
        id: "job-2",
        target: "firebase",
        action: "upsert_operation",
        entityType: "operation",
        entityId: "operation-1",
        idempotencyKey: "firebase:operation-1",
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
          target: "firebase",
          action: "upsert_operation",
          entityType: "operation",
          entityId: "operation-1",
          idempotencyKey: "firebase:operation-1",
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
          target: "firebase"
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
});

function createMigratedDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  return database;
}
