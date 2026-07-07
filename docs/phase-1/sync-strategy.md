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

#### Condicao de pagamento (implementado)

- A condicao local (`payment_terms`) pode ser vinculada a um codigo de parcela do OMIE via
  `payment_terms.omie_parcela_code` (ex: "000", "030"). Os codigos disponiveis sao espelhados
  do OMIE (`ListarParcelas`) em `omie_payment_terms` no pull.
- No fechamento, o desktop resolve o codigo vinculado e o envia no payload do job
  (`paymentTermOmieCode`, `paymentTermInstallmentCount`).
- A Edge Function usa esse codigo em `codigo_parcela` (pedido) / `cCodParc` + `nQtdeParc` (OS).
  Sem vinculo, cai no padrao `"000"` (a vista). O codigo e string e preserva zeros a esquerda.

### Operacao Interna

- Criar OS com `IncluirOS` em `/api/v1/servicos/os/`.
- Enviar `cCodIntOS` idempotente.
- Enviar cliente, condicao, servico/produto interno e quantidade.
- Salvar `nCodOS` retornado.

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
