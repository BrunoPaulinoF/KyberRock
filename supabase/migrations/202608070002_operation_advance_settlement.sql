-- Venda em carteira abatida do adiantamento do cliente, compartilhada entre as balancas.
--
-- O cliente paga adiantado na pedreira, o financeiro lanca o dinheiro no OMIE como
-- adiantamento e ele vai retirando material aos poucos. Na balanca a venda continua
-- sendo "Em carteira"; o que muda e a marca `settle_from_advance`, escolhida na entrada,
-- que manda o fechamento abater a compra do adiantamento que sobrou.
--
-- As duas colunas precisam viajar pela nuvem porque a pedreira tem mais de uma balanca:
-- a marca antes do fechamento (a saida pode ser pesada no outro computador) e o valor
-- abatido depois dele (senao a Carteira da outra maquina mostra a venda inteira a
-- receber e o proximo fechamento reserva de novo um adiantamento ja consumido).
--
-- Sem NOT NULL e sem default: as operacoes ja projetadas nasceram antes das colunas e
-- recebem os valores no proximo push do desktop.
alter table public.weighing_operations
  add column if not exists settle_from_advance boolean,
  add column if not exists omie_advance_settle_cents integer;
