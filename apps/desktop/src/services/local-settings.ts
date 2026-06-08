import type { DesktopDatabase } from "../database/sqlite.js";

interface LocalSettingRow {
  value_json: string;
}

export function readLocalSetting<TValue = unknown>(database: DesktopDatabase, key: string): TValue | null {
  const row = database.prepare("SELECT value_json FROM local_settings WHERE key = ?").get(key) as
    | LocalSettingRow
    | undefined;

  return row ? (JSON.parse(row.value_json) as TValue) : null;
}

export function readStringLocalSetting(database: DesktopDatabase, key: string): string | null {
  const value = readLocalSetting(database, key);
  return typeof value === "string" ? value : null;
}

export function writeLocalSetting(
  database: DesktopDatabase,
  key: string,
  value: unknown,
  updatedAt: string = new Date().toISOString()
): void {
  database
    .prepare(
      `INSERT INTO local_settings (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value), updatedAt);
}
