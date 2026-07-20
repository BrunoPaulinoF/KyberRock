-- Relatorio financeiro OMIE (contas a pagar + extrato de conta corrente),
-- separado do envio de vendas/caminhoes: novo canal opcional por destinatario
-- (send_financial), tabela de dedupe propria e agendamento de hora em hora
-- independente do pipeline de vendas/caminhoes (que hoje roda pelo desktop,
-- migracao 202607160001). O financial-report-email busca os dados
-- diretamente na API do OMIE (credenciais em companies.omie_app_key/secret)
-- e nao depende do app desktop estar aberto.

alter table public.report_recipients
  add column if not exists send_financial boolean not null default false;

create table if not exists public.financial_report_dispatches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  report_date date not null,
  -- Hora local (America/Sao_Paulo) em que o despacho foi disparado — junto com
  -- (company_id, report_date) forma a chave de deduplicacao para o cron
  -- de hora em hora nao reenviar quando roda mais de uma vez na mesma hora.
  schedule_hour smallint,
  recipients_count integer not null,
  status text not null check (status in ('sent', 'partial', 'failed')),
  last_error text,
  dispatched_at timestamptz not null default now()
);

create index if not exists idx_financial_report_dispatches_dedup
  on public.financial_report_dispatches(company_id, report_date, schedule_hour);

alter table public.financial_report_dispatches enable row level security;

create policy "no direct client access"
  on public.financial_report_dispatches for all
  to anon, authenticated
  using (false)
  with check (false);

-- Reaproveita o segredo do Vault ('cron_shared_secret') criado pela migracao
-- 202607150002 — mesmo mecanismo de autenticacao do daily-report-scheduler,
-- entao nenhum passo manual de configuracao e necessario.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('kyberrock_financial_report_hourly');
    exception when others then
      null;
    end;

    perform cron.schedule(
      'kyberrock_financial_report_hourly',
      '0 * * * *',
      $cron$
        select net.http_post(
          url := 'https://vksihzfrgqoemcqpquit.supabase.co/functions/v1/financial-report-scheduler',
          headers := jsonb_build_object(
            'x-cron-secret',
            (select decrypted_secret from vault.decrypted_secrets where name = 'cron_shared_secret'),
            'Content-Type', 'application/json'
          ),
          body := '{}'::jsonb
        );
      $cron$
    );
  end if;
end$$;
