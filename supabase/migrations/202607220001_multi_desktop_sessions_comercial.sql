-- Multiplos desktops ativos por pedreira + papel "comercial" para relatorios.
--
-- 1) Remove a trava de um unico desktop ativo por empresa: agora cada computador
--    tem seu proprio registro (chaveado por installation_id) e a ativacao de um
--    novo computador nao invalida mais o token dos demais.
-- 2) Cada dispositivo ganha uma cor estavel, usada no desktop para contornar as
--    operacoes com a cor do computador que as criou (+ legenda).
-- 3) user_profiles passa a aceitar o papel 'comercial', que pode ler as
--    operacoes de pesagem da propria empresa (todas as unidades/status) para
--    extrair relatorios de venda no loader-web.

-- 1) Multiplos desktops ativos por empresa
drop index if exists public.idx_device_registrations_one_active_desktop_per_company;

alter table public.device_registrations
  add column if not exists installation_id text;

alter table public.device_registrations
  add column if not exists color text;

-- Um registro por instalacao fisica (installation_id e gerado pelo desktop e
-- estavel por computador). Registros antigos sem installation_id continuam
-- validos e sao adotados na proxima ativacao daquele computador.
create unique index if not exists idx_device_registrations_company_installation
  on public.device_registrations(company_id, installation_id)
  where installation_id is not null;

-- 2) Papel comercial
alter table public.user_profiles
  drop constraint if exists user_profiles_role_check;

alter table public.user_profiles
  add constraint user_profiles_role_check check (role in ('loader', 'comercial'));

-- 3) RLS: comercial le operacoes de pesagem da propria empresa (qualquer status,
--    qualquer unidade) para montar o relatorio de vendas. Segue o mesmo estilo
--    das policies do loader ((select auth.uid()) para evitar reavaliacao por linha).
drop policy if exists "comercial can read company operations" on public.weighing_operations;
create policy "comercial can read company operations"
  on public.weighing_operations for select
  to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.id = (select auth.uid())
        and p.role = 'comercial'
        and p.company_id = weighing_operations.company_id
        and p.is_active = true
    )
  );

-- Comercial enxerga todas as unidades da empresa (nomes para filtros do relatorio).
drop policy if exists "comercial can read company units" on public.units;
create policy "comercial can read company units"
  on public.units for select
  to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.id = (select auth.uid())
        and p.role = 'comercial'
        and p.company_id = units.company_id
        and p.is_active = true
    )
  );
