import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getAppliedMigrations, runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, getLocalDesktopIdentity } from "./bootstrap";
import {
  assertDatabaseFileHealthy,
  createAutomaticBackup,
  exportManualBackup,
  restoreBackup
} from "./backup";

describe("desktop backup", () => {
  it("creates automatic backups and restores them into a new database file", async () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-backup-"));
    const databasePath = path.join(tempDirectory, "data", "kyberrock.sqlite3");
    const backupDirectory = path.join(tempDirectory, "backups");
    const restoredDatabasePath = path.join(tempDirectory, "restored", "kyberrock.sqlite3");
    const database = openDesktopDatabase({ databasePath });

    try {
      runDesktopMigrations(database);
      const identity = ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-1",
        deviceName: "PC Balanca",
        installationId: "install-1"
      });

      const backup = await createAutomaticBackup({
        database,
        databasePath,
        backupDirectory,
        unitId: identity.unitId,
        now: new Date("2026-06-06T12:30:45.000Z")
      });

      expect(backup.backupPath).toContain("kyberrock-unit-1-20260606-123045.sqlite3");
      expect(existsSync(backup.backupPath)).toBe(true);
      assertDatabaseFileHealthy(backup.backupPath);

      database.close();
      restoreBackup(backup.backupPath, restoredDatabasePath);

      const restoredDatabase = openDesktopDatabase({ databasePath: restoredDatabasePath });

      try {
        expect(getAppliedMigrations(restoredDatabase)).toHaveLength(1);
        expect(getLocalDesktopIdentity(restoredDatabase)).toEqual(identity);
      } finally {
        restoredDatabase.close();
      }
    } finally {
      if (database.open) {
        database.close();
      }
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("exports a manual backup to the selected path", async () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-export-"));
    const databasePath = path.join(tempDirectory, "data", "kyberrock.sqlite3");
    const exportPath = path.join(tempDirectory, "manual", "manual-backup.sqlite3");
    const database = openDesktopDatabase({ databasePath });

    try {
      runDesktopMigrations(database);

      const backup = await exportManualBackup(database, exportPath);

      expect(backup.backupPath).toBe(exportPath);
      expect(existsSync(exportPath)).toBe(true);
      assertDatabaseFileHealthy(exportPath);
    } finally {
      database.close();
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
