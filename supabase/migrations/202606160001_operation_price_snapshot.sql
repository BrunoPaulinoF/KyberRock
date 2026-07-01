alter table public.weighing_operations
  add column if not exists base_unit_price_cents integer,
  add column if not exists applied_price_table_id text,
  add column if not exists applied_price_table_name text,
  add column if not exists applied_price_table_item_id text,
  add column if not exists price_unit text not null default 'ton',
  add column if not exists price_savings_percent numeric,
  add column if not exists cancel_reason text;

create index if not exists idx_weighing_operations_price_table
  on public.weighing_operations(applied_price_table_id);
