-- Quais relatorios cada destinatario recebe no envio automatico:
-- 'sales' (fechamento de vendas), 'trucks' (controle de caminhoes) ou 'both'.
alter table public.report_recipients
  add column if not exists report_types text not null default 'sales'
  check (report_types in ('sales', 'trucks', 'both'));
