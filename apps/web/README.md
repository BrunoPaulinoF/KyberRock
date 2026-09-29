# KyberRock Web

Site do carregador, do comercial e da gestão da pedreira (workspace `@kyberrock/web`), em
`https://kyberrock.kybernan.com.br`. Lê o Supabase do KyberRock direto (com o login do usuário e
RLS) e grava **só** pela Edge Function `web-api`. O contrato completo está em `docs/web-api.md`;
o plano em `docs/plano-migracao-web.md`.

Também é o site público que o KyberRock Portal (`apps/loader-web`, EasyPanel) era — e que por isso
pode sair do ar: a apresentação do produto em `/` (com o login no topo), o painel da plataforma da
Kybernan em `/admin` (`src/admin/`), a página do link temporário do WhatsApp em
`/whatsapp/:token`, o instalador do desktop em `/download` e o guia em PDF. O que fazer antes de
desligar o EasyPanel está no `AGENTS.md` ("Saida do loader-web").

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
troque o perfil do login no painel `/admin` (usuário e senha da plataforma, não um login de
pedreira).

## Telas

Perfis (`src/lib/permissions.ts`; o que cada um grava espelha `_shared/web-session.ts`). Cada
perfil ve um conjunto FECHADO de telas (`SCREENS_BY_ROLE`) — o resto nem aparece no menu, e o
endereco digitado a mao volta para a tela inicial dele:

| Perfil          | Telas                                                                                                                                                                   | Configuracoes |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `monitoramento` | So `/monitoramento` (vendas em tempo real, tela cheia)                                                                                                                  | Nao           |
| `comercial`     | Comercial (tela do portal), insights, conferencia de faturamento, relatorios, controle de caminhoes, relatorio por cliente e cadastros (cadastra tudo, preco sem senha) | Nao           |
| `gestor`        | Todas, menos a Nova entrada                                                                                                                                             | Sim           |
| `operacao`      | Todas; mudar preco sempre pede a senha da pedreira                                                                                                                      | Sim           |
| `administrador` | Todas + `/suporte` (Logs), sem pedir senha                                                                                                                              | Sim           |
| `loader`        | So `/carregamento` (celular e tablet, instalavel como app)                                                                                                              | —             |

Monitoramento so consulta. Quem nao tem configuracoes ve so o botao Sair no rodape.
A pesagem pelo site e um PEDIDO que a balanca executora da unidade registra
(`docs/web-api.md` 4.9). O app instalavel e `public/manifest.webmanifest` + `public/sw.js`.

As telas seguem a disposicao do KyberRock Desktop (mesmo menu, mesmos nomes, abas por icone,
botoes quadrados de acao): quem opera a balanca nao deve estranhar o site. As pecas comuns
estao em `src/components/desk.tsx`.

**No celular** (ate 800 px, bloco "celular" de `src/styles.css`) o menu lateral vira uma barra
fina no topo com o botao de menu e o nome da tela, e o mesmo menu desliza da esquerda
(`Layout.tsx`). Campos com 16 px (abaixo disso o iPhone da zoom ao tocar), botoes com altura de
dedo, abas numa linha que rola, janelas abrindo de baixo com Salvar/Cancelar sempre a vista e
tabela larga rolando dentro do proprio cartao — nunca a pagina inteira para o lado. Cada tela e
um arquivo separado (`lazy` no `App.tsx`), baixado so quando aberta: o primeiro carregamento caiu
de ~320 kB para ~150 kB compactados. Por isso o CSS de uma tela (`pages/*.css`) so chega com ela —
classe usada em mais de uma tela mora no `styles.css`.

