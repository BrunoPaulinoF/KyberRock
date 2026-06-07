import { DESKTOP_MIGRATIONS, type DesktopMigration } from "./migrations.js";
import type { DesktopDatabase } from "./sqlite.js";

export interface AppliedMigration {
  version: number;
  name: string;
  appliedAt: string;
}

interface AppliedMigrationRow {
  version: number;
  name: string;
  applied_at: string;
}

export function runDesktopMigrations(
  database: DesktopDatabase,
  migrations: readonly DesktopMigration[] = DESKTOP_MIGRATIONS,
  now: Date = new Date()
): AppliedMigration[] {
  ensureMigrationTable(database);

  const applied = new Map(
    getAppliedMigrations(database).map((migration) => [migration.version, migration.name])
  );
  const appliedAt = now.toISOString();
  const applyMigration = database.transaction((migration: DesktopMigration) => {
    database.exec(migration.sql);
    database
      .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
      .run(migration.version, migration.name, appliedAt);
  });

  for (const migration of [...migrations].sort((left, right) => left.version - right.version)) {
    const appliedName = applied.get(migration.version);

    if (appliedName === migration.name) {
      continue;
    }

    if (appliedName) {
      throw new Error(
        `Migration version ${migration.version} was applied as ${appliedName}, expected ${migration.name}.`
      );
    }

    applyMigration(migration);
  }

  return getAppliedMigrations(database);
}

export function getAppliedMigrations(database: DesktopDatabase): AppliedMigration[] {
  ensureMigrationTable(database);

  return database
    .prepare("SELECT version, name, applied_at FROM schema_migrations ORDER BY version")
    .all()
    .map((row) => mapAppliedMigrationRow(row as AppliedMigrationRow));
}

export function assertDesktopDatabaseHealthy(database: DesktopDatabase): void {
  const integrityResult = database.prepare("PRAGMA integrity_check").pluck().get();

  if (integrityResult !== "ok") {
    throw new Error(`SQLite integrity check failed: ${String(integrityResult)}`);
  }

  const foreignKeyIssues = database.prepare("PRAGMA foreign_key_check").all();

  if (foreignKeyIssues.length > 0) {
    throw new Error(`SQLite foreign key check failed with ${foreignKeyIssues.length} issue(s).`);
  }
}

function ensureMigrationTable(database: DesktopDatabase): void {
  database.exec(`
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);
}

function mapAppliedMigrationRow(row: AppliedMigrationRow): AppliedMigration {
  return {
    version: row.version,
    name: row.name,
    appliedAt: row.applied_at
  };
}
