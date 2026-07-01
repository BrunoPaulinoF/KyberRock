import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { createCarrier, deleteCarrier, updateCarrier } from "./carriers";
import { createDriver, deleteDriver } from "./drivers";
import {
  listProductDefaultPriceSummaries,
  removeProductDefaultPrice,
  upsertProductDefaultPrice
} from "./product-prices";
import { createVehicle, deleteVehicle } from "./vehicles";

describe("desktop cadastro CRUD behavior", () => {
  it("reports missing records when deleting cadastros", () => {
    const database = createDatabase();

    try {
      expect(() => deleteCarrier(database, "missing-carrier")).toThrow(
        "Transportadora nao encontrada."
      );
      expect(() => deleteVehicle(database, "missing-vehicle")).toThrow("Veiculo nao encontrado.");
      expect(() => deleteDriver(database, "missing-driver")).toThrow("Motorista nao encontrado.");
    } finally {
      database.close();
    }
  });

  it("soft-deletes existing carrier, vehicle and driver cadastros", () => {
    const database = createDatabase();

    try {
      const carrier = createCarrier(database, { companyId: "company-1", name: "Transporte A" });
      const vehicle = createVehicle(database, { companyId: "company-1", plate: "abc1234" });
      const driver = createDriver(database, { companyId: "company-1", name: "Motorista A" });

      deleteCarrier(database, (carrier as { id: string }).id);
      deleteVehicle(database, vehicle.id);
      deleteDriver(database, driver.id);

      expect(readDeletedAt(database, "carriers", (carrier as { id: string }).id)).not.toBeNull();
      expect(readDeletedAt(database, "vehicles", vehicle.id)).not.toBeNull();
      expect(readDeletedAt(database, "drivers", driver.id)).not.toBeNull();
    } finally {
      database.close();
    }
  });

  it("tracks carrier OMIE push state for create, update and delete", () => {
    const database = createDatabase();

    try {
      const carrier = createCarrier(database, { companyId: "company-1", name: "Transporte A" }) as {
        id: string;
        sync_status: string;
        needs_push: number;
      };

      expect(carrier.sync_status).toBe("pending");
      expect(carrier.needs_push).toBe(1);

      database
        .prepare("UPDATE carriers SET needs_push = 0, sync_status = 'synced' WHERE id = ?")
        .run(carrier.id);

      const updated = updateCarrier(database, carrier.id, { name: "Transporte B" }) as {
        sync_status: string;
        needs_push: number;
      };

      expect(updated.sync_status).toBe("pending");
      expect(updated.needs_push).toBe(1);

      deleteCarrier(database, carrier.id);

      expect(database.prepare("SELECT needs_push FROM carriers WHERE id = ?").pluck().get(carrier.id)).toBe(0);
    } finally {
      database.close();
    }
  });

  it("removes a product default price without removing the product", () => {
    const database = createDatabase();

    try {
      insertProduct(database);
      upsertProductDefaultPrice(database, {
        companyId: "company-1",
        productId: "product-1",
        unitPriceCents: 15_000
      });

      expect(listProductDefaultPriceSummaries(database, "company-1")[0].unitPriceCents).toBe(
        15_000
      );

      removeProductDefaultPrice(database, "company-1", "product-1");

      const summary = listProductDefaultPriceSummaries(database, "company-1")[0];
      expect(summary.productId).toBe("product-1");
      expect(summary.id).toBeNull();
      expect(summary.unitPriceCents).toBeNull();
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

function insertProduct(database: DesktopDatabase): void {
  database
    .prepare(
      `INSERT INTO products (id, company_id, code, description, unit, created_at, updated_at)
       VALUES ('product-1', 'company-1', 'P001', 'Brita 1', 'ton', '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z')`
    )
    .run();
}

function readDeletedAt(database: DesktopDatabase, table: string, id: string): string | null {
  return (
    database.prepare(`SELECT deleted_at FROM ${table} WHERE id = ?`).get(id) as {
      deleted_at: string | null;
    }
  ).deleted_at;
}
