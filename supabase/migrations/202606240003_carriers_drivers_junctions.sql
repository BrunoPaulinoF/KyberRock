-- Carriers, drivers, vehicles and N:M junction tables for cloud sync

create table if not exists public.carriers (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  omie_customer_id integer,
  name text not null,
  document text,
  source text not null default 'local' check (source in ('omie', 'local')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.drivers (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  document text,
  phone text,
  is_independent boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  plate text not null,
  description text,
  carrier_id text references public.carriers(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_carriers (
  id text primary key,
  customer_id text not null references public.customers(id) on delete cascade,
  carrier_id text not null references public.carriers(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, carrier_id)
);

create table if not exists public.driver_carriers (
  id text primary key,
  driver_id text not null references public.drivers(id) on delete cascade,
  carrier_id text not null references public.carriers(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, carrier_id)
);

create index if not exists idx_carriers_company on public.carriers(company_id);
create index if not exists idx_drivers_company on public.drivers(company_id);
create index if not exists idx_vehicles_company on public.vehicles(company_id);
create index if not exists idx_vehicles_carrier on public.vehicles(carrier_id);
create index if not exists idx_customer_carriers_customer on public.customer_carriers(customer_id);
create index if not exists idx_customer_carriers_carrier on public.customer_carriers(carrier_id);
create index if not exists idx_driver_carriers_driver on public.driver_carriers(driver_id);
create index if not exists idx_driver_carriers_carrier on public.driver_carriers(carrier_id);

alter table public.carriers enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.customer_carriers enable row level security;
alter table public.driver_carriers enable row level security;

create policy "loader can read carriers from own company"
  on public.carriers for select
  to authenticated
  using (exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.company_id = carriers.company_id and p.is_active = true));

create policy "loader can read drivers from own company"
  on public.drivers for select
  to authenticated
  using (exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.company_id = drivers.company_id and p.is_active = true));

create policy "loader can read vehicles from own company"
  on public.vehicles for select
  to authenticated
  using (exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.company_id = vehicles.company_id and p.is_active = true));

create policy "loader can read customer_carriers from own company"
  on public.customer_carriers for select
  to authenticated
  using (exists (
    select 1 from public.user_profiles p
    join public.customers c on c.company_id = p.company_id
    where p.id = auth.uid() and c.id = customer_carriers.customer_id and p.is_active = true
  ));

create policy "loader can read driver_carriers from own company"
  on public.driver_carriers for select
  to authenticated
  using (exists (
    select 1 from public.user_profiles p
    join public.drivers d on d.company_id = p.company_id
    where p.id = auth.uid() and d.id = driver_carriers.driver_id and p.is_active = true
  ));
