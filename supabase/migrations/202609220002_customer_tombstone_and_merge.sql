-- A nuvem passa a saber que um cadastro FOI EXCLUIDO — e os duplicados que ja estao aqui sao
-- unificados.
--
-- ## O furo
--
-- `public.customers` (e `carriers`) nao tinha `deleted_at`. Para a nuvem, existir era estar
-- vivo. O desktop ja mandava `is_active = false` no lugar, mas cadastro inativo continua
-- aparecendo na tela de clientes de proposito (e assim que o operador acha e reativa), entao a
-- linha excluida numa balanca voltava a ocupar a lista das outras com outro rotulo.
--
-- Pior: o pull do desktop tinha, literalmente,
--
--     deleted_at = CASE WHEN customers.needs_push = 0 THEN NULL ELSE customers.deleted_at END
--
-- ou seja, todo ciclo RESSUSCITAVA o que a maquina tinha excluido — e foi assim que a limpeza
-- de duplicados da migracao local 39 (que marcava a perdedora com `needs_push = 0`) se desfez
-- sozinha no ciclo seguinte. O par que o operador via na tela ("MORAES - AREIA E PEDRA LTDA",
-- um LOCAL e um OMIE, mesmo CNPJ e mesmo codigo OMIE) estava nesse estado desde 01/08/2026.
--
-- ## O que esta migracao faz
--
-- 1. cria a coluna `deleted_at` nas duas tabelas — a partir daqui a exclusao VIAJA, e uma
--    unificacao feita em qualquer balanca chega nas outras em vez de voltar;
-- 2. unifica, de uma vez, os cadastros que ja estao duplicados AQUI: o historico (pesagem,
--    orcamento, extrato de credito, vinculos) muda de dono e a perdedora vira tombstone.
--
-- O passo 2 tambem roda em cada balanca, na abertura (`mergeDuplicateCustomersByDocument`). Nao
-- e redundancia: a nuvem precisa da limpeza porque as pesagens projetadas aqui alimentam o
-- painel e o loader, e a balanca precisa da sua porque o SQLite dela e a fonte da operacao. O
-- que nao pode variar e a REGRA de quem fica — ela e a mesma nos dois lugares e na migracao
-- local 39: primeiro quem tem codigo OMIE (e o cadastro que o ERP conhece), depois o mais
-- antigo, empate no menor id. Regra igual nos dois lados = as duas pontas convergem para a
-- mesma sobrevivente sem precisar combinar nada.
--
-- Duplicado por NOME (sem documento) fica de fora, aqui e la: matriz e filial dividem o nome e
-- sao clientes diferentes. Esse caso vai para o botao "Unificar" da tela, com o operador
-- decidindo.

alter table public.customers add column if not exists deleted_at timestamptz;
alter table public.carriers add column if not exists deleted_at timestamptz;

comment on column public.customers.deleted_at is
  'Quando o cadastro foi excluido (ou encerrado por unificacao) na balanca. E o tombstone que o desktop-pull usa para tirar a linha das outras maquinas — sem ele, "existe na nuvem" era a unica resposta possivel e todo pull ressuscitava o que uma balanca tinha excluido.';
comment on column public.carriers.deleted_at is
  'Mesma marca de customers.deleted_at, para a transportadora excluida numa balanca nao voltar pelo espelho.';

do $$
declare
  grupos int;
