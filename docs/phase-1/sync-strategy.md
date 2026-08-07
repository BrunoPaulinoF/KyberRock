# Sync Strategy - Fase 1

Status: draft inicial.

## Objetivo

Garantir que o desktop opere offline, preserve dados localmente e sincronize com Supabase e OMIE sem duplicidade.

## Regras Base

- SQLite local e a primeira gravacao de toda operacao.
- Toda escrita externa nasce como item em `sync_queue`.
- Supabase e OMIE recebem snapshots idempotentes.
- Falhas externas nunca apagam dados locais.
- Reenvio automatico usa backoff.
- Erros ficam visiveis ao operador sem expor segredos.

## Alvos De Sync

| Target   | Responsabilidade                                        | Frequencia                     |
| -------- | ------------------------------------------------------- | ------------------------------ |
| Supabase | Operacoes abertas/fechadas/canceladas para cloud e site | A cada poucos minutos e manual |
| OMIE     | Cadastros, pedidos, OS e financeiro                     | A cada 30 minutos e manual     |

## Ciclo Da Fila

1. Dominio local salva entidade no SQLite.
2. Dominio local cria `sync_queue` com `idempotency_key` unica.
3. Worker seleciona itens `pending` cujo `next_attempt_at <= now`.
4. Worker marca item como `running`.
5. Worker executa chamada externa.
6. Em sucesso, salva retorno externo na entidade local e marca `done`.
7. Em erro recuperavel, marca `failed`, incrementa tentativas e agenda retry.
8. Em erro permanente, marca `dead_letter` e exige acao do operador/suporte.

## Idempotencia

### Chave KyberRock

Formato:

```text
kyberrock:{unitId}:{entityId}:{action}
```

### Supabase

- Usar `operationId` como ID do documento.
- `set`/upsert deve ser seguro para repeticao.
- Fechamento de carregamento usa o mesmo `operationId`.

### OMIE

Usar campos de integracao quando disponiveis:

- cliente: `codigo_cliente_integracao`;
- produto, se criado pela API futuramente: `codigo_produto_integracao`;
- pedido: `codigo_pedido_integracao`;
- OS: `cCodIntOS`;
- contas a receber, se necessario: `codigo_lancamento_integracao`.

Antes de reenviar uma criacao apos erro desconhecido, tentar consulta por codigo de integracao quando a API permitir.

## Supabase Flow

### Abrir Carregamento

Criar/atualizar documento cloud:

```text
companies/{companyId}/units/{unitId}/loadingRequests/{operationId}
```

Com dados minimos do carregador:

- placa;
- cliente;
- motorista;
- veiculo;
- produto;
- status aberto;
- timestamps.

### Fechar Operacao

- Atualizar `operations/{operationId}` com status fechado.
- Atualizar/remover `loadingRequests/{operationId}` para nao aparecer como aberto.

### Cancelar Operacao

- Atualizar status como `cancelled`.
- Remover/fechar carregamento aberto.
- Preservar motivo e auditoria.

## OMIE Flow

### Sincronizacao De Cadastros

Clientes:

- Buscar via `ListarClientes` e/ou `ConsultarCliente`.
- Salvar `codigo_cliente_omie`, `codigo_cliente_integracao`, limite e bloqueio.
- Cliente local pendente usa `UpsertCliente` quando credenciais estiverem configuradas.

Produtos:

- Buscar via `ListarProdutos` e/ou `ConsultarProduto`.
- Produto OMIE vence em campos de cadastro.

Financeiro:

- Usar `valor_limite_credito` e `bloquear_faturamento` do cadastro de cliente quando disponiveis.
- Complementar contas em aberto por `ListarContasReceber`/`ConsultarContaReceber`.
- Zero ou vazio em limite desconsidera bloqueio por limite.

### Operacao Com Nota

- Criar pedido com `IncluirPedido` em `/api/v1/produtos/pedido/`.
- Enviar `codigo_pedido_integracao` idempotente.
- Enviar produto com quantidade/peso liquido, valor unitario e condicao.
- Enviar frete no bloco `frete` quando aplicavel, incluindo modalidade, transportadora, peso e valor.
- Salvar `codigo_pedido` retornado.

#### Tipo de frete (implementado)

Sao **quatro situacoes em dois grupos** (definicao do comercial, "Frete Pedreira"). O
operador escolhe o grupo e, na caixa logo abaixo do tipo de frete, a situacao:

