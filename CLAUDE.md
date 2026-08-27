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
- **`supabase/functions/*`** — Deno Edge Functions, the _only_ place sensitive integrations run:
  admin surface (`admin-api`, `admin-auth`), OMIE bridge (`omie-sync`), desktop sync/lifecycle
  (`desktop-sync`, `desktop-pull`, `desktop-status`, `desktop-activate`, `desktop-download`),
  scheduled reporting (`daily-report-scheduler`, `daily-report-email`) and the documentation
  assistant (`docs-assistant`). `_shared/` holds code common to them. Never call OMIE, the
  OpenAI API or the service-role key from desktop or web. Note: this is distinct from the
  `functions/` workspace (`@kyberrock/functions`), which is a plain TypeScript utils library.
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
- **Balancas principais de precos** (`docs/preco-balanca-principal.md`, AGENTS.md "Balanca principal
  de precos"): o cadastro de preco da pedreira (preço padrão, preço especial por cliente, tabelas de
  preço + vínculo e valor de frete do cadastro) tem **dono** — as balanças marcadas no painel
  (`device_registrations.is_price_master`), que podem ser **mais de uma** por empresa. A projeção
  desses dados já existia, mas **empatava**: duas balanças cadastrando o mesmo par (cliente, produto)
  geram ids diferentes e o pull de cada lado descartava a linha da outra por causa do índice único
  local, então cada computador ficava com o preço que ele mesmo digitou. Com principal definida a
  linha que perde cede, a secundária não publica preço (`PRICE_MASTERED_CADASTRO_KEYS`) e a edição é
  recusada no **runtime**, não só na tela. Quem perde depende da política (`priceConflictPolicy`):
  `cloud` na secundária, `newest` entre principais, `local` sem principal. O `newest` é o que torna
  possível ter duas principais — "quem publica por último" faria as duas se derrubarem
  alternadamente e o preço oscilaria em toda a pedreira; comparando o `updated_at` da própria linha
  (empate no maior id), as duas pontas decidem igual seja qual for a ordem do sync. A mesma regra
  vive nos dois runtimes (`cloudRowWins` no desktop, `winsConflict` na nuvem). O empate se repetia na
  nuvem — mesmo índice único, e o `desktop-sync` grava por `id` —, então quando quem publica é uma
  principal a linha concorrente cede antes do upsert e a linha perdedora **sai do payload**
  (`_shared/price-master-conflicts.ts`); tentá-la seria um 23505 derrubando o lote a cada ciclo. O
  pull **não apaga** preço: quem tira o par disputado é aquele tombstone, que chega junto com o preço
  novo. Sem principal, nada muda. A memória de frete da última venda (`source: "last_used"`) é da
  máquina e sobrevive ao espelhamento.
  A **mesma eleição** também dá dono ao bloco comercial/crédito do cliente
  (`MASTERED_CUSTOMER_COLUMNS`: forma de pagamento e transportadora padrão, exige NF, uso de crédito
  OMIE e toda a configuração da conta de crédito). Esse caso é diferente: não havia empate, essas
  colunas simplesmente **nunca saíam do SQLite** — o mesmo cliente tinha crédito habilitado numa
  balança e não na outra. Como o dono é de **parte** da linha (nome, documento e endereço não têm
  dono), a secundária continua publicando o cliente, só que **sem** essas colunas
  (`masteredColumns`); coluna ausente do payload preserva o que a nuvem tem. O desempate é a mesma
  `priceConflictPolicy`, e o `newest` importa tanto quanto no preço: "a principal nunca adota o que
  vem da nuvem" funcionaria com uma só e, com duas, devolveria o problema de origem. E como coluna
  não pode "não existir", `customers.commercial_published_at` é o que separa "a principal limpou o
  padrão" de "ninguém publicou ainda" — sem essa marca o nulo da migração pendente apagaria a
  configuração boa da secundária. O bloco carrega dois ids que precisam de tradutor (a forma de
  pagamento do sistema nasce com id sorteado em cada máquina), e é por isso que o pull grava
  `carriers` e `payment_methods` **antes** de `customers`. Fora do bloco: condição de pagamento
  padrão e observações internas, que viajam pelo OMIE (as observações passaram a ser **enviadas** no
  `push_customer` — antes eram só lidas, e o que o operador digitava se perdia).
- **Backoffice financeiro** (`docs/financeiro.md`): é a cobrança **da plataforma** — a Kybernan
  fatura cada pedreira (`public.companies`) pela mensalidade acertada caso a caso. Nada a ver com
  o financeiro das operações da balança, que vive no OMIE; por isso a aba **Financeiro** do painel
  é separada dos cadastros. Três datas por pedreira: **virada** (início do uso, base do rateio da
  primeira fatura), **fechamento** (gera a fatura) e **vencimento**. Toda a matemática está em
  `supabase/functions/_shared/billing-cycle.ts` — puro e testado; nem a tela nem as funções
  recalculam data ou valor por conta própria. O motor (`_shared/billing-engine.ts`) é o **mesmo**
  para o botão do painel (`admin-billing`) e para a passada do pg_cron (`billing-run`): fechar,
  emitir boleto no Mercado Pago, enviar por WhatsApp (instância UAZAPI **global**, não a da
  pedreira) e bloquear por inadimplência via `companies.payment_blocked`, a coluna que o
  `desktop-status` já consulta. As credenciais (Mercado Pago e WhatsApp) **não ficam no banco nem na tela**: o nome de
  cada variável é fixo em `_shared/billing-secrets.ts` e o valor vem do secret do Supabase — a aba
  de configuração apenas exibe a situação de cada uma. A passada é idempotente — índice único por ciclo, boleto só quando
  não há `boleto_payment_id`, WhatsApp só quando `whatsapp_sent_at` está vazio — e recupera ciclos
  pulados em vez de perder o mês. A liberação do bloqueio é conservadora: só desfaz bloqueio que o
  próprio motor aplicou (`billing_invoices.blocked_at`).
- **Central de ajuda** (`apps/desktop/src/renderer/documentation-*`): o texto vive em
  `documentation-content.ts` (dados puros), a busca em `documentation-search.ts` e a tela em
  `DocumentationView.tsx` — corrigir uma dúvida operacional não deve tocar o componente. O
  assistente flutuante **recupera os trechos no renderer** e manda só eles para a Edge Function
  `docs-assistant`: a documentação usada é sempre a da versão instalada, e nenhum dado de
  operação, cliente ou peso sai do computador da balança. Quem responde é a IA — a nuvem é
  chamada mesmo quando a busca não achou trecho nenhum, e aí ela raciocina pelo briefing do
  sistema/OMIE que vive em `docs-assistant/prompt.ts`. A resposta se declara em três origens
  (`documentacao` | `conhecimento` | `desconhecido`): só a primeira cita fonte, as outras duas
  oferecem o suporte. Sem nuvem ele cai na documentação local, e o que ela não cobre vira "fale
  com o suporte", nunca um palpite. A chave e o modelo da OpenAI são **globais** e vêm do painel
  do loader-web (tabela `ai_assistant_settings`), não de secret por instalação.

## Product & design docs

`PRD.md`, `PLAN.md`, `docs/ARCHITECTURE.md`, and `docs/phase-*/` (data model, contracts,
sync-strategy, security-and-operations) are the source of product/architecture intent — much of
it in Portuguese. Consult them before changing the data model, sync behavior, or integrations.
