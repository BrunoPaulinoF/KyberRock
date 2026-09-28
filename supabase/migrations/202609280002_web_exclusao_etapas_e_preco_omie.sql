-- KyberRock Web: excluir cadastro, etapas do caminhao na pedreira e o preco do OMIE na nuvem.
--
-- 1) Motorista e placa ganham `deleted_at` na nuvem. Ate aqui o cliente e a transportadora ja
--    tinham a lapide (migracao `202609220002`), mas motorista e veiculo so sabiam "inativo": a
--    exclusao feita na balanca subia como `is_active = false` e o site nao tinha como excluir.
--    Agora a `web-api` (`delete_driver` / `delete_vehicle`) carimba a lapide junto com o
--    `is_active = false` — a balanca antiga le o inativo, a nova le a lapide — e a balanca passa
--    a enviar a exclusao dela do mesmo jeito.
alter table public.drivers add column if not exists deleted_at timestamptz;
alter table public.vehicles add column if not exists deleted_at timestamptz;

-- 2) Etapas do caminhao (tela Comercial do site: ENTRADA -> CARREGANDO -> SAIDA). A entrada e a
--    saida ja existiam (`weighing_operations.created_at` / `closed_at`) e o fim da carga tambem
--    (`loading_requests.loader_completed_at`, que o carregador marca). Faltava o INICIO da carga,
--    que o carregador passa a marcar no botao "Iniciar" da tela dele. Nao vai para a balanca: o
--    `desktop-sync` grava a solicitacao sem esta coluna, entao o upsert da balanca nao a apaga.
alter table public.loading_requests add column if not exists loader_started_at timestamptz;

-- 3) Preco do OMIE na nuvem. Na balanca o preco padrao do produto e o da tabela de preco padrao
--    OU, sem ela, o valor unitario que veio do OMIE (`products.unit_price_cents`) — e a balanca
--    nunca enviava esse valor, entao o site mostrava "Sem preco" para quase todo produto. A
--    balanca passa a envia-lo; ate ela atualizar, preenche aqui o preco base que ela usou na
--    ultima pesagem de cada produto sem preco padrao (`base_unit_price_cents`, que e exatamente
--    esse valor). O envio da balanca substitui este numero pelo do OMIE.
update public.products p
set unit_price_cents = last_sale.base_unit_price_cents
from (
  select distinct on (o.product_id)
    o.product_id,
    o.base_unit_price_cents
  from public.weighing_operations o
  where o.product_id is not null
    and o.base_unit_price_cents is not null
    and o.base_unit_price_cents > 0
    and o.status <> 'cancelled'
  order by o.product_id, coalesce(o.closed_at, o.created_at) desc
) last_sale
where p.id = last_sale.product_id
  and p.unit_price_cents is null
  and not exists (
    select 1
    from public.product_default_prices d
    where d.product_id = p.id
      and d.deleted_at is null
      and d.is_active
  );

notify pgrst, 'reload schema';