| #   | Grupo     | Situacao                         | `freight_type` | modFrete | Valor no pedido     | Transportador na NF |
| --- | --------- | -------------------------------- | -------------- | -------- | ------------------- | ------------------- |
| 1   | Com frete | valor do frete **na nota**       | `fob`          | `1`      | sim (soma no total) | sim                 |
| 2   | Com frete | valor **so no sistema**          | `cif`          | `1`      | nao                 | sim                 |
| 3   | Sem frete | so o **transportador** na nota   | `third_party`  | `1`      | nao (nao ha)        | sim                 |
| 4   | Sem frete | **sem ocorrencia** de transporte | `none`         | `9`      | nao                 | nao                 |

- As chaves gravadas sao as do catalogo antigo porque a coluna `freight_type` tem CHECK com
  essa lista (SQLite migracao 32 e espelho da nuvem); o significado de cada uma e o da tabela.
  `own_sender`/`own_recipient` sao legado de leitura e mantem o modFrete `"3"`/`"4"`
  (`veiculo_proprio "S"`).
- **Situacao 2**: o valor fica no KyberRock (`freight_json` + `freight_total_cents`) para
  controle e para a **NF de servico de transporte**; nao vai em `valor_frete` do pedido, nao
  soma no total da nota e nao sai no cupom (o total impresso desconta o frete).
- **Situacao 4**: o pedido vai sem transportadora nenhuma (`carrier`, `localCarrierId` e o
  `carrierName`/`carrierOmieId` do bloco de transporte ficam nulos).
- Operacao gravada **sem escolha de tipo** nasce na situacao 3 (`FREIGHT_MODALITY_DEFAULT`) —
  o comportamento historico da balanca, em que o pedido sempre levava a transportadora.
- Transportadora, placa e motorista sao selecionaveis em **qualquer** tipo de frete; o tipo
  decide o que vai para a nota, nao o que o operador pode registrar.

#### Calculo do valor do frete (implementado)

O que a entrada grava e a **regra** (`freight_json`), nao o valor: frete so vira dinheiro
quando existe peso liquido, ou seja, no **fechamento**. Os tres calculos da tela, sempre
sobre o peso liquido pesado (`net_weight_kg`, em kg, convertido para tonelada pela regra):

| Calculo          | Formula                                       |
| ---------------- | --------------------------------------------- |
| `per_ton`        | `kg / 1000 x valor_por_tonelada`              |
| `per_ton_km`     | `kg / 1000 x distancia_km x valor_por_ton_km` |
| `fixed_plus_ton` | `valor_fixo + kg / 1000 x valor_por_tonelada` |

O `minValueCents` (frete minimo) e um piso aplicado depois do calculo. O resultado vai para
`freight_total_cents`, soma em `total_cents` e, na situacao 1, sai como `valor_frete` no
bloco `frete` do pedido — a aba **"Frete e Outras Despesas"** do OMIE, onde `peso_bruto` e
`peso_liquido` sao em **kg** (granel: os dois iguais ao peso liquido pesado).

`freight_json` **e projetado na nuvem** (migracao `202608070001_operation_freight_json`).
Antes nao era, e o pull gravava a coluna com o que a nuvem devolvia: a regra da operacao
ainda aberta era apagada a cada ciclo e a saida fechava com frete zero — cupom sem a linha
FRETE e pedido sem `valor_frete`. Hoje o pull trata a coluna como as da carteira
(`mergeProjectedValue`): nuvem sem a coluna nao apaga nada, projecao mais nova manda
(inclusive o nulo de "tirei o frete", feito na outra balanca). Como rede de seguranca, uma
operacao "com frete" que chegue ao fechamento sem regra tem a regra reconstruida pela
memoria de frete do cliente para (cliente, produto, tipo) — a mesma fonte que preencheu a
entrada; sem memoria, fecha sem frete, nunca com um valor inventado.

#### Placa e UF do veiculo (implementado)

- A NF-e pede placa **e** UF do veiculo no transporte: o bloco `frete` leva `placa` +
  `uf_placa`. A UF sai de `vehicles.plate_state`, e so vai quando e uma UF valida de 2 letras
  (campo fiscal nao aceita texto livre); sem ela o pedido segue so com a placa.
- A OS nao tem bloco `frete`: na operacao interna a UF acompanha a placa no texto de
  `cDadosAdicNF` (`Placa: ABC1D23/MG`).
