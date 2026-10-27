-- Lembrete de vencimento por WhatsApp (aba Financeiro do painel).
--
-- A fatura so ia ao cliente no fechamento e, depois, so o bloqueio falava com ele. Em 27/10/2026 a
-- FAT-2026-00010 (Pedreira Ibiuna) tinha sido entregue no WhatsApp de cobranca em 15/10 e venceu
-- em 25/10 sem pagamento — dez dias sem nenhum aviso no meio.
--
-- Agora a passada automatica do `billing-run` (9h e 15h de Brasilia) manda um lembrete curto
-- `reminder_days_before` dias antes do vencimento (`sendDueReminders`, em
-- `_shared/billing-engine.ts`), uma vez por VENCIMENTO: `reminder_sent_for_due_date` guarda para
-- qual vencimento o lembrete ja saiu, e o boleto reemitido com data nova ganha outro.
--
-- `auto_reminder_enabled` nasce LIGADO: o lembrete foi pedido para todas as pedreiras. O motor le
-- a coluna ausente como desligado, entao nada sai antes desta migracao existir.

alter table public.billing_settings
  add column if not exists auto_reminder_enabled boolean not null default true,
  add column if not exists reminder_days_before integer not null default 3
    check (reminder_days_before between 1 and 30),
  add column if not exists whatsapp_reminder_template text;

alter table public.billing_invoices
  add column if not exists reminder_sent_for_due_date date,
  add column if not exists reminder_sent_at timestamptz;

comment on column public.billing_settings.auto_reminder_enabled is
  'Manda o lembrete de vencimento por WhatsApp antes do vencimento (billing-run).';
comment on column public.billing_settings.reminder_days_before is
  'Quantos dias antes do vencimento o lembrete sai (1 a 30).';
comment on column public.billing_settings.whatsapp_reminder_template is
  'Texto do lembrete com marcadores ({pedreira}, {valor}, {vencimento}, {dias}, {boleto}...). Vazio usa o padrao.';
comment on column public.billing_invoices.reminder_sent_for_due_date is
  'Vencimento para o qual o lembrete ja saiu. Um lembrete por vencimento: boleto reemitido com data nova ganha outro.';
comment on column public.billing_invoices.reminder_sent_at is
  'Quando o lembrete do vencimento em reminder_sent_for_due_date saiu.';
