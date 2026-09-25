-- Perfis por tela no KyberRock Web + o aviso que deixa o Monitoramento em tempo real.
--
-- Contexto: `docs/plano-migracao-web.md` e `apps/web/src/lib/permissions.ts`. Cada perfil do
-- site passa a ver um conjunto FECHADO de telas (o que nao e dele nem aparece):
--
--   - `monitoramento` so o painel de vendas em tempo real (tela Monitoramento);
--   - `comercial`     insights, conferencia de faturamento, relatorios, controle de caminhoes,
--                     relatorio por cliente e cadastros — cadastra tudo e muda preco sem senha;
--   - `gestor`        tudo, menos a Nova entrada;
--   - `operacao`      tudo; mudar preco SEMPRE pede a senha da pedreira;
--   - `administrador` tudo, sem senha, mais os logs de suporte (novo).
--
-- O que cada um GRAVA continua decidido na `web-api` (`_shared/web-session.ts`); aqui so entra o
-- perfil novo e a leitura dele.

-- 1) O perfil novo.
alter table public.user_profiles
  drop constraint if exists user_profiles_role_check;

alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role in ('loader', 'monitoramento', 'comercial', 'gestor', 'operacao', 'administrador'));

-- 2) Leitura da empresa para os cinco perfis do site. Mesmo laco da `202609240001`: percorre o
-- catalogo para nenhuma politica "web users can read ..." ficar com a lista antiga (inclui
-- `operation_requests`, `billing_requests`, `weighing_operations` e `units`).
do $$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname like 'web users can read %'
  loop
    execute format('drop policy if exists %I on public.%I', policy_row.policyname, policy_row.tablename);
    execute format(
      'create policy %I on public.%I for select to authenticated using ('
      || 'exists (select 1 from public.user_profiles p '
      || 'where p.id = (select auth.uid()) '
      || 'and p.role in (''monitoramento'', ''comercial'', ''gestor'', ''operacao'', ''administrador'') '
      || 'and p.company_id = %I.company_id '
      || 'and p.is_active = true))',
      policy_row.policyname,
      policy_row.tablename,
      policy_row.tablename
    );
  end loop;
end;
$$;

-- 3) O aviso de que as pesagens da empresa mudaram — para a tela Monitoramento nao precisar
-- PERGUNTAR a cada poucos segundos.
--
-- Mesmo desenho de `cadastro_change_pings` (202609220001) e `operation_request_pings`
-- (202609250001): UMA linha por empresa com a hora da ultima escrita em `weighing_operations`,
-- publicada no Realtime. A tela, inscrita em `company_id=eq.<a dela>`, busca as vendas na hora
-- (pela leitura normal, com RLS). Publicar a propria `weighing_operations` no Realtime faria o
-- servidor do Realtime decodificar cada linha de pesagem gravada pelas balancas; o aviso e uma
-- linha minuscula por lote.
--
-- Diferente dos outros dois avisos, este e lido por usuario LOGADO do site (nao pela balanca com
-- a chave publicavel), entao a leitura fica restrita a quem e da empresa.
create table if not exists public.operation_change_pings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  changed_at timestamptz not null default now()
);

comment on table public.operation_change_pings is
  'Uma linha por empresa com a hora da ultima escrita em weighing_operations. Publicada no Realtime para a tela Monitoramento do site atualizar na hora. Nao carrega dado da pesagem.';

alter table public.operation_change_pings enable row level security;

drop policy if exists "web users read own company operation pings" on public.operation_change_pings;
create policy "web users read own company operation pings"
  on public.operation_change_pings
  for select
  to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.id = (select auth.uid())
        and p.company_id = operation_change_pings.company_id
        and p.is_active = true
    )
  );

-- Escrita e so do gatilho. Cliente nenhum carimba aviso.
revoke all on public.operation_change_pings from anon, authenticated;
grant select on public.operation_change_pings to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.operation_change_pings;
exception
  when duplicate_object then null;
end;
$$;

create or replace function public.ping_operation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.operation_change_pings (company_id, changed_at)
    select distinct new_rows.company_id, now()
      from new_rows
     where new_rows.company_id is not null
    on conflict (company_id) do update
      set changed_at = excluded.changed_at;
  exception
    -- Perder o aviso so atrasa o Monitoramento ate a proxima consulta de reserva da tela.
    -- Perder a pesagem por causa do aviso seria inaceitavel.
    when others then
      raise warning 'ping_operation_change falhou: %', sqlerrm;
  end;
  return null;
end;
$$;

comment on function public.ping_operation_change() is
  'Carimba operation_change_pings com a hora da escrita em weighing_operations. Gatilho por STATEMENT (um aviso por lote) e a prova de falha: o aviso se perde, a pesagem nunca.';

-- Funcao de gatilho: ninguem precisa chama-la por `/rest/v1/rpc` (ver 202609250002).
revoke execute on function public.ping_operation_change() from public, anon, authenticated;

-- INSERT e UPDATE em gatilhos separados: a tabela de transicao e declarada por evento.
drop trigger if exists ping_operation_change_insert on public.weighing_operations;
create trigger ping_operation_change_insert
  after insert on public.weighing_operations
  referencing new table as new_rows
  for each statement
  execute function public.ping_operation_change();

drop trigger if exists ping_operation_change_update on public.weighing_operations;
create trigger ping_operation_change_update
  after update on public.weighing_operations
  referencing new table as new_rows
  for each statement
  execute function public.ping_operation_change();

notify pgrst, 'reload schema';
