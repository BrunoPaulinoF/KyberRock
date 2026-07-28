-- Espelho compartilhado do cadastro da pedreira.
--
-- Todo desktop da mesma pedreira precisa enxergar exatamente o mesmo cadastro
-- (transportadoras, motoristas, veiculos, vinculos e precos). As tabelas de
-- carriers/drivers/vehicles e as juncoes ja existiam no repositorio
-- (202606240003), mas projetos que nao aplicaram aquela migracao respondem
-- "Could not find the table 'public.customer_carriers' in the schema cache" no
-- desktop. Este arquivo e idempotente: recria o que faltar, adiciona a coluna
-- company_id nas juncoes (para o desktop-pull filtrar por empresa numa unica
-- consulta) e cria vehicle_carriers, que so existia no SQLite local.

create table if not exists public.carriers (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  omie_customer_id bigint,
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

create table if not exists public.vehicle_carriers (
  id text primary key,
  company_id uuid references public.companies(id) on delete cascade,
  vehicle_id text not null references public.vehicles(id) on delete cascade,
  carrier_id text not null references public.carriers(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vehicle_id, carrier_id)
);

-- company_id nas juncoes: o desktop-pull filtra o espelho da pedreira por
-- empresa. Sem ela seria preciso listar todos os ids de clientes/motoristas na
-- consulta, o que estoura a URL do PostgREST em bases grandes.
alter table public.customer_carriers add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.driver_carriers add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.vehicle_carriers add column if not exists company_id uuid references public.companies(id) on delete cascade;

update public.customer_carriers cc
set company_id = c.company_id
from public.customers c
where c.id = cc.customer_id and cc.company_id is null;

update public.driver_carriers dc
set company_id = d.company_id
from public.drivers d
where d.id = dc.driver_id and dc.company_id is null;

update public.vehicle_carriers vc
set company_id = v.company_id
from public.vehicles v
where v.id = vc.vehicle_id and vc.company_id is null;

create index if not exists idx_carriers_company on public.carriers(company_id);
create index if not exists idx_drivers_company on public.drivers(company_id);
create index if not exists idx_vehicles_company on public.vehicles(company_id);
create index if not exists idx_vehicles_carrier on public.vehicles(carrier_id);
create index if not exists idx_customer_carriers_customer on public.customer_carriers(customer_id);
create index if not exists idx_customer_carriers_carrier on public.customer_carriers(carrier_id);
create index if not exists idx_customer_carriers_company on public.customer_carriers(company_id);
create index if not exists idx_driver_carriers_driver on public.driver_carriers(driver_id);
create index if not exists idx_driver_carriers_carrier on public.driver_carriers(carrier_id);
create index if not exists idx_driver_carriers_company on public.driver_carriers(company_id);
create index if not exists idx_vehicle_carriers_vehicle on public.vehicle_carriers(vehicle_id);
create index if not exists idx_vehicle_carriers_carrier on public.vehicle_carriers(carrier_id);
create index if not exists idx_vehicle_carriers_company on public.vehicle_carriers(company_id);
create index if not exists idx_product_default_prices_company on public.product_default_prices(company_id);
create index if not exists idx_customer_special_prices_company on public.customer_special_prices(company_id);

alter table public.carriers enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.customer_carriers enable row level security;
alter table public.driver_carriers enable row level security;
alter table public.vehicle_carriers enable row level security;

-- O desktop le e escreve estas tabelas apenas pelas Edge Functions
-- (service role, autenticado por device token). O loader-web autenticado
-- continua com leitura da propria empresa.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'carriers'
      and policyname = 'loader can read carriers from own company'
  ) then
    create policy "loader can read carriers from own company"
      on public.carriers for select
      to authenticated
      using (exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.company_id = carriers.company_id and p.is_active = true));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'drivers'
      and policyname = 'loader can read drivers from own company'
  ) then
    create policy "loader can read drivers from own company"
      on public.drivers for select
      to authenticated
      using (exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.company_id = drivers.company_id and p.is_active = true));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vehicles'
      and policyname = 'loader can read vehicles from own company'
  ) then
    create policy "loader can read vehicles from own company"
      on public.vehicles for select
      to authenticated
      using (exists (select 1 from public.user_profiles p where p.id = auth.uid() and p.company_id = vehicles.company_id and p.is_active = true));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'customer_carriers'
      and policyname = 'loader can read customer_carriers from own company'
  ) then
    create policy "loader can read customer_carriers from own company"
      on public.customer_carriers for select
      to authenticated
      using (exists (
        select 1 from public.user_profiles p
        join public.customers c on c.company_id = p.company_id
        where p.id = auth.uid() and c.id = customer_carriers.customer_id and p.is_active = true
      ));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'driver_carriers'
      and policyname = 'loader can read driver_carriers from own company'
  ) then
    create policy "loader can read driver_carriers from own company"
      on public.driver_carriers for select
      to authenticated
      using (exists (
        select 1 from public.user_profiles p
        join public.drivers d on d.company_id = p.company_id
        where p.id = auth.uid() and d.id = driver_carriers.driver_id and p.is_active = true
      ));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vehicle_carriers'
      and policyname = 'loader can read vehicle_carriers from own company'
  ) then
    create policy "loader can read vehicle_carriers from own company"
      on public.vehicle_carriers for select
      to authenticated
      using (exists (
        select 1 from public.user_profiles p
        where p.id = auth.uid() and p.company_id = vehicle_carriers.company_id and p.is_active = true
      ));
  end if;
end
$$;

-- Recarrega o cache de schema do PostgREST para as tabelas novas aparecerem
-- imediatamente (o erro "in the schema cache" vem justamente desse cache).
notify pgrst, 'reload schema';
