# Fase 2 - Fundacao Do Monorepo

Status: concluida.

## Decisoes Tecnicas

### SQLite Local

Decisao: usar `better-sqlite3` quando o desktop entrar na Fase 3.

Motivos:

- melhor controle do banco local offline-first;
- menor complexidade de empacotamento no Electron do que Prisma engines;
- backup, restore e migrations SQL ficam mais explicitos;
- escala do produto vem de multiunidade + Supabase, nao de um ORM pesado no desktop;
- bom desempenho para workload local da balanca.

### Site Do Carregador

Decisao: usar Vite + React + TypeScript.

Motivos:

- o site e inicialmente uma SPA somente leitura;
- nao ha necessidade atual de SSR;
- build estatico e simples para Docker no EasyPanel;
- menor runtime e menor superficie operacional que Next.js neste momento.

## Estrutura Criada

```text
apps/
  desktop/
  loader-web/
packages/
  shared/
  scale-adapters/
  omie-client/
  print-templates/
functions/
```

## Comandos

- `npm install`
- `npm run build`
- `npm run lint`
- `npm test`
- `npm run format:check`

## Docker Do Loader Web

Build local a partir da raiz do repositorio:

```bash
docker build -f apps/loader-web/Dockerfile -t kyberrock-loader-web .
```

Execucao local:

```bash
docker run --rm -p 8080:80 kyberrock-loader-web
```

## Observacoes

- Electron sera adicionado na Fase 3, quando o desktop real com SQLite comecar.
- Supabase Edge Functions sera configurado em fase propria.
- Credenciais OMIE/Supabase continuam fora do Git.
