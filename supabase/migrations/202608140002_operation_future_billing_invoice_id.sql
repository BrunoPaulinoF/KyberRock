-- QUAL nota de entrega futura a carga baixou, na projecao da nuvem.
--
-- `future_billing_nfe_number` (migracao 202608130002) guarda o NUMERO, que e o que vira
-- texto do documento. Este id guarda a LINHA do cadastro, que e o que baixa o saldo dela: o
-- mesmo cliente pode ter a nota 500 do rachao e a nota 500 da brita, de series diferentes, e
-- somar a retirada na linha errada zeraria a nota que ainda tem carga para entregar.
--
-- Projetar o vinculo e o que faz o saldo bater nas duas balancas da pedreira: a retirada que
-- a outra maquina fechou so entra na conta desta quando a pesagem volta pelo pull sabendo de
-- qual nota ela saiu.
--
-- Sem chave estrangeira de proposito. A coluna e RETRATO, congelado no fechamento: se a nota
-- for removida do cadastro (que e como a pedreira encerra a entrega futura), a pesagem ja
-- entregue continua declarando de onde ela saiu, e um `on delete set null` apagaria
-- justamente o historico. Null = pesagem que nao entregou entrega futura nenhuma, ou pesagem
-- anterior a esta versao (nessas o saldo e recuperado pelo numero congelado).

alter table public.weighing_operations
  add column if not exists future_billing_invoice_id text;

comment on column public.weighing_operations.future_billing_invoice_id is
  'Nota de entrega futura (customer_future_billing_invoices.id) que esta carga baixou, congelada no fechamento. E dela que sai o saldo do quadro no cadastro do cliente.';

create index if not exists idx_weighing_operations_future_billing_invoice
  on public.weighing_operations(future_billing_invoice_id)
  where future_billing_invoice_id is not null;

notify pgrst, 'reload schema';
