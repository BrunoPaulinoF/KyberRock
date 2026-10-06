import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "./migrate";
import { DESKTOP_MIGRATIONS } from "./migrations";
import { openDesktopDatabase, type DesktopDatabase } from "./sqlite";
import { isCadastroAliasResyncPending } from "../services/cadastro-aliases";

/**
 * A 63 cria `cadastro_remote_links`, a memoria do id que a nuvem tem nas colunas de cadastro
 * traduzidas pela equivalencia de cliente/transportadora. As linhas que o pull ja tinha
 * descartado so voltam numa passada inteira — pedida de novo, so para quem ja puxava da nuvem.
 */
describe("atualizacao de um banco em uso (62 -> 63)", () => {
  it("cria a memoria do id da nuvem e pede uma passada inteira", () => {
    const database = migratedTo62();

    try {
      database
        .prepare("INSERT INTO local_settings (key, value_json, updated_at) VALUES (?, ?, ?)")
        .run("cloud_cadastro_last_pull_at", JSON.stringify("2026-10-05T10:00:00.000Z"), AT);

      const applied = runDesktopMigrations(database);
      expect(applied.map((migration) => migration.version)).toContain(63);

      database
        .prepare(
          `INSERT INTO cadastro_remote_links (table_name, row_id, column_name, remote_id, updated_at)
           VALUES ('customer_carriers', 'cc-1', 'customer_id', 'omie_11488403507', ?)`
        )
        .run(AT);
      expect(
        database
          .prepare(
            `SELECT remote_id FROM cadastro_remote_links
             WHERE table_name = 'customer_carriers' AND row_id = 'cc-1' AND column_name = 'customer_id'`
          )
          .pluck()
          .get()
      ).toBe("omie_11488403507");
      expect(isCadastroAliasResyncPending(database)).toBe(true);
    } finally {
      database.close();
    }
  });

  it("instalacao que nunca puxou da nuvem nao ganha passada extra", () => {
    const database = migratedTo62();

    try {
      runDesktopMigrations(database);
      expect(isCadastroAliasResyncPending(database)).toBe(false);
    } finally {
      database.close();
    }
  });
});

const AT = "2026-10-06T12:00:00.000Z";

function migratedTo62(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 62);
  runDesktopMigrations(database, previous);
  expect(previous.at(-1)?.version).toBe(62);
  return database;
}
