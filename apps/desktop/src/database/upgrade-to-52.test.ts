import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "./migrate";
import { DESKTOP_MIGRATIONS } from "./migrations";
import { openDesktopDatabase, type DesktopDatabase } from "./sqlite";
import { ensureInitialDesktopIdentity } from "../services/bootstrap";
import { getActiveReceiptPrintProfile } from "../services/printing";

/**
 * A migracao 52 RECONSTROI a `print_profiles` (o SQLite nao altera CHECK no lugar), e a
 * tabela guarda a logo do cupom e a personalizacao inteira da pedreira. Reconstrucao que
 * perde linha aqui e a pedreira imprimindo sem logo no dia seguinte — por isso este caminho
 * de atualizacao tem teste proprio, com dados dentro.
 */
describe("atualizacao de um banco em uso (51 -> 52)", () => {
  it("preserva o perfil de cupom salvo, com logo e personalizacao", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      const previous = DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 51);
      runDesktopMigrations(database, previous);
      expect(previous.at(-1)?.version).toBe(51);
      const deviceId = seedPrintProfile(database);

      const applied = runDesktopMigrations(database);
      expect(applied.map((migration) => migration.version)).toContain(52);

      const profile = getActiveReceiptPrintProfile(database, deviceId);
      expect(profile).toMatchObject({
        id: "profile-1",
        printerType: "windows",
        windowsPrinterName: "MP-4200 TH",
        paperWidthMm: 80,
        copies: 2,
        cutPaper: true,
        isActive: true
      });
      expect(profile?.receiptLogo.dataUrl).toBe("data:image/png;base64,LOGO");
      expect(profile?.receiptLogo.widthMm).toBe(24);
      expect(profile?.templateConfig).toMatchObject({
        mode: "custom",
        fontSizePx: 13,
        companyPhone: "(15) 3248-1234"
      });

      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
      expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("passa a aceitar o modo texto direto e continua recusando lixo", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      seedPrintProfile(database);

      expect(() =>
        database
          .prepare("UPDATE print_profiles SET printer_type = 'windows_escpos' WHERE id = ?")
          .run("profile-1")
      ).not.toThrow();

      // O CHECK continua existindo: a reconstrucao nao pode ter afrouxado a coluna.
      expect(() =>
        database
          .prepare("UPDATE print_profiles SET printer_type = 'qualquer' WHERE id = ?")
          .run("profile-1")
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("mantem a chave estrangeira do computador dono do perfil", () => {
    const database = openDesktopDatabase({ databasePath: ":memory:" });

    try {
      runDesktopMigrations(database);
      seedPrintProfile(database);

      // Perfil de um computador que nao existe nao pode entrar: era assim antes da
      // reconstrucao e precisa continuar sendo.
      expect(() =>
        database
          .prepare(
            `INSERT INTO print_profiles
               (id, device_id, document_type, printer_type, windows_printer_name, paper_width_mm,
                margin_json, font_config_json, copies, cut_paper, is_active, created_at, updated_at)
             VALUES ('orfao', 'device-inexistente', 'receipt_80mm', 'windows', 'X', 80,
                     '{}', '{}', 1, 0, 1, '2026-08-13T12:00:00.000Z', '2026-08-13T12:00:00.000Z')`
          )
          .run()
      ).toThrow();
    } finally {
      database.close();
    }
  });

  it("aplica sobre um banco em ARQUIVO com WAL, como nas balancas", () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-upgrade-52-"));
    const databasePath = path.join(tempDirectory, "data", "kyberrock.sqlite3");

    try {
      let database = openDesktopDatabase({ databasePath });
      runDesktopMigrations(
        database,
        DESKTOP_MIGRATIONS.filter((migration) => migration.version <= 51)
      );
      expect(database.pragma("journal_mode", { simple: true })).toBe("wal");
      const deviceId = seedPrintProfile(database);

      // Fecha e reabre, como o app faz entre um uso e o proximo.
      database.close();
      database = openDesktopDatabase({ databasePath });

      const applied = runDesktopMigrations(database);
      expect(applied.map((migration) => migration.version)).toContain(52);
      expect(getActiveReceiptPrintProfile(database, deviceId)?.windowsPrinterName).toBe(
        "MP-4200 TH"
      );
      expect(database.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
      database.close();
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});

/** Um perfil de cupom 80 mm ja configurado, como a balanca tem antes de atualizar. */
function seedPrintProfile(database: DesktopDatabase): string {
  const identity = ensureInitialDesktopIdentity(database, {
    companyId: "c1",
    companyLegalName: "Pedreira Ibiuna LTDA",
    unitId: "u1",
    unitName: "UN1",
    deviceId: "d1",
    deviceName: "PC Balanca",
    installationId: "i1"
  });
  const at = "2026-08-13T12:00:00.000Z";

  database
    .prepare(
      `INSERT INTO print_profiles
         (id, device_id, document_type, printer_type, windows_printer_name, network_host,
          network_port, paper_width_mm, margin_json, font_config_json, template_config_json,
          copies, cut_paper, is_active, created_at, updated_at)
       VALUES ('profile-1', ?, 'receipt_80mm', 'windows', 'MP-4200 TH', NULL, NULL, 80,
               '{}', ?, ?, 2, 1, 1, ?, ?)`
    )
    .run(
      identity.deviceId,
      JSON.stringify({
        receiptLogo: {
          dataUrl: "data:image/png;base64,LOGO",
          widthMm: 24,
          heightMm: 16,
          fit: "cover"
        }
      }),
      JSON.stringify({ mode: "custom", fontSizePx: 13, companyPhone: "(15) 3248-1234" }),
      at,
      at
    );

  return identity.deviceId;
}
