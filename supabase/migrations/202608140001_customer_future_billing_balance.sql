-- Saldo da nota de venda para entrega futura na projecao da nuvem.
--
-- A nota de faturamento (CFOP 5.922/6.922) e emitida por uma QUANTIDADE, e o cliente vai
-- retirando aquilo caminhao a caminhao. `total_weight_kg` e esse total em quilos — a mesma
-- unidade de `weighing_operations.net_weight_kg`, para o saldo ser uma subtracao e nao uma
-- conversao. Quanto ja saiu nao e coluna: e a soma do peso liquido das pesagens que citaram
-- a nota, recalculada em cada balanca a partir do que a nuvem devolve (mesma escolha do
-- saldo de credito do cliente, que tambem vive do log e nao de um contador projetado).
--
-- Projetar o total e o que faz o saldo bater nas DUAS balancas da pedreira: as pesagens ja
-- atravessam a nuvem, entao sem o total do outro lado a segunda maquina somaria retiradas
-- contra um teto que ela nao conhece. Nulo = nota sem controle de saldo (como fica toda nota
-- cadastrada antes desta migracao).

alter table public.customer_future_billing_invoices
  add column if not exists total_weight_kg numeric;

comment on column public.customer_future_billing_invoices.total_weight_kg is
  'Quantidade faturada na NF-e de entrega futura, em quilos. Null = nota sem controle de saldo.';

-- Uma unica nota vigente por (cliente, produto) deixa de valer: quem esgota a nota de 500 t
-- abre outra para o mesmo produto, e as duas convivem — a esgotada como historico do que ja
-- foi entregue, a nova como a que carimba as proximas pesagens. Continua unica a MESMA nota
-- repetida no mesmo par, que e erro de digitacao. Os indices espelham exatamente os do
-- SQLite (migracao local 54); sem isso a nuvem aceitaria o que a balanca recusa e a
-- divergencia so apareceria quando as duas maquinas faturassem o mesmo cliente.
drop index if exists public.idx_customer_future_billing_customer_product;
drop index if exists public.idx_customer_future_billing_customer_default;

create unique index if not exists idx_customer_future_billing_product_nfe
  on public.customer_future_billing_invoices(customer_id, product_id, nfe_number)
  where deleted_at is null and product_id is not null;

create unique index if not exists idx_customer_future_billing_default_nfe
  on public.customer_future_billing_invoices(customer_id, nfe_number)
  where deleted_at is null and product_id is null;

notify pgrst, 'reload schema';