- `vehicles.plate_state` e alimentada pelo sync do cadastro de veiculos do OMIE
  (`ListarVeiculos` em `/transportador/veiculo/`, entidade `veiculos` do master sync). O casamento
  e por placa normalizada (so letras/numeros): veiculo local existente recebe a UF e o
  `omie_vehicle_id`; o que so existe no OMIE entra como cadastro novo (`source = 'omie'`). Uma UF
  ja preenchida no KyberRock nunca e apagada por um cadastro do OMIE sem UF.
- O campo tambem e editavel no cadastro de placas, para corrigir/preencher o que o OMIE nao tem.

#### Condicao de pagamento (implementado)

- A condicao local (`payment_terms`) pode ser vinculada a um codigo de parcela do OMIE via
  `payment_terms.omie_parcela_code` (ex: "000", "030"). Os codigos disponiveis sao espelhados
  do OMIE (`ListarParcelas`) em `omie_payment_terms` no pull.
- No fechamento, o desktop resolve o codigo vinculado e os vencimentos da condicao e envia
  tudo no payload do job (`paymentTermOmieCode`, `paymentTermInstallmentCount`,
  `paymentTermInstallmentDays`). O codigo e string e preserva zeros a esquerda.
- **Pedido de venda**: com meio de pagamento OU parcelas com vencimento, a Edge Function usa o
  parcelamento informado do OMIE — `codigo_parcela` `"999"` + `qtde_parcelas` no cabecalho e
  `lista_parcelas` com `data_vencimento`, `percentual`, `valor` e `meio_pagamento` por parcela.
  A vista sem meio, usa o codigo vinculado (ou `"000"`).
- **OS**: mesmo parcelamento (`buildInstallmentPlan` e compartilhado). Condicao vinculada a um
  codigo do cadastro usa o codigo em `cCodParc` + `nQtdeParc`; **sem vinculo**, a OS vai com
  `cCodParc` `"999"` e o bloco `Parcelas` (`nParcela`, `nDias`, `dDtVenc`, `nPercentual`,
  `nValor`) — a condicao digitada na operacao cai no OMIE exatamente como foi digitada.
  Antes esse caso dependia de localizar/criar a condicao no cadastro de parcelas e, quando nao
  dava, caia em `"000"`: a OS nascia **a vista** mesmo com "9/18/27" digitado na operacao.
- Se o OMIE recusar a estrutura do bloco `Parcelas`, a OS e reenviada pelo caminho antigo
  (codigo vinculado, senao o do cadastro via `ensureOmieParcelaCode`, senao `"000"`), com o
  motivo no log: uma recusa de formato nunca deixa a operacao sem OS.

#### Gerar boleto (implementado)

- O KyberRock nao gera boleto (PRD 10.7): quem emite a cobranca e o OMIE, no faturamento. O
  que o app controla e **se** o boleto deve sair, e isso acompanha a forma de pagamento
  escolhida na operacao (`paymentMethodOmieCode`, o tPag da NF-e).
- O campo do OMIE e **negativo**: `nao_gerar_boleto` `"S"` NAO gera o boleto ao emitir a nota
  e `"N"` gera (padrao). Ele existe no `cabecalho` e em cada parcela do pedido de venda, e na
  parcela da OS — o valor da parcela tem prioridade sobre o do cabecalho.
- Regra aplicada na Edge Function (`boletoGenerationFlag` / `buildBoletoParcelaFields`):
  - **boleto** (`"15"`) -> `nao_gerar_boleto` `"N"` (gerar boleto **ativo**) + `tipo_documento`
    `"BOL"`, para a conta a receber nascer tipada como boleto em vez de "NF-e";
  - **outro meio conhecido** (dinheiro, PIX, cartoes, em carteira) -> `nao_gerar_boleto` `"S"`;
  - **sem meio no payload** (credito do cliente/fiado, desktop antigo) -> nada e enviado e
    vale o padrao do cadastro do cliente no OMIE ("Gerar Boletos ao Emitir NF-e").
- Como o flag so viaja na parcela da OS, a operacao interna em boleto vai com o bloco
  `Parcelas` mesmo a vista e mesmo com a condicao ja vinculada a um codigo do cadastro
  (`cCodParc` `"999"`). Nos demais meios a OS mantem o caminho historico.
- A parcela da OS tambem leva o **`meio_pagamento`** (mesma tag do `lista_parcelas` do pedido).
  Sem ele a aba "Parcelas" da OS chegava ao OMIE sem o meio "15 - Boleto Bancario" na venda
  **sem nota** em boleto, e o faturamento nao tinha do que tirar a cobranca — mesmo com o
  `nao_gerar_boleto` `"N"` e o `tipo_documento` `"BOL"`.
