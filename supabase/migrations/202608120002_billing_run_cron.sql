-- Agendamento do motor de cobranca (`billing-run`).
--
-- Roda duas vezes por dia em horario comercial de Sao Paulo (09h e 15h; o
-- servidor conta em UTC, dai 12h e 18h). Nao e de hora em hora de proposito: o
-- fechamento gera fatura e DISPARA WHATSAPP, e ninguem quer boleto chegando as
-- 3 da manha. Quem confirma pagamento em tempo real e o `billing-webhook` do
-- Mercado Pago; estas passadas sao a rede de seguranca (fechamento do dia,
-- marcacao de vencidas, bloqueio por inadimplencia e reconsulta de boletos).
--
-- A passada e idempotente: o indice unico
-- `idx_billing_invoices_company_period` impede a segunda fatura do mesmo ciclo,
-- e boleto/WhatsApp so saem uma vez por fatura.
--
-- O segredo do cron e o mesmo do agendador de relatorios
-- ('cron_shared_secret' no Vault, criado pela migracao 202607150002). Ele e
-- recriado aqui se ainda nao existir, para que esta migracao funcione sozinha
-- num projeto novo.

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
    perform cron.unschedule('kyberrock_billing_run');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'kyberrock_billing_run',
    '0 12,18 * * *',
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
