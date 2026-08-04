-- Codigo sequencial da operacao (000001, 000002, ...), impresso no topo do cupom. O
-- desktop guarda o codigo no SQLite local (migracao local 46) e o projeta aqui pelo
-- mesmo motivo do device_id: numa pedreira com mais de uma balanca, cada maquina
-- calcula o proximo codigo a partir do maior que conhece, e e a projecao da nuvem que
-- leva o que a outra maquina ja usou.
--
-- Sem NOT NULL: as operacoes ja projetadas nasceram antes do campo existir e recebem o
-- codigo no proximo push do desktop (que fez o backfill local por ordem de criacao).

alter table public.weighing_operations
  add column if not exists operation_code integer;

-- Leitura do maior codigo da pedreira, que e como o desktop resolve o proximo.
create index if not exists idx_weighing_operations_unit_operation_code
  on public.weighing_operations(unit_id, operation_code desc);
