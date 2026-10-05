import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "./migrate";
import { DESKTOP_MIGRATIONS } from "./migrations";
import { openDesktopDatabase, type DesktopDatabase } from "./sqlite";
import { ensureInitialDesktopIdentity } from "../services/bootstrap";
import { isCadastroAliasResyncPending } from "../services/cadastro-aliases";

/**
 * A 62 cria a equivalencia de transportadoras gemeas (`carrier_aliases`) e a coluna com o id que
 * a nuvem tem para a transportadora da pesagem. Como na 61, a balanca que ja puxava da nuvem
 * precisa de UMA passada inteira — e a marca passa a ter um nome que vale para as duas.
 */
describe("atualizacao de um banco em uso (61 -> 62)", () => {
  it("cria a equivalencia da transportadora e troca a marca da passada inteira", () => {
    const database = migratedTo61();

    try {
      seedCarrierAndOperation(database);
      writeSetting(database, "cloud_cadastro_last_pull_at", "2026-10-01T10:00:00.000Z");
      // A marca da 61 ainda pendente: a balanca atualizou de novo antes do pull seguinte.
      writeSetting(database, "customer_alias_resync_pending", true);

      const applied = runDesktopMigrations(database);
      expect(applied.map((migration) => migration.version)).toContain(62);

      expect(
        database
          .prepare("SELECT carrier_id, remote_carrier_id FROM weighing_operations WHERE id = ?")
          .get("op-1")
      ).toEqual({ carrier_id: "transportes", remote_carrier_id: null });

      database
        .prepare(
          `INSERT INTO carrier_aliases (remote_id, company_id, local_id, created_at, updated_at)
           VALUES ('omie_supplier_42', 'c1', 'transportes', ?, ?)`
        )
        .run(AT, AT);
      expect(() =>
        database
          .prepare(
            `INSERT INTO carrier_aliases (remote_id, company_id, local_id, created_at, updated_at)
             VALUES ('outra-gemea', 'c1', 'nao-existe', ?, ?)`
          )
          .run(AT, AT)
      ).toThrow(/FOREIGN KEY/);

      expect(isCadastroAliasResyncPending(database)).toBe(true);
      expect(
        database
          .prepare(
            "SELECT COUNT(*) FROM local_settings WHERE key = 'customer_alias_resync_pending'"
          )
          .pluck()
          .get()
      ).toBe(0);
    } finally {
      database.close();
    }
  });

  it("instalacao que nunca puxou da nuvem nao ganha passada extra", () => {
    const database = migratedTo61();

    try {
      runDesktopMigrations(database);
      expect(isCadastroAliasResyncPending(database)).toBe(false);
    } finally {
      database.close();
    }
  });
});

const AT = "2026-10-01T12:00:00.000Z";

function migratedTo61(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 61);
  runDesktopMigrations(database, previous);
  expect(previous.at(-1)?.version).toBe(61);
  return database;
}

function writeSetting(database: DesktopDatabase, key: string, value: unknown): void {
  database
    .prepare("INSERT INTO local_settings (key, value_json, updated_at) VALUES (?, ?, ?)")
    .run(key, JSON.stringify(value), AT);
}

/** Por SQL cru: o banco ainda esta na 61 e os servicos sao do build NOVO. */
function seedCarrierAndOperation(database: DesktopDatabase): void {
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
      `INSERT INTO carriers (id, company_id, name, document, source, is_active, created_at, updated_at)
       VALUES ('transportes', 'c1', 'Transportes LTDA', '11.222.333/0001-81', 'local', 1, ?, ?)`
    )
    .run(AT, AT);
  database
    .prepare(
      `INSERT INTO weighing_operations (
         id, company_id, unit_id, device_id, status, operation_type, carrier_id,
         entry_weight_kg, created_at, updated_at
       ) VALUES ('op-1', 'c1', 'u1', 'd1', 'synced', 'invoice', 'transportes', 10000, ?, ?)`
    )
    .run(AT, AT);
}
