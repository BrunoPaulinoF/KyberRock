# Fase 1 - Design Tecnico E Modelo De Dados

Status: draft inicial criado.

## Objetivo

Definir contratos, entidades, status, sincronizacao, multiunidade e regras de conflito antes da criacao do monorepo, migrations e apps.

## Arquivos

- `../ARCHITECTURE.md`: visao tecnica consolidada.
- `data-model.md`: modelo SQLite e Firestore.
- `contracts.md`: contratos TypeScript planejados.
- `sync-strategy.md`: filas, idempotencia, conflitos, cancelamentos e OMIE/Firebase.
- `security-and-operations.md`: segredos, seguranca, backup, logs e operacao.

## Status Dos Entregaveis

| Entregavel                                    | Status       |
| --------------------------------------------- | ------------ |
| Documento tecnico em `docs/ARCHITECTURE.md`   | Criado       |
| Modelo de dados SQLite                        | Draft criado |
| Modelo de dados Firestore                     | Draft criado |
| Contratos TypeScript compartilhados           | Draft criado |
| Identificadores globais e locais              | Definido     |
| Empresa, unidade e dispositivo desde o inicio | Definido     |
| Status de operacao                            | Definido     |
| Fila local de sincronizacao                   | Definida     |
| Idempotencia Firebase e OMIE                  | Definida     |
| Estrategia de conflito                        | Definida     |
| Cancelamento antes/depois do OMIE             | Definido     |
| Backup e restauracao local                    | Definido     |
| Logs locais e cloud                           | Definido     |
| Estrategia de seguranca                       | Draft criado |
| Frete no modelo                               | Draft criado |

## Decisoes Para A Fase 2

- SQLite desktop: `better-sqlite3`.
- Site do carregador: Vite + React + TypeScript, com deploy inicial via Docker no EasyPanel.

## Pendencias Antes Da Fase 3

- Revisar estes documentos com o usuario.
- Confirmar se o modelo inicial atende a expansao multiunidade.
- Confirmar formula exata de frete.
- Definir migrations SQLite iniciais.
