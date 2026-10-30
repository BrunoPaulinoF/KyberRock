-- Foto do cadastro da pesagem no FECHAMENTO (`closing_snapshot_json`).
--
-- O cupom lia cliente, documento, placa, motorista e produto do cadastro de AGORA: trocar a
-- razao social do cliente ou a placa do caminhao reescrevia todo cupom antigo reimpresso, e a
-- 2a via saia diferente da 1a que o cliente tem em maos. A balanca que fecha a pesagem grava a
-- foto (`apps/desktop/src/services/operation-closing-snapshot.ts`) e a projeta aqui, para a
-- reimpressao feita em OUTRA balanca da pedreira sair igual.
--
-- A foto nasce uma vez e nunca e reescrita: a copia que chega sem ela sobe sem a coluna
-- (`splitOperationsByClosingSnapshot`, em `_shared/operation-writes.ts`), e o pull do desktop
-- so a preenche quando a maquina nao tem.

alter table public.weighing_operations
  add column if not exists closing_snapshot_json text;

comment on column public.weighing_operations.closing_snapshot_json is
  'Foto do cadastro no fechamento (JSON: customerName, customerDocument, plate, driverName, carrierName, productCode, productDescription, paymentTermName, paymentMethodName, capturedAt). Usada na reimpressao do cupom; nunca reescrita.';
