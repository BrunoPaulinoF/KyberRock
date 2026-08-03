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
import {
  createVehicle,
  deleteVehicle,
  findOrCreateVehicle,
  getVehicleCarriers,
  updateVehicle
} from "./vehicles";
import { CacheStore } from "./cache-store";

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

      expect(
        database.prepare("SELECT needs_push FROM carriers WHERE id = ?").pluck().get(carrier.id)
      ).toBe(0);
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

  it("lists default prices only for sellable products", () => {
    const database = createDatabase();

    try {
      insertProduct(database);
      database
        .prepare(
          `INSERT INTO products (
            id, company_id, omie_product_id, code, description, unit, item_type, created_at, updated_at
          ) VALUES ('raw-material-1', 'company-1', 202, 'MP001', 'Materia Prima', 'UN', '99', datetime('now'), datetime('now'))`
        )
        .run();

      const summaries = listProductDefaultPriceSummaries(database, "company-1");

      expect(summaries.map((summary) => summary.productId)).toEqual(["product-1"]);
    } finally {
      database.close();
    }
  });

  // Sem trava de placa, cada tentativa criava mais um veiculo com a mesma placa: foi
  // assim que a mesma placa chegou a existir 6 vezes na base. A trava continua sendo uma
  // linha por placa — o que nao pode e recusar o cadastro (ver o teste seguinte).
  it("reaproveita a mesma placa em vez de duplicar, com ou sem traco", () => {
    const database = createDatabase();

    try {
      const first = createVehicle(database, {
        companyId: "company-1",
        plate: "HJI0517",
        description: "IDEAL TRANSPORTADORA"
      });

      expect(createVehicle(database, { companyId: "company-1", plate: "HJI0517" }).id).toBe(
        first.id
      );
      // A placa escrita como esta no caminhao e o mesmo veiculo.
      expect(createVehicle(database, { companyId: "company-1", plate: "HJI-0517" }).id).toBe(
        first.id
      );
      expect(createVehicle(database, { companyId: "company-1", plate: "hji0517" }).id).toBe(
        first.id
      );

      expect(
        database
          .prepare("SELECT COUNT(*) FROM vehicles WHERE plate = 'HJI0517' AND deleted_at IS NULL")
          .pluck()
          .get()
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  // O mesmo caminhao roda para varios clientes: recusar o segundo cadastro travava o
  // operador ("ja existe um veiculo com esta placa") e a placa nao entrava na operacao.
  it("soma a transportadora nova a placa que ja existe, sem apagar o cadastro anterior", () => {
    const database = createDatabase();

    try {
      const carrierA = createCarrier(database, {
        companyId: "company-1",
        name: "Transporte A"
      }) as { id: string };
      const carrierB = createCarrier(database, {
        companyId: "company-1",
        name: "Transporte B"
      }) as { id: string };

      const first = createVehicle(database, {
        companyId: "company-1",
        plate: "HJI0517",
        description: "IDEAL",
        plateState: "MG",
        carrierId: carrierA.id
      });

      const again = createVehicle(database, {
        companyId: "company-1",
        plate: "hji-0517",
        carrierId: carrierB.id
      });

      expect(again.id).toBe(first.id);
      // O cadastro de quem veio antes fica intacto.
      expect(again.description).toBe("IDEAL");
      expect(again.plate_state).toBe("MG");
      expect(again.carrier_id).toBe(carrierA.id);
      // E a placa passa a valer para as duas transportadoras.
      expect(getVehicleCarriers(database, first.id).map((link) => link.carrierId).sort()).toEqual(
        [carrierA.id, carrierB.id].sort()
      );
    } finally {
      database.close();
    }
  });

  // Escolher a transportadora no cadastro da placa precisa bastar: o seletor da entrada
  // lista vehicle_carriers, entao sem o vinculo a placa editada continuava sumida.
  it("vincula a transportadora escolhida na edicao da placa", () => {
    const database = createDatabase();

    try {
      const carrier = createCarrier(database, { companyId: "company-1", name: "Transporte A" }) as {
        id: string;
      };
      const vehicle = createVehicle(database, { companyId: "company-1", plate: "BTT2840" });

      expect(getVehicleCarriers(database, vehicle.id)).toHaveLength(0);

      updateVehicle(database, vehicle.id, { carrierId: carrier.id });

      expect(getVehicleCarriers(database, vehicle.id).map((link) => link.carrierId)).toEqual([
        carrier.id
      ]);
    } finally {
      database.close();
    }
  });

  // Recusar aqui repetiria a armadilha do cadastro invisivel: a lista esconde os inativos,
  // entao a placa ficaria ocupada por um veiculo que o operador nao tem como achar.
  it("reativa o veiculo inativo em vez de duplicar a placa", () => {
    const database = createDatabase();

    try {
      const created = createVehicle(database, { companyId: "company-1", plate: "BTT2840" });
      database.prepare("UPDATE vehicles SET is_active = 0 WHERE id = ?").run(created.id);

      const again = createVehicle(database, {
        companyId: "company-1",
        plate: "BTT2840",
        description: "CARRETA",
        plateState: "SP"
      });

      expect(again.id).toBe(created.id);
      expect(again.is_active).toBe(1);
      expect(again.description).toBe("CARRETA");
      expect(again.plate_state).toBe("SP");
      expect(
        database
          .prepare("SELECT COUNT(*) FROM vehicles WHERE plate = 'BTT2840' AND deleted_at IS NULL")
          .pluck()
          .get()
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it("reaproveita o veiculo da pesagem quando a placa vem com traco", () => {
    const database = createDatabase();

    try {
      const created = createVehicle(database, { companyId: "company-1", plate: "CLJ7386" });
      const found = findOrCreateVehicle(database, "company-1", "clj-7386");

      expect(found.id).toBe(created.id);
      expect(
        database.prepare("SELECT COUNT(*) FROM vehicles WHERE deleted_at IS NULL").pluck().get()
      ).toBe(1);
    } finally {
      database.close();
    }
  });

  it("acha a placa na busca com ou sem traco", () => {
    const database = createDatabase();

    try {
      createVehicle(database, { companyId: "company-1", plate: "HJI0517" });
      const cacheStore = new CacheStore(database);
      cacheStore.loadAll("company-1");

      expect(cacheStore.query({ entityType: "vehicle", search: "HJI-0517" }).total).toBe(1);
      expect(cacheStore.query({ entityType: "vehicle", search: "hji 0517" }).total).toBe(1);
      expect(cacheStore.query({ entityType: "vehicle", search: "HJI0517" }).total).toBe(1);
      expect(cacheStore.query({ entityType: "vehicle", search: "XYZ1234" }).total).toBe(0);
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
