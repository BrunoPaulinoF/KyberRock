-- Transportadora da operacao na projecao da nuvem.
--
-- O SQLite local guarda `weighing_operations.carrier_id` desde o inicio, mas a
-- coluna nunca existiu em `public.weighing_operations`. Consequencia pratica na
-- pedreira com duas balancas: trocar a transportadora de uma operacao aberta em
-- um computador nunca chegava no outro — nem depois do fechamento, porque o dado
-- simplesmente nao tinha por onde trafegar.
--
-- `carrier_name` acompanha o id pelo mesmo motivo de `customer_name` /
-- `product_description`: o loader-web e o admin leem a projecao sem espelho do
-- cadastro, entao precisam do texto junto.

alter table public.weighing_operations
  add column if not exists carrier_id text;

alter table public.weighing_operations
  add column if not exists carrier_name text;

-- Relatorio por transportadora dentro da empresa, na mesma ordem de leitura
-- (created_at desc) das demais consultas da tabela.
create index if not exists idx_weighing_operations_company_carrier
  on public.weighing_operations(company_id, carrier_id, created_at desc);
