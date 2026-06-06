# Pendencias Comerciais De Frete

## Objetivo

Listar definicoes de negocio que precisam ser fechadas antes da implementacao completa de fretes.

## Perguntas Pendentes

- O frete pode ser por conta do cliente, da pedreira ou de terceiro?
- O frete entra no preco final do produto ou fica separado?
- O calculo sera por tonelada, viagem, distancia, faixa/regiao ou valor fixo?
- Existe transportadora cadastrada no OMIE ou somente cadastro local?
- Motorista e transportadora sempre precisam estar vinculados?
- O frete aparece no cupom termico?
- O frete aparece no pedido de venda OMIE?
- O frete precisa aparecer em relatorios financeiros?
- Existe comissao, desconto ou repasse relacionado ao frete?
- Como tratar frete em operacao interna sem nota?
- Frete pode ser alterado depois da saida do caminhao?
- Frete cancelado deve gerar auditoria especifica?

## Decisoes Ja Conhecidas

- Frete faz parte do escopo do PRD.
- Regras finais ainda estao pendentes.
- A modelagem deve reservar espaco para frete desde o inicio, mesmo que alguma regra comercial fique para fase posterior.
