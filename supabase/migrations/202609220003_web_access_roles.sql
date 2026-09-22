-- Acesso do site web ao cadastro da propria empresa (comercial e gestor).
--
-- Contexto: `docs/plano-migracao-web.md`. O cadastro comercial (clientes, precos, veiculos,
-- motoristas, transportadoras) deixa de nascer no SQLite de cada computador e passa a ter um
-- dono so: o site web, escrevendo direto no Supabase pela Edge Function `web-api`. As balancas
-- continuam donas da PESAGEM e viram seguidoras do cadastro.
--
-- Esta migracao so abre a LEITURA. A escrita continua fechada para o cliente (politica
-- `no direct client access` das tabelas de cadastro): quem grava e a `web-api`, com a chave de
-- servico, depois de validar o usuario e aplicar as regras de `_shared/` (CNPJ alfanumerico,
-- documento unico por empresa, bloco comercial publicado). Abrir INSERT/UPDATE por RLS faria o
-- site gravar sem essas regras — e o problema que estamos tirando do desktop voltaria pelo
-- navegador.
--
-- Dois perfis:
--   - `comercial`: le todo o cadastro e as operacoes da empresa; edita cliente, veiculo,
--     motorista e transportadora pela `web-api`.
--   - `gestor`: tudo do comercial, mais preco e bloco comercial/credito do cliente.
--
-- A diferenca entre os dois e aplicada na `web-api`, nao aqui: para LEITURA os dois enxergam o
-- mesmo, entao as politicas usam `role in ('comercial', 'gestor')`. O carregador (`loader`)
-- continua vendo so a fila da unidade dele.

-- 1) Perfil `gestor`.
alter table public.user_profiles
  drop constraint if exists user_profiles_role_check;

alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role in ('loader', 'comercial', 'gestor'));

-- 2) As politicas que ja existiam so para o comercial passam a valer para o gestor.
drop policy if exists "comercial can read company operations" on public.weighing_operations;
drop policy if exists "web users can read company operations" on public.weighing_operations;
create policy "web users can read company operations"
  on public.weighing_operations for select
  to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.id = (select auth.uid())
        and p.role in ('comercial', 'gestor')
        and p.company_id = weighing_operations.company_id
        and p.is_active = true
    )
  );

drop policy if exists "comercial can read company units" on public.units;
drop policy if exists "web users can read company units" on public.units;
create policy "web users can read company units"
  on public.units for select
  to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.id = (select auth.uid())
        and p.role in ('comercial', 'gestor')
        and p.company_id = units.company_id
        and p.is_active = true
    )
  );

-- 3) Leitura do cadastro e do historico da propria empresa.
--
-- Politicas permissivas se somam (OR): a `no direct client access` (`using (false)`) continua
-- la e continua bloqueando anon e qualquer usuario que nao caia nesta. `carriers`, `drivers`,
-- `vehicles` e os vinculos deles ja tinham leitura por empresa para qualquer usuario ativo
-- (politicas "loader can read ... from own company"), entao ficam de fora.
do $$
declare
  cadastro_table text;
  policy_name text;
begin
  foreach cadastro_table in array array[
    'customers',
    'products',
    'customer_vehicles',
    'product_default_prices',
    'customer_special_prices',
    'price_tables',
    'price_table_items',
    'customer_price_tables',
    'customer_freight_rules',
    'customer_future_billing_invoices',
    'payment_terms',
    'payment_methods',
    'accounts',
    'customer_credit_movements',
    'customer_credit_balances',
    'quotations',
    'loading_requests'
  ]
  loop
    policy_name := 'web users can read ' || cadastro_table || ' from own company';
    execute format('drop policy if exists %I on public.%I', policy_name, cadastro_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using ('
      || 'exists (select 1 from public.user_profiles p '
      || 'where p.id = (select auth.uid()) '
      || 'and p.role in (''comercial'', ''gestor'') '
      || 'and p.company_id = %I.company_id '
      || 'and p.is_active = true))',
      policy_name,
      cadastro_table,
      cadastro_table
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
