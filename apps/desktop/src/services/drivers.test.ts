import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { CacheStore } from "./cache-store";
import { createDriver } from "./drivers";

describe("drivers", () => {
  it("loads independent flag into driver cache", () => {
    const database = createDatabase();

    try {
      const driver = createDriver(database, {
        companyId: "company-1",
        name: "Motorista Independente",
        isIndependent: true
      });
      const cacheStore = new CacheStore(database);

      cacheStore.loadAll("company-1");
      const result = cacheStore.query({ entityType: "driver", search: "Independente" });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe(driver.id);
      expect(result.rows[0].isIndependent).toBe(true);
    } finally {
      database.close();
    }
  });
});

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  database
    .prepare(
      `INSERT INTO companies (id, legal_name, trade_name, created_at, updated_at)
       VALUES ('company-1', 'KyberRock LTDA', 'KyberRock', '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z')`
    )
    .run();
  return database;
}
