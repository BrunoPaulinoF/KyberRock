# Architecture - KyberRock

Versão: 1.0
Status: documento vivo — descreve o sistema como ele existe hoje, não mais o desenho da Fase 1.
Base: `PRD.md`, `PLAN.md`, `docs/phase-0/*`, código em `apps/`, `packages/`, `supabase/`.

## Objetivo

Dar a visão técnica consolidada do KyberRock: quais superfícies existem, quem é dono de cada
dado, como a operação nasce e fecha, e como ela chega à nuvem e ao OMIE. Detalhes de execução
(comandos, quirks, deploy, versionamento) estão em `AGENTS.md`; detalhes de tabela e coluna em
`docs/phase-1/data-model.md`.

## Princípios

- Offline-first no desktop Windows.
- Nenhum peso manual.
- Toda pesagem nasce e fecha no banco local antes de qualquer sincronização.
- Balanças são integradas por adapters configuráveis por unidade/dispositivo.
- Impressoras são selecionadas entre as instaladas no Windows, com perfis configuráveis.
- OMIE é fonte de cadastros/financeiro e destino de pedidos/ordens de serviço.
- Supabase é camada cloud para o site do carregador, o painel administrativo, a sincronização
  entre balanças e a multiunidade — projeção, nunca fonte de verdade da operação viva.
- Segredos nunca entram no Git, docs, logs ou banco local em texto puro.
- Toda operação crítica gera auditoria.
- Toda integração externa usa idempotência.

## Superfícies

| Superfície              | Responsabilidade                                                            | Estado         |
| ----------------------- | --------------------------------------------------------------------------- | -------------- |
| Desktop Windows         | Operação principal, leitura de balança, SQLite, impressão, sync, relatórios | Offline-first  |
| Loader web — `/`        | Carregador vê as solicitações de carregamento em aberto                     | Online         |
| Loader web — `/admin`   | Painel administrativo: pedreiras, unidades, balanças, versões, financeiro   | Online         |
| Supabase Edge Functions | Integrações sensíveis, sync, tarefas agendadas, e-mail, WhatsApp, IA        | Online         |
| Supabase Postgres       | Projeção cloud multiunidade e dados do site/painel                          | Online         |
| OMIE                    | ERP para cadastros, financeiro, pedidos e OS                                | Online externo |
| GitHub Releases         | Distribuição do instalador e do auto-update do desktop                      | Online externo |
| Mercado Pago / UAZAPI   | Boleto e WhatsApp da cobrança da plataforma                                 | Online externo |

## Topologia

```text
Desktop Windows (Electron)
  React renderer (sandbox, sem Node)
     | ipcRenderer -> preload -> ipcMain.handle("desktop:*")
  Electron main process
    SQLite local (better-sqlite3)   <- fonte de verdade da operação
    Scale adapters (Toledo serial/TCP, virtual)
    Impressão Windows (webContents.print / ESC-POS raw)
    Filas locais: sync cloud + fila OMIE
     |
     | HTTPS quando online (token do dispositivo)
     v
Supabase
  Postgres (projeção cloud, RLS)
  Auth (carregador e painel)
  Edge Functions (Deno)
     |
     | HTTPS server-side (app key/secret da empresa)
     v
OMIE API

Loader web (React + nginx/Docker)
  /       carregador, leitura das solicitações em aberto
  /admin  painel administrativo (Edge Functions admin-*)
```

O desktop **nunca** fala com o OMIE, o Mercado Pago ou a OpenAI direto: essas chamadas só
acontecem em Edge Function. O renderer **nunca** toca Node: tudo cruza a fronteira
`contextIsolation`/`sandbox` por `src/preload/preload.ts`.

## Módulos

| Módulo             | Caminho                    | Responsabilidade                                               |
| ------------------ | -------------------------- | -------------------------------------------------------------- |
| Shared             | `packages/shared`          | Tipos, enums de operação, ids, formatação, ranking de busca    |
| Scale adapters     | `packages/scale-adapters`  | Contrato de adapter, Toledo (serial e TCP) e balança virtual   |
| Print templates    | `packages/print-templates` | Cupom 80 mm e relatório A4                                     |
| OMIE client        | `packages/omie-client`     | Cliente tipado por serviço, datas, limites de campo, retry     |
| Desktop            | `apps/desktop`             | Operação local, hardware, SQLite, filas, relatórios            |
| Loader web + admin | `apps/loader-web`          | Site do carregador e painel administrativo                     |
| Edge Functions     | `supabase/functions`       | Integrações sensíveis, sync, jobs agendados                    |
| Utils TS           | `functions`                | Biblioteca `@kyberrock/functions` — **não** são Edge Functions |

