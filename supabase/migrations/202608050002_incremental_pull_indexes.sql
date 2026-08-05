-- Indices de updated_at para o pull incremental do desktop.
--
-- Todo o desenho de sincronizacao incremental (supabase/functions/desktop-pull) filtra
-- por `updated_at > <watermark>`: `byCompany()` faz isso nas 19 tabelas de cadastro e as
-- tres de historico repetem o padrao. Nao existia UM SO indice de updated_at no projeto
-- (`select ... from pg_indexes where indexdef ilike '%updated_at%'` voltava vazio), entao
-- cada pull incremental varria a tabela inteira para descobrir o que mudou -- e o pull
-- roda a cada 15s em cada balanca.
--
-- A ordem das colunas segue a ordem real do WHERE: igualdade primeiro (company_id /
-- unit_id), depois o range de updated_at.
--
-- Puramente aditivo: nenhum dado muda e nenhuma consulta existente troca de resultado.

-- Cadastro: `byCompany(table)` -> .eq("company_id", X).gt("updated_at", Y)
create index if not exists idx_customers_company_updated
  on public.customers (company_id, updated_at);

create index if not exists idx_products_company_updated
  on public.products (company_id, updated_at);

create index if not exists idx_carriers_company_updated
  on public.carriers (company_id, updated_at);

create index if not exists idx_drivers_company_updated
  on public.drivers (company_id, updated_at);

create index if not exists idx_vehicles_company_updated
  on public.vehicles (company_id, updated_at);

create index if not exists idx_customer_carriers_company_updated
  on public.customer_carriers (company_id, updated_at);

create index if not exists idx_driver_carriers_company_updated
  on public.driver_carriers (company_id, updated_at);

create index if not exists idx_vehicle_carriers_company_updated
  on public.vehicle_carriers (company_id, updated_at);

create index if not exists idx_product_default_prices_company_updated
  on public.product_default_prices (company_id, updated_at);

create index if not exists idx_customer_special_prices_company_updated
  on public.customer_special_prices (company_id, updated_at);

create index if not exists idx_price_tables_company_updated
  on public.price_tables (company_id, updated_at);

create index if not exists idx_price_table_items_company_updated
  on public.price_table_items (company_id, updated_at);

create index if not exists idx_customer_price_tables_company_updated
  on public.customer_price_tables (company_id, updated_at);

create index if not exists idx_customer_freight_rules_company_updated
  on public.customer_freight_rules (company_id, updated_at);

create index if not exists idx_payment_terms_company_updated
  on public.payment_terms (company_id, updated_at);

create index if not exists idx_payment_methods_company_updated
  on public.payment_methods (company_id, updated_at);

create index if not exists idx_accounts_company_updated
  on public.accounts (company_id, updated_at);

create index if not exists idx_customer_credit_movements_company_updated
  on public.customer_credit_movements (company_id, updated_at);

create index if not exists idx_report_recipients_company_updated
  on public.report_recipients (company_id, updated_at);

-- Historico: filtra company_id + unit_id antes do range de updated_at.
create index if not exists idx_weighing_operations_company_unit_updated
  on public.weighing_operations (company_id, unit_id, updated_at);

create index if not exists idx_loading_requests_company_unit_updated
  on public.loading_requests (company_id, unit_id, updated_at);

-- print_receipts e a excecao: o desktop-pull filtra so por unit_id.
create index if not exists idx_print_receipts_unit_updated
  on public.print_receipts (unit_id, updated_at);

-- Os FKs que o advisor de performance aponta sem indice de cobertura. Sao os mesmos
-- vinculos que o pull e os relatorios percorrem (preco por cliente, frete por cliente).
create index if not exists idx_customer_freight_rules_customer
  on public.customer_freight_rules (customer_id);

create index if not exists idx_customer_freight_rules_product
  on public.customer_freight_rules (product_id);

create index if not exists idx_customer_price_tables_customer
  on public.customer_price_tables (customer_id);

create index if not exists idx_customer_price_tables_price_table
  on public.customer_price_tables (price_table_id);

create index if not exists idx_customer_special_prices_product
  on public.customer_special_prices (product_id);

create index if not exists idx_daily_report_dispatches_unit
  on public.daily_report_dispatches (unit_id);
