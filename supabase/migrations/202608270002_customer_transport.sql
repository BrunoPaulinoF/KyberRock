-- Aba TRANSPORTE do cadastro do cliente: as placas daquele cliente e o tipo de frete padrao
-- dele.
--
-- Placa era cadastro solto na pedreira: a nova entrada oferecia TODAS as placas cadastradas,
-- e quem registra a entrada — com o caminhao em cima da balanca — tinha de achar a certa
-- numa lista de milhares. Errar ali nao para a operacao na hora: a placa sai no cupom, vai
-- para a nota, e o erro so aparece na conferencia do fechamento.
--
-- O vinculo e por CLIENTE (e nao por transportadora, que ja existe em vehicle_carriers):
-- quem chega para carregar e o caminhao do cliente, e e o nome dele que a balanca digita
-- primeiro. A projecao existe pelo mesmo motivo do resto do cadastro compartilhado: as
-- placas de um cliente tem de ser as mesmas em todas as balancas da pedreira.

create table if not exists public.customer_vehicles (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id text not null,
  vehicle_id text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_customer_vehicles_company
  on public.customer_vehicles (company_id);

create index if not exists idx_customer_vehicles_company_updated
  on public.customer_vehicles (company_id, updated_at);

create index if not exists idx_customer_vehicles_customer
  on public.customer_vehicles (customer_id);

-- Uma linha por par entre as vivas. Parcial em `deleted_at` para o mesmo par poder ser
-- desvinculado e vinculado de novo sem colidir com o tombstone antigo.
create unique index if not exists idx_customer_vehicles_pair
  on public.customer_vehicles (customer_id, vehicle_id)
  where deleted_at is null;

alter table public.customer_vehicles enable row level security;

comment on table public.customer_vehicles is
  'Placas de cada cliente (aba Transporte do cadastro). Filtra o campo Placa da nova entrada; nunca proibe uma placa de fora.';

-- Tipo de frete padrao do cliente: uma das chaves de FREIGHT_MODALITIES. E so um PADRAO —
-- preenche a nova entrada quando o cliente e escolhido e o operador ainda nao mexeu no
-- campo, e nunca sobrepoe a escolha feita na operacao. Nulo = sem padrao (o de sempre).
alter table public.customers
  add column if not exists default_freight_modality text;

comment on column public.customers.default_freight_modality is
  'Tipo de frete que este cliente costuma usar (aba Transporte). Preenche a nova entrada; nao trava a escolha do operador.';

notify pgrst, 'reload schema';
