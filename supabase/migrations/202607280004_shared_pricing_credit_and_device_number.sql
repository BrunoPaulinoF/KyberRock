-- Segunda parte do espelho compartilhado da pedreira:
--
-- 1) numero do computador dentro da unidade, usado como sufixo do cupom para
--    duas balancas nunca imprimirem o mesmo numero;
-- 2) tabelas de precificacao, condicoes/formas de pagamento, contas e credito
--    (fiado) que ate agora so existiam no SQLite de cada maquina.

-- ---------------------------------------------------------------------------
-- 1) Numero do computador na unidade
-- ---------------------------------------------------------------------------
alter table public.device_registrations
  add column if not exists device_number integer;

create unique index if not exists idx_device_registrations_unit_number
  on public.device_registrations(unit_id, device_number)
  where device_number is not null;

-- Atribui o menor numero livre da unidade. O lock por unidade evita que duas
-- ativacoes simultaneas peguem o mesmo numero.
create or replace function public.assign_device_number(p_device_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unit_id uuid;
  v_number integer;
begin
  select unit_id, device_number into v_unit_id, v_number
  from public.device_registrations
  where id = p_device_id;

  if v_unit_id is null then
    return null;
  end if;
  if v_number is not null then
    return v_number;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_unit_id::text));

  select coalesce(min(candidate), 1) into v_number
  from generate_series(
    1,
    (select count(*) + 1 from public.device_registrations where unit_id = v_unit_id)
  ) as candidate
  where not exists (
    select 1 from public.device_registrations d
    where d.unit_id = v_unit_id and d.device_number = candidate
  );

  update public.device_registrations
  set device_number = v_number, updated_at = now()
  where id = p_device_id;

  return v_number;
end;
$$;

revoke all on function public.assign_device_number(text) from public, anon, authenticated;
grant execute on function public.assign_device_number(text) to service_role;

-- Numero do computador que imprimiu, gravado junto do cupom para o reimpresso e
-- os relatorios mostrarem exatamente o que saiu no papel.
alter table public.print_receipts
  add column if not exists device_number integer;

-- ---------------------------------------------------------------------------
-- 2) Precificacao, pagamento, contas e credito compartilhados
-- ---------------------------------------------------------------------------
create table if not exists public.price_tables (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.price_table_items (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  price_table_id text not null references public.price_tables(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  unit_price_cents integer not null,
  unit text not null default 'ton',
  valid_from date,
  valid_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.customer_price_tables (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  price_table_id text not null references public.price_tables(id) on delete cascade,
  valid_from date,
  valid_to date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.customer_freight_rules (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  product_id text references public.products(id) on delete cascade,
  rule_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.payment_terms (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  omie_code text,
  name text not null,
  rules_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.payment_methods (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  code text not null,
  name text not null,
  omie_code text,
  is_system boolean not null default false,
  is_customer_credit boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.accounts (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  code text,
  name text not null,
  omie_code text,
  is_system boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Saldo de credito: company_id para o desktop-pull filtrar a pedreira numa
-- consulta so (a tabela e chaveada por cliente). O saldo em si nao e
-- sincronizado entre desktops — cada maquina recalcula pelo log de movimentos.
alter table public.customer_credit_balances
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

update public.customer_credit_balances b
set company_id = c.company_id
from public.customers c
where c.id = b.customer_id and b.company_id is null;

-- A operacao que originou o movimento e informativa: o log nao pode ficar preso
-- a ordem de chegada das operacoes (o historico na nuvem e limitado a janela
-- recente, e um debito nunca pode ser descartado por causa disso).
alter table public.customer_credit_movements
  drop constraint if exists customer_credit_movements_operation_id_fkey;

-- O log de movimentos passa a ter updated_at para entrar no pull incremental do
-- cadastro (o registro e imutavel: updated_at acompanha o created_at).
alter table public.customer_credit_movements
  add column if not exists updated_at timestamptz not null default now();

update public.customer_credit_movements
set updated_at = created_at
where updated_at < created_at;

create index if not exists idx_price_tables_company on public.price_tables(company_id);
create index if not exists idx_price_table_items_company on public.price_table_items(company_id);
create index if not exists idx_price_table_items_table on public.price_table_items(price_table_id);
create index if not exists idx_customer_price_tables_company on public.customer_price_tables(company_id);
create index if not exists idx_customer_freight_rules_company on public.customer_freight_rules(company_id);
create index if not exists idx_payment_terms_company on public.payment_terms(company_id);
create index if not exists idx_payment_methods_company on public.payment_methods(company_id);
create index if not exists idx_accounts_company on public.accounts(company_id);
create index if not exists idx_customer_credit_balances_company on public.customer_credit_balances(company_id);
create index if not exists idx_customer_credit_movements_company on public.customer_credit_movements(company_id);

alter table public.price_tables enable row level security;
alter table public.price_table_items enable row level security;
alter table public.customer_price_tables enable row level security;
alter table public.customer_freight_rules enable row level security;
alter table public.payment_terms enable row level security;
alter table public.payment_methods enable row level security;
alter table public.accounts enable row level security;

-- Sem policy: so as Edge Functions (service role, autenticadas por device token)
-- leem e escrevem estas tabelas. O loader-web nao precisa delas.

notify pgrst, 'reload schema';
