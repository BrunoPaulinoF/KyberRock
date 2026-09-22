# KyberRock Web

Site do comercial e da gestão da pedreira (workspace `@kyberrock/web`). Lê o Supabase do
KyberRock direto (com o login do usuário e RLS) e grava **só** pela Edge Function `web-api`.
O contrato completo está em `docs/web-api.md`; o plano em `docs/plano-migracao-web.md`.

## Regras desta pasta

1. **Nenhum `insert`/`update` direto do navegador.** Toda escrita é `callWebApi(...)`
   (`src/lib/api.ts`). As tabelas recusam escrita do cliente de propósito.
2. **Regra de negócio nova nasce em `supabase/functions/_shared/`.** Aqui é tela.
3. Tipos do banco: `src/lib/database.types.ts` é gerado (`npm run types -w @kyberrock/web`);
   não editar à mão. Ele está no `.prettierignore` da raiz.
4. Lint, formatação e testes são os da raiz (`npm run lint`, `npm run format`, `npm test`):
   esta pasta não tem configuração própria.

## Rodar

```bash
npm install                                   # na raiz do monorepo
cp apps/web/.env.example apps/web/.env        # chave publicável, nunca a de serviço
npm run dev -w @kyberrock/web                 # http://localhost:5175
npm run build -w @kyberrock/web               # apps/web/dist/
npx vitest run apps/web                       # só os testes do site
```

Acessos de homologação (Pedreira Teste): `gestor.teste@kyberrock.app` e
`comercial.teste@kyberrock.app` (senhas com a Kybernan).

## Telas

| Rota               | Quem   | O que faz                                                                 |
| ------------------ | ------ | ------------------------------------------------------------------------- |
| `/clientes`        | todos  | Lista, cadastro/edição (sobe ao OMIE), inativar; bloco comercial (gestor) |
| `/veiculos`        | todos  | Veículos e motoristas                                                     |
| `/transportadoras` | todos  | Transportadoras (sobem ao OMIE com CNPJ)                                  |
| `/precos`          | gestor | Preço padrão por produto e especial por cliente                           |
| `/vendas`          | todos  | Relatório de vendas por cliente/produto/dia, CSV                          |
| `/carteira`        | gestor | Fechamento e reabertura da carteira                                       |
| `/fechamento`      | gestor | Conferência do período e pedido de faturamento (a balança executa)        |

## Deploy na Hostinger

O site é estático (build do Vite em `apps/web/dist/`). Na Hostinger, ao conectar o
repositório `BrunoPaulinoF/KyberRock` (branch `main`):

1. **Diretório raiz do projeto**: `apps/web`.
2. **Variáveis de build**: `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
3. **Comando de build**: `npm install && npm run build` (dentro de `apps/web`; o
   `package.json` da pasta lista tudo o que o build precisa, então funciona sem a raiz).
   **Pasta publicada**: `dist`.
4. O `public/.htaccess` vai junto no build e faz toda rota cair no `index.html` (SPA).
5. Cada merge na `main` publica. O site não depende de nenhum outro workspace, então mudança
   só na balança ou nas Edge Functions gera um build igual ao anterior.

Se a Hostinger do plano não rodar build (hospedagem compartilhada só com FTP), o caminho é um
workflow em `.github/workflows/` da raiz que faça `npm ci && npm run build -w @kyberrock/web`
e envie `apps/web/dist/` por FTP com os secrets do repositório.

## Estrutura

```
src/
  lib/        supabase (cliente), api (web-api), auth (sessão), queries (leituras), format
  components/ ui (tabela, modal, campos, toast), Layout
  pages/      Login, Customers, Cadastros (veículos/motoristas/transportadoras), Prices,
              SalesReport, Wallet, InvoiceClosing
```
