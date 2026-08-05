import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getAppliedMigrations, runDesktopMigrations } from "../database/migrate";
import { DESKTOP_MIGRATIONS } from "../database/migrations";
import { openDesktopDatabase } from "../database/sqlite";
import { ensureInitialDesktopIdentity, getLocalDesktopIdentity } from "./bootstrap";
import {
  assertDatabaseFileHealthy,
  createAutomaticBackup,
  exportManualBackup,
  pruneOldBackups,
  restoreBackup
} from "./backup";

describe("desktop backup", () => {
  it("creates automatic backups and restores them into a new database file", async () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-backup-"));
    const databasePath = path.join(tempDirectory, "data", "kyberrock.sqlite3");
    const backupDirectory = path.join(tempDirectory, "backups");
    const restoredDatabasePath = path.join(tempDirectory, "restored", "kyberrock.sqlite3");
    const database = openDesktopDatabase({ databasePath });

    try {
      runDesktopMigrations(database);
      const identity = ensureInitialDesktopIdentity(database, {
        companyId: "company-1",
        companyLegalName: "KyberRock Mineracao LTDA",
        unitId: "unit-1",
        unitName: "Pedreira Principal",
        deviceId: "device-1",
        deviceName: "PC Balanca",
        installationId: "install-1"
      });

      const backup = await createAutomaticBackup({
        database,
        databasePath,
        backupDirectory,
        unitId: identity.unitId,
        now: new Date("2026-06-06T12:30:45.000Z")
      });

      expect(backup.backupPath).toContain("kyberrock-unit-1-20260606-123045.sqlite3");
      expect(existsSync(backup.backupPath)).toBe(true);
      assertDatabaseFileHealthy(backup.backupPath);

      database.close();
      restoreBackup(backup.backupPath, restoredDatabasePath);

      const restoredDatabase = openDesktopDatabase({ databasePath: restoredDatabasePath });

      try {
        expect(getAppliedMigrations(restoredDatabase)).toHaveLength(DESKTOP_MIGRATIONS.length);
        expect(getLocalDesktopIdentity(restoredDatabase)).toEqual(identity);
      } finally {
        restoredDatabase.close();
      }
    } finally {
      if (database.open) {
        database.close();
      }
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("exports a manual backup to the selected path", async () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-export-"));
    const databasePath = path.join(tempDirectory, "data", "kyberrock.sqlite3");
    const exportPath = path.join(tempDirectory, "manual", "manual-backup.sqlite3");
    const database = openDesktopDatabase({ databasePath });

    try {
      runDesktopMigrations(database);

      const backup = await exportManualBackup(database, exportPath);

      expect(backup.backupPath).toBe(exportPath);
      expect(existsSync(exportPath)).toBe(true);
      assertDatabaseFileHealthy(exportPath);
    } finally {
      database.close();
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});

describe("backup retention", () => {
  it("keeps the newest backups per quarry and leaves everything else alone", () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-retention-"));

    try {
      const write = (name: string) => writeFileSync(path.join(tempDirectory, name), "x");

      // Duas pedreiras na mesma pasta: um mesmo desktop pode ter trocado de unidade.
      // O unitId e um UUID e carrega hifens, como em producao.
      const unitA = "11111111-1111-4111-8111-111111111111";
      const unitB = "22222222-2222-4222-8222-222222222222";
      for (const day of ["01", "02", "03", "04", "05"]) {
        write(`kyberrock-${unitA}-202608${day}-120000.sqlite3`);
      }
      write(`kyberrock-${unitB}-20260801-120000.sqlite3`);
      write(`kyberrock-${unitB}-20260802-120000.sqlite3`);
      // Arquivos que nao sao backup automatico nunca podem ser tocados.
      write("manual-backup.sqlite3");
      write("anotacoes.txt");

      const removed = pruneOldBackups(tempDirectory, { keep: 2 });

      expect(removed.sort()).toEqual([
        `kyberrock-${unitA}-20260801-120000.sqlite3`,
        `kyberrock-${unitA}-20260802-120000.sqlite3`,
        `kyberrock-${unitA}-20260803-120000.sqlite3`
      ]);

      // A pedreira B tinha exatamente o limite: nada dela sai.
      expect(readdirSync(tempDirectory).sort()).toEqual([
        "anotacoes.txt",
        `kyberrock-${unitA}-20260804-120000.sqlite3`,
        `kyberrock-${unitA}-20260805-120000.sqlite3`,
        `kyberrock-${unitB}-20260801-120000.sqlite3`,
        `kyberrock-${unitB}-20260802-120000.sqlite3`,
        "manual-backup.sqlite3"
      ]);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("removes the WAL sidecars together with the backup they belong to", () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-sidecar-"));

    try {
      const unit = "unit-1";
      const write = (name: string) => writeFileSync(path.join(tempDirectory, name), "x");
      // A verificacao de saude abre cada backup e deixa -wal/-shm ao lado. Se a poda
      // apagasse so o .sqlite3, esses orfaos ficariam para sempre.
      for (const day of ["01", "02"]) {
        const backup = `kyberrock-${unit}-202608${day}-120000.sqlite3`;
        write(backup);
        write(`${backup}-wal`);
        write(`${backup}-shm`);
      }

      const removed = pruneOldBackups(tempDirectory, { keep: 1 });

      expect(removed).toEqual([`kyberrock-${unit}-20260801-120000.sqlite3`]);
      // O backup antigo saiu inteiro, com sidecars; o mantido segue completo.
      expect(readdirSync(tempDirectory).sort()).toEqual([
        `kyberrock-${unit}-20260802-120000.sqlite3`,
        `kyberrock-${unit}-20260802-120000.sqlite3-shm`,
        `kyberrock-${unit}-20260802-120000.sqlite3-wal`
      ]);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });

  it("never empties the directory and tolerates a missing one", () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "kyberrock-retention-min-"));

    try {
      const unit = "unit-1";
      writeFileSync(path.join(tempDirectory, `kyberrock-${unit}-20260801-120000.sqlite3`), "x");

      // keep e forcado para no minimo 1: um valor zerado nao pode apagar o unico backup.
      expect(pruneOldBackups(tempDirectory, { keep: 0 })).toEqual([]);
      expect(readdirSync(tempDirectory)).toHaveLength(1);

      // Pasta inexistente e um no-op, nao uma excecao: a manutencao roda apos o backup
      // e nunca pode derrubar essa rotina.
      expect(pruneOldBackups(path.join(tempDirectory, "nao-existe"))).toEqual([]);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
