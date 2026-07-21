-- Hora especifica de envio do relatorio financeiro OMIE por destinatario.
-- Quando nula, o financial-report-email cai no schedule_time geral do
-- destinatario (mesmo horario dos demais relatorios); quando definida,
-- o resumo executivo de financas do OMIE sai nesse horario proprio.
alter table public.report_recipients
  add column if not exists financial_schedule_time text;
