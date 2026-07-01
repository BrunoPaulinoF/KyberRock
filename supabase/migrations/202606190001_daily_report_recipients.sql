create table if not exists public.report_recipients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  display_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, email)
);

create index if not exists idx_report_recipients_company on public.report_recipients(company_id);

alter table public.report_recipients enable row level security;

create policy "no direct client access"
  on public.report_recipients for all
  to anon, authenticated
  using (false)
  with check (false);

create table if not exists public.daily_report_dispatches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  report_date date not null,
  recipients_count integer not null,
  status text not null check (status in ('sent', 'partial', 'failed')),
  last_error text,
  dispatched_at timestamptz not null default now()
);

create index if not exists idx_daily_report_dispatches_company_date
  on public.daily_report_dispatches(company_id, report_date desc);

alter table public.daily_report_dispatches enable row level security;

create policy "no direct client access"
  on public.daily_report_dispatches for all
  to anon, authenticated
  using (false)
  with check (false);
