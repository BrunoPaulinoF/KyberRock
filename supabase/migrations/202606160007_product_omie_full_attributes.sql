alter table public.products
  add column if not exists family_code text,
  add column if not exists family_description text,
  add column if not exists brand text,
  add column if not exists model text,
  add column if not exists detailed_description text,
  add column if not exists internal_notes text,
  add column if not exists ncm text,
  add column if not exists ean text,
  add column if not exists unit_price_cents integer,
  add column if not exists gross_weight_kg numeric,
  add column if not exists net_weight_kg numeric,
  add column if not exists height_m numeric,
  add column if not exists width_m numeric,
  add column if not exists depth_m numeric,
  add column if not exists cest text,
  add column if not exists item_type text,
  add column if not exists icms_origin text,
  add column if not exists blocked boolean not null default false,
  add column if not exists omie_integration_code text,
  add column if not exists fiscal_recommendations_json jsonb,
  add column if not exists updated_from_omie_at timestamptz;

create index if not exists idx_products_company_family on public.products(company_id, family_code);
create index if not exists idx_products_company_brand on public.products(company_id, brand);
create index if not exists idx_products_company_ncm on public.products(company_id, ncm);
create index if not exists idx_products_company_active on public.products(company_id, is_active);
create index if not exists idx_products_company_omie on public.products(company_id, omie_product_id);

comment on column public.products.family_code is 'Codigo da familia do produto no OMIE (codigo_familia).';
comment on column public.products.family_description is 'Descricao da familia do produto no OMIE (descricao_familia).';
comment on column public.products.brand is 'Marca do produto (marca no OMIE).';
comment on column public.products.model is 'Modelo do produto (modelo no OMIE).';
comment on column public.products.detailed_description is 'Descricao detalhada/extensa do produto (descr_detalhada no OMIE).';
comment on column public.products.internal_notes is 'Observacoes internas do produto (obs_internas no OMIE).';
comment on column public.products.gross_weight_kg is 'Peso bruto em quilogramas (peso_bruto no OMIE).';
comment on column public.products.net_weight_kg is 'Peso liquido em quilogramas (peso_liq no OMIE).';
comment on column public.products.height_m is 'Altura em metros (altura no OMIE).';
comment on column public.products.width_m is 'Largura em metros (largura no OMIE).';
comment on column public.products.depth_m is 'Profundidade em metros (profundidade no OMIE).';
comment on column public.products.cest is 'Codigo CEST do produto.';
comment on column public.products.item_type is 'Tipo de item (tipoItem no OMIE).';
comment on column public.products.icms_origin is 'Origem da mercadoria para ICMS (origem_mercadoria no OMIE).';
comment on column public.products.blocked is 'Produto bloqueado no OMIE (bloqueado=S).';
comment on column public.products.omie_integration_code is 'Codigo de integracao do produto no OMIE (codigo_produto_integracao).';
comment on column public.products.fiscal_recommendations_json is 'Recomendacoes fiscais retornadas pelo OMIE (recomendacoes_fiscais).';
comment on column public.products.updated_from_omie_at is 'Timestamp do ultimo pull bem sucedido a partir do OMIE.';
