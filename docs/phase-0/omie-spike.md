# Spike OMIE

## Objetivo

Validar autenticacao e chamadas essenciais ao OMIE antes da implementacao principal, reduzindo risco de contrato, dados obrigatorios e duplicidade.

## Resultado Atual

Status: parcial.

Conectividade HTTPS com `api.omie.com.br:443` foi validada com sucesso no ambiente atual. Autenticacao real ainda nao foi executada porque as credenciais nao foram configuradas no projeto, e nao devem ser commitadas.

## Regra Para Credenciais

Usar variaveis de ambiente locais ou cofre do sistema operacional:

- `OMIE_APP_KEY`
- `OMIE_APP_SECRET`

Nao criar arquivos com credenciais reais dentro do repositorio.

## Chamadas A Validar

| Area | Objetivo | Status | Observacao |
| --- | --- | --- | --- |
| Autenticacao | Validar `app_key` e `app_secret` | Pendente | Usar credenciais reais em ambiente seguro |
| Clientes | Consultar cliente existente | Pendente | Levantar campos obrigatorios usados no KyberRock |
| Produtos | Consultar produto existente | Pendente | Confirmar identificadores e unidade |
| Forma/condicao | Consultar forma e condicao de recebimento | Pendente | Endpoint exato a confirmar |
| Financeiro | Consultar limite/bloqueio/contas a receber | Pendente | Definir regra de bloqueio com dados reais |
| Pedido de venda | Simular ou criar em ambiente seguro | Pendente | Evitar duplicidade em producao |
| Ordem de servico | Simular ou criar em ambiente seguro | Pendente | Confirmar campos obrigatorios |

## Dados Obrigatorios A Levantar

Pedido de venda:

- cliente/codigo OMIE;
- produto/codigo OMIE;
- quantidade em tonelada;
- valor unitario;
- forma/condicao de recebimento;
- empresa/unidade;
- observacoes necessarias;
- identificador externo/idempotente do KyberRock;
- comportamento para cancelamento.

Ordem de servico ou operacao interna:

- cliente ou destinatario interno exigido pelo OMIE;
- servico/produto usado para operacao interna;
- quantidade;
- centro de custo, categoria ou projeto, se obrigatorio;
- observacoes;
- identificador externo/idempotente do KyberRock;
- comportamento para cancelamento.

Financeiro/bloqueio:

- onde consultar limite de credito;
- como identificar cliente bloqueado;
- onde consultar contas a receber vencidas;
- regra quando limite estiver vazio ou zero;
- tempo maximo aceito para dados financeiros em cache offline.

## Testes Minimos

- Chamada simples autenticada com sucesso.
- Consulta de cliente conhecido.
- Consulta de produto conhecido.
- Consulta de forma/condicao conhecida.
- Consulta de dados financeiros de cliente conhecido.
- Validacao de erro com credencial invalida.
- Validacao de timeout ou OMIE indisponivel.
- Validacao de campo idempotente para evitar duplicidade.

## Criterio De Aceite

O spike e aceito quando a autenticacao OMIE funcionar ou quando houver erro real documentado com causa e proximo passo.
