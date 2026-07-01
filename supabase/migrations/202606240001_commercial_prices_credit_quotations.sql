create table if not exists public.product_default_prices (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  unit_price_cents integer not null check (unit_price_cents > 0),
  unit text not null default 'ton',
  valid_from date,
  valid_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sync_version integer not null default 0
);

create table if not exists public.customer_special_prices (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  unit_price_cents integer not null check (unit_price_cents > 0),
  unit text not null default 'ton',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sync_version integer not null default 0
);

create table if not exists public.customer_credit_balances (
  customer_id text primary key references public.customers(id) on delete cascade,
  balance_cents integer not null default 0,
  omie_source_json jsonb,
  last_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_credit_movements (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  operation_id text references public.weighing_operations(id) on delete set null,
  movement_type text not null check (
    movement_type in (
      'credit',
      'debit_product',
      'debit_freight',
      'refund_product',
      'refund_freight',
      'manual_adjustment'
    )
  ),
  amount_cents integer not null,
  balance_after_cents integer not null,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.quotations (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  payment_term_id text,
  unit_price_cents integer not null check (unit_price_cents > 0),
  estimated_quantity_kg numeric not null check (estimated_quantity_kg > 0),
  notes text,
  status text not null default 'open' check (status in ('open', 'consumed', 'cancelled')),
  consumed_operation_id text references public.weighing_operations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  sync_version integer not null default 0
);

alter table public.customers
  add column if not exists credit_mode text not null default 'normal'
    check (credit_mode in ('normal', 'prepaid'));

alter table public.weighing_operations
  add column if not exists deduct_freight_from_credit boolean not null default false,
  add column if not exists product_credit_debit_cents integer not null default 0,
  add column if not exists freight_credit_debit_cents integer not null default 0,
  add column if not exists quotation_id text references public.quotations(id) on delete set null;

create unique index if not exists idx_product_default_prices_product
  on public.product_default_prices(product_id, is_active)
  where deleted_at is null;

create unique index if not exists idx_customer_special_prices_customer_product
  on public.customer_special_prices(customer_id, product_id)
  where deleted_at is null;

create index if not exists idx_customer_credit_movements_customer_created
  on public.customer_credit_movements(customer_id, created_at desc);

create index if not exists idx_quotations_customer_status
  on public.quotations(customer_id, status, created_at desc)
  where deleted_at is null;

create index if not exists idx_weighing_operations_quotation
  on public.weighing_operations(quotation_id);

alter table public.product_default_prices enable row level security;
alter table public.customer_special_prices enable row level security;
alter table public.customer_credit_balances enable row level security;
alter table public.customer_credit_movements enable row level security;
alter table public.quotations enable row level security;
