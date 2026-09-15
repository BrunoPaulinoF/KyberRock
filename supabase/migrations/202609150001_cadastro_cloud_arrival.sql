-- Quando a linha de cadastro CHEGOU na nuvem — que e diferente de quando alguem a editou.
--
-- O pull frequente do desktop (a cada 15 s) pede so o que mudou desde o ciclo anterior, e o
-- recorte era `updated_at > cadastroSince`. Acontece que `updated_at` e a hora da maquina que
-- CRIOU o cadastro, e o `desktop-sync` grava esse valor como veio — enquanto o cadastro so sai
-- da maquina de origem na varredura completa, que roda a cada 30 min. Entre uma coisa e outra
-- abre um buraco permanente:
--
--   10:00  o comercial cadastra o cliente          -> updated_at = 10:00 no SQLite dele
--   10:28  a varredura publica a linha             -> a nuvem grava updated_at = 10:00
--   10:29  a expedicao faz o pull incremental      -> pede updated_at > 10:24 (cursor - 5 min)
--          ... e a linha de 10:00 nao entra nesse recorte. Nunca mais vai entrar: o cursor da
--          expedicao so anda para a frente.
--
-- O cliente ficava esperando a proxima varredura COMPLETA da expedicao (ate mais 30 min, e ela
-- pode ser desligada nas configuracoes) para aparecer. Nos casos em que a diferenca passa dos
-- 5 min de folga do cursor — cadastro feito offline, computador que passou a noite fechado,
-- relogio local atrasado — o cadastro simplesmente nao chegava pelo caminho rapido.
--
-- `cloud_synced_at` e a hora do RELOGIO DA NUVEM no momento em que a linha foi gravada aqui, e
-- e por ela que o `desktop-pull` passa a recortar o incremental. Assim "o que mudou desde o meu
-- ultimo pull" quer dizer o que chegou na nuvem desde entao, que e a pergunta certa: nao depende
-- do relogio de cada computador da pedreira nem de quanto tempo a linha demorou para subir.
--
-- Quem carimba e um GATILHO, nao o payload: alem do `desktop-sync`, escrevem nestas tabelas o
-- painel administrativo, o `omie-sync` e o proprio desligamento da linha perdedora da disputa de
-- preco (o tombstone que precisa chegar nas outras balancas). Carimbar no gatilho garante que
-- toda escrita entre na janela, inclusive as que ainda nem existem.
--
-- O `default now()` na coluna vale tambem para o backfill: a linha que ja estava na nuvem recebe
-- a hora desta migracao. Ela nao "reaparece" no pull de ninguem por causa disso (o cursor de cada
-- balanca ja esta a frente), e nao precisa: quem ja a tem, tem.

create or replace function public.stamp_cloud_synced_at()
returns trigger
language plpgsql
as $$
begin
  new.cloud_synced_at := now();
  return new;
end;
$$;

comment on function public.stamp_cloud_synced_at() is
  'Carimba cloud_synced_at com o relogio da nuvem em toda escrita de cadastro. E o recorte do pull incremental do desktop (desktop-pull), e por isso nao pode depender do valor enviado no payload.';

do $$
declare
  cadastro_table text;
begin
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
    execute format(
      'alter table public.%I add column if not exists cloud_synced_at timestamptz not null default now()',
      cadastro_table
    );

    execute format(
      'comment on column public.%I.cloud_synced_at is %L',
      cadastro_table,
      'Quando esta linha foi gravada NA NUVEM. Recorte do pull incremental do desktop — nao confundir com updated_at, que e a hora da maquina que editou o cadastro.'
    );

    -- O pull filtra por empresa e por chegada; o id entra porque a paginacao ordena por ele.
    execute format(
      'create index if not exists %I on public.%I (company_id, cloud_synced_at, id)',
      'idx_' || cadastro_table || '_cloud_synced_at',
      cadastro_table
    );

    execute format('drop trigger if exists stamp_cloud_synced_at on public.%I', cadastro_table);
    execute format(
      'create trigger stamp_cloud_synced_at before insert or update on public.%I for each row execute function public.stamp_cloud_synced_at()',
      cadastro_table
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
