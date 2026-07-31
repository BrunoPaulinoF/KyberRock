-- Origem do lancamento no extrato de credito do cliente.
--
-- Os adiantamentos sao registrados no financeiro do OMIE (titulo a receber numa
-- categoria de adiantamento, baixado quando o dinheiro entra). O KyberRock nao
-- cria esse lancamento: espelha o valor no extrato para que as compras da
-- balanca sejam abatidas do saldo. Sem marcar a origem, o mesmo adiantamento
-- poderia entrar duas vezes (espelhado + lancado a mao).

alter table public.customer_credit_movements
  add column if not exists source text not null default 'local';

-- codigo_lancamento_omie do titulo a receber que originou o adiantamento.
alter table public.customer_credit_movements
  add column if not exists omie_title_id bigint;

-- Idempotencia do espelho: o mesmo titulo do OMIE so pode virar um lancamento de
-- cada tipo por empresa, mesmo que duas balancas sincronizem ao mesmo tempo.
create unique index if not exists idx_customer_credit_movements_omie_title
  on public.customer_credit_movements(company_id, omie_title_id, movement_type)
  where omie_title_id is not null;

create index if not exists idx_customer_credit_movements_source
  on public.customer_credit_movements(customer_id, source);
