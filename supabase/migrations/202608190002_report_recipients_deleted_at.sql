-- Exclusao de destinatario de relatorio: a nuvem passa a guardar o tombstone.
--
-- O desktop apaga o destinatario com soft delete (deleted_at) e empurra a linha
-- para ca. A projecao so tinha is_active, entao o que chegava era "inativo" — e
-- o pull seguinte devolvia a linha viva, sem nenhuma marca de exclusao, para uma
-- base local que ja tinha zerado o needs_push. Resultado na tela de Relatorios:
-- o destinatario excluido reaparecia (como Inativo) a cada sincronizacao, em
-- todas as balancas da pedreira.
alter table public.report_recipients
  add column if not exists deleted_at timestamptz;

-- Os indices unicos precisam ignorar o excluido, senao o tombstone segura o
-- e-mail/WhatsApp para sempre e recadastrar o mesmo contato (id novo, vindo de
-- outra balanca) passa a falhar com duplicate key no push.
alter table public.report_recipients
  drop constraint if exists report_recipients_company_id_email_key;

create unique index if not exists idx_report_recipients_company_email
  on public.report_recipients(company_id, email)
  where email is not null and deleted_at is null;

drop index if exists idx_report_recipients_company_whatsapp;
create unique index idx_report_recipients_company_whatsapp
  on public.report_recipients(company_id, whatsapp_phone)
  where whatsapp_phone is not null and deleted_at is null;

-- Envio (daily-report-email / financial-report-email) filtra por is_active, e o
-- desktop sempre manda is_active = false junto com o deleted_at — o excluido ja
-- sai da lista de envio antes mesmo desta coluna existir.
