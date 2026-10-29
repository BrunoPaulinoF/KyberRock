-- Regua de cobranca por WhatsApp (aba Financeiro do painel).
--
-- A FAT-2026-00010 (Pedreira Ibiuna) foi enviada no fechamento, em 15/10, venceu em 25/10 e, ate
-- 29/10, o cliente nao tinha recebido mais nada: o boleto expirou e o Mercado Pago o cancelou em
-- 27/10, e a balanca seria bloqueada em 31/10 sem nenhum papel valido nas maos dele.
--
-- Agora a passada do `billing-run` segue uma regua contada do vencimento ORIGINAL (V) e da
-- carencia (G) — `collectionNoticeFor`, em `_shared/billing-cycle.ts`:
--   fechamento        fatura completa com o PDF (como antes);
--   V - 3             lembrete com o mesmo boleto (`reminder_days_before`, como antes);
--   V                 "vence hoje", com o mesmo boleto;
--   V + 3             "fatura vencida", com boleto NOVO vencendo no dia (`overdue_notice_days_after`);
--   V + G             ultimo dia: "o sistema para amanha", com boleto reemitido se o anterior caiu;
--   V + G + 1         bloqueio (como antes).
-- O boleto reemitido NAO muda `billing_invoices.due_date`: o bloqueio continua contando do
-- vencimento original. Cada aviso sai uma vez por vencimento, marcado nas colunas abaixo.
--
-- E a passada da manha vai de 9h para 7h de Brasilia: o aviso com o boleto que vence no dia tem
-- de chegar cedo. A da tarde (15h) continua como rede de seguranca.

alter table public.billing_settings
  add column if not exists overdue_notice_days_after integer not null default 3
    check (overdue_notice_days_after between 1 and 30);

alter table public.billing_invoices
  add column if not exists due_notice_sent_for date,
  add column if not exists due_notice_sent_at timestamptz,
  add column if not exists overdue_notice_sent_for date,
  add column if not exists overdue_notice_sent_at timestamptz,
  add column if not exists final_notice_sent_for date,
  add column if not exists final_notice_sent_at timestamptz;

comment on column public.billing_settings.overdue_notice_days_after is
  'Quantos dias depois do vencimento sai o aviso de fatura vencida, com boleto novo vencendo no dia (1 a 30).';
comment on column public.billing_invoices.due_notice_sent_for is
  'Vencimento para o qual o aviso "vence hoje" ja saiu.';
comment on column public.billing_invoices.due_notice_sent_at is
  'Quando o aviso "vence hoje" do vencimento em due_notice_sent_for saiu.';
comment on column public.billing_invoices.overdue_notice_sent_for is
  'Vencimento para o qual o aviso de fatura vencida (com boleto novo) ja saiu.';
comment on column public.billing_invoices.overdue_notice_sent_at is
  'Quando o aviso de fatura vencida do vencimento em overdue_notice_sent_for saiu.';
comment on column public.billing_invoices.final_notice_sent_for is
  'Vencimento para o qual o aviso de ultimo dia antes do bloqueio ja saiu.';
comment on column public.billing_invoices.final_notice_sent_at is
  'Quando o aviso de ultimo dia do vencimento em final_notice_sent_for saiu.';

do $$
begin
  begin
    perform cron.unschedule('kyberrock_billing_run');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'kyberrock_billing_run',
    '0 10,18 * * *',
    $cron$
      select net.http_post(
        url := 'https://vksihzfrgqoemcqpquit.supabase.co/functions/v1/billing-run',
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
