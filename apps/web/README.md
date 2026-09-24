# KyberRock Web

Site do comercial e da gestão da pedreira (workspace `@kyberrock/web`). Lê o Supabase do
KyberRock direto (com o login do usuário e RLS) e grava **só** pela Edge Function `web-api`.
O contrato completo está em `docs/web-api.md`; o plano em `docs/plano-migracao-web.md`.

## Regras desta pasta

1. **Nenhum `insert`/`update` direto do navegador.** Toda escrita é `callWebApi(...)`
   (`src/lib/api.ts`). As tabelas recusam escrita do cliente de propósito. Única exceção: a tela
   do carregador carimba `loading_requests.loader_completed_at` direto, pela política que o
   carregador já usava (só solicitação aberta da própria unidade) — carimbo operacional, não
   cadastro.
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

Perfis (`src/lib/permissions.ts`, espelho de `_shared/web-session.ts`): `monitoramento` só
consulta; `operacao` edita veículos, motoristas e transportadoras e faz pesagem; `comercial`
também clientes; `gestor` tudo. O `loader` (carregador) só tem `/carregamento`. A pesagem pelo
site é um PEDIDO que a balança executora da unidade registra (`docs/web-api.md` 4.9).

As telas seguem a disposicao do KyberRock Desktop (mesmo menu, mesmos nomes, abas por icone,
botoes quadrados de acao): quem opera a balanca nao deve estranhar o site. As pecas comuns
estao em `src/components/desk.tsx`.

| Rota                       | Quem                             | O que faz                                                                                |
| -------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------- |
| `/carregamento`            | carregador                       | Fila de carregamento da unidade: concluir e devolver carga                               |
| `/painel`                  | todos                            | Painel: resumo do dia, balanca executora, pendencias do OMIE, ultimas pesagens           |
| `/nova-entrada`            | operacao e gestor                | Nova entrada (peso digitado, frete, condicao digitada) — vira pedido a balanca           |
| `/operacoes`               | todos (acoes: operacao e gestor) | Operacoes: abertas, canceladas (`?aba=canceladas`), concluidas (`?aba=concluidas`)       |
| `/carteira`                | gestor                           | Carteira: fechamento e reabertura                                                        |
| `/cadastros/<aba>`         | todos (edicao conforme o perfil) | Clientes, Produtos (precos), Pagamento, Transporte (motoristas, transportadoras, placas) |
| `/insights`                | todos                            | Insights: KPIs, graficos e tabela dinamica                                               |
| `/controle-caminhoes`      | todos                            | Tempo de patio por caminhao                                                              |
| `/relatorio-cliente`       | todos                            | Relatorio por cliente (simplificado/completo), CSV e impressao                           |
| `/conferencia-faturamento` | todos                            | Conferencia de faturamento pesagem a pesagem                                             |
| `/fechamento`              | gestor                           | Fechamento de faturas (pedido de faturamento; a balanca executa)                         |
| `/relatorios`              | todos (destinatarios: gestor)    | Fechamento diario, periodo, tabela dinamica, mensal e destinatarios                      |
| `/documentacao`            | todos                            | Central de ajuda (copia da do desktop, guardada por teste)                               |
| `/configuracoes/<aba>`     | todos (engrenagem do rodape)     | Balanca, Impressao e Cloud: estado das balancas da unidade, cupons do site, fila OMIE    |

Os enderecos antigos (`/operacao`, `/clientes`, `/veiculos`, `/transportadoras`, `/precos`,
`/vendas`) redirecionam para os novos.

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

Prévia sem servidor com rewrite (uma pasta dentro de outro site, uma hospedagem estática
qualquer): compile com `VITE_ROUTER=hash` e as rotas viram `/#/clientes`, que funciona em
qualquer lugar. Os caminhos dos arquivos já são relativos (`base: "./"`), então o build também
funciona fora da raiz do domínio.

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
