import { describe, expect, it } from "vitest";

import {
  assertDesktopDatabaseHealthy,
  getAppliedMigrations,
  runDesktopMigrations
} from "./migrate";
import { DESKTOP_MIGRATIONS } from "./migrations";
import { openDesktopDatabase } from "./sqlite";

describe("runDesktopMigrations", () => {
  it("creates the initial offline-first schema", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      const migrations = runDesktopMigrations(
        database,
        undefined,
        new Date("2026-06-06T12:00:00.000Z")
      );
      const tableNames = database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .pluck()
        .all();

      expect(migrations).toEqual(
        DESKTOP_MIGRATIONS.map((migration) => ({
          version: migration.version,
          name: migration.name,
          appliedAt: "2026-06-06T12:00:00.000Z"
        }))
      );
      expect(tableNames).toContain("companies");
      expect(tableNames).toContain("devices");
      expect(tableNames).toContain("local_settings");
      expect(tableNames).toContain("sync_queue");
      expect(tableNames).toContain("weighing_operations");
      assertDesktopDatabaseHealthy(database);
    } finally {
      database.close();
    }
  });

  it("does not apply the same migration twice", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database, undefined, new Date("2026-06-06T12:00:00.000Z"));
      runDesktopMigrations(database, undefined, new Date("2026-06-06T13:00:00.000Z"));

      expect(getAppliedMigrations(database)).toHaveLength(DESKTOP_MIGRATIONS.length);
    } finally {
      database.close();
    }
  });

  it("uses cloud naming instead of legacy provider names in the local schema", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      const schemaSql = database
        .prepare("SELECT group_concat(sql, '\n') FROM sqlite_master WHERE sql IS NOT NULL")
        .pluck()
        .get() as string;

      expect(schemaSql.toLowerCase()).not.toContain(`fire${"base"}`);
      expect(schemaSql).toContain("pending_cloud");
      expect(schemaSql).toContain("cloud_synced_at");
    } finally {
      database.close();
    }
  });
});
