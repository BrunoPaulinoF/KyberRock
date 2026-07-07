# Fase 3.1 - Instalador E Atualizacoes

Status: pipeline automatico implementado.

## Entregue

- `electron-builder` configurado para gerar instalador Windows NSIS;
- script `npm run dist:win --workspace @kyberrock/desktop`;
- `electron-updater` com **download automatico** e **instalacao ao fechar o app**
  (`AUTO_DOWNLOAD_UPDATES` / `AUTO_INSTALL_ON_QUIT` em `src/services/update-flow.ts`);
- botoes de verificar / instalar agora continuam disponiveis como override manual;
- provider **GitHub Releases** (repo privado) configurado no `build.publish` do
  `apps/desktop/package.json`;
- **pipeline CI** `.github/workflows/desktop-release.yml` que gera e publica o instalador
  automaticamente a cada push na `main`.

## Como O Update Funciona Hoje

1. Merge/push na `main` (tocando `apps/desktop/**`, `packages/**` ou o manifest raiz).
2. O workflow define a versao como `MAJOR.MINOR.<run_number>` (sempre crescente, sem bump manual).
3. Injeta o token de leitura (`GH_UPDATER_TOKEN`) no app e roda `npm run dist:win:publish` num
   runner Windows.
4. O `electron-builder --publish always` cria um GitHub Release `vX.Y.Z` (publicado, nao draft)
   com `latest.yml` + `.exe` + `.blockmap`, usando o `GITHUB_TOKEN` automatico do Actions. Uma
   copia tambem fica como artefato do run.
5. O desktop instalado verifica a cada 30 min, autentica com o token de leitura embutido e detecta
   a versao nova.
6. Baixa em segundo plano automaticamente.
7. Instala na proxima vez que o operador fechar o app (sem interromper a operacao).

## Secret Necessario (GitHub Actions)

Configurar em *Settings -> Secrets and variables -> Actions*:

- `GH_UPDATER_TOKEN` - PAT **fine-grained**, com escopo **apenas neste repositorio** e permissao
  **`Contents: read`**. E o token embutido no app instalado para baixar os releases do repo privado.

Sem esse secret, o release ainda e publicado, mas os apps instalados nao conseguem autenticar para
baixar a atualizacao.

## Decisao De Seguranca

Como o repo e privado, o app precisa de um token para ler os releases. Optou-se por **embutir um
token somente-leitura** (escopo unico repo, `Contents: read`) no build via CI, em vez de rodar um
servidor HTTPS proprio. O token nunca e commitado (fica no secret `GH_UPDATER_TOKEN` e e injetado
em `src/main/updater-config.ts` no build). Como ele viaja dentro do `.asar`, deve ser tratado como
baixa-confianca: manter read-only + unico repo e rotacionar atualizando o secret e re-rodando o
workflow. A publicacao (escrita) usa o `GITHUB_TOKEN` do Actions, que nunca sai do CI.

## Pendente Para Release Real

- Criar o secret `GH_UPDATER_TOKEN`;
- decidir assinatura de codigo Windows antes do piloto externo.