## Edge Functions

| Função                                                  | Papel                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `desktop-activate`                                      | Ativa uma balança por código, cria/reaproveita o registro e emite o token      |
| `desktop-status`                                        | Heartbeat da balança: bloqueio por inadimplência, nome, canal, aviso de update |
| `desktop-sync`                                          | Recebe o push do desktop (operações, cupons, cadastro compartilhado)           |
| `desktop-pull`                                          | Devolve o cadastro compartilhado e o histórico para a balança                  |
| `desktop-download`                                      | Redireciona o download público do instalador estável mais recente              |
| `omie-sync`                                             | Única ponte com o OMIE (cadastros, pedido/OS, faturamento, adiantamentos)      |
| `admin-auth` / `admin-api`                              | Login e API do painel administrativo                                           |
| `admin-billing`                                         | API da aba Financeiro do painel                                                |
| `billing-run`                                           | Passada agendada do motor de cobrança (pg_cron, duas vezes por dia)            |
| `billing-webhook`                                       | Notificação de pagamento do Mercado Pago; reconsulta a API antes de dar baixa  |
| `daily-report-scheduler` / `daily-report-email`         | Fechamento diário por e-mail (pg_cron de hora em hora)                         |
| `financial-report-scheduler` / `financial-report-email` | Relatório financeiro por e-mail (mesma cadência)                               |
| `whatsapp-link`                                         | Link temporário de 15 min para parear o WhatsApp da pedreira fora da balança   |
| `cnpj-lookup`                                           | Enriquecimento de cadastro por CNPJ                                            |
| `docs-assistant`                                        | Assistente da central de ajuda (OpenAI, chave global do painel)                |

`supabase/functions/_shared/` guarda o que é comum e testável em isolamento: regras de cobrança,
eleição de balança principal, nome/cor de dispositivo, releases do desktop, cifra de credenciais.

## Ownership De Dados

| Dado                                    | Fonte de verdade         | Escrita local             | Observação                                                           |
| --------------------------------------- | ------------------------ | ------------------------- | -------------------------------------------------------------------- |
| Empresa/unidade/dispositivo             | KyberRock (painel)       | Espelho                   | Criado no painel; a balança espelha o que o `desktop-status` devolve |
| Cliente — identificação e endereço      | OMIE                     | Parcial                   | Campos OMIE bloqueados localmente                                    |
| Cliente — bloco comercial/crédito       | Balança principal        | Só na principal           | Ver `docs/preco-balanca-principal.md`                                |
| Cliente local pendente                  | KyberRock                | Sim                       | Enviado ao OMIE depois (`push_customer`)                             |
| Produto                                 | OMIE                     | Não em campos OMIE        | Sincronizado para operação                                           |
| Forma/condição de pagamento             | OMIE                     | Não em campos OMIE        | Usado em regras financeiras                                          |
| Preço (padrão, especial, tabela, frete) | Balança principal        | Só na principal           | Empate resolvido por `priceConflictPolicy`                           |
| Veículo/motorista                       | KyberRock                | Sim                       | Vínculos com cliente/transportadora                                  |
| Transportadora                          | OMIE                     | Parcial                   | OMIE usa o cadastro de clientes/fornecedores/transportadoras         |
| Adiantamento do cliente                 | OMIE                     | Não                       | Espelhado no extrato de crédito; abate as compras                    |
| Operação de pesagem                     | KyberRock local          | Sim                       | Sincronizada para cloud/OMIE                                         |
| Cupom                                   | KyberRock local          | Sim                       | Reimpressão gera auditoria                                           |
| Solicitação de carregamento             | KyberRock/Supabase       | Sim local, cloud via sync | Site lê somente as abertas                                           |
| Nota fiscal / faturamento da operação   | OMIE                     | Não                       | Número da nota volta pela conferência de faturamento                 |
| Mensalidade da plataforma               | Kybernan (Supabase)      | Não                       | `docs/financeiro.md`; nada a ver com o financeiro da pedreira        |
| Versão instalada / anel de atualização  | GitHub Releases + painel | Não                       | A balança reporta a versão; o painel decide quem recebe o quê        |
| Logs/auditoria                          | KyberRock                | Sim                       | Não expor segredos                                                   |

