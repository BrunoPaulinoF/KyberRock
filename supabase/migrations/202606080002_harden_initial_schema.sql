create index if not exists idx_audit_logs_company on public.audit_logs(company_id);
create index if not exists idx_audit_logs_unit on public.audit_logs(unit_id);
create index if not exists idx_customers_company on public.customers(company_id);
create index if not exists idx_device_registrations_company on public.device_registrations(company_id);
create index if not exists idx_device_registrations_unit on public.device_registrations(unit_id);
create index if not exists idx_loading_requests_company on public.loading_requests(company_id);
create index if not exists idx_loading_requests_operation on public.loading_requests(operation_id);
create index if not exists idx_print_receipts_operation on public.print_receipts(operation_id);
create index if not exists idx_print_receipts_unit on public.print_receipts(unit_id);
create index if not exists idx_products_company on public.products(company_id);
create index if not exists idx_user_profiles_company on public.user_profiles(company_id);
create index if not exists idx_weighing_operations_customer on public.weighing_operations(customer_id);
create index if not exists idx_weighing_operations_device on public.weighing_operations(device_id);
create index if not exists idx_weighing_operations_product on public.weighing_operations(product_id);
create index if not exists idx_weighing_operations_unit on public.weighing_operations(unit_id);

drop policy if exists "loader can read own profile" on public.user_profiles;
drop policy if exists "loader can read own company" on public.companies;
drop policy if exists "loader can read own unit" on public.units;
drop policy if exists "loader can read open loading requests from own unit" on public.loading_requests;
drop policy if exists "loader can read open operations from own unit" on public.weighing_operations;

create policy "loader can read own profile"
  on public.user_profiles for select
  to authenticated
  using (id = (select auth.uid()) and is_active = true);

create policy "loader can read own company"
  on public.companies for select
  to authenticated
  using (exists (select 1 from public.user_profiles p where p.id = (select auth.uid()) and p.company_id = companies.id and p.is_active = true));

create policy "loader can read own unit"
  on public.units for select
  to authenticated
  using (exists (select 1 from public.user_profiles p where p.id = (select auth.uid()) and p.unit_id = units.id and p.is_active = true));

create policy "loader can read open loading requests from own unit"
  on public.loading_requests for select
  to authenticated
  using (
    status = 'open'
    and exists (select 1 from public.user_profiles p where p.id = (select auth.uid()) and p.unit_id = loading_requests.unit_id and p.is_active = true)
  );

create policy "loader can read open operations from own unit"
  on public.weighing_operations for select
  to authenticated
  using (
    status = 'open'
    and exists (select 1 from public.user_profiles p where p.id = (select auth.uid()) and p.unit_id = weighing_operations.unit_id and p.is_active = true)
  );

create policy "no direct client access"
  on public.audit_logs for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "no direct client access"
  on public.customers for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "no direct client access"
  on public.device_registrations for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "no direct client access"
  on public.print_receipts for all
  to anon, authenticated
  using (false)
  with check (false);

create policy "no direct client access"
  on public.products for all
  to anon, authenticated
  using (false)
  with check (false);

do $$
declare
  function_identity regprocedure;
begin
  select p.oid::regprocedure
    into function_identity
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'rls_auto_enable'
    and pg_get_function_identity_arguments(p.oid) = '';

  if function_identity is not null then
    execute format('revoke execute on function %s from anon, authenticated', function_identity);
  end if;
end $$;
