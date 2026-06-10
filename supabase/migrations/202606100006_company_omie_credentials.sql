alter table public.companies
  add column if not exists omie_app_key text,
  add column if not exists omie_app_secret text;

comment on column public.companies.omie_app_key is 'OMIE app key da empresa. Usado para sincronizar clientes, produtos e condicoes de pagamento.';
comment on column public.companies.omie_app_secret is 'OMIE app secret da empresa. Usado em conjunto com omie_app_key para autenticar com a API OMIE.';
