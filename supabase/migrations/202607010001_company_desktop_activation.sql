alter table public.companies
  add column if not exists desktop_activation_code text,
  add column if not exists desktop_activation_code_hash text,
  add column if not exists desktop_activation_code_rotated_at timestamptz;

with latest_unit_code as (
  select distinct on (company_id)
    company_id,
    desktop_activation_code,
    desktop_activation_code_hash,
    desktop_activation_code_rotated_at
  from public.units
  where desktop_activation_code_hash is not null
  order by company_id, desktop_activation_code_rotated_at desc nulls last
)
update public.companies c
set
  desktop_activation_code = latest_unit_code.desktop_activation_code,
  desktop_activation_code_hash = latest_unit_code.desktop_activation_code_hash,
  desktop_activation_code_rotated_at = latest_unit_code.desktop_activation_code_rotated_at,
  updated_at = now()
from latest_unit_code
where c.id = latest_unit_code.company_id
  and c.desktop_activation_code_hash is null;

create unique index if not exists idx_companies_desktop_activation_code_hash
  on public.companies(desktop_activation_code_hash)
  where desktop_activation_code_hash is not null;

with ranked_devices as (
  select
    id,
    row_number() over (
      partition by company_id
      order by last_seen_at desc nulls last, updated_at desc nulls last, created_at desc nulls last
    ) as rn
  from public.device_registrations
  where is_active = true
)
update public.device_registrations
set is_active = false, updated_at = now()
where id in (select id from ranked_devices where rn > 1);

create unique index if not exists idx_device_registrations_one_active_desktop_per_company
  on public.device_registrations(company_id)
  where is_active = true;
