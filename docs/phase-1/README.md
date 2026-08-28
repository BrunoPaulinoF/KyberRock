# Fase 1 - Design Tecnico E Modelo De Dados

Status: concluida. Os quatro documentos desta pasta deixaram de ser draft e viraram a
documentacao viva dos assuntos que cobrem — sao mantidos junto com o codigo.

## Objetivo

Definir contratos, entidades, status, sincronizacao, multiunidade e regras de conflito antes da criacao do monorepo, migrations e apps.

## Arquivos

- `../ARCHITECTURE.md`: visao tecnica consolidada.
- `data-model.md`: modelo SQLite e Supabase Postgres.
- `contracts.md`: contratos TypeScript planejados.
- `sync-strategy.md`: filas, idempotencia, conflitos, cancelamentos e OMIE/Supabase.
- `security-and-operations.md`: segredos, seguranca, backup, logs e operacao.

## Status Dos Entregaveis

Todos entregues e hoje implementados no codigo:

| Entregavel                                    | Status                                            |
| --------------------------------------------- | ------------------------------------------------- |
| Documento tecnico em `docs/ARCHITECTURE.md`   | Mantido como visao consolidada do sistema         |
| Modelo de dados SQLite                        | Implementado (migrations ate a versao 57)         |
| Modelo de dados Supabase Postgres             | Implementado (`supabase/migrations/`)             |
| Contratos TypeScript compartilhados           | Implementados em `packages/*` e no preload        |
| Identificadores globais e locais              | Implementado                                      |
| Empresa, unidade e dispositivo desde o inicio | Implementado, com varias balancas por pedreira    |
| Status de operacao                            | Implementado (`packages/shared/src/operation.ts`) |
| Fila local de sincronizacao                   | Implementada                                      |
| Idempotencia Supabase e OMIE                  | Implementada                                      |
| Estrategia de conflito                        | Implementada, incluindo dono do preco por balanca |
| Cancelamento antes/depois do OMIE             | Implementado                                      |
| Backup e restauracao local                    | Implementados                                     |
| Logs locais e cloud                           | Implementados                                     |
| Estrategia de seguranca                       | Implementada                                      |
| Frete no modelo                               | Implementado (quatro modalidades + legado)        |

## Decisoes Para A Fase 2

- SQLite desktop: `better-sqlite3`.
- Site do carregador: Vite + React + TypeScript, com deploy inicial via Docker no EasyPanel.

## Pendencias Que Sobreviveram

- A formula de frete por distancia continua parametrizavel por cliente/produto, sem formula unica
  fechada comercialmente.
