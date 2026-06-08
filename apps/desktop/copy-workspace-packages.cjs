const fs = require("fs");
const path = require("path");

const workspacePackages = ["print-templates", "shared", "scale-adapters", "omie-client"];
const desktopDistPath = path.resolve(__dirname, "dist");

for (const pkg of workspacePackages) {
  const sourcePath = path.resolve(__dirname, "../../packages", pkg, "dist");
  const targetPath = path.resolve(desktopDistPath, "node_modules", "@kyberrock", pkg);

  if (!fs.existsSync(sourcePath)) {
    console.warn(`Warning: ${sourcePath} not found, skipping copy.`);
    continue;
  }

  fs.mkdirSync(targetPath, { recursive: true });

  function copyRecursive(src, dest) {
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        fs.mkdirSync(destPath, { recursive: true });
        copyRecursive(srcPath, destPath);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  copyRecursive(sourcePath, targetPath);

  // Create a minimal package.json for the copied module
  const pkgJson = {
    name: `@kyberrock/${pkg}`,
    version: "0.1.0",
    type: "module",
    main: "dist/index.js",
    types: "dist/index.d.ts"
  };
  fs.writeFileSync(path.join(targetPath, "package.json"), JSON.stringify(pkgJson, null, 2));

  console.log(`Copied ${pkg} to ${targetPath}`);
}
