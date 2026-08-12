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
- **Auto-update** (`electron-updater`): `autoDownload: true`, `autoInstallOnAppQuit: true` (see `AUTO_DOWNLOAD_UPDATES` / `AUTO_INSTALL_ON_QUIT` in `src/services/update-flow.ts`). Provider is **GitHub Releases** on this (private) repo. Because the repo is private, the app carries a read-only token to fetch the release; the token is **not** in Git — it lives in the `GH_UPDATER_TOKEN` secret and is injected into `src/main/updater-config.ts` at build time by CI, then set as `process.env.GH_TOKEN` at runtime (`configureAutoUpdater`). Checks every 30 min **only when `app.isPackaged`**, downloads new versions in the background, and installs them the next time the operator quits the app — no mid-operation interruption. The manual "check / install now" buttons still work as an override. The installer itself is generated and published automatically by CI (see "Desktop versioning").
- **SQLite path**: `%ProgramData%\\KyberRock\\data\\kyberrock.sqlite3` (see `src/database/paths.ts`).
- **Manutencao diaria**: `runAutomaticBackup` (`services/runtime.ts`) chama `runDatabaseMaintenance`
  logo **apos** o backup — nessa ordem de proposito, para que tudo o que e podado ja esteja
  dentro do backup recem-criado. Ela poda os jobs `done` do `sync_queue` com mais de 90 dias
  (`pruneCompletedSyncJobs`), mantem os 30 backups mais recentes **por pedreira**
  (`pruneOldBackups` — a contagem e por unidade porque um desktop pode trocar de pedreira e o
  `unitId` esta no nome do arquivo) e roda `PRAGMA optimize`. As tres etapas sao best-effort:
  manutencao nunca pode derrubar o backup nem uma operacao em andamento.
- **Fila de sync**: o retry usa backoff exponencial com jitter (`computeSyncRetryDelayMs`),
  de 60 s ate um teto de 15 min. Antes era fixo em 60 s, o que gastava as 10 tentativas em
  10 minutos e mandava para `dead_letter` (que exige clique do operador) um job que so
  precisava esperar o OMIE voltar. Um `retryAfterMs` explicito ainda tem prioridade sobre a
  formula. `markSyncJobBlocked` continua fora dessa logica: falha determinística nao gasta
  tentativa.
- **Quem executa a fila OMIE**: o pedido/OS sai no proprio fechamento
  (`triggerBackgroundOmieOrderPush` → `runOmieQueue(operationId)`), mas a trava
  (`omieQueueProcessing`) e unica e disputada com `syncCloudNow` e `syncOmieNow`. Quem
  esbarra nela **nao e mais descartado**: marca `omieQueueRerunRequested` e o `finally` da
  passada em andamento roda uma passada COMPLETA logo em seguida (mesmo padrao do
  `cloudSyncRerunRequested`). Antes, um fechamento que caisse em cima de uma varredura
  ficava esperando o proximo ciclo cloud — ate 30 min com "sera enviado na proxima
  sincronizacao" na tela. Alem disso, `startOmieQueueDrainScheduler` (tick de 30 s,
  `omie-queue-scheduler.ts`, ligado no `main.ts`) executa o que o `next_attempt_at` ja
  autorizou: sem ele o backoff de 60 s / 2 min / 4 min nao tinha executor nenhum entre as
  varreduras de 30 minutos. O tick **nao acelera tentativa** — `hasRunnableOmieJobs` (uma
  consulta local) corta antes de qualquer chamada de rede quando nao ha job vencido.
