/**
 * Cadastro feito sem internet: nasce marcado, e na volta da internet e juntado ao gemeo
 * que ja existia (o do site, que o pull trouxe) — ou liberado para subir, se era novo.
 */

import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity } from "./bootstrap";
import {
  hasOfflinePendingCadastro,
  lastRowId,
  listOfflinePendingCadastro,
  markCreatedOffline,
  personNameKey,
  plateKey,
  reconcileOfflineCadastros
} from "./offline-cadastro";

const OLD = "2026-08-01T10:00:00.000Z";
const OUTAGE = "2026-09-28T15:00:00.000Z";
const BACK = new Date("2026-09-28T16:00:00.000Z");

describe("cadastro feito sem internet", () => {
  it("marca so o que nasceu durante a chamada", () => {
    const database = createDatabase();
    try {
      insertDriver(database, { id: "antigo", name: "Antigo", createdAt: OUTAGE });
      const before = lastRowId(database, "drivers");
      insertDriver(database, { id: "novo", name: "Novo", createdAt: OUTAGE });

      markCreatedOffline(database, "drivers", "company-1", before);

      expect(listOfflinePendingCadastro(database).drivers).toEqual(["novo"]);
      expect(hasOfflinePendingCadastro(database)).toBe(true);
    } finally {
      database.close();
    }
  });

  it("motorista com o mesmo nome do site: a pesagem passa para o do site e o daqui some", () => {
    const database = createDatabase();
    try {
      insertCarrier(database, { id: "carrier-1", document: "11222333000181", createdAt: OLD });
      insertDriver(database, { id: "site", name: "João  da Silva", createdAt: OLD });
      insertDriver(database, {
        id: "offline",
        name: "JOAO DA SILVA",
        createdAt: OUTAGE,
        pending: true
      });
      insertDriverCarrier(database, "dc-offline", "offline", "carrier-1");
      insertOperation(database, { id: "op-1", driverId: "offline" });

      const result = reconcileOfflineCadastros(database, BACK);

      expect(result.merged).toEqual([{ table: "drivers", loserId: "offline", keeperId: "site" }]);
      expect(column(database, "weighing_operations", "driver_id", "op-1")).toBe("site");
      expect(column(database, "driver_carriers", "driver_id", "dc-offline")).toBe("site");
      expect(count(database, "drivers", "offline")).toBe(0);
      expect(hasOfflinePendingCadastro(database)).toBe(false);
    } finally {
      database.close();
    }
  });

  it("placa repetida: junta pela placa e nao duplica o vinculo que o do site ja tinha", () => {
    const database = createDatabase();
    try {
      insertCarrier(database, { id: "carrier-1", document: "11222333000181", createdAt: OLD });
      insertVehicle(database, { id: "site", plate: "ABC1D23", createdAt: OLD });
      insertVehicle(database, {
        id: "offline",
        plate: "abc-1d23",
        createdAt: OUTAGE,
        pending: true
      });
      insertVehicleCarrier(database, "vc-site", "site", "carrier-1");
      insertVehicleCarrier(database, "vc-offline", "offline", "carrier-1");
      insertOperation(database, { id: "op-1", vehicleId: "offline" });

      reconcileOfflineCadastros(database, BACK);

      expect(column(database, "weighing_operations", "vehicle_id", "op-1")).toBe("site");
      expect(count(database, "vehicle_carriers", "vc-offline")).toBe(0);
      expect(count(database, "vehicles", "offline")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("cliente com o mesmo CNPJ: fica o do site (com codigo OMIE) e o daqui vira tombstone", () => {
    const database = createDatabase();
    try {
      insertCustomer(database, {
        id: "site",
        document: "12.ABC.345/01DE-35",
        omieCustomerId: 777,
        createdAt: OUTAGE
      });
      insertCustomer(database, {
        id: "offline",
        document: "12ABC34501DE35",
        createdAt: "2026-09-28T14:00:00.000Z",
        pending: true
      });
      insertOperation(database, { id: "op-1", customerId: "offline" });

      const result = reconcileOfflineCadastros(database, BACK);

      // Mesmo o daqui sendo mais antigo, fica o que ja existia: so o daqui nunca saiu da maquina.
      expect(result.merged).toEqual([{ table: "customers", loserId: "offline", keeperId: "site" }]);
      expect(column(database, "weighing_operations", "customer_id", "op-1")).toBe("site");
      expect(column(database, "customers", "deleted_at", "offline")).not.toBeNull();
    } finally {
      database.close();
    }
  });

  it("transportadora repetida: veiculo e padrao do cliente passam para a que ficou", () => {
    const database = createDatabase();
    try {
      insertCarrier(database, { id: "site", document: "11222333000181", createdAt: OLD });
      insertCarrier(database, {
        id: "offline",
        document: "11.222.333/0001-81",
        createdAt: OUTAGE,
        pending: true
      });
      insertVehicle(database, {
        id: "v-1",
        plate: "XYZ9A88",
        createdAt: OUTAGE,
        carrierId: "offline"
      });
      insertCustomer(database, {
        id: "c-1",
        document: null,
        createdAt: OLD,
        defaultCarrierId: "offline"
      });

      reconcileOfflineCadastros(database, BACK);

      expect(column(database, "vehicles", "carrier_id", "v-1")).toBe("site");
      expect(column(database, "customers", "default_carrier_id", "c-1")).toBe("site");
      expect(count(database, "carriers", "offline")).toBe(0);
    } finally {
      database.close();
    }
  });

  it("cadastro novo de verdade e liberado com updated_at andando para o push enxergar", () => {
    const database = createDatabase();
    try {
      insertDriver(database, { id: "site", name: "Maria", createdAt: OLD });
      insertDriver(database, { id: "offline", name: "Pedro", createdAt: OUTAGE, pending: true });

      const result = reconcileOfflineCadastros(database, BACK);

      expect(result.merged).toEqual([]);
      expect(result.released).toBe(1);
      expect(column(database, "drivers", "updated_at", "offline")).toBe(BACK.toISOString());
      expect(hasOfflinePendingCadastro(database)).toBe(false);
    } finally {
      database.close();
    }
  });

  it("cliente sem documento nao tem com quem ser comparado: so e liberado", () => {
    const database = createDatabase();
    try {
      insertCustomer(database, { id: "site", document: null, createdAt: OLD });
      insertCustomer(database, { id: "offline", document: null, createdAt: OUTAGE, pending: true });

      const result = reconcileOfflineCadastros(database, BACK);

      expect(result.merged).toEqual([]);
      expect(count(database, "customers", "offline")).toBe(1);
    } finally {
      database.close();
    }
  });
});

describe("chaves de comparacao", () => {
  it("placa ignora traco, espaco e caixa", () => {
    expect(plateKey("abc-1d23")).toBe(plateKey("ABC 1D23"));
  });

  it("nome ignora acento, caixa e espacos repetidos", () => {
    expect(personNameKey("  João   da Silva ")).toBe("JOAO DA SILVA");
  });
});

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
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
  return database;
}

function insertCustomer(
  database: DesktopDatabase,
  options: {
    id: string;
    document: string | null;
    createdAt: string;
    omieCustomerId?: number;
    pending?: boolean;
    defaultCarrierId?: string;
  }
): void {
  database
    .prepare(
      `INSERT INTO customers
         (id, company_id, legal_name, trade_name, document, omie_customer_id, source, is_active,
          sync_status, needs_push, default_carrier_id, offline_pending, created_at, updated_at)
       VALUES (?, 'company-1', 'Cliente LTDA', 'Cliente', ?, ?, 'local', 1, 'synced', 0, ?, ?, ?, ?)`
    )
    .run(
      options.id,
      options.document,
      options.omieCustomerId ?? null,
      options.defaultCarrierId ?? null,
      options.pending ? 1 : 0,
      options.createdAt,
      options.createdAt
    );
}

function insertCarrier(
  database: DesktopDatabase,
  options: { id: string; document: string; createdAt: string; pending?: boolean }
): void {
  database
    .prepare(
      `INSERT INTO carriers (id, company_id, name, document, source, is_active, offline_pending, created_at, updated_at)
       VALUES (?, 'company-1', 'Transportes', ?, 'local', 1, ?, ?, ?)`
    )
    .run(
      options.id,
      options.document,
      options.pending ? 1 : 0,
      options.createdAt,
      options.createdAt
    );
}

function insertDriver(
  database: DesktopDatabase,
  options: { id: string; name: string; createdAt: string; pending?: boolean }
): void {
  database
    .prepare(
      `INSERT INTO drivers (id, company_id, name, is_active, offline_pending, created_at, updated_at)
       VALUES (?, 'company-1', ?, 1, ?, ?, ?)`
    )
    .run(options.id, options.name, options.pending ? 1 : 0, options.createdAt, options.createdAt);
}

function insertVehicle(
  database: DesktopDatabase,
  options: { id: string; plate: string; createdAt: string; pending?: boolean; carrierId?: string }
): void {
  database
    .prepare(
      `INSERT INTO vehicles (id, company_id, plate, carrier_id, is_active, offline_pending, created_at, updated_at)
       VALUES (?, 'company-1', ?, ?, 1, ?, ?, ?)`
    )
    .run(
      options.id,
      options.plate,
      options.carrierId ?? null,
      options.pending ? 1 : 0,
      options.createdAt,
      options.createdAt
    );
}

function insertDriverCarrier(
  database: DesktopDatabase,
  id: string,
  driverId: string,
  carrierId: string
): void {
  database
    .prepare(
      `INSERT INTO driver_carriers (id, driver_id, carrier_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    )
    .run(id, driverId, carrierId, OUTAGE, OUTAGE);
}

function insertVehicleCarrier(
  database: DesktopDatabase,
  id: string,
  vehicleId: string,
  carrierId: string
): void {
  database
    .prepare(
      `INSERT INTO vehicle_carriers (id, vehicle_id, carrier_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    )
    .run(id, vehicleId, carrierId, OUTAGE, OUTAGE);
}

function insertOperation(
  database: DesktopDatabase,
  options: { id: string; customerId?: string; driverId?: string; vehicleId?: string }
): void {
  database
    .prepare(
      `INSERT INTO weighing_operations
         (id, company_id, unit_id, device_id, status, operation_type, customer_id, driver_id,
          vehicle_id, created_at, updated_at)
       VALUES (?, 'company-1', 'unit-1', 'device-1', 'closed_local', 'invoice', ?, ?, ?, ?, ?)`
    )
    .run(
      options.id,
      options.customerId ?? null,
      options.driverId ?? null,
      options.vehicleId ?? null,
      OUTAGE,
      OUTAGE
    );
}

function column(database: DesktopDatabase, table: string, name: string, id: string): unknown {
  return database.prepare(`SELECT ${name} FROM ${table} WHERE id = ?`).pluck().get(id);
}

function count(database: DesktopDatabase, table: string, id: string): number {
  return database.prepare(`SELECT COUNT(*) FROM ${table} WHERE id = ?`).pluck().get(id) as number;
}
