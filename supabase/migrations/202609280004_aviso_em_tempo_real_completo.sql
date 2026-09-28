-- Tudo o que muda na nuvem avisa o site na hora — inclusive exclusao e carregamento.
--
-- Os dois avisos ja existiam: `cadastro_change_pings` (202609220001) para o cadastro e
-- `operation_change_pings` (202609260001) para a pesagem. Sobravam tres buracos:
--
--   1. Nenhum dos dois ouvia DELETE. Quase tudo e exclusao logica (`deleted_at`, que e UPDATE e
--      ja avisava), mas a unificacao de clientes (202609220002) apaga de verdade vinculos de
--      transportadora — e quem estava com a tela aberta nao ficava sabendo.
--   2. `loading_requests` nao avisava: o carregador comecar ou terminar de carregar so aparecia
--      nas telas de operacao do site no tique de reserva delas.
--   3. O aviso de pesagem nao dizia de que tabela veio. Agora diz (`source`), como o de cadastro,
--      para cada tela so reler quando mudou o que ela mostra.
--
-- Mesmas regras de sempre: gatilho por STATEMENT (um aviso por lote) e a prova de falha (perder
-- o aviso so atrasa a tela ate a releitura de reserva; perder a escrita seria inaceitavel).

-- 1) Pesagem: o aviso passa a dizer a tabela.
alter table public.operation_change_pings add column if not exists source text;

create or replace function public.ping_operation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.operation_change_pings (company_id, changed_at, source)
    select distinct new_rows.company_id, now(), tg_table_name
      from new_rows
     where new_rows.company_id is not null
    on conflict (company_id) do update
      set changed_at = excluded.changed_at,
          source = excluded.source;
  exception
    when others then
      raise warning 'ping_operation_change falhou em %: %', tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;

-- A mesma conta para DELETE, lendo a tabela de transicao das linhas que SAIRAM.
create or replace function public.ping_operation_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.operation_change_pings (company_id, changed_at, source)
    select distinct old_rows.company_id, now(), tg_table_name
      from old_rows
     where old_rows.company_id is not null
    on conflict (company_id) do update
      set changed_at = excluded.changed_at,
          source = excluded.source;
  exception
    when others then
      raise warning 'ping_operation_delete falhou em %: %', tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.ping_operation_change() from public, anon, authenticated;
revoke execute on function public.ping_operation_delete() from public, anon, authenticated;

do $$
declare
  operation_table text;
begin
  foreach operation_table in array array['weighing_operations', 'loading_requests']
  loop
    execute format('drop trigger if exists ping_operation_change_insert on public.%I', operation_table);
    execute format(
      'create trigger ping_operation_change_insert after insert on public.%I '
      || 'referencing new table as new_rows for each statement '
      || 'execute function public.ping_operation_change()',
      operation_table
    );

    execute format('drop trigger if exists ping_operation_change_update on public.%I', operation_table);
    execute format(
      'create trigger ping_operation_change_update after update on public.%I '
      || 'referencing new table as new_rows for each statement '
      || 'execute function public.ping_operation_change()',
      operation_table
    );

    execute format('drop trigger if exists ping_operation_change_delete on public.%I', operation_table);
    execute format(
      'create trigger ping_operation_change_delete after delete on public.%I '
      || 'referencing old table as old_rows for each statement '
      || 'execute function public.ping_operation_delete()',
      operation_table
    );
  end loop;
end;
$$;

-- 2) Cadastro: exclusao de verdade tambem avisa.
create or replace function public.ping_cadastro_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.cadastro_change_pings (company_id, changed_at, source)
    select distinct old_rows.company_id, now(), tg_table_name
      from old_rows
     where old_rows.company_id is not null
    on conflict (company_id) do update
      set changed_at = excluded.changed_at,
          source = excluded.source;
  exception
    when others then
      raise warning 'ping_cadastro_delete falhou em %: %', tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;

comment on function public.ping_cadastro_delete() is
  'Carimba cadastro_change_pings quando linhas de cadastro sao apagadas de verdade. Gatilho por STATEMENT e a prova de falha, como ping_cadastro_change.';

revoke execute on function public.ping_cadastro_delete() from public, anon, authenticated;

do $$
declare
  cadastro_table text;
begin
  -- As mesmas 21 tabelas de `202609220001`.
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
    execute format('drop trigger if exists ping_cadastro_change_delete on public.%I', cadastro_table);
    execute format(
      'create trigger ping_cadastro_change_delete after delete on public.%I '
      || 'referencing old table as old_rows for each statement '
      || 'execute function public.ping_cadastro_delete()',
      cadastro_table
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
