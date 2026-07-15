-- Configuracao dos canais de envio de relatorios (SMTP e WhatsApp/UAZAPI) por
-- empresa. O desktop cadastra e conecta a instancia UAZAPI na tela de
-- Relatorios e empurra a configuracao via desktop-sync; o daily-report-email
-- le desta tabela (com fallback nos envs SMTP_*/UAZAPI_* do projeto), entao
-- nenhum secret precisa ser definido manualmente nas Edge Functions.

create table if not exists public.report_channel_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  smtp_host text,
  smtp_port integer,
  smtp_user text,
  smtp_password text,
  smtp_sender text,
  whatsapp_url text,
  whatsapp_instance_token text,
  whatsapp_instance_name text,
  whatsapp_status text,
  updated_at timestamptz not null default now()
);

alter table public.report_channel_settings enable row level security;

create policy "no direct client access"
  on public.report_channel_settings for all
  to anon, authenticated
  using (false)
  with check (false);
