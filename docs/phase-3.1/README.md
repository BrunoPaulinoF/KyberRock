# Fase 3.1 - Instalador E Atualizacoes

Status: pipeline automatico implementado.

## Entregue

- `electron-builder` configurado para gerar instalador Windows NSIS;
- script `npm run dist:win --workspace @kyberrock/desktop`;
- `electron-updater` com **download automatico** e **instalacao ao fechar o app**
  (`AUTO_DOWNLOAD_UPDATES` / `AUTO_INSTALL_ON_QUIT` em `src/services/update-flow.ts`);
- botoes de verificar / instalar agora continuam disponiveis como override manual;
- provider generico HTTPS configurado como `https://updates.kyberrock.com/desktop/win`;
- **pipeline CI** `.github/workflows/desktop-release.yml` que gera e publica o instalador
  automaticamente a cada push na `main`.

## Como O Update Funciona Hoje

1. Merge/push na `main` (tocando `apps/desktop/**`, `packages/**` ou o manifest raiz).
2. O workflow define a versao como `MAJOR.MINOR.<run_number>` (sempre crescente, sem bump manual)
   e roda `npm run dist:win` num runner Windows.
3. O workflow publica `latest.yml` + `.exe` + `.blockmap` em
   `updates.kyberrock.com/desktop/win` via rsync/SSH (quando os secrets estao configurados).
   Os artefatos tambem ficam disponiveis para download direto no run do Actions.
4. O desktop instalado verifica a cada 30 min e detecta a versao nova.
5. Baixa em segundo plano automaticamente.
6. Instala na proxima vez que o operador fechar o app (sem interromper a operacao).

## Secrets Do Deploy (GitHub Actions)

Configurar em *Settings -> Secrets and variables -> Actions*:

- `UPDATE_SSH_HOST` - host do servidor de updates;
- `UPDATE_SSH_USER` - usuario SSH;
- `UPDATE_SSH_KEY` - chave privada SSH (conteudo do arquivo);
- `UPDATE_DEPLOY_PATH` - diretorio no servidor mapeado para a URL `/desktop/win`;
- `UPDATE_SSH_PORT` - opcional, padrao `22`.

Enquanto esses secrets nao existem, o build ainda roda e o instalador fica baixavel no run;
so o passo de publicar no servidor e pulado (com aviso).

## Decisao De Seguranca

O app nao carrega token do GitHub privado. Para repo privado, publicar updates diretamente do
GitHub Releases exigiria token no runtime ou proxy autenticado; por isso os artefatos vao para o
endpoint HTTPS controlado (`updates.kyberrock.com`, VPS/EasyPanel).

## Pendente Para Release Real

- Provisionar o servidor de updates e preencher os secrets de deploy acima;
- decidir assinatura de codigo Windows antes do piloto externo.
