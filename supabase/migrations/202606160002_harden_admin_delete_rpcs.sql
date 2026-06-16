alter function public.delete_company(uuid) set search_path = public, pg_temp;
alter function public.delete_unit(uuid) set search_path = public, pg_temp;

revoke all on function public.delete_company(uuid) from public, anon, authenticated;
revoke all on function public.delete_unit(uuid) from public, anon, authenticated;

grant execute on function public.delete_company(uuid) to service_role;
grant execute on function public.delete_unit(uuid) to service_role;
