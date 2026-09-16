-- O historico do cron nao tinha fim.
--
-- `cron.job_run_details` guarda uma linha por execucao de cada agendamento e o pg_cron NAO a
-- limpa sozinho. Com o relatorio financeiro de hora em hora e a cobranca duas vezes por dia,
-- sao ~26 linhas por dia que nunca saem: em 16/09/2026 a tabela tinha 1.469 linhas desde
-- 15/07 e ja era a sexta maior do banco -- crescendo para sempre, sem que ninguem leia
-- execucao de dois meses atras.
--
-- 30 dias e o recorte: cobre a investigacao de "o relatorio de terca nao saiu" com folga e
-- mantem a tabela num tamanho fixo. A limpeza roda de madrugada, longe das passadas de
-- cobranca (12h e 18h UTC) e do relatorio (:00 de cada hora).

create extension if not exists pg_cron;

do $$
begin
  begin
    perform cron.unschedule('kyberrock_cron_history_purge');
  exception when others then
    null;
  end;

  perform cron.schedule(
    'kyberrock_cron_history_purge',
    '17 5 * * *',
    $cron$
      delete from cron.job_run_details
      where end_time < now() - interval '30 days'
         or (end_time is null and start_time < now() - interval '30 days');
    $cron$
  );
end$$;
