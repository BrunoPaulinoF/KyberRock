import { mkdirSync } from "node:fs";
import path from "node:path";

export interface DesktopDataPaths {
  rootDirectory: string;
  dataDirectory: string;
  backupDirectory: string;
  logDirectory: string;
  configDirectory: string;
  databasePath: string;
}

export function getDefaultDesktopBaseDirectory(): string {
  return process.env.PROGRAMDATA ?? path.join(process.cwd(), ".kyberrock-data");
}

export function getDesktopDataPaths(
  baseDirectory = getDefaultDesktopBaseDirectory()
): DesktopDataPaths {
  const rootDirectory = path.join(baseDirectory, "KyberRock");
  const dataDirectory = path.join(rootDirectory, "data");

  return {
    rootDirectory,
    dataDirectory,
    backupDirectory: path.join(rootDirectory, "backups"),
    logDirectory: path.join(rootDirectory, "logs"),
    configDirectory: path.join(rootDirectory, "config"),
    databasePath: path.join(dataDirectory, "kyberrock.sqlite3")
  };
}

export function ensureDesktopDataDirectories(paths: DesktopDataPaths): void {
  mkdirSync(paths.dataDirectory, { recursive: true });
  mkdirSync(paths.backupDirectory, { recursive: true });
  mkdirSync(paths.logDirectory, { recursive: true });
  mkdirSync(paths.configDirectory, { recursive: true });
}
