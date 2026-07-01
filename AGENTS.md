# KyberRock — Agent Guide

## Layout

- **Monorepo**: `npm` workspaces. Root `tsconfig.json` is `references`-only; each workspace has `composite: true` and excludes `**/*.test.ts` from build — use `import type` for test-only symbols.
- **Desktop** (`apps/desktop`, `@kyberrock/desktop`): Electron 40 + React 19 + Vite 7 + `better-sqlite3`. Hardware integration (scale, printer) lives in `src/services/`; the renderer never imports Node.
- **Loader web** (`apps/loader-web`, `@kyberrock/loader-web`): React 19 + Vite 7 + Supabase JS, served via nginx (Docker / EasyPanel).
- **Functions lib** (`functions`, `@kyberrock/functions`): TypeScript utils workspace (not to be confused with Deno Edge Functions in `supabase/functions/`).
- **Shared packages** (`packages/`): `shared` (types), `scale-adapters` (balance), `omie-client` (OMIE), `print-templates` (80 mm / A4).
- **Cloud**: Supabase Postgres + Deno Edge Functions in `supabase/functions/` (with `_shared/`); SQL migrations in `supabase/migrations/`. Use the `supabase_kyberrock_*` MCP tools for DB / function work.
- Product / architecture docs: `PRD.md`, `PLAN.md`, `docs/ARCHITECTURE.md`, `docs/phase-*/`. Do not duplicate them here.

## Commands

Root:

```bash
npm install
npm run build   # runs each workspace's build (tsc + vite as applicable)
npm run lint    # eslint . (flat config)
npm test        # vitest run
npm run format  # prettier . --write
```

Per workspace (`-w` is short for `--workspace`):

```bash
npm run dev      -w @kyberrock/loader-web   # vite @ :5173
npm run dev      -w @kyberrock/desktop      # vite @ :5174 (renderer only)
npm run start    -w @kyberrock/desktop      # build + electron .
npm run build    -w @kyberrock/desktop      # tsc -b + vite + copy workspace dists
npm run dist:win -w @kyberrock/desktop      # NSIS installer -> apps/desktop/release/
```

## Desktop quirks

- **Vite**: `base: "./"`, `outDir: "dist/renderer"`. Dev server is `0.0.0.0:5174`; to load it in Electron, export `KYBERROCK_DESKTOP_DEV_SERVER_URL=http://localhost:5174` before `npm run start`.
- **better-sqlite3 (native)**: must be rebuilt against Electron. `dist:win` calls `rebuild:native:electron` automatically; for plain `npm run start` after a fresh `npm install` or after bumping Electron, run `npm run rebuild:native:electron -w @kyberrock/desktop`. Requires Python 3 + MSVC build tools on Windows.
- **Workspace imports inside Electron**: `apps/desktop/build` runs `copy-workspace-packages.cjs`, which copies `packages/*/dist` into `apps/desktop/dist/node_modules/@kyberrock/*`. If `@kyberrock/<pkg>` fails to resolve at runtime, run `npm run build` at the root first.
- **Electron security**: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. All Node / IPC flows through `src/preload/preload.ts` and `ipcMain.handle("desktop:*", …)` in `src/main/main.ts`.
- **Auto-update** (`electron-updater`): `autoDownload: false`, `autoInstallOnAppQuit: false`. Generic HTTPS provider at `https://updates.kyberrock.com/desktop/win`. Checks every 30 min, **only when `app.isPackaged`** — the operator must explicitly trigger download and install.
- **SQLite path**: `%ProgramData%\\KyberRock\\data\\kyberrock.sqlite3` (see `src/database/paths.ts`).
- **Startup log**: `%LOCALAPPDATA%\\KyberRock Desktop\\startup.log`. Check here first when the window fails to open.
- **Icon**: `apps/desktop/midia/icon.ico` (source PNG: `apps/desktop/midia/kyberrocklogo.png`); consumed by `electron-builder` for the executable and the NSIS installer.

## Loader-web quirks

- `npm run dev -w @kyberrock/loader-web` → port 5173.
- Docker: `docker build -f apps/loader-web/Dockerfile .`. The build context is the repo root; the stage installs root deps and then runs `npm run build -w @kyberrock/loader-web`.
- `.dockerignore` excludes `apps/desktop`, `functions`, `supabase` and several root files (e.g. `PRD.md`, `PLAN.md`, `eslint.config.js`). Do not loosen it without revalidating image size and build time.
- `nginx.conf` already does SPA fallback (`try_files $uri $uri/ /index.html`) and ships security + cache headers.

## Tests

- Vitest 4 (root `vitest.config.ts`); includes `{apps,packages,functions}/**/*.test.{ts,tsx}`. **`passWithNoTests: false`** — adding a new empty workspace will break `npm test`.
- Single file: `npx vitest run <path>`.
- Test files live next to the code (`apps/desktop/src/services/*.test.ts`).

## Lint & format

- ESLint 9 flat config + `typescript-eslint` recommended. Enforces `@typescript-eslint/consistent-type-imports: error`. Ignores `dist/`, `build/`, `release/`, `coverage/`, `**/*.cjs`.
- Prettier: `semi: true`, `singleQuote: false`, `trailingComma: "none"`, `printWidth: 100`. Ignores `package-lock.json` and build artifacts.
- `tsconfig.base.json` sets `forceConsistentCasingInFileNames` — respect path casing in imports.

## Secrets & security

- `.env`, `*.pem`, `*.key`, `service-account*.json`, `*.sqlite*`, `logs/`, `ui-debug.log` are gitignored. **Never** commit credentials, real customer data, or production dumps.
- `KYBERROCK_ADMIN_PASSWORD_HASH = sha256(SALT + plain_password)`. Configure `SALT` and `HASH` in Edge Function secrets only.
- `SUPABASE_SERVICE_ROLE_KEY` is Edge-Function-only. Desktop and web use `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY`.
- OMIE creds (`OMIE_APP_KEY` / `OMIE_APP_SECRET`) live in Edge Function env. **Always** call OMIE from an Edge Function — never from frontend or desktop.
- For local dev, copy `.env.example` to `.env` and fill placeholder values; real secrets stay out of Git.

## OMIE idempotency

Every OMIE call uses a key of the form `kyberrock:{unitId}:{operationId}:{action}` (e.g. `kyberrock:unit_abc:op_123:create_sales_order`). Re-sends must not duplicate orders.

## Desktop versioning

Every installer build **must** bump the version and be tagged:

1. Bump `apps/desktop/package.json` (SemVer: patch / minor / major).
2. `npm run dist:win -w @kyberrock/desktop` → `apps/desktop/release/KyberRock Desktop Setup X.Y.Z.exe`.
3. Commit `package.json` (+ `package-lock.json` if it changed).
4. `git tag -a desktop-vX.Y.Z -m "Desktop release X.Y.Z"`.
5. Push the tag only when the user asks.
6. Optional: attach the `.exe` to the GitHub Release for the tag.

- **Never overwrite an existing tag** — bump the patch for a hotfix.
- **Rollback**: `git checkout desktop-vX.Y.Z && npm run dist:win -w @kyberrock/desktop` regenerates the old installer.
- Find the current released tag with `git tag -l 'desktop-v*' --sort=-v:refname | head -1`.

## Subagents

All subagents (`explore`, `qa-build`, `qa-lint`, `qa-test`) **must** use the model `minimax-m3`. Other models require explicit user approval.

After any code change, run `qa-build` (`npm run build`), `qa-lint` (`npm run lint`) and `qa-test` (`npm test`) **in parallel**. Treat the task as done only when all three report OK.
