-- O pull incremental perguntava 21 vezes o que cabe numa pergunta so.
--
-- A cada ~1 min cada balanca chama o `desktop-pull` pedindo "o cadastro que mudou desde o meu
-- ultimo pull". A funcao respondia varrendo UMA TABELA POR VEZ -- clientes, produtos,
-- transportadoras, motoristas, veiculos, vinculos, precos, contas, credito, destinatarios: 21
-- consultas HTTP ao PostgREST, quase todas devolvendo lista vazia, porque cadastro de pedreira
-- muda algumas vezes por dia e nao a cada minuto.
--
-- Medido em 16/09/2026: 273 mil requisicoes em 24 h para OITO balancas, e ~113 mil delas eram
-- exatamente essas varreduras vazias -- de longe o maior consumidor do projeto. Nao era volume
-- de DADO (as respostas eram vazias); era volume de VIAGEM.
--
-- Esta funcao faz as 21 varreduras dentro do banco e devolve numa viagem so. Cada uma usa o
-- indice que a migracao `202609150001` ja criou (`company_id, cloud_synced_at, id`), entao sao
-- 21 buscas de indice que nao acham nada -- trabalho proximo de zero -- em vez de 21 idas e
-- vindas pela rede.
--
-- O RECORTE E `cloud_synced_at`, a hora da NUVEM ao gravar, pelo mesmo motivo de sempre
-- (`_shared/cadastro-window.ts`): `updated_at` e a hora da maquina que EDITOU, e recortar por
-- ela deixa cair a linha publicada depois de criada.
--
-- TRUNCAMENTO. O cursor do desktop e o relogio do servidor, nao a ultima linha lida: uma
-- resposta cortada pela metade avancaria o cursor por cima do que ficou de fora, e o cadastro
-- so reapareceria na varredura completa. Por isso a funcao pede `p_limit + 1` linhas: passou do
-- teto, a tabela **nao** entra no resultado e o nome dela sai em `truncated` -- o `desktop-pull`
-- entao busca essa tabela pelo caminho paginado de sempre. Melhor uma viagem a mais do que um
-- cliente que nunca chega.
--
-- Esta e uma funcao de OTIMIZACAO, nao de regra: enquanto ela nao existir (deploy da Edge
-- Function antes da migracao) o `desktop-pull` usa o caminho antigo, tabela por tabela. Nada
-- deixa de chegar; so chega em mais viagens.
--
-- A varredura COMPLETA (sem `p_since`) nao passa por aqui de proposito: ela pede o cadastro
-- inteiro da pedreira, que e justamente o caso em que paginar importa.

create or replace function public.desktop_pull_cadastro_delta(
  p_company_id uuid,
  p_since timestamptz,
  p_limit integer default 1000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  cadastro_table text;
  table_rows jsonb;
  changed jsonb := '{}'::jsonb;
  truncated text[] := array[]::text[];
begin
  -- Sem empresa ou sem corte isto seria "me da o cadastro inteiro", que e a varredura
  -- completa: ela tem caminho proprio, paginado, e nao deve cair aqui por engano.
  if p_company_id is null or p_since is null then
    raise exception 'desktop_pull_cadastro_delta exige p_company_id e p_since';
  end if;

  if p_limit is null or p_limit < 1 then
    p_limit := 1000;
  end if;

  foreach cadastro_table in array array[
    'customers',
    'products',
    'carriers',
    'drivers',
    'vehicles',
    'customer_carriers',
    'customer_vehicles',
    'driver_carriers',
    'vehicle_carriers',
    'product_default_prices',
    'customer_special_prices',
    'price_tables',
    'price_table_items',
    'customer_price_tables',
    'customer_freight_rules',
    'customer_future_billing_invoices',
    'payment_terms',
    'payment_methods',
    'accounts',
    'customer_credit_movements',
    'report_recipients'
  ]
  loop
    -- `to_jsonb(t)` leva a linha INTEIRA: coluna nova entra sozinha na proxima migracao, sem
    -- ninguem precisar lembrar de acrescenta-la aqui.
    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb)
         from (
           select * from public.%I
           where company_id = $1 and cloud_synced_at > $2
           order by cloud_synced_at, id
           limit $3
         ) t',
      cadastro_table
    )
    into table_rows
    using p_company_id, p_since, p_limit + 1;

    if jsonb_array_length(table_rows) > p_limit then
      truncated := truncated || cadastro_table;
    elsif jsonb_array_length(table_rows) > 0 then
      changed := changed || jsonb_build_object(cadastro_table, table_rows);
    end if;
  end loop;

  -- `tables` traz so quem mudou: a resposta tipica e `{"tables": {}, "truncated": []}`, que e
  -- o que se quer ver num minuto em que ninguem cadastrou nada.
  return jsonb_build_object('tables', changed, 'truncated', to_jsonb(truncated));
end;
$$;

comment on function public.desktop_pull_cadastro_delta(uuid, timestamptz, integer) is
  'Cadastro compartilhado alterado desde p_since (recorte cloud_synced_at), numa viagem so em vez de 21. Tabela acima de p_limit linhas sai em truncated para o desktop-pull busca-la paginada.';

-- Chamada so pelo `desktop-pull`, que usa a service role. Sem isto o PostgREST exporia a
-- funcao para anon/authenticated, e ela recebe o `company_id` por parametro: qualquer um com
-- a chave publica leria o cadastro de OUTRA pedreira.
revoke all on function public.desktop_pull_cadastro_delta(uuid, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.desktop_pull_cadastro_delta(uuid, timestamptz, integer)
  to service_role;
