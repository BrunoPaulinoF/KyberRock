-- Os ids de pedido/OS que o OMIE devolve hoje ja passam de 11 digitos
-- (ex.: 11488908941), acima do teto de `integer` (2147483647). O upsert do
-- desktop-sync em weighing_operations passou a quebrar com
-- 22003 "value ... is out of range for type integer" em toda operacao ja
-- faturada: como o erro derruba a resposta inteira, `cloud_synced_at` nunca
-- avancava no desktop e a reconciliacao reenviava a mesma operacao a cada
-- sincronizacao, para sempre.
--
-- `customers.salesperson_id` guarda o `codigo_vendedor`, id da mesma faixa do
-- OMIE, e cai no mesmo problema assim que um vendedor novo for cadastrado.
--
-- Os ids do OMIE ja sao bigint em customers.omie_customer_id,
-- carriers.omie_customer_id e products.omie_product_id (202606260002).
alter table public.weighing_operations
  alter column omie_sales_order_id type bigint,
  alter column omie_service_order_id type bigint;

alter table public.customers
  alter column salesperson_id type bigint;
