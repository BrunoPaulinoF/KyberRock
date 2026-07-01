alter table public.report_recipients
  alter column email drop not null,
  add column if not exists whatsapp_phone text,
  add column if not exists send_email boolean not null default true,
  add column if not exists send_whatsapp boolean not null default false,
  add column if not exists schedule_frequency text not null default 'daily' check (schedule_frequency in ('daily', 'weekly', 'monthly')),
  add column if not exists schedule_time text not null default '20:00';

create unique index if not exists idx_report_recipients_company_whatsapp
  on public.report_recipients(company_id, whatsapp_phone)
  where whatsapp_phone is not null;