- **Falha de envio precisa aparecer na operacao**: a tela de Concluidas
  (`getFiscalBillingStatus`) le **so as colunas da operacao**, nunca o `sync_queue`. Uma
  recusa que a classificacao nao reconhece (rede, 5xx, campo que o edge nao prefixou) cai
  no `markSyncJobFailed`, que guarda o motivo **no job** — por isso `processOmieSyncQueue`
  copia a mensagem para `omie_billing_message` tambem na venda com nota (a interna ja
  fazia isso com `service_order_failed`). O `omie_billing_status = 'failed'` — vermelho,
  aviso sonoro (`omie-delivery-notifications`) e botao de reenvio — entra **so no
  dead_letter**: e o unico momento em que o envio parou de andar sozinho. Enquanto ha
  tentativa sobrando a operacao fica neutra, so exibindo o motivo. Um envio que der certo
  depois limpa o marcador da recusa anterior.
- **Trava de cadastro na ABERTURA** (`omie-customer-readiness.ts`): a entrada e recusada
  enquanto faltar campo que o OMIE exige. A regra vive num modulo puro e e aplicada em DOIS
  lugares que nunca podem divergir — `startWeighing` (trava de verdade, antes de capturar
  peso) e o aviso da tela de entrada (`customerOmieReadiness`, que desabilita "Capturar
  peso" e leva ao cadastro). Ela e deliberadamente **estreita**, porque parar a balanca a
  toa custa mais caro que o fechamento perdido que ela evita:
  - **So cliente SEM codigo OMIE.** Com codigo, o cadastro que o pedido usa e o do OMIE
    (`buildOmieBillingJob` manda `customerOmieId` e o edge nem olha o bloco local), e o
    espelho local pode estar vazio por motivo nenhum: o push do cadastro para a nuvem
    **nao leva endereco** (ver `CADASTRO_PUSH_ENTITIES`) e `upsertCloudCustomers` nem
    escreve essas colunas — ou seja, o cliente completo na balanca A chega na balanca B
    sem endereco. Conferir ali pararia caminhao por um dado que nao e usado.
  - **So campo obrigatorio**: telefone e complemento ficam de fora. Venda com nota pede
    CNPJ/CPF, o bloco do destinatario da NF-e (CEP, endereco, numero, bairro, cidade, UF)
    e e-mail — este ultimo dispensado quando ha e-mail padrao de NF-e, que o fechamento ja
    aplica sozinho (`autoCompleteCustomerForNfe`). A operacao interna vira ordem de
    servico, nao emite NF-e: dela so se cobra o documento.
  - **Nunca no FECHAMENTO**: la o caminhao ja esta carregado sobre a balanca e a operacao
    tem que fechar local (offline-first). A abertura e a ultima hora barata de dizer "nao".
- **Listagens de operacao e o teto de escala**: `listOpenWeighingOperations` /
  `listClosedWeighingOperations` / `listCanceledWeighingOperations` ainda **nao tem LIMIT** e
  o tick de 15 s do multi-desktop (`App.tsx`) rebusca as tres. Os indices da migracao 48
  ajudam so as consultas seletivas — medido com 20 mil operacoes: abertas 3,3x mais rapido,
  canceladas 1,4x, **concluidas 0,98x** (devolve 86% da tabela, entao varrer ja e o plano
  otimo). O remedio para as concluidas e paginar: a mesma consulta com `LIMIT 300` cai de
  251 ms para 0,3 ms. Ao paginar, a busca precisa descer junto para o backend — hoje
  `filterClosedOperationsBySearch` filtra no renderer sobre o array inteiro, entao um LIMIT
  cru tornaria o historico antigo inalcancavel pela busca.
- **Startup log**: `%LOCALAPPDATA%\\KyberRock Desktop\\startup.log`. Check here first when the window fails to open.
- **Icon**: `apps/desktop/midia/icon.ico` (source PNG: `apps/desktop/midia/kyberrocklogo.png`); consumed by `electron-builder` for the executable and the NSIS installer.
- **Logo do cupom**: o upload (`renderer/receipt-logo-file.ts`) **converte a imagem para PNG** antes de salvar — `nativeImage.createFromDataURL` só decodifica PNG/JPEG, enquanto o Chromium (prévia e HTML do cupom) abre também WebP/GIF/BMP/SVG; sem a conversão a logo aparecia na tela e sumia no papel. Na impressão, `prepareReceiptLogo` (em `src/main/main.ts`) gera **um único raster de 1 bit** a 203 dpi que alimenta os dois caminhos: bit image ESC/POS (impressora de rede) e `<img>` PNG monocromático no HTML (impressora do Windows). A conversão cor → ponto vive só em `buildThermalDotMap` (`services/receipt-logo-raster.ts`), usada também pela prévia da tela: ela **estica o contraste da tinta** (sem isso, logo em cor de marca mais clara que o cinza médio — laranja, amarelo, azul claro — virava papel em branco e o cupom saía sem logo) e aplica **pontilhado Floyd‑Steinberg** nos meios-tons. Buffers do `toBitmap()` do Electron são **BGRA premultiplicado**: passe `premultiplied: true`, senão o alfa é aplicado duas vezes e a borda suavizada escurece. Logo que sairia em branco é detectada (`isRasterBlank`), avisada na tela e o HTML volta a usar a imagem original em vez de imprimir um retângulo vazio; na impressora de rede ela simplesmente **não é enviada** (a térmica é de 1 bit e não tem para onde cair — imprimir o raster gastaria uma faixa de papel em branco). O `<img>` do HTML ainda carrega a original em `data-fallback-src`: os dois caminhos usam decodificadores diferentes (`nativeImage` no main, Chromium na prévia), então quando o raster não carrega o `waitForReceiptImages` **troca a fonte** em vez de remover a imagem — remover era o que fazia o cupom sair sem logo nenhuma com a logo perfeita na tela.
- **Código da operação no cupom**: a linha do topo é `COD 000123` (`receiptOperationCodeLine`, em `packages/print-templates`) e não se confunde com `COPIA NRO`, que conta IMPRESSÕES. São **três** renderizadores desenhando o mesmo cabeçalho — texto ESC/POS, HTML da impressora do Windows e prévia da tela (`renderer/ReceiptPreviewCard.tsx`) —, e foi a cópia solta entre eles que deixou a prévia sem a linha quando o código passou a existir. Mexeu no cabeçalho: mexa nos três.

## Importação de clientes por planilha

CLI em `apps/desktop/src/scripts/import-customers.ts` (compilado para
`dist/scripts/import-customers.js`), com dois comandos: `conciliar` (junta a planilha comercial
com a de CNPJ/CPF pelo nome) e `importar` (grava no SQLite local). Guia completo em
`docs/importacao-clientes.md`.

```bash
npm run build -w @kyberrock/desktop
npm run clientes -w @kyberrock/desktop -- conciliar --precos A.xlsx --documentos B.xlsx
npm run clientes -w @kyberrock/desktop -- importar --arquivo clientes-conciliados.csv --dry-run
```

- Lê `.xlsx` sem dependência nova (`spreadsheet-read.ts` = ZIP via `node:zlib` + XML) e CSV/TSV.
- **Nunca chama o OMIE**: grava com `needs_push = 1` (e `source: omie → hybrid`) e deixa o
  `omie-sync` empurrar, mantendo a idempotência existente.
- `--dry-run` roda tudo dentro de uma transação e força rollback no fim — o relatório é o mesmo
  da execução real. Sem `--dry-run`, o banco é copiado para a pasta de backups antes de gravar.
- `better-sqlite3` precisa estar compilado para **Node**, não para Electron (após `dist:win` já
  está: o script termina com `npm rebuild better-sqlite3`).

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

## CI

`.github/workflows/ci.yml` runs on **every pull request** and on **every push to `main`**. Two jobs,
one per runtime:

- **`node`** — `npm ci`, then `npm run format:check` → `npm run lint` → `npm run build` → `npm test`,
  in that order.
  - **Build before test is mandatory**: `@kyberrock/*` packages publish `main: dist/index.js`, so on
    a clean checkout (no `dist/`) vitest cannot resolve them and ~20 test files fail on import.
  - Keep them **sequential**. Running `npm run build` and `npm test` at once in the same working
    tree makes the build rewrite files vitest is importing, producing phantom failures like
    `X is not a constructor`. To parallelize, use separate jobs/checkouts.
  - `npm ci` runs **with** install scripts (unlike `desktop-release.yml`): `omie-master-sync.test.ts`
    opens a real `better-sqlite3` database and needs the native binary for the Node runtime.
    `ELECTRON_SKIP_BINARY_DOWNLOAD=1` is set — nothing here launches Electron.
- **`deno`** — the Deno suite of the `omie-sync` Edge Function, scoped to
  `supabase/functions/omie-sync` and run **with** type-check. `npm test` does not cover it (vitest
  collects `*.test.ts`; the Deno files use `*_test.ts`). See `supabase/functions/omie-sync/TESTING.md`.

The whole repo was formatted with `npm run format` in one pass, so `format:check` is enforced in CI
from there on. If it fails, run `npm run format` — do not hand-fix.

One Prettier/ESLint interaction to know about, in `apps/desktop/src/services/scale-configs.ts`:
Prettier breaks long method chains across lines, which can push an `eslint-disable-next-line` off
the line it was meant to cover (there, `no-control-regex`). Put the directive immediately above the
offending link of the chain, not above the `return`.

## Secrets & security

- `.env`, `*.pem`, `*.key`, `service-account*.json`, `*.sqlite*`, `logs/`, `ui-debug.log` are gitignored. **Never** commit credentials, real customer data, or production dumps.
- `KYBERROCK_ADMIN_PASSWORD_HASH = sha256(SALT + plain_password)`. Configure `SALT` and `HASH` in Edge Function secrets only.
- `SUPABASE_SERVICE_ROLE_KEY` is Edge-Function-only. Desktop and web use `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY`.
- OMIE creds (`OMIE_APP_KEY` / `OMIE_APP_SECRET`) live in Edge Function env. **Always** call OMIE from an Edge Function — never from frontend or desktop.
- A credencial da IA do assistente da documentação **não é secret de deploy**: ela é cadastrada no painel administrativo do loader-web (aba **Assistente de IA**) e gravada na tabela singleton `public.ai_assistant_settings` — uma chave e um modelo **globais**, usados por todas as pedreiras. O `admin-api` (`get_ai_settings` / `update_ai_settings`) é o único caminho de escrita; a RLS nega acesso direto de `anon`/`authenticated`, e o `get` devolve só os quatro últimos caracteres da chave — ela nunca volta para a tela nem chega ao desktop. `OPENAI_API_KEY` / `OPENAI_MODEL` continuam existindo como **fallback** de Edge Function para instalações antigas, mas a tabela tem precedência. Sem chave (ou com o assistente desmarcado) a função responde **503** e o desktop cai silenciosamente na resposta local — a ausência da chave desliga a IA, não quebra a tela. A função omite `temperature` e usa `max_completion_tokens` justamente para aceitar qualquer modelo configurado ali; a lista do seletor é só de interface (o backend aceita qualquer texto), então modelo novo da OpenAI não exige deploy.
- For local dev, copy `.env.example` to `.env` and fill placeholder values; real secrets stay out of Git.

## Backoffice financeiro

Cobrança da plataforma (Kybernan → pedreira). Guia completo em `docs/financeiro.md`.

- **Não é** o financeiro das operações da balança (esse é OMIE + relatório de vendas). A tela é a
  aba **Financeiro** do painel administrativo, separada dos cadastros.
- Regras puras e testadas pelo vitest: `_shared/billing-cycle.ts` (virada/fechamento/vencimento/
  rateio/inadimplência), `_shared/billing-invoice.ts` (textos e campos obrigatórios do boleto) e
  `_shared/mercado-pago.ts` (`fetch` injetável). O `vitest.config.ts` já inclui
  `supabase/functions/_shared/*_test.ts`; os três novos entram nesse `include` existente.
- `_shared/billing-engine.ts` orquestra e é compartilhado por `admin-billing` (painel) e
  `billing-run` (pg_cron, `202608120002_billing_run_cron.sql`, 2×/dia). `billing-webhook` recebe a
  notificação do Mercado Pago e **reconsulta a API** antes de dar baixa — o corpo da requisição
  nunca é a fonte da verdade.
- **Segredos ficam nos secrets do Supabase, não no banco** (`_shared/billing-secrets.ts`,
  migração `202608120003`). `billing_settings` guarda só o NOME da variável
  (`MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET`, `UAZAPI_INSTANCE_TOKEN` por
  padrão) e a Edge Function lê o valor com `Deno.env.get()`. O painel vê nome, situação e os
  quatro últimos caracteres — nunca o valor. Não reintroduza coluna de valor: as antigas foram
  removidas de propósito.
- Idempotência do boleto: `kyberrock:{companyId}:{invoiceId}:create_boleto` (+ `:{n}` na
  reemissão), mesma convenção do OMIE.
- **A migração `202608120001_financial_backoffice.sql` precisa ser aplicada à mão** antes de abrir
  a aba — migrações não são automatizadas (ver "SQL migrations" abaixo).

## OMIE idempotency

Every OMIE call uses a key of the form `kyberrock:{unitId}:{operationId}:{action}` (e.g. `kyberrock:unit_abc:op_123:create_sales_order`). Re-sends must not duplicate orders.

## Desktop versioning

**Automated (default).** `.github/workflows/desktop-release.yml` builds and publishes the
Windows installer to **GitHub Releases** on every push to `main` that touches `apps/desktop/**`,
`packages/**` or the root manifest (also runnable via **workflow_dispatch**). The pipeline:

1. Derives the release version as `MAJOR.MINOR.<github.run_number>` from `apps/desktop/package.json`
   (monotonically increasing, so `electron-updater` always sees a newer version — **no manual
   bump needed**). The bump is done only in the build checkout; it is not committed back.
2. Injects the read-only updater token (`GH_UPDATER_TOKEN` secret) into `src/main/updater-config.ts`.
3. Runs `npm run dist:win:publish -w @kyberrock/desktop` on a Windows runner, which builds the
   NSIS installer and `electron-builder --publish always` creates a **published** (non-draft)
   Release `vX.Y.Z` with `latest.yml` + `*.exe` + `*.blockmap`. Publishing uses the automatic
   `GITHUB_TOKEN` (write scope stays in CI). A copy is also uploaded as a run artifact.

Required repo secret (Settings → Secrets and variables → Actions):
`GH_UPDATER_TOKEN` — a **fine-grained PAT scoped to this repo only, `Contents: read`**. This is the
token embedded in the installed app so it can download releases from the private repo. Without it,
builds still publish, but installed apps cannot authenticate to download the update.

- **Security note**: the read token ships inside the app (`.asar`), so treat it as low-trust —
  keep it read-only + single-repo, and rotate it by updating the secret and re-running the workflow.
- To cut a new **minor/major** line, bump `apps/desktop/package.json` (`MAJOR.MINOR`) in a PR;
  the patch keeps coming from `run_number`.
- **Fixed public download link**: `supabase/functions/desktop-download` (public, `verify_jwt=false`,
  needs `GH_RELEASES_TOKEN`) redirects to the latest release's `.exe`; loader-web nginx exposes it as
  `GET /download`. Always serves the newest installer for fresh installs.
- Code signing for external pilots is still pending (see `docs/phase-3.1/README.md`).

**Manual build (local / offline fallback):**

1. Bump `apps/desktop/package.json` if needed, then `npm run dist:win -w @kyberrock/desktop`
   → `apps/desktop/release/KyberRock Desktop Setup X.Y.Z.exe`.
2. Optionally tag `git tag -a desktop-vX.Y.Z -m "Desktop release X.Y.Z"` for a manual rollback point.
3. **Never overwrite an existing tag** — bump the patch for a hotfix.
4. **Rollback**: each release stays on GitHub Releases. To roll operators back, delete/mark as
   pre-release the bad `vX.Y.Z` release (electron-updater then serves the previous published one),
   or re-run the workflow from an older commit to publish a higher version built from good code.
   `dist:win:publish` (used by CI) is the publishing variant of `dist:win`.

## Edge Functions deploy

**Automated (default).** `.github/workflows/edge-functions-deploy.yml` deploys the Deno Edge
Functions on every push to `main` that touches `supabase/functions/**` or `supabase/config.toml`
(also runnable via **workflow_dispatch**, optionally with a space-separated list of functions).
It deploys only what the push changed; a change under `supabase/functions/_shared/**` redeploys
every function, since any of them may import from there. Nothing is pruned: a function deleted
from the repo stays live in the project until removed by hand.

Required repo secret: `SUPABASE_ACCESS_TOKEN` — a personal access token from
<https://supabase.com/dashboard/account/tokens>. Without it the job fails with an actionable error
instead of silently skipping the deploy.

**`verify_jwt` lives in `supabase/config.toml`, not in the dashboard.** Most functions authenticate
themselves in the request body (`deviceId` + `deviceToken`, admin session) and run with
`verify_jwt = false`; `cnpj-lookup` is the exception. Two consequences:

- **A function with no `[functions.<slug>]` block deploys with `verify_jwt = true`** (CLI default)
  and starts answering 401 to the desktop. Always add the block when creating a function.
- **Never pass `--no-verify-jwt` on a multi-function deploy**: the flag overrides the file for the
  whole batch and would silently open up `cnpj-lookup`.

**Manual deploy (local / fallback):**

```bash
npx supabase@latest login
npx supabase@latest functions deploy omie-sync --project-ref vksihzfrgqoemcqpquit --use-api
```

`--use-api` bundles server-side, so Docker is not needed. The project ref is not a secret (it is
already in `.env.example`). Omit `--no-verify-jwt`: `config.toml` now carries that setting.

## SQL migrations

**Not automated.** Unlike the Edge Functions and the desktop installer, nothing deploys
`supabase/migrations/**` on a push to `main`. A migration merged to `main` does **not** exist in
production until someone applies it — with the `supabase_kyberrock_*` MCP tools (`apply_migration`)
or the CLI. `list_migrations` shows what the project actually has.

**Apply the migration before the desktop release that needs it.** The desktop ships by auto-update
(30 min check, install on quit) while the cloud schema does not, so a new column always reaches the
scale first. When the cloud is behind, the desktop keeps sending the field and PostgREST rejects the
**whole batch** with `PGRST204` — not just that column.

`desktop-sync` degrades instead of freezing: an unknown column is dropped from the payload and the
write is retried without it (`supabase/functions/_shared/unknown-column.ts`), so the rest of the
projection still lands and the field arrives on the next push after the migration. The dropped
columns come back in the response as `droppedColumns` and are logged as
`desktop-sync: colunas ausentes na nuvem foram ignoradas` — **that log line means a migration is
pending in production**. Do not treat it as noise: without this fallback, a missing column on
`weighing_operations` also blocks `loading_requests` (FK `operation_id`) and the loader's screen
goes empty, with every truck already in the quarry invisible to him.

## Subagents

All subagents (`explore`, `qa-build`, `qa-lint`, `qa-test`) **must** use the model `minimax-m3`. Other models require explicit user approval.

After any code change, run `qa-build` (`npm run build`), `qa-lint` (`npm run lint`) and `qa-test` (`npm test`) **in parallel**. Treat the task as done only when all three report OK.

**Caveat**: `qa-build` and `qa-test` must not run at the same time _in the same working tree_ — the build rewrites files vitest is importing and you get phantom failures (`X is not a constructor` in `apps/desktop/src/services/*.test.ts`). Either give them separate worktrees, or run `npm run build` then `npm test` in sequence, as `.github/workflows/ci.yml` does. `qa-lint` is safe to run alongside either.