| Rota                       | Quem                                    | O que faz                                                                                            |
| -------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `/`                        | quem nao esta logado                    | Apresentacao do KyberRock com o login no topo (logado vai para a tela do perfil)                     |
| `/admin`                   | equipe Kybernan (login da plataforma)   | Painel da plataforma: pedreiras, unidades, logins, balancas, atualizacoes, financeiro, IA            |
| `/whatsapp/:token`         | qualquer um com o link (15 min)         | Parear o WhatsApp da pedreira pelo QR, sem login                                                     |
| `/carregamento`            | carregador                              | Fila de carregamento da unidade: concluir e devolver carga                                           |
| `/monitoramento`           | monitoramento, gestor, operacao, admin. | Vendas em tempo real (tela cheia, estilo KDS): numeros, graficos, ultimas vendas, patio              |
| `/painel`                  | gestor, operacao, administrador         | Painel: resumo do dia, balanca executora, pendencias do OMIE, ultimas pesagens                       |
| `/nova-entrada`            | operacao e administrador                | Nova entrada (peso digitado, frete, condicao digitada) — vira pedido a balanca                       |
| `/operacoes`               | gestor, operacao, administrador         | Operacoes: abertas, canceladas (`?aba=canceladas`), concluidas (`?aba=concluidas`)                   |
| `/carteira`                | gestor, operacao, administrador         | Carteira: fechamento e reabertura                                                                    |
| `/cadastros/<aba>`         | + comercial                             | Clientes, Produtos (precos), Pagamento, Transporte (motoristas, transportadoras, placas)             |
| `/comercial`               | comercial, gestor, operacao, admin.     | Relatorio de vendas do KyberRock Portal: visoes, filtros, imprimir e CSV (tela inicial do comercial) |
| `/insights`                | + comercial                             | Insights: KPIs, graficos e tabela dinamica                                                           |
| `/controle-caminhoes`      | + comercial                             | Tempo de patio por caminhao                                                                          |
| `/relatorio-cliente`       | + comercial                             | Relatorio por cliente (simplificado/completo), PDF e Excel iguais aos do desktop                     |
| `/conferencia-faturamento` | + comercial                             | Conferencia de faturamento pesagem a pesagem                                                         |
| `/fechamento`              | gestor, operacao, administrador         | Fechamento de faturas (pedido de faturamento; a balanca executa)                                     |
| `/relatorios`              | + comercial (destinatarios: nao)        | Fechamento diario, periodo, tabela dinamica, mensal e destinatarios                                  |
| `/documentacao`            | gestor, operacao, administrador         | Central de ajuda (copia da do desktop, guardada por teste)                                           |
| `/suporte`                 | administrador                           | Logs: saude das balancas, pedidos que falharam, envios OMIE, relatorios, navegador                   |
| `/configuracoes/<aba>`     | gestor, operacao, administrador         | Balanca, Impressao e Cloud: estado das balancas da unidade, cupons do site, fila OMIE                |

**Relatorios iguais aos do desktop.** Insights, Controle de caminhoes, Relatorio por cliente,
Conferencia de faturamento e Fechamento de faturas geram o MESMO documento que o KyberRock Desktop:
os montadores de HTML sao copias dos do desktop em `src/lib/desktop/` (so os imports mudam), e
`src/lib/desktop-copies.test.ts` falha se uma copia ficar para tras — corrigiu la, copie aqui. O
"PDF" abre a impressao do navegador com esse documento (ja com o nome de arquivo do desktop no
"Salvar como PDF"); o "Excel" baixa o mesmo `.xls` (`src/lib/report-output.ts`). Comparando o PDF
do desktop (Electron `printToPDF`) com a impressao do site do mesmo HTML, as paginas, a orientacao
e a posicao de cada palavra saem iguais.

Os enderecos antigos (`/operacao`, `/clientes`, `/veiculos`, `/transportadoras`, `/precos`,
`/vendas` e o `/loader` do loader-web) redirecionam para os novos. `/download` (no `.htaccess`)
leva ao instalador mais novo do KyberRock Desktop.

## Deploy na Hostinger

O site é estático (build do Vite em `apps/web/dist/`). Na Hostinger, ao conectar o
repositório `BrunoPaulinoF/KyberRock` (branch `main`):

1. **Diretório raiz do projeto**: `apps/web`.
2. **Variáveis de build**: `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`; opcional,
   `VITE_WHATSAPP_NUMBER` (WhatsApp comercial da página de apresentação, só dígitos com DDI —
   sem ela os botões usam o número de exemplo).
3. **Comando de build**: `npm install && npm run build` (dentro de `apps/web`; o
   `package.json` da pasta lista tudo o que o build precisa, então funciona sem a raiz).
   **Pasta publicada**: `dist`.
4. O `public/.htaccess` vai junto no build e faz toda rota cair no `index.html` (SPA), além do
   atalho `/download`. Os arquivos saem da raiz (`base: "/"` no `vite.config.ts`): com caminho
   relativo, abrir direto um endereço de dois níveis (`/cadastros/clientes` no F5,
   `/admin/login`, `/whatsapp/<token>`) pedia os scripts dentro da pasta errada e a tela ficava em
   branco.
5. Cada merge na `main` publica. O site não depende de nenhum outro workspace, então mudança
   só na balança ou nas Edge Functions gera um build igual ao anterior.

Prévia sem servidor com rewrite (uma pasta dentro de outro site, uma hospedagem estática
qualquer): compile com `VITE_ROUTER=hash` e as rotas viram `/#/clientes`, que funciona em
qualquer lugar. Nesse modo os caminhos dos arquivos são relativos (`base: "./"`), então o build
também funciona fora da raiz do domínio.

Se a Hostinger do plano não rodar build (hospedagem compartilhada só com FTP), o caminho é um
workflow em `.github/workflows/` da raiz que faça `npm ci && npm run build -w @kyberrock/web`
e envie `apps/web/dist/` por FTP com os secrets do repositório.

## Estrutura

```
src/
  lib/        supabase (cliente), api (web-api), auth (sessão), queries (leituras), format
  components/ ui (tabela, modal, campos, toast), Layout
  pages/      Login, Landing (apresentação), WhatsappConnect, Customers, Cadastros, Prices,
              SalesReport, Wallet, InvoiceClosing
  admin/      painel da plataforma (/admin): login próprio, estilo próprio (admin-ui.css)
```
