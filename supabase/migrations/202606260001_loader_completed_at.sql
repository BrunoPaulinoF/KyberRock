alter table public.loading_requests
  add column if not exists loader_completed_at timestamptz;

create index if not exists idx_loading_requests_unit_loader_completed
  on public.loading_requests(unit_id, loader_completed_at);

drop policy if exists "loader can mark loading request as completed" on public.loading_requests;

create policy "loader can mark loading request as completed"
  on public.loading_requests for update
  to authenticated
  using (
    status = 'open'
    and exists (
      select 1
      from public.user_profiles p
      where p.id = (select auth.uid())
        and p.unit_id = loading_requests.unit_id
        and p.is_active = true
    )
  )
  with check (
    exists (
      select 1
      from public.user_profiles p
      where p.id = (select auth.uid())
        and p.unit_id = loading_requests.unit_id
        and p.is_active = true
    )
  );
