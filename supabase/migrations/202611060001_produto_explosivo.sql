-- Produto EXPLOSIVO ja nasce cadastrado em cada pedreira.
--
-- Pedido da Pedreira Ibiuna (28/10/2026): pesar os caminhoes de explosivos e tirar um ticket
-- com o peso para arquivar com a documentacao quando houver explosao — sem valor, so para
-- registrar o que usou. A pesagem usa o cliente SEM CLIENTE (`202610300001`), que sai a
-- R$ 0,00 e nao vai ao OMIE; faltava o PRODUTO, porque a lista da balanca so tinha os
-- produtos de venda do OMIE.
--
-- O EXPLOSIVO e um produto proprio do KyberRock (sem `omie_product_id`), que nasce AQUI, na
-- nuvem, e chega as balancas pelo pull de cadastro como qualquer produto. O id e
-- `explosivo-<company_id>`: e por ele — nunca pelo nome — que a balanca o reconhece
-- (`packages/shared/src/no-customer.ts`). Ela so o oferece com o SEM CLIENTE e recusa a
-- combinacao com cliente de verdade, que nao tem preco nem codigo do OMIE para o pedido.
--
-- Pedreira nova: rodar este mesmo insert de novo. Ele e idempotente (`on conflict do nothing`)
-- e nao mexe no produto que ja existe — nem reativa o que alguem inativou.

insert into public.products (
  id,
  company_id,
  code,
  description,
  unit,
  is_active,
  blocked,
  tracks_stock,
  internal_notes
)
select 'explosivo-' || c.id::text,
       c.id,
       'EXPLOSIVO',
       'EXPLOSIVO',
       'T',
       true,
       false,
       false,
       'Registro do explosivo da detonacao: so com o cliente SEM CLIENTE, sai sem valor e nao vai ao OMIE.'
  from public.companies c
on conflict (id) do nothing;
