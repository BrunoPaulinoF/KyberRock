# KyberRock Web

Site do comercial e da gestão da pedreira. Lê o Supabase do KyberRock direto (com o login do
usuário e RLS) e grava **só** pela Edge Function `web-api`. O contrato completo está no
repositório principal, em `docs/web-api.md`; o plano em `docs/plano-migracao-web.md`.

## Regras do repositório

1. **Nenhuma migration aqui.** Tabela, coluna e política nascem no repositório principal
   (`supabase/migrations`).
2. **Nenhum `insert`/`update` direto do navegador.** Toda escrita é `callWebApi(...)`
   (`src/lib/api.ts`). As tabelas recusam escrita do cliente de propósito.
3. **Regra de negócio nova nasce em `_shared/` do repositório principal.** Aqui é tela.
4. Tipos do banco: `src/lib/database.types.ts` é gerado (`npm run types`); não editar à mão.

## Rodar

```bash
npm install
cp .env.example .env   # preencher VITE_SUPABASE_PUBLISHABLE_KEY (chave publicável, nunca a de serviço)
npm run dev            # http://localhost:5175
npm test               # vitest
npm run lint
npm run build          # dist/
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

O site é estático (build do Vite em `dist/`). Na Hostinger:

1. **Variáveis de build**: `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
2. **Comando de build**: `npm ci && npm run build`. **Pasta publicada**: `dist`.
3. O `public/.htaccess` vai junto no build e faz toda rota cair no `index.html` (SPA).
4. Deploy automático: conectar o repositório GitHub e a branch `main` no painel da Hostinger
   (Git / Web App). Cada merge na `main` publica.

Se a Hostinger do plano não rodar build (hospedagem compartilhada só com FTP), o workflow
`.github/workflows/deploy.yml` faz o build no GitHub Actions e envia o `dist/` por FTP —
basta preencher os secrets `FTP_HOST`, `FTP_USER`, `FTP_PASSWORD` (e `FTP_DIR`, ex.
`/public_html/`) no repositório.

## Estrutura

```
src/
  lib/        supabase (cliente), api (web-api), auth (sessão), queries (leituras), format
  components/ ui (tabela, modal, campos, toast), Layout
  pages/      Login, Customers, Cadastros (veículos/motoristas/transportadoras), Prices,
              SalesReport, Wallet, InvoiceClosing
```