- Se o OMIE recusar o formato do bloco `Parcelas` numa operacao em boleto, o log do reenvio
  diz explicitamente que a OS vai nascer **sem** o "gerar boleto" da parcela (a cobranca passa
  a depender so da recomendacao do cadastro do cliente): uma recusa de formato nunca deixa a
  operacao sem OS, mas tambem nao pode sumir em silencio.

#### Venda em carteira (implementado)

- A forma de pagamento **"Em carteira"** (`payment_methods.code = 'wallet'`,
  `is_wallet = 1`) e a venda que fecha na balanca **sem forma de recebimento definida**:
  ela fica na carteira ate um fechamento futuro, onde o operador escolhe COMO o cliente
  vai pagar (dinheiro, PIX, boleto...) e para quando.
- Ela vai ao OMIE como **`"99"` (outros)**: a NF sai normalmente, mas o meio cai no ramo
  generico do `boletoGenerationFlag` (`nao_gerar_boleto` `"S"`), entao o faturamento **nao**
  emite cobranca — o boleto/recebimento so existe depois do fechamento. A conta corrente e a
  **OMIE Cash**, pelo vinculo padrao do seed (`payment_methods.account_id`) e pelo fallback
  `DEFAULT_ACCOUNT_NAME_BY_METHOD_CODE` da Edge Function.
- O fechamento em si e **local** (tela Carteira do desktop): grava em
  `weighing_operations` a forma de recebimento escolhida
  (`wallet_settlement_method_id`), o vencimento combinado (`wallet_settlement_due_date`),
  quando foi fechado (`wallet_settled_at`) e a observacao. A carteira e da pedreira
  inteira, entao esses campos **e** a forma de pagamento da venda viajam na projecao da
  nuvem (junto com `payment_methods.is_wallet`, que e o que classifica a venda), para as
  duas balancas mostrarem a mesma carteira.
