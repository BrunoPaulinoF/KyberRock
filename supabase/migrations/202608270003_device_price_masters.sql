-- Mais de uma balanca principal de precos por pedreira.
--
-- A migracao 202608270001 deu dono ao cadastro de preco e limitou o dono a UMA balanca por
-- empresa, via indice unico parcial. Na pedreira isso e apertado demais: quem cadastra
-- preco costuma ser mais de um posto (a balanca da portaria e a do escritorio, por
-- exemplo), e obrigar a eleger um so transforma cada cadastro de preco numa ida ate a outra
-- maquina.
--
-- O indice sai; a coluna fica. O que muda e so quantas balancas podem publicar preco — o
-- resto do combinado continua: quem nao e principal nao publica preco e espelha o que as
-- principais publicam.
--
-- Duas principais so nao se derrubam porque o criterio de desempate deixou de ser "quem
-- publica por ultimo" e passou a ser QUEM EDITOU por ultimo (`updated_at` da propria linha,
-- empate no maior id) — ver `_shared/price-master-conflicts.ts`. Com o criterio antigo, o
-- par disputado ficaria oscilando entre os dois valores em todas as balancas a cada ciclo
-- de sync; com o novo, as duas pontas chegam a mesma conclusao seja qual for a ordem em que
-- sincronizam.
--
-- Nenhum dado se perde: quem ja tinha uma principal eleita continua com ela, agora sem a
-- restricao de ser a unica.

drop index if exists public.idx_device_registrations_price_master;

comment on column public.device_registrations.is_price_master is
  'Balanca principal de precos da pedreira: publica preco padrao, preco especial por cliente, tabelas de preco e valor de frete do cadastro. Pode haver mais de uma por empresa — entre principais vence quem editou a linha por ultimo. As demais balancas espelham o que as principais publicam. Definido no painel administrativo e entregue ao desktop pelo desktop-status.';

notify pgrst, 'reload schema';
