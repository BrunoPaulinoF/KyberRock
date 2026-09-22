-- O aviso de que o cadastro mudou — para o outro computador nao precisar PERGUNTAR.
--
-- Com a chegada imediata (`triggerCadastroCloudPush`) o cadastro sai da maquina que editou em
-- segundos, e com `cloud_synced_at` (migracao `202609150001`) o pull incremental finalmente
-- enxerga o que chegou. Sobrou o ultimo degrau: a outra balanca so descobre isso no proximo
-- tique do relogio dela, a cada 15 s. Na media sao ~7 s de espera por uma linha que ja esta na
-- nuvem, e 15 s no pior caso — com o caminhao na balanca e a operadora olhando a tela, e
-- exatamente o intervalo em que ela liga para o comercial perguntando se ja cadastrou.
--
-- Esta tabela e o aviso. UMA linha por empresa, com a hora da ultima mudanca de cadastro:
--
--   1. qualquer escrita em qualquer tabela de cadastro carimba a linha da empresa;
--   2. o Realtime do Supabase publica essa escrita (`supabase_realtime`);
--   3. a balanca, inscrita em `company_id=eq.<a dela>`, puxa NA HORA em vez de esperar o tique.
--
-- O ciclo de 15 s continua existindo e nao muda: e ele que cobre a balanca que estava sem
-- internet, o aviso perdido e o Realtime fora do ar. O aviso ADIANTA o pull; nao e por onde o
-- cadastro anda.
--
-- ## Por que uma tabela de aviso, e nao o Realtime direto nas tabelas de cadastro
--
-- Publicar `customers` no Realtime exigiria abrir a tabela para leitura direta do cliente — e a
-- politica dela e "no direct client access" (`qual = false`) desde sempre: o cadastro so sai da
-- nuvem pelo `desktop-pull`, autenticado pelo token do dispositivo. Trocar isso por "toda
-- balanca le a tabela com a chave publica" seria pagar o tempo real com o modelo de acesso
-- inteiro.
--
-- O que esta tabela expoe e so isto: um UUID de empresa e um horario. Nenhum nome, nenhum
-- documento, nenhum preco. Quem recebe o aviso ainda precisa do token do dispositivo para pedir
-- o cadastro ao `desktop-pull` — o aviso nao carrega dado e nao abre porta nenhuma; ele so diz
-- "vale a pena perguntar agora".
--
-- ## Por que o gatilho e por STATEMENT, e nao por linha
--
-- O `omie-sync` grava cadastro em lote: um gatilho por linha carimbaria a mesma linha de aviso
-- milhares de vezes na mesma transacao, e cada carimbo e um evento que sai para todas as
-- balancas. Por statement, um lote de 500 clientes gera UM aviso — que e a informacao real
-- ("mudou algo no cadastro desta empresa"), ja que o pull seguinte traz o lote inteiro de
-- qualquer jeito.
--
-- ## Por que a falha do aviso nao pode derrubar a escrita
--
-- O gatilho roda dentro da transacao de quem gravou o cadastro. Se o carimbo falhar (tabela
-- recem-criada, permissao, o que for), o certo e perder o AVISO, nunca o cadastro: sem o aviso
-- a linha chega no tique de 15 s, como chegava antes desta migracao. Por isso todo o corpo do
-- gatilho vive dentro de um `exception when others then null`.

create table if not exists public.cadastro_change_pings (
  company_id uuid primary key references public.companies (id) on delete cascade,
  changed_at timestamptz not null default now(),
  -- So diagnostico ("qual tabela disparou o ultimo aviso"). A balanca nao le esta coluna: ela
  -- puxa o cadastro inteiro que mudou desde o cursor dela, e nao so a tabela citada aqui.
  source text
);

comment on table public.cadastro_change_pings is
  'Uma linha por empresa com a hora da ultima mudanca de cadastro. Publicada no Realtime para a balanca puxar na hora em vez de esperar o tique de 15 s. Nao carrega dado de cadastro — so o UUID da empresa e o horario.';

alter table public.cadastro_change_pings enable row level security;

-- A balanca se conecta ao Realtime com a chave publicavel, sem sessao de usuario: a inscricao
-- entra como `anon`. Sem politica de SELECT o Realtime nao entrega evento nenhum.
drop policy if exists "read cadastro change pings" on public.cadastro_change_pings;
create policy "read cadastro change pings"
  on public.cadastro_change_pings
  for select
  to anon, authenticated
  using (true);

-- Escrita e so de quem grava cadastro (o gatilho, no papel do `service_role`). Cliente nenhum
-- carimba aviso: um aviso falso so faria a frota puxar a toa.
revoke all on public.cadastro_change_pings from anon, authenticated;
grant select on public.cadastro_change_pings to anon, authenticated;

-- Sem isto o Realtime nao publica a tabela. `company_id` e a chave primaria, entao o filtro
-- `company_id=eq.<uuid>` da balanca ja funciona com a replica identity padrao.
do $$
begin
  alter publication supabase_realtime add table public.cadastro_change_pings;
exception
  when duplicate_object then null;
end;
$$;

create or replace function public.ping_cadastro_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.cadastro_change_pings (company_id, changed_at, source)
    select distinct new_rows.company_id, now(), tg_table_name
      from new_rows
     where new_rows.company_id is not null
    on conflict (company_id) do update
      set changed_at = excluded.changed_at,
          source = excluded.source;
  exception
    -- Perder o aviso adia a chegada em ate 15 s (o tique continua la). Perder a escrita do
    -- cadastro por causa do aviso seria trocar um atraso por um dado que nunca existiu.
    when others then
      raise warning 'ping_cadastro_change falhou em %: %', tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;

comment on function public.ping_cadastro_change() is
  'Carimba cadastro_change_pings com a hora da mudanca. Gatilho por STATEMENT (um aviso por lote) e a prova de falha: o aviso se perde, o cadastro nunca.';

do $$
declare
  cadastro_table text;
begin
  -- As mesmas 21 tabelas que o pull incremental do desktop varre (`_shared/cadastro-delta.ts`) e
  -- que a `202609150001` ja carimba com `cloud_synced_at`. As tabelas de OPERACAO ficam de fora
  -- de proposito: pesagem, solicitacao de carregamento e cupom ja tinham caminho imediato.
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
    execute format('drop trigger if exists ping_cadastro_change_insert on public.%I', cadastro_table);
    execute format(
      'create trigger ping_cadastro_change_insert after insert on public.%I '
      || 'referencing new table as new_rows for each statement '
      || 'execute function public.ping_cadastro_change()',
      cadastro_table
    );

    -- INSERT e UPDATE em gatilhos separados porque a tabela de transicao e declarada por
    -- evento: um unico `after insert or update ... referencing new table` nao e aceito.
    execute format('drop trigger if exists ping_cadastro_change_update on public.%I', cadastro_table);
    execute format(
      'create trigger ping_cadastro_change_update after update on public.%I '
      || 'referencing new table as new_rows for each statement '
      || 'execute function public.ping_cadastro_change()',
      cadastro_table
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
