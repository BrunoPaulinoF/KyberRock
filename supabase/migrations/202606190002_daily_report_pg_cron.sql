-- Agendamento opcional via pg_cron para o fechamento diario 20h (America/Sao_Paulo).
-- O agendamento externo (GitHub Actions/EasyPanel) chama `daily-report-scheduler`
-- via POST com header `x-cron-secret`. Esse bloco cria um cron interno se a extensao
-- pg_cron estiver habilitada no projeto Supabase; caso contrario e ignorado.

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('kyberrock_daily_report_20h');
    exception when others then
      null;
    end;

    perform cron.schedule(
      'kyberrock_daily_report_20h',
      '0 20 * * *',
      $cron$
        select net.http_post(
          url := current_setting('app.settings.daily_report_url', true),
          headers := jsonb_build_object(
            'x-cron-secret', current_setting('app.settings.cron_shared_secret', true),
            'Content-Type', 'application/json'
          ),
          body := jsonb_build_object('date', to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'))
        );
      $cron$
    );
  end if;
end$$;