## Identificadores

Dois identificadores por entidade operacional:

- `id`: UUID global, gerado pelo KyberRock, usado entre SQLite, Supabase Postgres e filas.
- `localId`: inteiro SQLite opcional para performance interna, nunca usado como identificador
  externo.

IDs externos ficam em campos específicos: `omieCustomerId`, `omieProductId`, `omieSalesOrderId`,
`omieServiceOrderId`. IDs no Supabase usam os mesmos UUIDs globais.

Formato das chaves idempotentes:

```text
kyberrock:{unitId}:{operationId}:{action}
```

Exemplos: `kyberrock:unit_abc:op_123:create_sales_order`,
`kyberrock:unit_abc:op_123:create_service_order`. A cobrança da plataforma usa a mesma convenção
com outro escopo: `kyberrock:{companyId}:{invoiceId}:create_boleto`.

Importante: os campos de código do OMIE (`codigo_cliente_integracao`, `codigo_pedido_integracao`,
`cCodIntOS`, `cCodIntPed`) rejeitam caracteres especiais (`:`, `-`, etc.). A Edge Function
`omie-sync` converte a chave idempotente (e UUIDs locais) em um código alfanumérico
determinístico via `toOmieIntegrationCode` (`supabase/functions/omie-sync/omie-sync-core.ts`)
antes de enviar ao OMIE — a mesma chave sempre gera o mesmo código, preservando a idempotência.
A chave no formato acima continua sendo usada nas filas locais e no Supabase.

## Status Da Operação

Definidos em `packages/shared/src/operation.ts` (`OPERATION_STATUSES`).

| Status              | Significado                                   |
| ------------------- | --------------------------------------------- |
| `draft`             | Operação iniciada antes da captura de entrada |
| `entry_registered`  | Peso de entrada capturado                     |
| `loading_requested` | Solicitação aberta para o carregador          |
| `awaiting_exit`     | Caminhão deve retornar à balança              |
| `closed_local`      | Saída capturada e valores calculados          |
| `pending_cloud`     | Ainda não sincronizada ao cloud               |
| `pending_omie`      | Ainda não enviada ao OMIE                     |
| `synced`            | Sincronizações obrigatórias confirmadas       |
| `sync_error`        | Existe erro de sincronização pendente         |
| `cancelled`         | Cancelada com motivo obrigatório              |

`synced` e `cancelled` são terminais (`isTerminalOperationStatus`).

## Fluxo Operacional Local

1. Operador seleciona cliente, veículo, motorista, produto, tipo de operação e condição.
2. Sistema valida bloqueios financeiros com dados OMIE em cache local.
3. Adapter de balança informa peso estável.
4. Desktop registra o peso de entrada no SQLite.
5. Desktop cria a solicitação de carregamento local e o evento para o Supabase.
6. Carregador vê a solicitação quando ela chega ao Supabase Postgres.
7. Na saída, o adapter informa novo peso estável.
8. Desktop calcula peso líquido, produto, frete e total.
9. Desktop fecha a operação localmente e gera o cupom.
10. Desktop enfileira o sync Supabase e o OMIE.
11. O sync envia quando houver conectividade.

Entre os passos 4 e 9 (operação **em andamento**: `draft`, `entry_registered`,
`loading_requested`, `awaiting_exit`) a operação é **editável por inteiro** na tela de Operações
— duplo clique na linha abre a ficha completa e, em andamento, a edição de cliente, produto,
preço por tonelada, valor e regra de frete, placa, motorista, transportadora, forma e condição de
pagamento e tipo de fechamento (`updateWeighingOperationDetails`). Alterar o preço exige a senha
de alteração de preços da empresa. A edição reflete na `loading_requests` (o que o carregador vê)
e reenfileira o upsert cloud. Depois do fechamento a ficha continua abrindo, mas só para consulta:
o pedido/OS já foi montado para o OMIE e a correção passa a ser cancelar e refazer.

