# Fase 4 - Fluxo De Pesagem Com Balanca Simulada

Status: concluida.

## Entregue

- Adapter mock de balanca em `packages/scale-adapters`;
- painel desktop com fluxo por telas internas;
- tela de nova entrada;
- tela de operacoes abertas;
- abertura de operacao com cliente, placa, motorista e produto;
- selecao de operacao com nota ou interna;
- forma/condicao de recebimento;
- tabela de preco simulada;
- captura de peso de entrada pela balanca simulada, sem campo manual de peso;
- listagem de operacoes em aberto;
- fechamento com peso de saida simulado;
- calculo e persistencia do peso liquido;
- calculo financeiro por preco/kg da tabela simulada;
- bloqueio de peso de saida menor ou igual ao peso de entrada;
- cancelamento com motivo obrigatorio;
- criacao de `loading_requests` local;
- auditoria local de entrada, saida e cancelamento;
- enfileiramento local para futura sincronizacao Firebase;
- tratamento visual inicial de erros de validacao.

## Limites Da Fase

- Cadastros continuam rapidos/simulados; sincronizacao OMIE real entra em fases posteriores.
- A balanca fisica real continua pendente da validacao da Fase 0.
- Frete usa estrutura do schema, mas a formula comercial final ainda precisa ser definida.

## Validacao

```bash
npm run build
npm run lint
npm test
```
