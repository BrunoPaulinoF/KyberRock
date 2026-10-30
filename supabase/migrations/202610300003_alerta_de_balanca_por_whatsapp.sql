-- Alerta de balanca por WhatsApp (`device-health-alerts`).
--
-- A nuvem ja sabia, pelo `desktop-status`, se cada balanca esta ligada (`last_seen_at`) e se
-- esta entregando (`health_*`): fila atrasada, envio parado esperando clique e o motivo da
-- ultima recusa. Mas so o painel /admin mostrava isso, e ninguem fica olhando o painel — a
-- balanca desligada no meio do dia e a nota que nao saiu eram descobertas por telefone.
--
-- Agora uma passada a cada 10 minutos compara a saude de cada balanca com os alertas abertos
-- e avisa por WhatsApp quando um problema COMECA e quando ele TERMINA (regra em
-- `_shared/device-alerts.ts`). O envio usa a instancia UAZAPI global da Kybernan, a mesma do
-- financeiro (`billing_settings.whatsapp_url` + secret `UAZAPI_INSTANCE_TOKEN`).

-- Quem recebe. `company_id` nulo = suporte: recebe de todas as pedreiras.
create table if not exists public.device_alert_recipients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  name text not null default '',
  whatsapp_phone text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_device_alert_recipients_company
  on public.device_alert_recipients(company_id);

comment on table public.device_alert_recipients is
  'Quem recebe o alerta de balanca por WhatsApp. company_id nulo = suporte (todas as pedreiras). Editado so pelo painel /admin (admin-api).';

-- Um alerta por problema: aberto quando comeca, resolvido quando termina. O indice parcial
-- impede o mesmo tipo de alerta aberto duas vezes para a mesma balanca.
create table if not exists public.device_alerts (
  id uuid primary key default gen_random_uuid(),
  device_id text not null references public.device_registrations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('offline', 'queue_blocked', 'queue_stuck')),
  detail text,
  opened_at timestamptz not null default now(),
  notified_at timestamptz,
  resolved_at timestamptz,
  resolved_notified_at timestamptz,
  last_error text
);

create unique index if not exists idx_device_alerts_open
  on public.device_alerts(device_id, kind)
  where resolved_at is null;

create index if not exists idx_device_alerts_company_opened
  on public.device_alerts(company_id, opened_at desc);

comment on table public.device_alerts is
  'Alertas de balanca (sem contato, envio parado, fila atrasada). Um aviso ao abrir e um ao resolver; resolvidos com mais de 90 dias sao apagados pela propria passada.';

alter table public.device_alert_recipients enable row level security;
alter table public.device_alerts enable row level security;

drop policy if exists "no direct client access" on public.device_alert_recipients;
create policy "no direct client access"
  on public.device_alert_recipients for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "no direct client access" on public.device_alerts;
create policy "no direct client access"
  on public.device_alerts for all
  to anon, authenticated
  using (false)
  with check (false);

-- Passada de 10 em 10 minutos. Mesmo segredo dos demais agendadores ('cron_shared_secret' no
-- Vault, migracao 202607150002), recriado aqui se ainda nao existir.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_shared_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'cron_shared_secret',
      'Segredo compartilhado dos agendadores internos (relatorios e cobranca)'
    );
  end if;
end$$;

do $$
begin
  begin
    perform cron.unschedule('kyberrock_device_health_alerts');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'kyberrock_device_health_alerts',
    '*/10 * * * *',
    $cron$
      select net.http_post(
        url := 'https://vksihzfrgqoemcqpquit.supabase.co/functions/v1/device-health-alerts',
        headers := jsonb_build_object(
          'x-cron-secret',
          (select decrypted_secret from vault.decrypted_secrets where name = 'cron_shared_secret'),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
end$$;
