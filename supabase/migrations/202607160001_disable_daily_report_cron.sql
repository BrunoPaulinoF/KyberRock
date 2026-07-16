-- Os relatorios agendados agora sao enviados pelo app desktop com os anexos
-- em PDF/Excel (mesmos documentos das telas de Insights e Controle de
-- Caminhoes), configurados na tela de Relatorios. Desativa o disparo de hora
-- em hora do envio antigo (e-mail HTML + texto de WhatsApp) para os
-- destinatarios nao receberem tudo duplicado.
--
-- As Edge Functions daily-report-scheduler/daily-report-email continuam
-- deployadas e podem ser reativadas reagendando o job, se necessario.

do $$
begin
  if to_regclass('cron.job') is not null
     and exists (select 1 from cron.job where jobname = 'kyberrock_daily_report_hourly') then
    perform cron.unschedule('kyberrock_daily_report_hourly');
  end if;
end $$;
