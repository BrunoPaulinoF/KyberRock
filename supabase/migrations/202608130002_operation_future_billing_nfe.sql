-- Nota de entrega futura que a pesagem entregou, na projecao da nuvem.
--
-- O numero e resolvido no cadastro do cliente (por produto) e CONGELADO no fechamento da
-- pesagem, porque ele vira texto de documento: vai para os dados adicionais da NF-e no
-- OMIE e para o cupom impresso, e os dois tem de concordar para sempre. Trocar a nota no
-- cadastro depois nao pode reescrever o que ja foi entregue.
--
-- Projetar a coluna e o que permite a 2a via sair em OUTRA balanca da pedreira citando a
-- mesma nota. Sem ela, a segunda maquina reimprimiria o cupom sem a referencia que a NF-e
-- ja carrega — justamente a divergencia que congelar o numero existe para evitar.
--
-- Null e o caso comum: pesagem que nao entregou entrega futura nenhuma.

alter table public.weighing_operations
  add column if not exists future_billing_nfe_number text;

comment on column public.weighing_operations.future_billing_nfe_number is
  'Numero da NF-e de venda para entrega futura que esta carga entregou, congelado no fechamento. Sai nos dados adicionais do pedido no OMIE e no cupom.';

notify pgrst, 'reload schema';
