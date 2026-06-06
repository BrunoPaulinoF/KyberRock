# Architecture - KyberRock

Versao: 0.1
Status: draft da Fase 1
Base: `PRD.md`, `PLAN.md`, `docs/phase-0/*`

## Objetivo

Definir a arquitetura tecnica antes de criar migrations, colecoes Firebase, pacotes compartilhados e aplicativos. Este documento e a referencia principal da Fase 1.

## Principios

- Offline-first no desktop Windows.
- Nenhum peso manual.
- Toda pesagem nasce e fecha no banco local antes de qualquer sincronizacao.
- Balancas sao integradas por adapters configuraveis por unidade/dispositivo.
- Impressoras sao selecionadas entre as instaladas no Windows, com perfis configuraveis.
- OMIE e fonte de cadastros/financeiro e destino de pedidos/operacoes internas.
- Firebase e camada cloud para site do carregador, sincronizacao e multiunidade.
- Segredos nunca entram no Git, docs, logs ou banco local em texto puro.
- Toda operacao critica gera auditoria.
- Toda integracao externa usa idempotencia.

## Superficies

| Superficie | Responsabilidade | Estado |
| --- | --- | --- |
| Desktop Windows | Operacao principal, leitura de balanca, SQLite, impressao, sync | Offline-first |
| Loader web | Visualizacao de carregamentos em aberto pelo carregador | Online |
| Firebase Functions | Integracoes sensiveis, tarefas agendadas, e-mail | Online |
| Firestore | Visao cloud multiunidade e dados do site do carregador | Online |
| OMIE | ERP para cadastros, financeiro, pedidos e OS | Online externo |

## Topologia

```text
Desktop Windows
  React UI
  Electron main process
  SQLite local
  Scale adapters
  Windows print profiles
  Local sync queue
     |
     | HTTPS quando online
     v
Firebase
  Firestore
  Auth
  Functions
  Hosting
     |
     | HTTPS server-side
     v
OMIE API

Loader web
  React UI
  Firebase Auth
  Firestore read-only access
```

## Modulos Planejados

| Modulo | Futuro caminho | Responsabilidade |
| --- | --- | --- |
| Shared | `packages/shared` | Tipos, enums, validacoes de dominio |
| Scale adapters | `packages/scale-adapters` | Contrato e adapters de balanca |
| Print templates | `packages/print-templates` | Cupom 80 mm e relatorios A4 |
| OMIE client | `packages/omie-client` | Cliente tipado, payloads, erros e idempotencia |
| Desktop | `apps/desktop` | Operacao local e integracoes de hardware |
| Loader web | `apps/loader-web` | Consulta do carregador |
| Functions | `functions` | Integracoes cloud, e-mails e jobs |

## Ownership De Dados

| Dado | Fonte de verdade | Escrita local | Observacao |
| --- | --- | --- | --- |
| Empresa/unidade/dispositivo | KyberRock | Sim | Criado/configurado no KyberRock |
| Cliente OMIE | OMIE | Parcial | Campos OMIE bloqueados localmente |
| Cliente local pendente | KyberRock | Sim | Enviado ao OMIE depois |
| Produto | OMIE | Nao em campos OMIE | Sincronizado para operacao |
| Forma/condicao de pagamento | OMIE | Nao em campos OMIE | Usado em regras financeiras |
| Tabela de preco | KyberRock | Sim | Vinculada ao cliente/produto |
| Veiculo/motorista | KyberRock | Sim | Pode ter vinculos com cliente/transportadora |
| Transportadora | OMIE | Parcial | OMIE usa cadastro de clientes/fornecedores/transportadoras |
| Operacao de pesagem | KyberRock local | Sim | Sincronizada para Firebase/OMIE |
| Cupom | KyberRock local | Sim | Reimpressao gera auditoria |
| Solicitacao carregamento | KyberRock/Firebase | Sim local, cloud via sync | Site le somente abertas |
| Logs/auditoria | KyberRock | Sim | Nao expor segredos |

## Identificadores

Usar dois identificadores por entidade operacional:

- `id`: UUID global, gerado pelo KyberRock, usado entre SQLite, Firestore e filas.
- `localId`: inteiro SQLite opcional para performance interna, nunca usado como identificador externo.

IDs externos ficam em campos especificos:

- `omieCustomerId`, `omieProductId`, `omieSalesOrderId`, `omieServiceOrderId`.
- `firebasePath` ou `firestoreDocId` quando necessario.

Formato recomendado para chaves idempotentes enviadas ao OMIE:

```text
kyberrock:{unitId}:{operationId}:{action}
```

Exemplos:

