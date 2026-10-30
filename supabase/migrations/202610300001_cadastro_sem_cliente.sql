-- Cadastro SEM CLIENTE ja nasce cadastrado em cada pedreira.
--
-- A Pedreira Ibiuna precisa passar caminhao na balanca sem vincular cliente nenhum
-- (transporte interno, caminhao da propria pedreira). O cliente "SEM CLIENTE" e a opcao para
-- isso: escolhido na Nova entrada, a pesagem sai a R$ 0,00, sem credito, sem cadastro nem
-- pedido no OMIE (ver `packages/shared/src/no-customer.ts` e AGENTS.md "Pesagem SEM CLIENTE").
--
-- Ele nasce AQUI, na nuvem, e nao por um botao na balanca: assim ja esta na lista de clientes
-- de todas as balancas da pedreira (o pull de cadastro o traz, avisado pelo
-- `cadastro_change_pings`) e no site, sem ninguem precisar criar.
--
-- O id e `sem-cliente-<company_id>`: e por ele — nunca pelo nome — que a balanca e o site
-- reconhecem o cadastro. O bloco comercial vai publicado (`commercial_published_at`) para as
-- balancas adotarem "nao exige NF" e "sem conta de credito" em vez do padrao da tabela local.
--
-- Pedreira nova: rodar este mesmo insert de novo. Ele e idempotente (`on conflict do nothing`)
-- e nao mexe no cadastro que ja existe — nem reativa o que alguem inativou.

insert into public.customers (
  id,
  company_id,
  legal_name,
  trade_name,
  observations,
  is_active,
  nf_required,
  credit_mode,
  credit_account_enabled,
  credit_periodicity,
  commercial_published_at
)
select 'sem-cliente-' || c.id::text,
       c.id,
       'SEM CLIENTE',
       'SEM CLIENTE',
       'Pesagem sem cliente: sai sem valor e nao vai ao OMIE.',
       true,
       false,
       'normal',
       false,
       'monthly',
       now()
  from public.companies c
on conflict (id) do nothing;
