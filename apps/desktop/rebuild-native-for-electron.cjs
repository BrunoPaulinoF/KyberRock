const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const desktopPackageJsonPath = path.resolve(__dirname, "package.json");
const desktopPackageJson = JSON.parse(fs.readFileSync(desktopPackageJsonPath, "utf8"));
const electronVersion = desktopPackageJson.devDependencies.electron;
const repoRoot = path.resolve(__dirname, "../..");
const betterSqlitePath = path.join(repoRoot, "node_modules", "better-sqlite3");

if (!fs.existsSync(betterSqlitePath)) {
  throw new Error(`better-sqlite3 not found at ${betterSqlitePath}. Run npm install first.`);
}

// better-sqlite3 nao publica prebuild para toda versao de Electron (ex.: Electron
// 40 = ABI 143, enquanto os prebuilds vao ate ~136). Por isso compilamos o modulo
// nativo do fonte contra o Electron alvo usando @electron/rebuild, que funciona
// com ou sem prebuild disponivel. Requer toolchain de C++ (no Windows, Visual
// Studio com "Desktop development with C++" — os runners windows-2022 tem).
const electronRebuildCli = path.join(repoRoot, "node_modules", "@electron", "rebuild", "lib", "cli.js");

const result = spawnSync(
  process.execPath,
  [
    electronRebuildCli,
    "--force",
    "--version",
    electronVersion,
    "--only",
    "better-sqlite3",
    "--module-dir",
    repoRoot,
    "--build-from-source"
  ],
  { stdio: "inherit" }
);

if (result.status !== 0) {
  if (result.error) {
    console.error(result.error);
  }
  process.exit(result.status ?? 1);
}