## Várias Balanças Na Mesma Pedreira

Uma pedreira roda com mais de um computador de balança, cada um com seu registro em
`device_registrations`, seu token e seu SQLite completo. Isso muda três coisas:

- **Ativação nunca toca o registro alheio.** A escolha do registro a reaproveitar é por
  `installation_id` (`_shared/device-registration.ts`); rotacionar o token de outra máquina a
  derrubaria no meio da operação.
- **O cadastro é compartilhado pela nuvem.** Cada balança publica o que cadastra
  (`CADASTRO_PUSH_ENTITIES` em `supabase-sync.ts`) e recebe o das outras pelo `desktop-pull`.
- **Preço e bloco comercial/crédito têm dono.** As balanças marcadas como principais no painel
  (`device_registrations.is_price_master`, pode ser mais de uma) publicam esses campos; as
  secundárias exibem e não publicam, e a edição é recusada no runtime. O desempate entre
  principais é por `updated_at` da própria linha. Guia completo em
  `docs/preco-balanca-principal.md`.

A identidade visual de cada máquina (nome e cor) vem do painel e chega pelo heartbeat do
`desktop-status`, que roda a cada 5 s: renomear no painel troca o nome em todas as telas em
segundos, sem reativar nada.

## Hardware

Balança:

- configurada por unidade/dispositivo;
- contrato único de adapter (`packages/scale-adapters`);
- implementado: Toledo por **serial** e por **TCP/IP**, mais uma **balança virtual** para teste;
- previstos pelo contrato: USB serial, HTTP/API local, arquivo/driver, adapter específico;
- sem adapter funcional, a pesagem fica bloqueada — nunca há campo de peso manual.

Impressão:

- lista as impressoras instaladas no Windows;
- perfil salvo por tipo de documento;
- cupom 80 mm e relatório A4 usam perfis separados;
- dois caminhos de impressão: `webContents.print` e envio ESC-POS bruto (inclusive por rede);
- falha de impressão não apaga operação fechada — cada tentativa fica em `print_receipts`.

## OMIE

Toda chamada ao OMIE sai da Edge Function `omie-sync` — nunca do desktop nem do loader-web. As
credenciais (app key/secret por empresa) ficam do lado servidor.

Ações do `omie-sync`:

| Ação                     | Papel                                                          |
| ------------------------ | -------------------------------------------------------------- |
| `sync`                   | Sincronização de cadastros orquestrada pelo desktop            |
| `pull_reference_data`    | Categorias, contas correntes, formas/condições de pagamento    |
| `push_customer`          | Cliente criado/alterado localmente sobe para o OMIE            |
| `push_carrier`           | Transportadora criada localmente sobe para o OMIE              |
| `create_order`           | Pedido de venda (operação com nota) ou OS (operação interna)   |
| `create_and_bill_order`  | Cria e fatura na mesma passada                                 |
| `check_order_billing`    | Confere o faturamento e traz o número da nota                  |
| `cancel_order`           | Cancelamento depois do envio, respeitando o que o OMIE permite |
| `list_document_types`    | Tipos de documento disponíveis na empresa                      |
| `pull_customer_advances` | Espelha os adiantamentos do cliente no extrato de crédito      |
| `settle_advance`         | Baixa o adiantamento contra as parcelas do pedido              |

Endpoints usados:

| Área                     | Endpoint                         | Chamadas relevantes                                                 |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------- |
| Clientes/transportadoras | `/api/v1/geral/clientes/`        | `ListarClientes`, `ConsultarCliente`, `UpsertCliente`               |
| Produtos                 | `/api/v1/geral/produtos/`        | `ListarProdutos`, `ConsultarProduto`                                |
| Pedido de venda          | `/api/v1/produtos/pedido/`       | `IncluirPedido`, `ConsultarPedido`, `StatusPedido`, `ExcluirPedido` |
| Ordem de serviço         | `/api/v1/servicos/os/`           | `IncluirOS`, `ConsultarOS`, `StatusOS`, `ExcluirOS`                 |
| Contas a receber         | `/api/v1/financas/contareceber/` | `ListarContasReceber`, `ConsultarContaReceber`, `LancarRecebimento` |

