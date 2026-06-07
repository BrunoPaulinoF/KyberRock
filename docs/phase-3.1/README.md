# Fase 3.1 - Instalador E Atualizacoes

Status: base implementada.

## Entregue

- `electron-builder` configurado para gerar instalador Windows NSIS;
- script `npm run dist:win --workspace @kyberrock/desktop`;
- `electron-updater` configurado sem download automatico;
- botao no desktop para verificar atualizacao;
- botao para baixar e instalar somente quando houver update disponivel;
- provider generico HTTPS configurado como `https://updates.kyberrock.com/desktop/win`.

## Como O Update Deve Funcionar

1. Fazemos push para o GitHub.
2. Um pipeline de release gera o instalador e os arquivos `latest.yml`/artefatos do `electron-builder`.
3. O pipeline publica esses arquivos em uma URL HTTPS acessivel pelo desktop.
4. O desktop verifica se existe versao nova.
5. Se houver, aparece o botao para instalar.
6. Ao clicar, o app baixa o update e chama a instalacao.

## Decisao De Seguranca

O app nao deve carregar token do GitHub privado. Para repo privado, publicar updates diretamente do GitHub Releases exigiria token no runtime ou outro proxy autenticado. A abordagem mais segura para o app instalado e publicar os artefatos em endpoint HTTPS controlado, por exemplo VPS/EasyPanel.

## Pendente Para Release Real

- Definir URL final de updates;
- configurar pipeline GitHub Actions com secrets de deploy da VPS;
- decidir assinatura de codigo Windows antes do piloto externo.