- **Cliente que pagou adiantado**: a marca `settle_from_advance` (caixa "abater do
  adiantamento" na entrada) faz o fechamento descontar a compra do adiantamento que o
  cliente tem no OMIE, ate onde ele der — a reserva vai para `omie_advance_settle_cents`
  e a baixa la e a mesma do fiado (job `settle_advance`, ver `docs/ARCHITECTURE.md`). O
  que passar do adiantamento continua em carteira esperando o fechamento normal; se o
  adiantamento cobrir o total, a venda ja sai fechada, sem forma de recebimento (foi o
  adiantamento que recebeu) e sem poder ser reaberta — o estorno e o cancelamento da
  operacao. As duas colunas (`settle_from_advance` e `omie_advance_settle_cents`) tambem
  vao na projecao: a saida pode ser pesada na outra balanca, e sem elas a outra maquina
  cobraria a venda inteira e reservaria de novo um adiantamento ja consumido.
- **A pesagem confere o saldo**: com a marca ligada, capturar o peso (na entrada e no
  fechamento) dispara um `pull_customer_advances` MIRADO naquele cliente
  (`filtrar_cliente`), disparado junto com a captura para nao somar espera. Sem ele o
  abatimento dependeria da varredura agendada, e o cliente que "deixou pago" de manha
  seria abatido contra saldo velho. A conferencia e **best-effort** (offline-first: sem
  internet a pesagem acontece igual, com o saldo ja espelhado — o erro e sempre para
  MENOS, e o restante fica em carteira) e **nao mexe no cursor** da varredura completa,
  senao ela passaria a pular os adiantamentos antigos dos demais clientes.
- Diferenca para o credito do cliente (fiado): a carteira **nao** consome limite/saldo do
  cadastro e nao tem periodicidade automatica — o fechamento e manual, quando o comercial
  e o cliente combinam.

### Operacao Interna

- Criar OS com `IncluirOS` em `/api/v1/servicos/os/`.
- Enviar `cCodIntOS` idempotente.
- Enviar cliente, condicao, servico/produto interno e quantidade.
- Salvar `nCodOS` retornado.

#### Paridade com o pedido de venda (implementado)

A venda sem nota carrega os MESMOS dados da venda com nota; muda o modulo do OMIE
(Servicos em vez de Vendas), nao o conteudo. A OS nasce em `cEtapa` `"50"` ("Faturar"),
como o pedido de venda, e o faturamento (NFS-e) e feito dentro do OMIE.

- `cCodCateg` usa a categoria do plano gerencial do produto (senao a padrao da unidade),
  a mesma resolvida para `codigo_categoria` do pedido de venda.
- `nCodCC` usa a conta corrente vinculada ao meio de pagamento da operacao.
- A OS nao tem bloco `frete`: o frete entra como uma segunda linha de `ServicosPrestados`
  ("FRETE", com a modalidade no texto) e o peso liquido/placa vao em `cDadosAdicItem`.
- `cDadosAdicNF` concentra o que o pedido espalha entre `frete` e o cadastro da
  transportadora: marcacao de venda sem valor fiscal, id da operacao, motorista, placa,
  transportadora (ou transporte proprio), peso liquido e valor do frete.
- `cCodServMun` e `cCodServLC116` saem do MESMO cadastro de servico do tenant
  (`ListarCadastroServico`) — combinar codigos de servicos diferentes faz o OMIE recusar a OS.
- O cupom termico da operacao interna e igual ao da fiscal, com o aviso
  **VENDA SEM VALOR FISCAL** no topo e no pe (nao desligavel pelo template).
- Fechamento sem como criar a OS (cliente sem codigo OMIE e sem CNPJ/CPF) marca
  `omie_billing_status = 'cadastro_incompleto'` na operacao, em vez de nao enfileirar nada
  em silencio. Envio recusado pelo OMIE marca `'service_order_failed'` com a mensagem.

## Cancelamento E Alteracao

### Antes Do OMIE

- Cancelar localmente com motivo obrigatorio.
- Marcar itens de fila OMIE relacionados como cancelados/ignorados.
- Sincronizar status cancelado ao Supabase.

### Depois Do OMIE

- Nao alterar silenciosamente.
- Registrar solicitacao de cancelamento/alteracao com motivo.
- Tentar chamada OMIE apropriada conforme tipo:
  - pedido: avaliar `ExcluirPedido`, status e etapa antes de cancelar;
  - OS: avaliar `ExcluirOS`, status e etapa antes de cancelar.
- Se OMIE negar, manter operacao local com erro de sincronizacao visivel.

#### Implementado: acao `cancel_order`

- `cancelWeighingOperation` neutraliza (dead_letter) jobs `create_order`/`create_and_bill_order`
  ainda pendentes da operacao ("Antes Do OMIE") e, se ja existe `omie_sales_order_id`/
  `omie_service_order_id`, enfileira um job `cancel_order` (idempotencyKey `omie:cancel:{operationId}`).
- A Edge Function `cancel_order` consulta primeiro (`ConsultarPedido`/`ConsultarOS`):
  - "nao cadastrado" -> `alreadyCancelled` (idempotente);
  - faturado (etapa >= 60 ou NF emitida) -> `blocked`, sem excluir (estorno/cancelamento de NF
    fica fora de escopo, sinalizado ao operador);
  - caso contrario, `ExcluirPedido`/`ExcluirOS`.
- Resposta `blocked` retorna HTTP 200 para o desktop marcar o job como concluido (sem retry
  infinito) e gravar `omie_billing_status = 'cancel_blocked'` com a mensagem visivel.
- Sucesso grava `omie_billing_status = 'cancelled_in_omie'`.

## Conflitos

| Caso                                     | Resolucao                                        |
| ---------------------------------------- | ------------------------------------------------ |
| Campo OMIE alterado localmente           | OMIE vence; campo local bloqueado                |
| Campo KyberRock alterado em dois lugares | Versao mais recente vence, com auditoria         |
| Operacao fechada alterada                | Exige motivo e auditoria                         |
| Operacao enviada ao OMIE alterada        | Exige fluxo especifico de cancelamento/alteracao |
| Supabase fora do ar                      | Mantem fila local pendente                       |
| OMIE fora do ar                          | Mantem fila local pendente                       |

## Retry

Backoff inicial recomendado:

| Tentativa | Proximo retry     |
| --------- | ----------------- |
| 1         | 1 minuto          |
| 2         | 5 minutos         |
| 3         | 15 minutos        |
| 4         | 1 hora            |
| 5+        | 4 horas ou manual |

Erros de validacao de payload devem ir para `dead_letter` mais cedo para correcao humana.

## Observabilidade

- Cada item de fila deve exibir status e ultima mensagem sanitizada.
- Tela desktop deve mostrar pendencias Supabase e OMIE separadas.
- Logs nao podem conter app secret, tokens ou payloads com dados sensiveis completos.
