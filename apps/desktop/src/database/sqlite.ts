import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { ensureDesktopDataDirectories, getDesktopDataPaths } from "./paths.js";

export type DesktopDatabase = Database.Database;

export interface OpenDesktopDatabaseOptions {
  databasePath?: string;
  readonly?: boolean;
  fileMustExist?: boolean;
}

export function openDesktopDatabase(options: OpenDesktopDatabaseOptions = {}): DesktopDatabase {
  const databasePath = options.databasePath ?? getDesktopDataPaths().databasePath;

  if (!options.readonly && databasePath !== ":memory:") {
    mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  if (!options.databasePath) {
    ensureDesktopDataDirectories(getDesktopDataPaths());
  }

  const database = new Database(databasePath, {
    fileMustExist: options.fileMustExist ?? false,
    readonly: options.readonly ?? false
  });

  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  // As listagens de operacoes fazem 7-8 LEFT JOINs e rodam a cada 15s no tick do
  // multi-desktop; cache de paginas maior e tabela temporaria em memoria atacam
  // exatamente esse custo. Nenhum dos dois altera o que e gravado em disco.
  database.pragma("cache_size = -32000");
  database.pragma("temp_store = MEMORY");

  if (!options.readonly && databasePath !== ":memory:") {
    database.pragma("journal_mode = WAL");
    // `synchronous` fica no padrao (FULL) de proposito. A operacao nasce e fecha no
    // SQLite local ANTES de qualquer sincronizacao, entao perder o ultimo commit numa
    // queda de energia da pedreira significaria perder uma venda ja impressa no cupom.
    // O ganho de NORMAL nao paga esse risco.
  }

  return database;
}