Campos OMIE que afetam o modelo:

- clientes: `codigo_cliente_omie`, `codigo_cliente_integracao`, `valor_limite_credito`,
  `bloquear_faturamento`;
- produtos: `codigo_produto`, `codigo_produto_integracao`, `codigo`, `descricao`, `unidade`;
- pedido: `codigo_pedido_integracao`, `codigo_cliente`, `codigo_parcela`, `det`, `frete`;
- frete do pedido: `codigo_transportadora`, `modalidade`, `placa`, `uf_placa`, `peso_liquido`,
  `peso_bruto`, `valor_frete`;
- veículo: `nCodVeic`, `cPlaca`, `cUF` (cadastro de `/transportador/veiculo/`, origem da UF do
  frete);
- OS: `cCodIntOS`, `nCodOS`, `nCodCli`, `cCodParc`, `nQtdeParc`, `ServicosPrestados`, `Parcelas`;
- contas a receber: `codigo_cliente_fornecedor`, `valor_documento`, `data_vencimento`,
  `status_titulo`.

Os fluxos passo a passo (frete, condição de pagamento, boleto, venda em carteira, paridade
pedido/OS, cancelamento, conferência de faturamento) estão em `docs/phase-1/sync-strategy.md`.

### Adiantamento do cliente (crédito pré-pago)

O saldo que banca as compras pré-pagas é dinheiro que o cliente já depositou, e o lançamento
financeiro é feito no OMIE — o KyberRock não cria nem baixa título lá.

- No OMIE, o adiantamento é um título de **contas a receber** classificado numa **categoria de
  adiantamento de clientes** (o padrão `Adiantamento de Clientes`, do plano de contas) e
  **baixado** quando o dinheiro entra. Enquanto não há baixa, não há saldo.
- A ação `pull_customer_advances` descobre as categorias de adiantamento pela descrição, lista
  `ListarContasReceber` filtrando por inclusão/alteração e espelha cada título no extrato de
  crédito (`customer_credit_movements`, `source = 'omie'`, `omie_title_id`).
- A Edge Function é o **único escritor** desse espelho: o título do OMIE é a chave de idempotência
  e o lançamento sempre entra como **delta** sobre o que já foi espelhado, então reprocessar a
  mesma página não altera o saldo, e baixa parcial ou cancelamento no OMIE viram acerto no
  extrato.
- O desktop apenas aplica as linhas recebidas (mesmo caminho de qualquer movimento vindo de outra
  máquina) e continua recalculando o saldo pelo log. As compras seguem debitando localmente no
  fechamento — é o que abate o adiantamento.
- Categoria e conta corrente do adiantamento são descobertas pela descrição, mas podem ser fixadas
  na tela de preços/categorias (`omie.advanceConfig`): o que o operador escolhe vence a detecção
  automática.
- **Não existe lançamento de crédito pelo KyberRock**: o desktop não tem tela nem IPC para inserir
  valor de crédito. O extrato só recebe crédito pelo espelho do OMIE (`source = 'omie'`); o que
  nasce aqui é o consumo — débito no fechamento e estorno no cancelamento. A aba Crédito é somente
  leitura (totais, extrato e o botão de sincronizar).
- Consequência no fiado: como o pagamento do boleto não é mais lançado aqui, o limite consumido só
  volta quando o pagamento chegar do OMIE. Enquanto o espelho cobrir apenas títulos de
  adiantamento, o recebimento de uma fatura de fiado precisa ser lançado no OMIE como adiantamento
  para devolver o saldo.

#### Baixa do adiantamento no OMIE

Debitar o saldo aqui não basta: o dinheiro está na conta corrente de adiantamentos do OMIE e
precisa ser amortizado lá, senão os dois lados divergem.

- No fechamento, a operação reserva em `omie_advance_settle_cents` a parte da compra que sai do
  adiantamento — limitada ao adiantamento espelhado que ainda não foi amortizado (o excedente é
  fiado e não gera baixa).
