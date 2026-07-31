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

#### Modalidade do frete (implementado)

- A modalidade do KyberRock mapeia para o `modalidade` (modFrete da NF-e) do bloco `frete`:
  CIF `"0"`, terceiros `"2"`, transporte proprio `"3"`/`"4"`, sem frete `"9"`.
- **FOB (frete por conta do cliente) vai como `"9"` — sem incidencia de frete.** Quando o frete
  e responsabilidade do cliente a Pedreira nao contrata nem responde pelo transporte, entao a
  operacao nao nasce no OMIE como "frete por conta do destinatario". Vale inclusive com valor
  de frete lancado na operacao (o valor continua indo em `valor_frete`).
- Compat: operacao antiga sem tipo salvo (default `none` -> `"9"`) que tenha valor de frete
  continua indo como CIF `"0"`, para nao enviar "sem frete" num pedido que tinha frete.

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
  (codigo do cadastro via `ensureOmieParcelaCode`, senao `"000"`), com o motivo no log: uma
  recusa de formato nunca deixa a operacao sem OS.

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
