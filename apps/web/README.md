# KyberRock Web

Site do carregador, do comercial e da gestão da pedreira (workspace `@kyberrock/web`). Carregador
e comercial também entram pelo KyberRock Portal (`apps/loader-web`) por enquanto — o site tem as
mesmas telas deles, e o portal sai depois dos testes. Lê o Supabase do
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
`comercial.teste@kyberrock.app` (senhas com a Kybernan). Para ver as telas de outro perfil,
troque o perfil do login no painel `/admin`.

## Telas

Perfis (`src/lib/permissions.ts`; o que cada um grava espelha `_shared/web-session.ts`). Cada
perfil ve um conjunto FECHADO de telas (`SCREENS_BY_ROLE`) — o resto nem aparece no menu, e o
endereco digitado a mao volta para a tela inicial dele:

| Perfil          | Telas                                                                                                                                       | Configuracoes |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `monitoramento` | So `/monitoramento` (vendas em tempo real, tela cheia)                                                                                      | Nao           |
| `comercial`     | Insights, conferencia de faturamento, relatorios, controle de caminhoes, relatorio por cliente e cadastros (cadastra tudo, preco sem senha) | Nao           |
| `gestor`        | Todas, menos a Nova entrada                                                                                                                 | Sim           |
| `operacao`      | Todas; mudar preco sempre pede a senha da pedreira                                                                                          | Sim           |
| `administrador` | Todas + `/suporte` (Logs), sem pedir senha                                                                                                  | Sim           |
| `loader`        | So `/carregamento` (celular e tablet, instalavel como app)                                                                                  | —             |

Monitoramento so consulta. Quem nao tem configuracoes ve so o botao Sair no rodape.
A pesagem pelo site e um PEDIDO que a balanca executora da unidade registra
(`docs/web-api.md` 4.9). O app instalavel e `public/manifest.webmanifest` + `public/sw.js`.

As telas seguem a disposicao do KyberRock Desktop (mesmo menu, mesmos nomes, abas por icone,
botoes quadrados de acao): quem opera a balanca nao deve estranhar o site. As pecas comuns
estao em `src/components/desk.tsx`.

| Rota                       | Quem                                    | O que faz                                                                                |
| -------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/carregamento`            | carregador                              | Fila de carregamento da unidade: concluir e devolver carga                               |
| `/monitoramento`           | monitoramento, gestor, operacao, admin. | Vendas em tempo real (tela cheia, estilo KDS): numeros, graficos, ultimas vendas, patio  |
| `/painel`                  | gestor, operacao, administrador         | Painel: resumo do dia, balanca executora, pendencias do OMIE, ultimas pesagens           |
| `/nova-entrada`            | operacao e administrador                | Nova entrada (peso digitado, frete, condicao digitada) — vira pedido a balanca           |
| `/operacoes`               | gestor, operacao, administrador         | Operacoes: abertas, canceladas (`?aba=canceladas`), concluidas (`?aba=concluidas`)       |
| `/carteira`                | gestor, operacao, administrador         | Carteira: fechamento e reabertura                                                        |
| `/cadastros/<aba>`         | + comercial                             | Clientes, Produtos (precos), Pagamento, Transporte (motoristas, transportadoras, placas) |
| `/insights`                | + comercial                             | Insights: KPIs, graficos e tabela dinamica                                               |
| `/controle-caminhoes`      | + comercial                             | Tempo de patio por caminhao                                                              |
| `/relatorio-cliente`       | + comercial                             | Relatorio por cliente (simplificado/completo), CSV e impressao                           |
| `/conferencia-faturamento` | + comercial                             | Conferencia de faturamento pesagem a pesagem                                             |
| `/fechamento`              | gestor, operacao, administrador         | Fechamento de faturas (pedido de faturamento; a balanca executa)                         |
| `/relatorios`              | + comercial (destinatarios: nao)        | Fechamento diario, periodo, tabela dinamica, mensal e destinatarios                      |
| `/documentacao`            | gestor, operacao, administrador         | Central de ajuda (copia da do desktop, guardada por teste)                               |
| `/suporte`                 | administrador                           | Logs: saude das balancas, pedidos que falharam, envios OMIE, relatorios, navegador       |
| `/configuracoes/<aba>`     | gestor, operacao, administrador         | Balanca, Impressao e Cloud: estado das balancas da unidade, cupons do site, fila OMIE    |

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
