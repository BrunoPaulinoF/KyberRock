create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text not null,
  document text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  timezone text not null default 'America/Sao_Paulo',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  role text not null check (role in ('loader')),
  company_id uuid not null references public.companies(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.device_registrations (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  name text not null,
  token_hash text not null,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  omie_customer_id integer,
  legal_name text not null,
  trade_name text not null,
  document text,
  phone text,
  email text,
  credit_limit_cents integer,
  open_receivables_cents integer not null default 0,
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  omie_product_id integer,
  code text not null,
  description text not null,
  unit text not null default 'KG',
  is_active boolean not null default true,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.weighing_operations (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  device_id text references public.device_registrations(id) on delete set null,
  status text not null,
  operation_type text not null,
  customer_id text references public.customers(id) on delete set null,
  product_id text references public.products(id) on delete set null,
  payment_term_id text,
  plate text,
  customer_name text,
  driver_name text,
  product_description text,
  entry_weight_kg numeric,
  exit_weight_kg numeric,
  net_weight_kg numeric,
  unit_price_cents integer,
  product_total_cents integer,
  freight_total_cents integer not null default 0,
  total_cents integer,
  omie_sales_order_id integer,
  omie_service_order_id integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  synced_at timestamptz
);

create table if not exists public.loading_requests (
  id text primary key,
  operation_id text not null references public.weighing_operations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  status text not null,
  plate text not null,
  customer_name text not null,
  driver_name text not null,
  product_description text not null,
  entry_weight_kg numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.print_receipts (
  id text primary key,
  operation_id text not null references public.weighing_operations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  receipt_number integer not null,
  copy_number integer not null default 1,
  status text not null,
  printer_name text,
  printed_at timestamptz,
  error_message text,
  content_snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  unit_id uuid references public.units(id) on delete set null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  before_json jsonb,
  after_json jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_units_company on public.units(company_id);
create index if not exists idx_user_profiles_unit on public.user_profiles(unit_id);
create index if not exists idx_loading_requests_unit_status on public.loading_requests(unit_id, status, created_at desc);
create index if not exists idx_weighing_operations_company_unit on public.weighing_operations(company_id, unit_id, created_at desc);

alter table public.companies enable row level security;
alter table public.units enable row level security;
alter table public.user_profiles enable row level security;
alter table public.device_registrations enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.weighing_operations enable row level security;
alter table public.loading_requests enable row level security;
alter table public.print_receipts enable row level security;
alter table public.audit_logs enable row level security;

create policy "loader can read own profile"
  on public.user_profiles for select
  to authenticated
  using (id = auth.uid() and is_active = true);

create policy "loader can read own company"
  on public.companies for select
  to authenticated
  using (exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.company_id = companies.id and p.is_active = true));

create policy "loader can read own unit"
  on public.units for select
  to authenticated
  using (exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.unit_id = units.id and p.is_active = true));

create policy "loader can read open loading requests from own unit"
  on public.loading_requests for select
  to authenticated
  using (
    status = 'open'
    and exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.unit_id = loading_requests.unit_id and p.is_active = true)
  );

create policy "loader can read open operations from own unit"
  on public.weighing_operations for select
  to authenticated
  using (
    status = 'open'
    and exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.unit_id = weighing_operations.unit_id and p.is_active = true)
  );
