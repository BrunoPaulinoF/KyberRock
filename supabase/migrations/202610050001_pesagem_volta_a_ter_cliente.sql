-- Pesagem que perdeu o cliente na nuvem volta a ter cliente.
--
-- ## O furo
--
-- Cliente com dois cadastros na nuvem (mesmo CNPJ, ids diferentes — a Levisa tem
-- `omie_11488403507` e um criado numa balanca) fica com UM so em cada balanca: o pull descarta o
-- gemeo (`findLocalCadastroWithDocument`). A pesagem fechada na expedicao aponta para um id; nas
-- outras balancas esse id nao existe, e la ela vira pesagem sem cliente. Quando uma dessas
-- balancas confere a nota no OMIE ela reenvia a pesagem com o MESMO `updated_at`, e o
-- `desktop-sync` gravava o vazio por cima: a nuvem perdia `customer_id` e `customer_name`.
--
-- Na Pedreira Ibiuna foram 95 pesagens (57 da Levisa, desde 03/08/2026). O site le a nuvem, entao
-- a Conferencia de faturamento mostrava 0 pesagens da Levisa de 08 a 19/09 — contra 15
-- (457,6 t, R$ 24.250,68) no computador da expedicao, que guarda o cliente certo.
--
-- O `desktop-sync` agora nao deixa o vazio apagar o cliente (`keepOperationLinks`, em
-- `_shared/operation-writes.ts`). Esta migracao devolve o cliente as que ja tinham perdido.
--
-- ## De onde vem o cliente
--
-- Do CUPOM. A via impressa e congelada no fechamento (`print_receipts.content_snapshot_json`) e
-- traz a linha "Documento: <CNPJ/CPF>" do cliente que a balanca tinha na pesagem — e nenhum
-- reenvio mexe nela. O documento e comparado sem pontuacao e sem caixa, mas COM as letras do
-- CNPJ alfanumerico. Entre os cadastros vivos com o mesmo documento fica o da mesma regra da
-- unificacao (`202609220002`): primeiro quem tem codigo OMIE, depois o mais antigo, empate no
-- menor id — o mesmo que as balancas escolhem ao unificar.
--
-- O nome do cupom (`loading_requests.customer_name`) nao entra: matriz e filial dividem o nome.
-- Pesagem sem cupom com documento fica como esta.
--
-- `updated_at` nao muda: a linha nao ficou mais nova, so voltou a dizer quem e o cliente. Com o
-- `updated_at` antigo, nenhuma balanca troca a copia dela por esta.
--
-- ## Ordem
--
-- Aplicar DEPOIS do deploy do `desktop-sync` com `keepOperationLinks`: antes dele, a proxima
-- conferencia de nota de uma balanca sem o cadastro apagaria o cliente de novo. Rodar duas vezes
-- nao faz mal — so mexe em pesagem que ainda esta sem cliente.

with documento_do_cupom as (
  select distinct on (cupom.operation_id) cupom.operation_id, cupom.doc_key
    from (
      select pr.operation_id,
             pr.created_at,
             upper(
               regexp_replace(substring(l.line from '^Documento:(.*)$'), '[^0-9A-Za-z]', '', 'g')
             ) as doc_key
        from public.print_receipts pr
        join public.weighing_operations o on o.id = pr.operation_id and o.customer_id is null
        cross join lateral jsonb_array_elements_text(
          case
            when jsonb_typeof(pr.content_snapshot_json -> 'lines') = 'array'
              then pr.content_snapshot_json -> 'lines'
            else '[]'::jsonb
          end
        ) as l(line)
       where l.line like 'Documento:%'
    ) as cupom
   where cupom.doc_key <> ''
   order by cupom.operation_id, cupom.created_at
),
cliente as (
  select distinct on (o.id)
         o.id as operation_id,
         c.id as customer_id,
         coalesce(nullif(trim(c.trade_name), ''), c.legal_name) as customer_name
    from public.weighing_operations o
    join documento_do_cupom d on d.operation_id = o.id
    join public.customers c
      on c.company_id = o.company_id
     and c.deleted_at is null
     and upper(regexp_replace(coalesce(c.document, ''), '[^0-9A-Za-z]', '', 'g')) = d.doc_key
   order by o.id, (coalesce(c.omie_customer_id, 0) > 0) desc, c.created_at asc, c.id asc
)
update public.weighing_operations o
   set customer_id = cliente.customer_id,
       customer_name = coalesce(nullif(trim(o.customer_name), ''), cliente.customer_name)
  from cliente
 where o.id = cliente.operation_id
   and o.customer_id is null;
