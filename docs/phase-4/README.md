# Fase 4 - Fluxo De Pesagem Com Balanca Simulada

Status: em andamento.

## Primeira Entrega

- Adapter mock de balanca em `packages/scale-adapters`;
- painel desktop com bloco de nova pesagem simulada;
- abertura de operacao com cliente, placa, motorista e produto;
- captura de peso de entrada pela balanca simulada, sem campo manual de peso;
- listagem de operacoes em aberto;
- fechamento com peso de saida simulado;
- calculo e persistencia do peso liquido;
- bloqueio de peso de saida menor ou igual ao peso de entrada;
- cancelamento com motivo obrigatorio;
- criacao de `loading_requests` local;
- auditoria local de entrada, saida e cancelamento;
- enfileiramento local para futura sincronizacao Firebase.

## Ainda Pendente Na Fase 4

- Selecao real de operacao com nota ou interna;
- forma/condicao de recebimento;
- tabela de preco e calculo financeiro;
- UX separada por telas/rotas em vez de painel unico;
- tratamentos visuais de erro mais completos.

## Validacao

```bash
npm run build
npm run lint
npm test
```
