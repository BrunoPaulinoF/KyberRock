-- Completa os indices de FK que faltaram na 202608050002.
--
-- Aquela migracao dizia cobrir "os FKs que o advisor de performance aponta sem indice de
-- cobertura", mas cobriu 6 dos 10: sobraram o de price_table_items e os tres de quotations.
-- Sem indice, um DELETE/UPDATE na tabela referenciada varre a tabela filha inteira para
-- validar a FK.
--
-- Puramente aditivo, e as duas tabelas estao praticamente vazias hoje.

create index if not exists idx_price_table_items_product
  on public.price_table_items (product_id);

create index if not exists idx_quotations_company
  on public.quotations (company_id);

create index if not exists idx_quotations_consumed_operation
  on public.quotations (consumed_operation_id);

create index if not exists idx_quotations_product
  on public.quotations (product_id);
