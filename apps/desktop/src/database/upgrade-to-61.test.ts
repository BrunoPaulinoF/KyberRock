import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "./migrate";
import { DESKTOP_MIGRATIONS } from "./migrations";
import { openDesktopDatabase, type DesktopDatabase } from "./sqlite";
import { ensureInitialDesktopIdentity } from "../services/bootstrap";
import { isCustomerAliasResyncPending } from "../services/customer-aliases";

/**
 * A 61 cria a equivalencia de clientes gemeos (`customer_aliases`) e a coluna com o id que a
 * nuvem tem para o cliente da pesagem. A tabela nasce vazia — os gemeos ja foram descartados
 * em pulls anteriores —, entao a balanca que ja puxava da nuvem precisa de UMA passada inteira
 * para a equivalencia nascer e curar as pesagens ja gravadas sem cliente.
 */
describe("atualizacao de um banco em uso (60 -> 61)", () => {
  it("cria a equivalencia, preserva as pesagens e pede uma passada inteira", () => {
    const database = migratedTo60();

    try {
      seedCustomerAndOperation(database);
      database
        .prepare("INSERT INTO local_settings (key, value_json, updated_at) VALUES (?, ?, ?)")
        .run("cloud_cadastro_last_pull_at", JSON.stringify("2026-10-01T10:00:00.000Z"), AT);

      const applied = runDesktopMigrations(database);
      expect(applied.map((migration) => migration.version)).toContain(61);

      expect(
        database
          .prepare("SELECT customer_id, remote_customer_id FROM weighing_operations WHERE id = ?")
          .get("op-1")
      ).toEqual({ customer_id: "levisa", remote_customer_id: null });

      database
        .prepare(
          `INSERT INTO customer_aliases (remote_id, company_id, local_id, created_at, updated_at)
           VALUES ('omie_11488403507', 'c1', 'levisa', ?, ?)`
        )
        .run(AT, AT);
      expect(
        database
          .prepare("SELECT local_id FROM customer_aliases WHERE remote_id = ?")
          .pluck()
          .get("omie_11488403507")
      ).toBe("levisa");
      // A equivalencia aponta para um cadastro DAQUI.
      expect(() =>
        database
          .prepare(
            `INSERT INTO customer_aliases (remote_id, company_id, local_id, created_at, updated_at)
             VALUES ('outro-gemeo', 'c1', 'nao-existe', ?, ?)`
          )
          .run(AT, AT)
      ).toThrow(/FOREIGN KEY/);

      expect(isCustomerAliasResyncPending(database)).toBe(true);
    } finally {
      database.close();
    }
  });

  it("instalacao que nunca puxou da nuvem nao ganha passada extra", () => {
    const database = migratedTo60();

    try {
      runDesktopMigrations(database);
      expect(isCustomerAliasResyncPending(database)).toBe(false);
    } finally {
      database.close();
    }
  });
});

const AT = "2026-10-01T12:00:00.000Z";

function migratedTo60(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 60);
  runDesktopMigrations(database, previous);
  expect(previous.at(-1)?.version).toBe(60);
  return database;
}

/** Por SQL cru: o banco ainda esta na 60 e os servicos sao do build NOVO. */
function seedCustomerAndOperation(database: DesktopDatabase): void {
  ensureInitialDesktopIdentity(database, {
    companyId: "c1",
    companyLegalName: "Pedreira Ibiuna LTDA",
    unitId: "u1",
    unitName: "UN1",
    deviceId: "d1",
    deviceName: "PC Balanca",
    installationId: "i1",
    adoptDeviceId: true
  });
  database
    .prepare(
      `INSERT INTO customers (id, company_id, source, legal_name, trade_name, document, is_active, created_at, updated_at)
       VALUES ('levisa', 'c1', 'local', 'LEVISA COMERCIO LTDA', 'LEVISA', '12.345.678/0001-95', 1, ?, ?)`
    )
    .run(AT, AT);
  database
    .prepare(
      `INSERT INTO weighing_operations (
         id, company_id, unit_id, device_id, status, operation_type, customer_id,
         entry_weight_kg, created_at, updated_at
       ) VALUES ('op-1', 'c1', 'u1', 'd1', 'synced', 'invoice', 'levisa', 10000, ?, ?)`
    )
    .run(AT, AT);
}
