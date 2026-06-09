alter table public.units
  add column if not exists desktop_activation_code text;

comment on column public.units.desktop_activation_code is 'Código de ativação do desktop em texto plano (6 dígitos), visível para o administrador.';
