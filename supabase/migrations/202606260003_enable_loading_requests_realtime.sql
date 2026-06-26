alter table public.loading_requests replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'loading_requests'
  ) then
    alter publication supabase_realtime add table public.loading_requests;
  end if;
end $$;
