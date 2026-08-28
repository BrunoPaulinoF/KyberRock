# Fase 3.1 - Instalador E Atualizacoes

Status: implementada. O fluxo de distribuicao evoluiu depois desta fase — ver a nota abaixo.

## Entregue

- `electron-builder` configurado para gerar instalador Windows NSIS;
- script `npm run dist:win --workspace @kyberrock/desktop`;
- `electron-updater` com **download automatico** e **instalacao ao fechar o app**
  (`AUTO_DOWNLOAD_UPDATES` / `AUTO_INSTALL_ON_QUIT` em `src/services/update-flow.ts`);
- botoes de verificar / instalar agora continuam disponiveis como override manual;
- provider **GitHub Releases** (repo privado) configurado no `build.publish` do
  `apps/desktop/package.json`;
- **pipeline CI** `.github/workflows/desktop-release.yml` que gera o instalador a cada push na
  `main` (hoje como **rascunho**; a publicacao passou a ser um passo separado —
  `desktop-promote.yml`).

## Como O Update Funciona Hoje

> Atualizado: **compilar deixou de ser distribuir**. O fluxo descrito na entrega original — todo
> push na `main` virando atualizacao automatica em todas as pedreiras — foi substituido por
> release em rascunho + promocao explicita em dois aneis. O passo a passo completo (workflows,
> armadilhas do `latest.yml`, regras da tela) esta em `AGENTS.md`, secao "Desktop versioning".

1. Push na `main` tocando `apps/desktop/**`, `packages/**` ou o manifesto da raiz dispara o
   `desktop-release.yml`.
2. A versao e derivada como `MAJOR.MINOR.<run_number>` (sempre crescente, sem bump manual) e o
   token de leitura (`GH_UPDATER_TOKEN`) e injetado no build.
3. A Release `vX.Y.Z` nasce **como rascunho** — estado que updater nenhum enxerga. O build
   compila com `--publish never` e os assets (`.exe`, `.blockmap`, `latest.yml`) sobem depois,
   ja conferido que o `better_sqlite3.node` entrou no pacote.
4. Distribuir e um ato explicito, pela aba **Atualizacoes** do painel (ou pelo
   `desktop-promote.yml`), em dois aneis:

   | Anel       | Estado da release           | Quem recebe                                       |
   | ---------- | --------------------------- | ------------------------------------------------- |
   | _(nenhum)_ | rascunho                    | ninguem — o build so existe                       |
   | teste      | publicada como _prerelease_ | so as balancas marcadas como teste (canal `beta`) |
   | producao   | publicada como estavel      | todas as balancas (canal `latest`, o padrao)      |

5. O desktop instalado verifica periodicamente, autentica com o token embutido e detecta a versao
   nova do seu anel; o anel de cada balanca fica em `device_registrations.update_channel`.
6. Baixa em segundo plano e instala na proxima vez que o operador fechar o app.

Consequencia boa do modelo: tres merges seguidos geram tres builds parados; ao liberar so o
ultimo, a balanca da um salto unico em vez de instalar tres vezes.

## Secret Necessario (GitHub Actions)

Configurar em _Settings -> Secrets and variables -> Actions_:

- `GH_UPDATER_TOKEN` - PAT **fine-grained**, com escopo **apenas neste repositorio** e permissao
  **`Contents: read`**. E o token embutido no app instalado para baixar os releases do repo privado.

Sem esse secret, o release ainda e publicado, mas os apps instalados nao conseguem autenticar para
baixar a atualizacao.

## Link Fixo De Download (instalacao nova)

Alem do auto-update, existe um link publico fixo que sempre baixa a versao mais recente:

- Edge Function `supabase/functions/desktop-download` (publica, `verify_jwt = false`): consulta o
  release mais recente no GitHub e redireciona para a URL assinada do `.exe`.
- Atalho amigavel no nginx do loader-web: `GET /download` -> 302 para a Edge Function. Ex.:
  `https://kybernan-kyber-rock.qdidmr.easypanel.host/download`.

Passos para ativar:

1. Criar o secret **`GH_RELEASES_TOKEN`** nas _Edge Functions_ do projeto Supabase (mesmo tipo de
   PAT do `GH_UPDATER_TOKEN`: fine-grained, `Contents: read` neste repo).
2. Deploy da funcao como **publica**: `supabase functions deploy desktop-download --no-verify-jwt`
   (ou toggle "Verify JWT" desligado no dashboard).
3. Redeploy do loader-web (Docker/EasyPanel) para o nginx passar a servir `/download`.

Botao no app: o menu **Configuracoes -> Atualizacao** verifica/instala a atualizacao, e um ponto
verde aparece na engrenagem quando ha versao nova pronta.

## Decisao De Seguranca

Como o repo e privado, o app precisa de um token para ler os releases. Optou-se por **embutir um
token somente-leitura** (escopo unico repo, `Contents: read`) no build via CI, em vez de rodar um
servidor HTTPS proprio. O token nunca e commitado (fica no secret `GH_UPDATER_TOKEN` e e injetado
em `src/main/updater-config.ts` no build). Como ele viaja dentro do `.asar`, deve ser tratado como
baixa-confianca: manter read-only + unico repo e rotacionar atualizando o secret e re-rodando o
workflow. A publicacao (escrita) usa o `GITHUB_TOKEN` do Actions, que nunca sai do CI.

## Pendente Para Release Real

- Decidir assinatura de codigo Windows antes de distribuicao externa mais ampla.
