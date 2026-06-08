alter table public.units
  add column if not exists desktop_activation_code_hash text,
  add column if not exists desktop_activation_code_rotated_at timestamptz;

create unique index if not exists idx_units_desktop_activation_code_hash
  on public.units(desktop_activation_code_hash)
  where desktop_activation_code_hash is not null;

create index if not exists idx_device_registrations_active
  on public.device_registrations(is_active);
