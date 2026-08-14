-- Notas de VENDA PARA ENTREGA FUTURA do cliente na projecao da nuvem.
--
-- A pedreira emite uma NF-e de simples faturamento (CFOP 5.922/6.922) e o cliente vai
-- retirando a carga aos poucos; cada retirada e uma remessa de entrega futura (CFOP
-- 5.116/5.117) que precisa referenciar aquele faturamento. O numero e digitado no cadastro
-- do cliente na balanca e carimbado no cupom e nos dados adicionais do pedido no OMIE.
--
-- Uma linha por (cliente, produto) porque a nota e emitida por tipo de produto: o mesmo
-- cliente tem uma nota de rachao e outra de brita, e a pesagem de rachao tem que sair com
-- o numero da nota de rachao. `product_id` nulo vale para qualquer produto do cliente.
--
-- Projetar a tabela e o que faz o cadastro atravessar de uma balanca para a outra: sem ela
-- a segunda maquina da pedreira fatura o mesmo cliente sem a referencia da nota. Mesmo
-- desenho de `public.customer_freight_rules`, que ja resolve "por produto, com padrao".

create table if not exists public.customer_future_billing_invoices (
  id text primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id text not null references public.customers(id) on delete cascade,
  product_id text references public.products(id) on delete cascade,
  nfe_number text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Os mesmos dois indices unicos parciais do SQLite (migracao 52). Sem eles a nuvem
-- aceitaria duas notas vigentes para o mesmo par e cada balanca ficaria com a sua — o
-- upsert local descarta a linha conflitante, entao a divergencia nao apareceria em lugar
-- nenhum ate as duas maquinas faturarem o mesmo cliente com numeros diferentes.
create unique index if not exists idx_customer_future_billing_customer_product
  on public.customer_future_billing_invoices(customer_id, product_id)
  where deleted_at is null and product_id is not null;
create unique index if not exists idx_customer_future_billing_customer_default
  on public.customer_future_billing_invoices(customer_id)
  where deleted_at is null and product_id is null;

create index if not exists idx_customer_future_billing_company
  on public.customer_future_billing_invoices(company_id);
create index if not exists idx_customer_future_billing_customer
  on public.customer_future_billing_invoices(customer_id);
create index if not exists idx_customer_future_billing_product
  on public.customer_future_billing_invoices(product_id);
-- O pull incremental filtra por (company_id, updated_at), como nas demais tabelas de
-- cadastro (ver 202608050002_incremental_pull_indexes.sql).
create index if not exists idx_customer_future_billing_company_updated
  on public.customer_future_billing_invoices(company_id, updated_at);

alter table public.customer_future_billing_invoices enable row level security;

-- Sem policy: so as Edge Functions (service role, autenticadas por device token) leem e
-- escrevem esta tabela. O loader-web nao precisa dela.

notify pgrst, 'reload schema';
