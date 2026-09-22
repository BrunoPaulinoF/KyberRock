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
- **CNPJ alfanumerico** (IN RFB 2.229/2024): o CNPJ continua com 14 posicoes e a mesma mascara,
  mas as 12 primeiras aceitam **letras** alem de digitos (os dois verificadores do fim continuam
  numericos, e a conta deles e a mesma — cada caractere vale `ASCII - 48`, o que faz digito valer
  o proprio numero). Por isso documento **nunca** e normalizado por `replace(/\D/g, "")`: jogar a
  letra fora grava OUTRO documento, que sobe ao OMIE, sai na NF-e e no boleto — e, com 11 digitos
  restantes, ainda faria um CNPJ subir como pessoa fisica. A regra vive em
  `packages/shared/src/format.ts` (`normalizeDocument` / `documentKind` / `isValidCnpj`) e,
  espelhada para o Deno, em `supabase/functions/_shared/document.ts`; a comparacao entre cadastros
  usa `documentKey` / `DOCUMENT_KEY_SQL` (`apps/desktop/src/services/customer-identity.ts`), que
  tira a pontuacao e a caixa mas **nao** as letras. Quem decide "CPF ou CNPJ" pergunta a FORMA
  (`documentKind`), nunca `length === 11`.
- **OMIE idempotency**: every OMIE call carries a key `kyberrock:{unitId}:{operationId}:{action}`
  (e.g. `kyberrock:unit_abc:op_123:create_sales_order`). Re-sends must never duplicate orders.
- **Operation status machine**: an operation moves through `draft` → `entry_registered` →
  `loading_requested` → `awaiting_exit` → `closed_local` → `pending_cloud`/`pending_omie` →
  `synced` (or `sync_error` / `cancelled`). Local close happens before any sync; sync failures
  never erase a closed local operation.