begin
  -- Pares (perdedora -> sobrevivente) do MESMO documento, dentro da mesma empresa.
  create temporary table cadastro_merge on commit drop as
  with vivos as (
    select id,
           company_id,
           omie_customer_id,
           created_at,
           upper(regexp_replace(coalesce(document, ''), '[^0-9A-Za-z]', '', 'g')) as doc_key
      from public.customers
     where deleted_at is null
  ),
  chaveados as (
    select *,
           first_value(id) over (
             partition by company_id, doc_key
             order by (case when omie_customer_id is not null then 0 else 1 end),
                      created_at,
                      id
           ) as keeper_id
      from vivos
     where doc_key <> ''
  )
  select id as loser_id, keeper_id, company_id
    from chaveados
   where id <> keeper_id;

  select count(*) into grupos from cadastro_merge;
  raise notice 'cadastros duplicados a unificar: %', grupos;

  -- Vinculos com chave natural: a linha da perdedora que colidiria com uma que a sobrevivente
  -- ja tem e DESCARTADA antes do repontamento — repontar violaria o indice unico e derrubaria
  -- a migracao inteira.
  update public.customer_special_prices sp
     set deleted_at = now()
    from cadastro_merge m
   where sp.customer_id = m.loser_id
     and sp.deleted_at is null
     and exists (
       select 1 from public.customer_special_prices keep
        where keep.customer_id = m.keeper_id
          and keep.product_id is not distinct from sp.product_id
          and keep.deleted_at is null
     );

  update public.customer_vehicles cv
     set deleted_at = now()
    from cadastro_merge m
   where cv.customer_id = m.loser_id
     and cv.deleted_at is null
     and exists (
       select 1 from public.customer_vehicles keep
        where keep.customer_id = m.keeper_id
          and keep.vehicle_id is not distinct from cv.vehicle_id
          and keep.deleted_at is null
     );

  update public.customer_future_billing_invoices fb
     set deleted_at = now()
    from cadastro_merge m
   where fb.customer_id = m.loser_id
     and fb.deleted_at is null
     and exists (
       select 1 from public.customer_future_billing_invoices keep
        where keep.customer_id = m.keeper_id
          and keep.product_id is not distinct from fb.product_id
          and keep.nfe_number is not distinct from fb.nfe_number
          and keep.deleted_at is null
     );

  -- Sem indice unico na nuvem, mas COM ele no SQLite: sem descartar aqui, a proxima publicacao
  -- da balanca traria a linha ja apagada e as duas versoes ficariam brigando.
  update public.customer_freight_rules fr
     set deleted_at = now()
    from cadastro_merge m
   where fr.customer_id = m.loser_id
     and fr.deleted_at is null
     and exists (
       select 1 from public.customer_freight_rules keep
        where keep.customer_id = m.keeper_id
          and keep.product_id is not distinct from fr.product_id
          and keep.deleted_at is null
     );

  -- Tabela de preco: quem fica ja tendo uma tabela mantem a dela. Duas tabelas vinculadas ao
  -- mesmo cliente nao teriam desempate previsivel na hora de precificar.
  update public.customer_price_tables cpt
     set deleted_at = now()
    from cadastro_merge m
   where cpt.customer_id = m.loser_id
     and cpt.deleted_at is null
     and exists (
       select 1 from public.customer_price_tables keep
        where keep.customer_id = m.keeper_id
          and keep.deleted_at is null
     );

  -- `customer_carriers` tem `(customer_id, carrier_id)` unico e NAO tem deleted_at: aqui o
  -- descarte e a remocao da linha repetida mesmo.
  delete from public.customer_carriers cc
   using cadastro_merge m
   where cc.customer_id = m.loser_id
     and exists (
       select 1 from public.customer_carriers keep
        where keep.customer_id = m.keeper_id
          and keep.carrier_id = cc.carrier_id
     );

  -- Repontamento: tudo o que sobrou passa para a sobrevivente.
  update public.weighing_operations o set customer_id = m.keeper_id
    from cadastro_merge m where o.customer_id = m.loser_id;

  update public.quotations q set customer_id = m.keeper_id
    from cadastro_merge m where q.customer_id = m.loser_id;

  update public.customer_credit_movements cm set customer_id = m.keeper_id
    from cadastro_merge m where cm.customer_id = m.loser_id;

  update public.customer_special_prices sp set customer_id = m.keeper_id
    from cadastro_merge m where sp.customer_id = m.loser_id;

  update public.customer_freight_rules fr set customer_id = m.keeper_id
    from cadastro_merge m where fr.customer_id = m.loser_id;

  update public.customer_future_billing_invoices fb set customer_id = m.keeper_id
    from cadastro_merge m where fb.customer_id = m.loser_id;

  update public.customer_vehicles cv set customer_id = m.keeper_id
    from cadastro_merge m where cv.customer_id = m.loser_id;

  update public.customer_carriers cc set customer_id = m.keeper_id
    from cadastro_merge m where cc.customer_id = m.loser_id;

  update public.customer_price_tables cpt set customer_id = m.keeper_id
    from cadastro_merge m where cpt.customer_id = m.loser_id;

  -- Saldo de credito: a linha da perdedora sai e o saldo de quem fica e RECALCULADO pelo
  -- extrato ja unificado — somar dois saldos prontos repetiria qualquer ajuste manual.
  delete from public.customer_credit_balances b
   using cadastro_merge m where b.customer_id = m.loser_id;

  update public.customer_credit_balances b
     set balance_cents = coalesce((
           select sum(case when cm.movement_type in ('debit_product', 'debit_freight')
                           then -cm.amount_cents else cm.amount_cents end)
             from public.customer_credit_movements cm
            where cm.customer_id = b.customer_id
         ), 0),
         updated_at = now()
   where b.customer_id in (select keeper_id from cadastro_merge);

  -- A sobrevivente herda o codigo OMIE que so a perdedora tinha: sem ele, o proximo pedido
  -- tentaria um IncluirCliente de quem ja existe la e a fila pararia em "Cliente ja cadastrado".
  update public.customers k
     set omie_customer_id = coalesce(k.omie_customer_id, l.omie_customer_id),
         omie_integration_code = coalesce(k.omie_integration_code, l.omie_integration_code),
         updated_at = now()
    from cadastro_merge m
    join public.customers l on l.id = m.loser_id
   where k.id = m.keeper_id
     and k.omie_customer_id is null
     and l.omie_customer_id is not null;

  -- E o tombstone, que e o que faz a limpeza chegar nas balancas.
  update public.customers c
     set deleted_at = now(),
         is_active = false,
         updated_at = now()
    from cadastro_merge m
   where c.id = m.loser_id;
end;
$$;

notify pgrst, 'reload schema';
