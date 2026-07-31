import { describe, expect, it } from "vitest";

import { runDesktopMigrations } from "../database/migrate";
import { openDesktopDatabase, type DesktopDatabase } from "../database/sqlite";
import {
  readOmieAdvanceConfig,
  rememberDetectedAdvanceConfig,
  writeOmieAdvanceConfig
} from "./omie-advance-config";

describe("configuracao do adiantamento OMIE", () => {
  it("comeca vazia (deteccao pela descricao)", () => {
    const database = createDatabase();
    try {
      expect(readOmieAdvanceConfig(database)).toEqual({
        categoryCodes: [],
        accountCode: null,
        accountName: null,
        manual: false
      });
    } finally {
      database.close();
    }
  });

  it("guarda o que a sincronizacao descobriu para os proximos ciclos", () => {
    const database = createDatabase();
    try {
      rememberDetectedAdvanceConfig(database, {
        categoryCodes: ["1.01.05"],
        accountCode: 22
      });

      expect(readOmieAdvanceConfig(database)).toMatchObject({
        categoryCodes: ["1.01.05"],
        accountCode: 22,
        manual: false
      });
    } finally {
      database.close();
    }
  });

  it("nao sobrescreve a categoria fixada pelo operador", () => {
    const database = createDatabase();
    try {
      // Pedreira renomeou a categoria: a deteccao por descricao nao acha, e o
      // operador aponta qual e. A partir dai a deteccao nao manda mais.
      writeOmieAdvanceConfig(database, { categoryCodes: ["2.05.99"], manual: true });
      rememberDetectedAdvanceConfig(database, { categoryCodes: ["1.01.05"], accountCode: 22 });

      expect(readOmieAdvanceConfig(database)).toMatchObject({
        categoryCodes: ["2.05.99"],
        manual: true
      });
    } finally {
      database.close();
    }
  });

  it("normaliza codigos repetidos, vazios e conta invalida", () => {
    const database = createDatabase();
    try {
      const config = writeOmieAdvanceConfig(database, {
        categoryCodes: [" 1.01.05 ", "1.01.05", ""],
        accountCode: 0
      });

      expect(config.categoryCodes).toEqual(["1.01.05"]);
      expect(config.accountCode).toBeNull();
    } finally {
      database.close();
    }
  });
});

function createDatabase(): DesktopDatabase {
  const database = openDesktopDatabase({ databasePath: ":memory:" });
  runDesktopMigrations(database);
  return database;
}
