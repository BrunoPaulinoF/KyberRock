-- Modalidade de frete (CIF/FOB/terceiros/transporte proprio/sem frete) na projecao
-- da nuvem. O desktop ja guarda `freight_type` no SQLite local (migracao local 32),
-- mas a coluna nunca foi projetada em `weighing_operations`, entao o relatorio de
-- vendas do comercial (loader-web) nao conseguia filtrar por CIF x FOB.
--
-- Mesmo dominio e mesmo default do SQLite local: 'none' (sem frete) para as
-- operacoes ja projetadas, que serao corrigidas no proximo push do desktop.

alter table public.weighing_operations
  add column if not exists freight_type text not null default 'none';

alter table public.weighing_operations
  drop constraint if exists weighing_operations_freight_type_check;

alter table public.weighing_operations
  add constraint weighing_operations_freight_type_check
    check (freight_type in ('cif', 'fob', 'third_party', 'own_sender', 'own_recipient', 'none'));

-- Relatorio de vendas do comercial: filtra por empresa + modalidade dentro de um
-- periodo, na mesma ordem de leitura (created_at desc) das demais consultas.
create index if not exists idx_weighing_operations_company_freight_type
  on public.weighing_operations(company_id, freight_type, created_at desc);
