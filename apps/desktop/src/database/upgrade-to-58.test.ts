import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "./migrate";
import { DESKTOP_MIGRATIONS } from "./migrations";
import { openDesktopDatabase } from "./sqlite";
import { ensureInitialDesktopIdentity } from "../services/bootstrap";
import { getActiveReceiptPrintProfile } from "../services/printing";

/**
 * O cupom passou a aceitar 1 via. Antes o piso era 2 e o valor gravado nao importava — a coluna
 * nasce com DEFAULT 1. A migracao 58 sobe esses perfis para 2, para ninguem passar a imprimir
 * uma via so sem ter escolhido.
 */
describe("atualizacao de um banco em uso (57 -> 58)", () => {
  it("perfil antigo com 1 via gravada continua imprimindo 2", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 57);
      runDesktopMigrations(database, previous);
      expect(previous.at(-1)?.version).toBe(57);
      const identity = ensureInitialDesktopIdentity(database, {
        companyId: "c1",
        companyLegalName: "Pedreira Ibiuna LTDA",
        unitId: "u1",
        unitName: "UN1",
        deviceId: "d1",
        deviceName: "PC Balanca",
        installationId: "i1"
      });
      const at = "2026-09-25T12:00:00.000Z";
      database
        .prepare(
          `INSERT INTO print_profiles
             (id, device_id, document_type, printer_type, windows_printer_name, network_host,
              network_port, paper_width_mm, margin_json, font_config_json, template_config_json,
              copies, cut_paper, is_active, created_at, updated_at)
           VALUES ('profile-1', ?, 'receipt_80mm', 'windows', 'MP-4200 TH', NULL, NULL, 80,
                   '{}', '{}', '{}', 1, 1, 1, ?, ?)`
        )
        .run(identity.deviceId, at, at);

      const applied = runDesktopMigrations(database);
      expect(applied.map((migration) => migration.version)).toContain(58);
      expect(getActiveReceiptPrintProfile(database, identity.deviceId)?.copies).toBe(2);
    } finally {
      database.close();
    }
  });
});
