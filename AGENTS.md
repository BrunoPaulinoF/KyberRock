# KyberRock Desktop — Build & Versioning

## Desktop Installer Build

### Prerequisites
- Node.js 20+
- Windows (for native module compilation)
- Python 3.x (for `better-sqlite3` rebuild)

### Build Steps
1. `npm install` — install dependencies
2. `npm run build` — build all workspaces
3. `cd apps/desktop`
4. `npm run dist:win` — generate the Windows installer (NSIS)

### Installer Output
- The installer is generated at `apps/desktop/release/KyberRock Desktop Setup X.Y.Z.exe`
- The `release` folder contains the NSIS installer and unpacked files.

### Icon
- The desktop app icon is located at `apps/desktop/midia/icon.ico`
- Source logo: `apps/desktop/midia/kyberrocklogo.png`
- The `icon.ico` is used by `electron-builder` for the app executable and installer.

## Subagentes & Modelos

### Modelo obrigatório para subagentes
- **Todos os subagentes (`explore`, `qa-build`, `qa-lint`, `qa-test`) devem usar o modelo `deepseek-v4-flash`.**
- Isso garante consistência de custo e velocidade em todas as operações paralelas.
- Nunca usar outros modelos (ex: `gpt-4`, `claude-3`) para subagentes sem autorização explícita do usuário.

## Versioning & Release Discipline

**Every time a desktop installer is generated, it MUST be versioned and tagged.**

### Why
- Avoid regressions by keeping a known-good installer for each release
- Enable rollback if a new build breaks in production
- Provide a clear audit trail of what changed between versions

### How to Version
1. Before building, bump the version in `apps/desktop/package.json` following SemVer:
   - `0.1.0` → `0.1.1` (patch / bugfix)
   - `0.1.0` → `0.2.0` (minor / feature)
   - `0.1.0` → `1.0.0` (major / breaking)
2. Run the build: `npm run dist:win`
3. Commit the version bump and the updated `package-lock.json` (if changed)
4. Create a Git tag: `git tag -a desktop-vX.Y.Z -m "Desktop release X.Y.Z"`
5. Push the tag: `git push origin desktop-vX.Y.Z`
6. (Optional) Attach the `.exe` installer to the GitHub Release page for that tag

### Tag Format
- `desktop-vX.Y.Z` (e.g., `desktop-v0.1.0`)
- Never overwrite an existing tag. If a hotfix is needed, bump the patch version.

### Rollback Procedure
- If a deployed installer causes issues, checkout the last known-good tag:
  ```bash
  git checkout desktop-vX.Y.Z
  cd apps/desktop
  npm run dist:win
  ```
- The previous installer will be regenerated identically.
