import { describe, expect, it } from "vitest";

import {
  assertDesktopDatabaseHealthy,
  getAppliedMigrations,
  runDesktopMigrations
} from "./migrate";
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

      expect(migrations).toEqual([
        {
          version: 1,
          name: "initial_offline_schema",
          appliedAt: "2026-06-06T12:00:00.000Z"
        }
      ]);
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

      expect(getAppliedMigrations(database)).toHaveLength(1);
    } finally {
      database.close();
    }
  });
});