- `kyberrock:unit_abc:op_123:create_sales_order`
- `kyberrock:unit_abc:op_123:create_service_order`

## Status Da Operacao

| Status | Significado |
| --- | --- |
| `draft` | Operacao iniciada antes de captura de entrada |
| `entry_registered` | Peso de entrada capturado |
| `loading_requested` | Solicitacao aberta para o carregador |
| `awaiting_exit` | Caminhao deve retornar a balanca |
| `closed_local` | Saida capturada e valores calculados |
| `pending_firebase` | Ainda nao sincronizada ao Firebase |
| `pending_omie` | Ainda nao enviada ao OMIE |
| `synced` | Sincronizacoes obrigatorias confirmadas |
| `sync_error` | Existe erro de sincronizacao pendente |
| `cancelled` | Cancelada com motivo obrigatorio |

## Fluxo Operacional Local

1. Operador seleciona cliente, veiculo, motorista, produto, tipo de operacao e condicao.
2. Sistema valida bloqueios financeiros com dados OMIE em cache local.
3. Adapter de balanca informa peso estavel.
4. Desktop registra peso de entrada no SQLite.
5. Desktop cria solicitacao de carregamento local e evento para Firebase.
6. Carregador ve a solicitacao quando ela chegar ao Firestore.
7. Na saida, adapter informa novo peso estavel.
8. Desktop calcula peso liquido, produto, frete e total.
9. Desktop fecha operacao localmente e gera cupom.
10. Desktop enfileira sync Firebase e OMIE.
11. Sync envia quando houver conectividade.

## Hardware

Balanca:

- configurada por unidade/dispositivo;
- contrato unico de adapter;
- conexoes planejadas: serial, USB serial, TCP/IP, HTTP/API local, arquivo/driver, adapter especifico;
- sem adapter funcional, a pesagem fica bloqueada.

Impressao:

- listar impressoras instaladas no Windows;
- salvar perfil por tipo de documento;
- cupom 80 mm e relatorio A4 usam perfis separados;
- falha de impressao nao apaga operacao fechada.

## OMIE

A integracao deve usar a documentacao publica enquanto as credenciais reais nao estiverem configuradas.

Endpoints candidatos iniciais:

| Area | Endpoint | Chamadas relevantes |
| --- | --- | --- |
| Clientes/transportadoras | `/api/v1/geral/clientes/` | `ListarClientes`, `ConsultarCliente`, `UpsertCliente` |
| Produtos | `/api/v1/geral/produtos/` | `ListarProdutos`, `ConsultarProduto` |
| Pedido de venda | `/api/v1/produtos/pedido/` | `IncluirPedido`, `ConsultarPedido`, `StatusPedido`, `ExcluirPedido` |
| Ordem de servico | `/api/v1/servicos/os/` | `IncluirOS`, `ConsultarOS`, `StatusOS`, `ExcluirOS` |
| Contas a receber | `/api/v1/financas/contareceber/` | `ListarContasReceber`, `ConsultarContaReceber` |

Campos OMIE observados na documentacao publica que afetam o modelo:

- clientes: `codigo_cliente_omie`, `codigo_cliente_integracao`, `valor_limite_credito`, `bloquear_faturamento`;
- produtos: `codigo_produto`, `codigo_produto_integracao`, `codigo`, `descricao`, `unidade`;
- pedido: `codigo_pedido_integracao`, `codigo_cliente`, `codigo_parcela`, `det`, `frete`;
- frete pedido: `codigo_transportadora`, `modalidade`, `peso_liquido`, `peso_bruto`, `valor_frete`;
- OS: `cCodIntOS`, `nCodOS`, `nCodCli`, `cCodParc`, `ServicosPrestados`;
- contas a receber: `codigo_cliente_fornecedor`, `valor_documento`, `data_vencimento`, `status_titulo`.

## Firebase

Firestore deve ser uma projecao cloud, nao a fonte primaria da operacao local.

Objetivos:

- site do carregador le solicitacoes abertas;
- desktop sincroniza operacoes abertas, fechadas e canceladas;
- dados segregados por empresa/unidade;
- carregador tem permissao somente leitura;
- desktop/dispositivo autentica para escrita controlada.

## Documentos De Apoio

- `docs/phase-1/data-model.md`
- `docs/phase-1/contracts.md`
- `docs/phase-1/sync-strategy.md`
- `docs/phase-1/security-and-operations.md`

## Pendencias Tecnicas

- Validar PC real da balanca.
- Validar impressora real 80 mm.
- Receber/configurar credenciais OMIE fora do Git.
- Confirmar formula exata de frete por distancia e peso.
- Confirmar projeto Firebase e ambientes.
