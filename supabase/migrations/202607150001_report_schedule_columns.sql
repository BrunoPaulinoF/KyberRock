-- Corrige o schema cloud de report_recipients: a versao aplicada em producao da
-- 202606290001 nao incluiu as colunas de agendamento, o que quebrava tanto o push
-- de destinatarios do desktop (desktop-sync retornava 42703) quanto o select do
-- daily-report-email. Todas as operacoes sao idempotentes.

alter table public.report_recipients
  alter column email drop not null;

alter table public.report_recipients
  add column if not exists schedule_frequency text not null default 'daily'
    check (schedule_frequency in ('daily', 'weekly', 'monthly')),
  add column if not exists schedule_time text not null default '20:00';

create unique index if not exists idx_report_recipients_company_whatsapp
  on public.report_recipients(company_id, whatsapp_phone)
  where whatsapp_phone is not null;

-- Hora local (America/Sao_Paulo) em que o despacho foi disparado. Junto com
-- (company_id, unit_id, report_date) forma a chave de deduplicacao usada pelo
-- daily-report-email para nao reenviar quando o scheduler roda duas vezes.
alter table public.daily_report_dispatches
  add column if not exists schedule_hour smallint;

create index if not exists idx_daily_report_dispatches_dedup
  on public.daily_report_dispatches(company_id, unit_id, report_date, schedule_hour);