- Duas portas levam a essa reserva: a venda no **crédito do cliente** (fiado ou pré-pago), que
  sempre abate o que houver de adiantamento; e a venda **em carteira** com
  `settle_from_advance = 1`, a marca "abater do adiantamento" que o operador liga na entrada
  quando o cliente pagou adiantado e agora está retirando. Na carteira o excedente não vira fiado:
  continua em carteira, e a venda só nasce quitada (`wallet_settled_at` sem forma de recebimento)
  quando o adiantamento cobre o total.
- Depois que o pedido/OS existe no OMIE (e, na venda com nota, foi faturado), a fila OMIE despacha
  o job `settle_advance`: a Edge Function acha os títulos do pedido
  (`nCodPedido`/`numero_pedido`), distribui o valor entre as parcelas em aberto e lança
  `LancarRecebimento` contra a conta de adiantamentos.
- Idempotência pelo `codigo_baixa_integracao` (chave da operação + título): um retry nunca baixa o
  mesmo título duas vezes.
- Enquanto o faturamento não gerar título, o job volta para a fila em vez de dar a operação como
  amortizada. O estado fica em `omie_advance_status` (`pending`/`settled`/`partial`/`error`) na
  própria operação.
- Cancelamento: pedido já faturado não é cancelável no OMIE, e antes do faturamento não existe
  título — então não há baixa a desfazer. Um estorno excepcional continua sendo trabalho do
  financeiro no OMIE.

## Supabase

O Postgres é **projeção**, não fonte primária da operação local. Objetivos:

- o site do carregador lê as solicitações abertas da sua unidade;
- o desktop sincroniza operações abertas, fechadas e canceladas;
- as balanças da mesma pedreira compartilham cadastro;
- os dados ficam segregados por empresa/unidade;
- o carregador tem permissão somente de leitura;
- o dispositivo autentica por token para escrita controlada.

Push e pull do desktop passam por `desktop-sync` e `desktop-pull`, ambos com service role do lado
servidor e escopo checado pelo token do dispositivo. As regras de conflito, os cursores
incrementais e a ordem de gravação estão em `docs/phase-1/sync-strategy.md`.

## Crédito, Carteira E Faturamento Futuro

Três formas de a venda ser paga, todas decididas no fechamento local:

- **Crédito do cliente** — fiado com fechamento periódico (mensal, quinzenal ou semanal) ou
  pré-pago contra adiantamento. A configuração da conta vive no cadastro do cliente e é publicada
  pela balança principal. O fechamento gera a fatura de fiado e o boleto pelo OMIE.
- **Carteira** — a venda sai sem título no OMIE e fica registrada como pendente de recebimento
  (`wallet_settled_at`, `wallet_settlement_method_id`, `wallet_settlement_due_date`), com tela
  própria para baixa e reabertura.
- **Faturamento futuro** — a retirada acontece agora e a nota sai depois, contra uma nota já
  emitida (`customer_future_billing_invoices`, `future_billing_nfe_number`). O saldo de peso da
  nota é controlado por cliente/produto.

## Relatórios E Canais

- Relatórios operacionais e gerenciais no desktop: diário, mensal, por cliente, por produto,
  controle de caminhões, fechamento de faturas, relatório de vendas — com exportação PDF/Excel e
  impressão A4.
- Destinatários ficam em `report_recipients` (sincronizado com a nuvem) e escolhem quais
  relatórios recebem e em que frequência.
- O envio agendado roda na nuvem: `daily-report-scheduler` e `financial-report-scheduler` são
  acordados pelo pg_cron de hora em hora e delegam o envio às funções `*-email`. Cada disparo fica
  registrado em `daily_report_dispatches` / `financial_report_dispatches`.
- Canais por pedreira (SMTP e WhatsApp/UAZAPI) ficam em `report_channel_settings`. O WhatsApp da
  pedreira é pareado por QR code na tela de Relatórios ou pelo **link temporário de 15 minutos**
  (`whatsapp-link`, `whatsapp_connection_links`), para o dono do número parear do próprio celular.

## Central De Ajuda

- O texto vive em `apps/desktop/src/renderer/documentation-content.ts` (dados puros), a busca em
  `documentation-search.ts` e a tela em `DocumentationView.tsx`.
