import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import { enqueueSyncJob } from "./sync-queue";
import { getDesktopStatusSnapshot } from "./status";

describe("getDesktopStatusSnapshot", () => {
  it("reports local identity, pending queue and last backup state", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-1",
        deviceName: "PC Balanca",
        installationId: "install-1"
      });
      enqueueSyncJob(database, {
        id: "job-1",
        target: "cloud",
        action: "upsert_operation",
        entityType: "operation",
        entityId: "operation-1",
        idempotencyKey: "cloud:operation-1",
        payload: {}
      });

      const snapshot = getDesktopStatusSnapshot(database, {
        databasePath: "C:/KyberRock/data/kyberrock.sqlite3",
        internetOnline: false,
        now: new Date("2026-06-06T12:00:00.000Z")
      });

      expect(snapshot).toMatchObject({
        internet: "offline",
        scale: "not_configured",
        cloud: "not_configured",
        omie: "not_configured",
        pendingSyncJobs: 1,
        lastBackupAt: null,
        databasePath: "C:/KyberRock/data/kyberrock.sqlite3",
        identity: {
          companyId: "company-1",
          unitId: "unit-1",
          deviceId: "device-1"
        }
      });
    } finally {
      database.close();
    }
  });
});
