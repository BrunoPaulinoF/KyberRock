-- Regra de frete da operacao (`freight_json`) na projecao da nuvem.
--
-- O desktop guarda em `weighing_operations.freight_json` a REGRA de calculo do frete
-- (tipo por tonelada / tonelada-km / fixo + tonelada, valor base, valor fixo, minimo,
-- distancia, destino e responsavel). E dela que o fechamento tira `freight_total_cents`,
-- porque o frete so pode ser calculado quando o peso liquido existe — na saida.
--
-- A coluna nunca foi projetada, e o pull do desktop grava `freight_json` com o que a
-- nuvem devolve: como a nuvem nao tinha a coluna, todo pull apagava a regra da operacao
-- AINDA ABERTA. No fechamento nao sobrava regra para calcular, o frete fechava em zero e
-- a operacao saia sem valor de frete no cupom e sem `valor_frete` no pedido do OMIE.
--
-- Projetar a regra tambem e o que permite a saida ser pesada em OUTRA balanca da
-- pedreira: sem ela, a segunda maquina fecharia a operacao sem saber cobrar o frete.

alter table public.weighing_operations
  add column if not exists freight_json text;

comment on column public.weighing_operations.freight_json is
  'Regra de calculo do frete da operacao (JSON: payer, rule, destination, showOnReceipt). O valor em reais so existe apos a saida, em freight_total_cents.';
