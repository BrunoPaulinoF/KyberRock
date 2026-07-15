-- Agendamento interno do envio automatico de relatorios (e-mail + WhatsApp).
--
-- O job roda de HORA em HORA: quem decide se cada destinatario recebe naquela hora
-- e o daily-report-email, comparando o schedule_time/schedule_frequency do
-- destinatario com a hora atual no fuso America/Sao_Paulo. Substitui o job diario
-- das 20h da migracao 202606190002, que nunca funcionou (pg_cron desabilitado e
-- app.settings.* nunca definidos).
--
-- O segredo do cron mora no Vault ('cron_shared_secret', gerado aqui na primeira
-- aplicacao). O daily-report-scheduler valida o header x-cron-secret contra o env
-- CRON_SHARED_SECRET e, na ausencia dele, contra o Vault via RPC get_cron_secret()
-- — portanto nenhum passo manual de configuracao e necessario.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cron_shared_secret') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'cron_shared_secret',
      'Segredo compartilhado do agendador de relatorios (daily-report-scheduler)'
    );
  end if;
end$$;

-- Leitura do segredo pelas edge functions (via supabase.rpc com service role).
-- Exposta SOMENTE ao service_role; anon/authenticated nao enxergam o valor.
create or replace function public.get_cron_secret()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'cron_shared_secret'
  limit 1;
$$;

revoke all on function public.get_cron_secret() from public;
revoke all on function public.get_cron_secret() from anon, authenticated;
grant execute on function public.get_cron_secret() to service_role;

do $$
begin
  -- Remove agendamentos anteriores (idempotente; ignora se nao existirem).
  begin
    perform cron.unschedule('kyberrock_daily_report_20h');
  exception when others then
    null;
  end;
  begin
    perform cron.unschedule('kyberrock_daily_report_hourly');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'kyberrock_daily_report_hourly',
    '0 * * * *',
    $cron$
      select net.http_post(
        url := 'https://vksihzfrgqoemcqpquit.supabase.co/functions/v1/daily-report-scheduler',
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
