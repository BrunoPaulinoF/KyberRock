const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const desktopPackageJsonPath = path.resolve(__dirname, "package.json");
const desktopPackageJson = JSON.parse(fs.readFileSync(desktopPackageJsonPath, "utf8"));
const electronVersion = desktopPackageJson.devDependencies.electron;
const betterSqlitePath = path.resolve(__dirname, "../../node_modules/better-sqlite3");

if (!fs.existsSync(betterSqlitePath)) {
  throw new Error(`better-sqlite3 not found at ${betterSqlitePath}. Run npm install first.`);
}

const prebuildInstallExecutable = path.resolve(
  __dirname,
  process.platform === "win32"
    ? "../../node_modules/.bin/prebuild-install.cmd"
    : "../../node_modules/.bin/prebuild-install"
);

const result = spawnSync(
  prebuildInstallExecutable,
  [
    "--runtime",
    "electron",
    "--target",
    electronVersion,
    "--arch",
    "x64",
    "--platform",
    "win32"
  ],
  {
    cwd: betterSqlitePath,
    shell: true,
    stdio: "inherit"
  }
);

if (result.status !== 0) {
  if (result.error) {
    console.error(result.error);
  }
  process.exit(result.status ?? 1);
}
