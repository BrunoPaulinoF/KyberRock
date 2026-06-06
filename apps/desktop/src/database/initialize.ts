import { ensureDesktopDataDirectories, getDesktopDataPaths, type DesktopDataPaths } from "./paths";
import { runDesktopMigrations, type AppliedMigration } from "./migrate";
import { openDesktopDatabase, type DesktopDatabase } from "./sqlite";

export interface InitializedDesktopDatabase {
  database: DesktopDatabase;
  paths: DesktopDataPaths;
  appliedMigrations: AppliedMigration[];
}

export function initializeDesktopDatabase(baseDirectory?: string): InitializedDesktopDatabase {
  const paths = getDesktopDataPaths(baseDirectory);
  ensureDesktopDataDirectories(paths);

  const database = openDesktopDatabase({ databasePath: paths.databasePath });
  const appliedMigrations = runDesktopMigrations(database);

  return {
    database,
    paths,
    appliedMigrations
  };
}