- **Data da pesagem nos relatorios** (AGENTS.md "Data da pesagem nos relatorios"): todo
  relatorio de DINHEIRO recorta o periodo pela data em que a pesagem **fechou**
  (`operationSaleDateSql`, em `weighing-operation-status.ts`), nunca pela de abertura —
  porque e essa a data que sobe ao OMIE como emissao do pedido (`issueDate`), e dela nascem
  a NF-e, a conta a receber e o vencimento. Com `created_at`, o caminhao que entra num dia e
  so fecha no outro caia num dia aqui e no outro no OMIE: em 11/09/2026 o extrato de la
  mostrava 50 lancamentos / R$ 60.971,18 contra 45 / R$ 53.556,22 na balanca, e as 5
  diferencas eram exatamente pesagens abertas em 09 e 10/09 e fechadas em 11/09 — nenhuma
  enviada errada. O `COALESCE` com `created_at` fica: operacao antiga nao tem horario de
  saida gravado. O **patio** continua pela ENTRADA (`getTruckControlReport`,
  `getAverageQuarryMinutes`), que ali o assunto e o tempo do caminhao na pedreira.
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
- **Cadastro de uma maquina chega nas outras** (AGENTS.md "Cadastro de uma maquina chega nas
  outras"): o cliente cadastrado no computador do comercial podia **nunca** aparecer no da
  expedicao. Duas causas somadas. (1) O cadastro so saia da maquina na varredura completa — 30 min
  por padrao, desligavel, e fechar o programa antes adiava tudo; a operacao ja tinha envio imediato,
  o cadastro nao. Agora todo salvamento passa por `cadastroChanged`/`triggerCadastroCloudPush`
  (`services/runtime.ts`), que e barato porque `pushSharedCadastroToCloud` anda por cursor, junta a
  rajada de um mesmo salvamento em um envio e nao perde o que for editado durante ele. (2) O pull
  incremental de 15 s recortava por `updated_at`, que e a hora da maquina que EDITOU — e o
  `desktop-sync` grava esse valor como veio. Linha criada 10:00 e publicada 10:28 chega com
  `updated_at = 10:00`, e quem ja puxou as 10:28 **nunca mais** a ve: o cursor so anda para frente.
  O recorte agora e `cloud_synced_at` — a hora da NUVEM ao gravar —, em `_shared/cadastro-window.ts`,
  carimbada por **gatilho** (migracao `202609150001_cadastro_cloud_arrival`) e nao pelo payload,
  porque tambem escrevem nessas tabelas o painel, o `omie-sync` e o tombstone da disputa de preco. A
  varredura completa continua pedindo o cadastro INTEIRO: e ela a rede de seguranca do que um
  incremental deixar passar, e a folga de 5 min do cursor cobre a fresta entre os dois relogios
  (`serverTime` da Edge Function x `now()` do Postgres). (3) Resolvido isso, a outra maquina ainda
  so descobria no tique seguinte do renderer (15 s). Agora a nuvem **avisa**:
  `cadastro_change_pings` (migracao `202609220001`) guarda UMA linha por empresa, carimbada por
  gatilho de STATEMENT nas mesmas 21 tabelas — por linha, um lote do `omie-sync` viraria 500
  avisos —, esta na publicacao `supabase_realtime`, e a balanca assina `company_id=eq.<a dela>`
  (`services/cadastro-realtime.ts`) e puxa na hora: ~1 a 3 s de ponta a ponta. O aviso **nao
  carrega cadastro** ("mudou algo na empresa X as 14:32"), e e isso que o deixa passar pela chave
  publicavel sem furar o `no direct client access` das tabelas de cadastro — quem busca continua
  sendo o `desktop-pull` com o token do dispositivo. O tique de 15 s **continua**, cobrindo queda
  de internet e evento perdido: o aviso adianta o pull, nao e por onde o cadastro anda. Por isso
  falhar e sempre so perder velocidade — o gatilho inteiro vive num `exception when others` (perder
  o aviso custa 15 s; perder a escrita custaria o cadastro) e toda subida da inscricao dispara um
  pull, porque o que passou enquanto ela esteve fora do ar nao volta sozinho.
- **Queda de conexao nao condena o envio** (AGENTS.md "Queda longa nao para a fila"): a fila
  desistia do job depois de 10 tentativas e o mandava para `dead_letter`, fora da rotacao
  automatica — com o backoff ate 15 min isso e ~2h de queda, e dali so um clique do operador
  fazia o pedido chegar ao OMIE. `outage-fault.ts` separa a falha da OUTRA PONTA (rede, 5xx, 429
  — o mesmo payload sobe quando ela voltar) da falha do DADO (que ja tinha `markSyncJobBlocked`),
  e o status HTTP passou a entrar na mensagem porque sem ele os dois casos chegavam iguais.
  Queda nunca vira `dead_letter`, e `rearmJobsDeadLetteredByOutage` resgata o que morreu antes
  desta versao — menos quem espera cadastro e quem foi cancelado.
- **Leitura que falhou nao e bloqueio** (AGENTS.md "Nuvem fora do ar nao bloqueia a frota"): as
  funcoes de acesso da balanca (`desktop-status`, `-pull`, `-sync`, `-activate`) decidiam com
  `if (error || !row)`, entao o banco fora do ar virava resposta **200** dizendo bloqueado — e a
  balanca, que so entra no prazo offline de 7 dias quando NAO fala com a nuvem, gravava o bloqueio
  e parava. `_shared/db-read-error.ts` separa linha ausente (`PGRST116`, negar e correto) e coluna
  ausente (migracao pendente, ja tratada) de **qualquer outra coisa**, que vira 5xx. O desconhecido
  cai no lado seguro de proposito: uma balanca bloqueada operando ate a nuvem voltar custa menos
  que a frota inteira parada por um soluco de infraestrutura.
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
- **Saúde da frota** (AGENTS.md "Coluna Saúde da aba Balanças"): a nuvem sabia se a balança está
  **ligada** (`last_seen_at`) e em que **versão** (`app_version`), mas não se ela está
  _entregando_ — fila parada e envio esperando clique do operador só apareciam na tela daquela
  máquina, e o suporte descobria por telefone. O resumo (`services/device-health.ts` →
  `_shared/device-health.ts` → coluna Saúde do painel) pega carona no `desktop-status`, sem
  requisição nova. Duas regras se repetem em todo o caminho: **parado não é pendente** — o job
  bloqueado por falha determinística fica em `failed` com `next_attempt_at` no ano 9999 e não
  anda mais sozinho, igual ao `dead_letter` — e **nulo não é zero**, porque "esta balança nunca
  reportou" (instalação antiga, migração pendente) não pode ser exibido como "fila limpa".
- **O que a nuvem nao precisa guardar nem receber** (AGENTS.md "O que a nuvem NAO precisa guardar
  nem receber"): o Supabase estourava espaco e engasgava, e a medicao (16/09/2026: 106 MB de banco,
  273 mil requisicoes em 24 h para OITO balancas) mostrou repeticao, nao operacao. A copia
  congelada do cupom (`print_receipts.content_snapshot_json`) levava a logo da pedreira em base64
  em **cada** via impressa — 11 kB dos ~11,5 kB da linha, 6.310 copias de 3 imagens distintas,
  **66 MB dos 106 MB**, contra 2,6 MB de tudo o que o cupom guarda de verdade. A logo viva mora no
  perfil de impressao; o snapshot e **arquivo** e ninguem o le (a reimpressao remonta o cupom pela
  OPERACAO, e `PRINT_RECEIPT_COLUMNS` ja evitava seleciona-lo). Por isso a via nasce sem a imagem
  (`archivableReceiptSnapshot`), o que ficou na fila e peneirado antes de subir
  (`snapshotWithoutLogoImage`) e o `desktop-pull` parou de mandar a coluna de volta — com a guarda
  de que `'{}'` chegando de fora **preserva** a copia de quem imprimiu, porque vazio e ausencia e
  nao correcao. Na mesma linha, o ping do `desktop-status` regravava a linha do dispositivo a cada
  vez so para carimbar `last_seen_at`: 101.875 UPDATEs numa tabela de **oito** linhas. A leitura
  nao mudou de velocidade; a escrita e que passou por `shouldWriteDeviceTouch`
  (`_shared/device-touch.ts`), que grava na hora quando muda um FATO (versao, aviso, fila, erro) e
  no maximo de 5 em 5 min quando so o relogio andou — folga que cabe tres vezes nos 15 min que o
  painel usa para declarar a balanca offline. Espaco de linha encolhida so volta ao disco com
  `VACUUM FULL`, que nao cabe em migracao.
  A peneira da logo vive em DOIS lugares de proposito: a do desktop viaja no INSTALADOR, e
  enquanto a balanca nao atualiza ela segue enviando a imagem (medido: 196 cupons novos, todos
  com logo, nas 24 h seguintes a limpeza). Quem protege o banco e a do `desktop-sync`
  (`_shared/receipt-snapshot.ts`) — o que nao pode entrar se barra na ENTRADA, nao na origem.
  A terceira repeticao era de VIAGEM, nao de dado: o pull incremental (a cada ~1 min, por
  balanca) varria as 21 tabelas do cadastro UMA POR VEZ, e quase toda resposta era vazia --
  ~113 mil das 273 mil requisicoes diarias. `desktop_pull_cadastro_delta` (migracao
  `202609160003`) faz as 21 varreduras dentro do banco, pelo indice que a `202609150001` ja
  criou, e devolve numa viagem so: o pull caiu de ~27 viagens para ~6. A varredura COMPLETA nao
  passa por ela (e o caso em que paginar importa); tabela acima do teto sai em `truncated` e
  volta a ser paginada, porque o cursor do desktop e o relogio do servidor e meia lista o
  avancaria por cima do que ficou de fora; e qualquer falha vira `null` em `parseCadastroDelta`
  (`_shared/cadastro-delta.ts`), que devolve o pull ao caminho antigo -- e otimizacao, nao regra.
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
