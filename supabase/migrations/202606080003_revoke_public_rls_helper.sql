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
    execute format('revoke execute on function %s from public', function_identity);
  end if;
end $$;
