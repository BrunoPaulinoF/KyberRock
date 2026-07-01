import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, getLocalDesktopIdentity } from "./bootstrap";

describe("ensureInitialDesktopIdentity", () => {
  it("creates company, unit, device and local settings", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);

      const identity = ensureInitialDesktopIdentity(
        database,
        {
          companyId: "company-1",
          companyLegalName: "KyberRock Mineracao LTDA",
          unitId: "unit-1",
          unitName: "Pedreira Principal",
          deviceId: "device-1",
          deviceName: "PC Balanca",
          installationId: "install-1"
        },
        new Date("2026-06-06T12:00:00.000Z")
      );

      expect(identity).toEqual({
        companyId: "company-1",
        unitId: "unit-1",
        deviceId: "device-1",
        installationId: "install-1"
      });
      expect(getLocalDesktopIdentity(database)).toEqual(identity);
      expect(database.prepare("SELECT COUNT(*) FROM companies").pluck().get()).toBe(1);
      expect(database.prepare("SELECT COUNT(*) FROM units").pluck().get()).toBe(1);
      expect(database.prepare("SELECT COUNT(*) FROM devices").pluck().get()).toBe(1);
    } finally {
      database.close();
    }
  });

  it("persists identity after closing and reopening the database", () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-desktop-"));
    const databasePath = path.join(tempDirectory, "kyberrock.sqlite3");

    try {
      const firstDatabase = openDesktopDatabase({ databasePath });
      runDesktopMigrations(firstDatabase);
      const identity = ensureInitialDesktopIdentity(firstDatabase, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-1",
        deviceName: "PC Balanca",
        installationId: "install-1"
      });
      firstDatabase.close();

      const reopenedDatabase = openDesktopDatabase({ databasePath });

      try {
        expect(getLocalDesktopIdentity(reopenedDatabase)).toEqual(identity);
      } finally {
        reopenedDatabase.close();
      }
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("keeps the local device id stable during reactivation to preserve foreign keys", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      const firstIdentity = ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-local-1",
        deviceName: "PC Balanca",
        installationId: "install-1"
      });
      database
        .prepare(
          `INSERT INTO scale_configs (
             id, device_id, adapter_type, connection_config_json, stability_config_json, created_at, updated_at
           ) VALUES (?, ?, 'virtual', '{}', '{}', ?, ?)`
        )
        .run("scale-config-1", firstIdentity.deviceId, "2026-06-06T12:00:00.000Z", "2026-06-06T12:00:00.000Z");

      const reactivatedIdentity = ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-cloud-new",
        deviceName: "PC Balanca",
        installationId: "install-1"
      });

      expect(reactivatedIdentity.deviceId).toBe(firstIdentity.deviceId);
      expect(getLocalDesktopIdentity(database)).toEqual(reactivatedIdentity);
      expect(
        database.prepare("SELECT device_id FROM scale_configs WHERE id = ?").pluck().get("scale-config-1")
      ).toBe(firstIdentity.deviceId);
    } finally {
      database.close();
    }
  });
});
