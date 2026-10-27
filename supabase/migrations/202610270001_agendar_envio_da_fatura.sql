-- Agendar o envio da fatura por WhatsApp (aba Financeiro do painel).
--
-- O motor so mandava a fatura no FECHAMENTO, ou na hora, pelo botao "Enviar agora". Nao havia
-- como deixar pronto o reenvio de um boleto reemitido para o dia seguinte: em 27/10/2026 o boleto
-- da FAT-2026-00010 (Pedreira Ibiuna) tinha vencido em 25/10 e precisava ser reemitido com
-- vencimento novo e chegar ao financeiro da pedreira no dia 28.
--
-- `whatsapp_scheduled_for` guarda o DIA do envio. A passada automatica do `billing-run` (pg_cron,
-- 9h e 15h de Brasilia) manda as faturas em aberto cujo dia chegou (`sendScheduledInvoices`, em
-- `_shared/billing-engine.ts`) e devolve a coluna a null quando o envio sai. Boleto que nao vale
-- mais (fatura ajustada sem reemissao, boleto vencido) segura o envio ate a reemissao.
--
-- Sem indice: a tabela tem uma linha por pedreira por mes.

alter table public.billing_invoices
  add column if not exists whatsapp_scheduled_for date;

comment on column public.billing_invoices.whatsapp_scheduled_for is
  'Dia em que a passada automatica envia a fatura por WhatsApp (Agendar envio do painel). Volta a null quando o envio sai.';
