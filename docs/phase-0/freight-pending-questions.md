# Decisoes Comerciais De Frete

## Objetivo

Registrar as definicoes de negocio recebidas para orientar a modelagem inicial de fretes.

## Respostas Recebidas

- O frete pode ser por conta do cliente, da pedreira ou de terceiro.
- O frete fica separado do preco do produto.
- O calculo deve considerar distancia e peso.
- A transportadora deve vir do OMIE.
- Ainda nao esta definido se motorista e transportadora sempre precisam estar vinculados.
- O frete aparece no cupom termico.
- O frete aparece no pedido de venda OMIE.
- O frete aparece nos relatorios financeiros.
- Nao existe comissao, desconto ou repasse relacionado ao frete.
- Em operacao interna sem nota, o frete deve ser tratado da mesma forma.
- O frete pode ser alterado depois da saida do caminhao.
- Cancelamento de frete nao precisa de auditoria especifica alem da auditoria padrao da operacao.

## Decisoes Ja Conhecidas

- Frete faz parte do escopo do PRD.
- A modelagem deve reservar espaco para frete desde o inicio.
- Frete deve ser entidade/campos separados do produto.
- Relatorios devem separar produto, frete e total.
- Integracao OMIE deve prever envio de frete junto ao pedido quando aplicavel.
- Alteracao de frete depois da saida deve gerar auditoria padrao da operacao.

## Pendencias Restantes

- Definir se motorista e transportadora sempre precisam estar vinculados.
- Definir formula exata de calculo por distancia e peso.
- Definir origem da distancia: cadastro de destino, tabela, digitacao operacional, geolocalizacao futura ou outro criterio.
- Confirmar no OMIE o formato correto para enviar frete no pedido de venda.
