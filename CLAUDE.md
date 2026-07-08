# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read AGENTS.md first

`AGENTS.md` is the authoritative operational guide: full command list, per-workspace
scripts, Electron/`better-sqlite3` quirks, loader-web/Docker notes, versioning/release
steps, and secrets handling. This file adds the cross-cutting architecture that spans
multiple workspaces and is not obvious from any single file. Do not duplicate AGENTS.md here.

## Commands (quick reference)

```bash
npm install
npm run build            # build every workspace (tsc + vite where applicable)
npm run lint             # eslint . (flat config)
npm test                 # vitest run — passWithNoTests: false, so an empty workspace breaks it
npx vitest run <path>    # single test file
npm run format           # prettier . --write
```

After a code change, build + lint + test must all pass before treating the task as done — see
AGENTS.md "Subagents" for the required parallel `qa-build`/`qa-lint`/`qa-test` gate.
Tests live next to the code they cover (`*.test.ts` / `*.test.tsx`).

## The big picture

KyberRock is a truck-weighing / loading operation system for an industrial unit. It is an
**offline-first Electron desktop app** backed by a cloud projection in Supabase, integrated
with the **OMIE** ERP. The guiding rule (`docs/ARCHITECTURE.md`): every weighing operation is
born and closed in the **local SQLite database** before any synchronization — the cloud is a
downstream projection, never the source of truth for the live operation.

Data flow:

```
apps/desktop (Electron + SQLite)  --HTTPS when online-->  Supabase (Postgres + Edge Functions)
                                                               |  server-side only
                                                               v
                                                          OMIE ERP API
apps/loader-web (React)  --read-only-->  Supabase Postgres   (loader sees open loading requests)
```

- **`apps/desktop`** — the operator app and the only place hardware lives. The Electron main
  process (`src/main`) owns SQLite (`src/database`), scale reading and printing (`src/services`),
  and the local sync queue. The React renderer never touches Node — everything crosses the
  `contextIsolation`/`sandbox` boundary via `src/preload/preload.ts` and
  `ipcMain.handle("desktop:*", …)`. See AGENTS.md "Desktop quirks" for native-rebuild and
  workspace-copy gotchas.
- **`apps/loader-web`** — read-only React site where the loader (carregador) sees open loading
  requests projected into Supabase Postgres. Served via nginx in Docker.
- **`supabase/functions/*`** — Deno Edge Functions, the *only* place sensitive integrations run:
  admin surface (`admin-api`, `admin-auth`), OMIE bridge (`omie-sync`), desktop sync/lifecycle
  (`desktop-sync`, `desktop-pull`, `desktop-status`, `desktop-activate`, `desktop-download`) and
  scheduled reporting (`daily-report-scheduler`, `daily-report-email`). `_shared/` holds code
  common to them. Never call OMIE or use the service-role key from desktop or web. Note: this is
  distinct from the `functions/` workspace (`@kyberrock/functions`), which is a plain TypeScript
  utils library.
- **`packages/*`** — shared building blocks consumed by the apps: `shared` (domain types, enums,
  ID + format helpers), `scale-adapters` (one adapter contract, e.g. Toledo + a virtual test
  adapter), `omie-client` (typed OMIE client with idempotency), `print-templates` (80 mm coupon
  / A4 report).

## Cross-cutting invariants

These recur across the codebase and are easy to violate accidentally:

- **Identifiers** (`docs/ARCHITECTURE.md`): every operational entity has a global UUID `id`
  (used across SQLite ↔ Supabase ↔ queues) plus an optional SQLite integer `localId` for
  internal performance only — `localId` is **never** an external identifier. OMIE IDs live in
  dedicated fields (`omieCustomerId`, `omieProductId`, `omieSalesOrderId`, …).
- **OMIE idempotency**: every OMIE call carries a key `kyberrock:{unitId}:{operationId}:{action}`
  (e.g. `kyberrock:unit_abc:op_123:create_sales_order`). Re-sends must never duplicate orders.
- **Operation status machine**: an operation moves through `draft` → `entry_registered` →
  `loading_requested` → `awaiting_exit` → `closed_local` → `pending_cloud`/`pending_omie` →
  `synced` (or `sync_error` / `cancelled`). Local close happens before any sync; sync failures
  never erase a closed local operation.
- **Data ownership is split**: KyberRock owns operations, coupons, prices, vehicles/drivers and
  loading requests; OMIE owns customer/product/payment cadastros — OMIE-owned fields are locked
  locally. See the ownership table in `docs/ARCHITECTURE.md`.
- **Monorepo TS**: root `tsconfig.json` is references-only; each workspace is `composite: true`
  and excludes `**/*.test.ts` from its build — use `import type` for test-only symbols and for
  all type imports (`@typescript-eslint/consistent-type-imports` is an error).

## Product & design docs

`PRD.md`, `PLAN.md`, `docs/ARCHITECTURE.md`, and `docs/phase-*/` (data model, contracts,
sync-strategy, security-and-operations) are the source of product/architecture intent — much of
it in Portuguese. Consult them before changing the data model, sync behavior, or integrations.
