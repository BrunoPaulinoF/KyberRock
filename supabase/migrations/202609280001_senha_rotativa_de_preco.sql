-- Senha rotativa de preco.
--
-- A senha que libera mudar preco deixou de ser fixa (`companies.price_change_password`, o
-- "0000"): agora e um codigo de 6 digitos que troca a cada 45 segundos, calculado a partir de
-- uma CHAVE por pedreira e do relogio (HOTP, ver `supabase/functions/_shared/price-code.ts`).
-- O comercial ve o codigo no site (acao `price_code` da `web-api`); a balanca recebe a chave
-- pelo `desktop-status` e confere o codigo sem precisar de internet.
--
-- A chave fica numa tabela SEPARADA de `companies` de proposito: `companies` e legivel por todo
-- login da empresa (RLS "loader can read own company"), e quem tivesse a chave calcularia o
-- codigo sozinho, sem pedir ao comercial. Aqui so a chave de servico le (RLS sem politica).

create table if not exists public.company_price_codes (
  company_id uuid primary key references public.companies(id) on delete cascade,
  -- 2 x 122 bits aleatorios, sem depender de extensao.
  secret text not null default (
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  ),
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

alter table public.company_price_codes enable row level security;
revoke all on public.company_price_codes from anon, authenticated;

-- Toda pedreira que ja existe ganha a sua chave.
insert into public.company_price_codes (company_id)
select id from public.companies
on conflict (company_id) do nothing;

-- E a pedreira nova nasce com ela.
create or replace function public.ensure_company_price_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.company_price_codes (company_id)
  values (new.id)
  on conflict (company_id) do nothing;
  return new;
end;
$$;

revoke all on function public.ensure_company_price_code() from public, anon, authenticated;

drop trigger if exists companies_ensure_price_code on public.companies;
create trigger companies_ensure_price_code
  after insert on public.companies
  for each row execute function public.ensure_company_price_code();
