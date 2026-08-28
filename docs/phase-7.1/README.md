# Fase 7.1 - Portal de Administracao

Status: implementada.

## Entregue

- Portal de administracao em `/admin` no site loader-web.
- Login do administrador (hoje por usuario e senha em secret do Supabase, na Edge Function
  `admin-auth`; na entrega original era login com Google restrito a um e-mail).
- Dashboard admin com lista de empresas/pedreiras.
- CRUD completo de empresas (criar, editar, ativar/desativar).
- CRUD completo de unidades por empresa.
- CRUD completo de usuarios carregadores por unidade.
- Controle de acesso: admin ve todas as pedreiras, usuarios carregadores veem apenas sua unidade.
- Regras de seguranca Supabase Postgres com separacao rigida entre admin e carregador.
- Escalavel para multiplas pedreiras.

## Limites Da Fase

- Existe um unico conjunto de credenciais de administrador, configurado por secret.
- A criacao de usuarios carregadores e feita apenas pelo admin. Nao existe auto-cadastro.

## Depois Desta Fase

O painel cresceu bem alem do que esta descrito aqui: gestao da frota de balancas (numero, cor,
nome, unidade, canal de atualizacao, balanca principal de precos), aba de **Atualizacoes**, aba
**Financeiro** (`docs/financeiro.md`), cofre de senhas e configuracao do assistente de IA. A
descricao atual esta em `docs/ARCHITECTURE.md` e em `AGENTS.md`.

## Validacao

```bash
npm run build
npm run lint
npm test
```
