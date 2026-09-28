-- Historico das alteracoes de preco especial de cliente, para o comercial ver na tela dele.
--
-- A balanca passou a exigir a senha rotativa do comercial para adicionar, trocar ou excluir
-- preco especial (`services/runtime.ts`), e o comercial precisa enxergar o que foi feito com a
-- senha que ele passou. Cada alteracao vira UMA linha aqui, gravada por quem FEZ a alteracao:
--
--   - a balanca, no momento do salvamento (local primeiro, sobe pelo `desktop-sync` com a chave
--     `priceChangeLog`, que carimba empresa, unidade e dispositivo pelo token);
--   - o site, pela `web-api`, com o nome do usuario logado.
--
-- ## Por que registro explicito, e nao gatilho em `customer_special_prices`
--
-- A tabela de preco muda por motivos que NAO sao alteracao de preco: a disputa entre balancas
-- principais aposenta a linha que perdeu e grava a que ganhou (`_shared/price-master-conflicts`),
-- a principal republica tudo quando e eleita, a unificacao de clientes troca o dono. Um gatilho
-- veria "removido" e "adicionado" em cada um desses casos. Quem sabe que houve uma alteracao de
-- verdade e quem a fez.
--
-- ## Imutavel
--
-- O `desktop-sync` grava com `ignoreDuplicates`: reenviar o mesmo lote nao reescreve nada, e uma
-- balanca nao consegue editar a linha de outra reaproveitando o id. Cliente nenhum escreve direto.

create table if not exists public.price_change_log (
  id text primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  unit_id uuid references public.units (id) on delete set null,
  -- Quem fez: a balanca (dispositivo) ou o usuario do site.
  device_id text references public.device_registrations (id) on delete set null,
  user_id uuid,
  author_name text,
  source text not null check (source in ('balanca', 'site')),
  kind text not null default 'preco_especial' check (kind in ('preco_especial')),
  action text not null check (action in ('adicionado', 'alterado', 'removido')),
  -- Copia do nome na hora da alteracao: o historico continua legivel se o cadastro mudar.
  customer_id text,
  customer_name text,
  product_id text,
  product_description text,
  old_price_cents integer,
  new_price_cents integer,
  changed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.price_change_log is
  'Historico imutavel das alteracoes de preco especial de cliente (balanca e site). Lido pelo comercial no site.';

create index if not exists idx_price_change_log_company_changed
  on public.price_change_log (company_id, changed_at desc);

-- O nome de quem fez, quando foi a balanca, e sempre o nome do dispositivo no painel — nao o que
-- o payload disser.
create or replace function public.price_change_log_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  device_name text;
begin
  if new.device_id is not null then
    select d.name into device_name
      from public.device_registrations d
     where d.id = new.device_id;
    new.author_name := coalesce(nullif(trim(device_name), ''), new.author_name);
  end if;
  return new;
end;
$$;

revoke execute on function public.price_change_log_author() from public, anon, authenticated;

drop trigger if exists price_change_log_author on public.price_change_log;
create trigger price_change_log_author
  before insert on public.price_change_log
  for each row
  execute function public.price_change_log_author();

alter table public.price_change_log enable row level security;

drop policy if exists "no direct client access" on public.price_change_log;
create policy "no direct client access"
  on public.price_change_log for all
  to anon, authenticated
  using (false);

drop policy if exists "web users read own company price change log" on public.price_change_log;
create policy "web users read own company price change log"
  on public.price_change_log for select
  to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.id = (select auth.uid())
        and p.role in ('comercial', 'gestor', 'operacao', 'administrador')
        and p.company_id = price_change_log.company_id
        and p.is_active = true
    )
  );

revoke all on public.price_change_log from anon, authenticated;
grant select on public.price_change_log to authenticated;

-- A tela do comercial atualiza na hora: o mesmo aviso de cadastro (`cadastro_change_pings`),
-- com `source = 'price_change_log'`.
drop trigger if exists ping_cadastro_change_insert on public.price_change_log;
create trigger ping_cadastro_change_insert
  after insert on public.price_change_log
  referencing new table as new_rows
  for each statement
  execute function public.ping_cadastro_change();

notify pgrst, 'reload schema';
