alter table public.customers
  add column if not exists omie_integration_code text,
  add column if not exists state_registration text,
  add column if not exists municipal_registration text,
  add column if not exists is_individual boolean not null default false,
  add column if not exists homepage text,
  add column if not exists contact_name text,
  add column if not exists phone_secondary text,
  add column if not exists ibge_city_code text,
  add column if not exists ibge_state_code text,
  add column if not exists country text,
  add column if not exists country_code text,
  add column if not exists customer_type text,
  add column if not exists is_foreign boolean not null default false,
  add column if not exists tags_json jsonb,
  add column if not exists salesperson_id integer,
  add column if not exists observations text,
  add column if not exists omie_billing_blocked boolean not null default false,
  add column if not exists default_payment_term_id text,
  add column if not exists zipcode text,
  add column if not exists address_street text,
  add column if not exists address_number text,
  add column if not exists address_complement text,
  add column if not exists neighborhood text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists last_synced_at timestamptz,
  add column if not exists omie_updated_at timestamptz;

alter table public.products
  add column if not exists tracks_stock boolean not null default true;

create index if not exists idx_customers_company_ibge on public.customers(company_id, ibge_city_code);
create index if not exists idx_customers_company_state_reg on public.customers(company_id, state_registration);
create index if not exists idx_customers_company_salesperson on public.customers(company_id, salesperson_id);
create index if not exists idx_customers_company_active on public.customers(company_id, is_active);
create index if not exists idx_products_company_tracks_stock on public.products(company_id, tracks_stock);

comment on column public.customers.omie_integration_code is 'Codigo de integracao do cliente no OMIE (codigo_cliente_integracao).';
comment on column public.customers.state_registration is 'Inscricao Estadual (inscricao_estadual no OMIE).';
comment on column public.customers.municipal_registration is 'Inscricao Municipal (inscricao_municipal no OMIE).';
comment on column public.customers.is_individual is 'Pessoa fisica (pessoa_fisica=S no OMIE).';
comment on column public.customers.homepage is 'Site/homepage do cliente.';
comment on column public.customers.contact_name is 'Nome do contato principal do cliente (contato no OMIE).';
comment on column public.customers.phone_secondary is 'Telefone secundario (telefone2 no OMIE).';
comment on column public.customers.ibge_city_code is 'Codigo IBGE da cidade.';
comment on column public.customers.ibge_state_code is 'Codigo IBGE do estado.';
comment on column public.customers.country is 'Pais.';
comment on column public.customers.country_code is 'Codigo do pais.';
comment on column public.customers.customer_type is 'Tipo no OMIE (C=cliente, F=fornecedor, CF=ambos).';
comment on column public.customers.is_foreign is 'Cliente exterior (exterior=S no OMIE).';
comment on column public.customers.tags_json is 'Tags do cliente no OMIE.';
comment on column public.customers.salesperson_id is 'Codigo do vendedor responsavel (codigo_vendedor no OMIE).';
comment on column public.products.tracks_stock is 'Movimenta estoque (oposto de nao_movimentar_estoque=S no OMIE).';