- O assistente flutuante **recupera os trechos no renderer** e manda só eles para a Edge Function
  `docs-assistant`: a documentação usada é sempre a da versão instalada, e nenhum dado de
  operação, cliente ou peso sai do computador da balança.
- Quem responde é a IA — a nuvem é chamada mesmo quando a busca não achou trecho nenhum, e aí ela
  raciocina pelo briefing do sistema/OMIE em `docs-assistant/prompt.ts`. A resposta se declara em
  três origens (`documentacao` | `conhecimento` | `desconhecido`): só a primeira cita fonte, as
  outras duas oferecem o suporte. Sem nuvem, cai na documentação local; o que ela não cobre vira
  "fale com o suporte", nunca um palpite.
- A chave e o modelo da OpenAI são **globais**, configurados no painel (`ai_assistant_settings`),
  não por instalação.

## Painel Administrativo

Em `/admin` do loader-web, com API nas funções `admin-auth`, `admin-api` e `admin-billing`:

- CRUD de empresas (pedreiras), unidades e usuários carregadores;
- gestão da frota de balanças: número, cor, nome, unidade, canal de atualização, marca de balança
  principal de preços, código de ativação;
- revelação sob demanda das credenciais de um cadastro (`reveal_credentials`), auditada sem o
  valor; cofre de senhas cifrado em `user_password_vault`;
- aba **Atualizações**: lista as versões do desktop e move cada uma entre os anéis;
- aba **Financeiro**: cobrança da plataforma (`docs/financeiro.md`);
- configuração global do assistente de IA.

## Distribuição E Atualização Do Desktop

Compilar não é distribuir. Um merge na `main` gera um build que nasce como **rascunho** — updater
nenhum enxerga. Distribuir é um ato explícito, em dois anéis:

| Anel       | Estado da release           | Quem recebe                                       |
| ---------- | --------------------------- | ------------------------------------------------- |
| _(nenhum)_ | rascunho                    | ninguém — o build só existe                       |
| teste      | publicada como _prerelease_ | só as balanças marcadas como teste (canal `beta`) |
| produção   | publicada como estável      | todas as balanças (canal `latest`, o padrão)      |

O anel de cada balança está em `device_registrations.update_channel`; a versão instalada volta
pelo heartbeat (`app_version`) e o painel consegue pedir a atualização para uma máquina
(`update_notice_*`). O passo a passo dos workflows, as armadilhas do `latest.yml` e as regras da
tela estão em `AGENTS.md` ("Desktop versioning"). Instalação nova usa o link público servido por
`desktop-download` (atalho `/download` no nginx do loader-web).

## Backoffice Financeiro Da Plataforma

Cobrança da Kybernan sobre cada pedreira — separada e independente do financeiro das operações,
que vive no OMIE. Datas (virada, fechamento, vencimento), rateio, boleto no Mercado Pago, aviso
por WhatsApp e bloqueio por inadimplência (`companies.payment_blocked`, checado pelo
`desktop-status`). Motor único compartilhado pelo botão do painel e pela passada do pg_cron.
Guia completo em `docs/financeiro.md`.

## Documentos De Apoio

- `docs/phase-1/data-model.md` — tabelas, colunas e regras de conflito.
- `docs/phase-1/contracts.md` — contratos entre processos e superfícies.
- `docs/phase-1/sync-strategy.md` — filas, idempotência, fluxos Supabase e OMIE.
- `docs/phase-1/security-and-operations.md` — segredos, autenticação, backup, logs.
- `docs/preco-balanca-principal.md` — dono do preço e do cadastro comercial.
- `docs/financeiro.md` — cobrança da plataforma.
- `AGENTS.md` — comandos, quirks, versionamento e deploy.

## Pendências Técnicas

- Assinatura de código Windows antes de distribuição externa mais ampla.
- Fórmula de frete por distância continua parametrizável por cliente/produto, sem fórmula única
  fechada comercialmente.
- Adapters de balança além de Toledo serial/TCP (USB serial, HTTP local, arquivo/driver) seguem
  previstos pelo contrato e não implementados.
- Migrations do Supabase continuam sendo aplicadas manualmente (ver `AGENTS.md`, "SQL migrations").
