# KyberRock Docs

Documentação técnica e operacional do projeto KyberRock.

## Onde procurar cada coisa

| Quero saber                                                | Leia                                 |
| ---------------------------------------------------------- | ------------------------------------ |
| Como rodar, buildar, testar e publicar                     | `../AGENTS.md`                       |
| Arquitetura que atravessa vários workspaces                | `../CLAUDE.md`                       |
| Visão técnica consolidada do sistema                       | `ARCHITECTURE.md`                    |
| Tabelas, colunas e regras de conflito                      | `phase-1/data-model.md`              |
| Contratos entre processos (IPC, sync, OMIE)                | `phase-1/contracts.md`               |
| Filas, idempotência, cancelamento e fluxos OMIE            | `phase-1/sync-strategy.md`           |
| Segredos, autenticação, backup, logs e hardening           | `phase-1/security-and-operations.md` |
| Quem é dono do preço e do cadastro comercial numa pedreira | `preco-balanca-principal.md`         |
| Cobrança da plataforma (Kybernan → pedreira)               | `financeiro.md`                      |
| Importar clientes por planilha                             | `importacao-clientes.md`             |
| Intenção de produto e plano de fases                       | `../PRD.md`, `../PLAN.md`            |

`AGENTS.md` é o guia operacional autoritativo (comandos, quirks por workspace, versionamento,
deploy). Estes documentos cobrem a intenção técnica e o desenho; quando os dois divergirem sobre
_como executar algo_, `AGENTS.md` vence.

## Estrutura

Documentos vivos, atualizados junto com o código:

- `ARCHITECTURE.md`: visão técnica consolidada do sistema em produção.
- `phase-1/`: modelo de dados, contratos, sincronização e segurança. Nasceram como desenho da
  Fase 1 e continuam sendo a referência mantida desses assuntos.
- `preco-balanca-principal.md`: balanças principais, dono do cadastro de preço e do bloco
  comercial/crédito do cliente.
- `financeiro.md`: backoffice financeiro da plataforma (mensalidade, boleto, WhatsApp, bloqueio).
- `importacao-clientes.md`: importação de clientes por planilha.
- `backlog-reuniao-2026-07-06.md`: backlog levantado com o cliente.

Registro histórico, mantido como memória das decisões — não reflete necessariamente o estado atual:

- `phase-0/`: preparação, spikes e validações técnicas iniciais.
- `phase-2/`, `phase-3/`, `phase-3.1/`, `phase-4/`, `phase-5/`, `phase-7.1/`: entregas por fase.

O sistema passou de longe do plano original de fases: sincronização cloud, integração OMIE
completa, relatórios, crédito/carteira, backoffice financeiro, painel administrativo, frota de
versões e central de ajuda entraram depois e não têm pasta `phase-*` própria. A descrição atual
desses módulos está em `ARCHITECTURE.md`.

## Regra De Segredos

Credenciais reais do OMIE, Supabase, e-mail, WhatsApp, Mercado Pago, impressoras, servidores ou
qualquer outro serviço externo não devem ser commitadas. Use arquivos locais ignorados pelo Git,
variáveis de ambiente, secrets do Supabase ou cofre de credenciais do sistema operacional.
Detalhes em `phase-1/security-and-operations.md`.
