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

  if (!options.readonly && databasePath !== ":memory:") {
    database.pragma("journal_mode = WAL");
  }

  return database;
}
