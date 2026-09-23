-- Quando a PESAGEM chegou na nuvem — o mesmo conserto da `202609150001_cadastro_cloud_arrival`,
-- agora para o historico (pesagens, pedidos de carregamento e vias impressas).
--
-- O pull frequente do desktop pede "o que mudou desde o meu ultimo pull" tambem para o
-- historico, e o recorte era `updated_at > historySince`. Mas `updated_at` e a hora da maquina
-- que EDITOU a pesagem, e o `desktop-sync` grava esse valor como veio. Quando a mudanca demora
-- mais que os 5 min de folga do cursor para subir, ela fica fora da janela de todo mundo que ja
-- puxou — e o cursor so anda para a frente.
--
-- Foi assim que carga CANCELADA entrou no fechamento de frete do transportador (Pedreira
-- Ibiuna, 23/09/2026): a balanca cancela as 12:56, o envio chega na nuvem as 13:02, e o
-- computador que faz o fechamento, que ja tinha puxado as 13:00, nunca fica sabendo. Para ele a
-- carga continua concluida e entra na fatura e no bloco "Transportadores e placas". Na nuvem,
-- 21 das 112 pesagens canceladas depois de fechadas chegaram com mais de 5 min de atraso. So a
-- varredura completa resgatava — e ela pode estar desligada na maquina.
--
-- `cloud_synced_at` e a hora do RELOGIO DA NUVEM no momento da gravacao, carimbada pelo mesmo
-- gatilho do cadastro (`stamp_cloud_synced_at`), e e por ela que o `desktop-pull` passa a
-- recortar o historico (`_shared/history-window.ts`).
--
-- O `default now()` vale tambem para as linhas que ja existem: todas recebem a hora desta
-- migracao, entao o proximo pull incremental de cada balanca traz o historico recente inteiro
-- uma vez (o mesmo que a varredura completa ja faz). E isso que entrega os cancelamentos que se
-- perderam aos computadores que ainda os tem como concluidos — sem precisar atualizar nenhum.

do $$
declare
  history_table text;
begin
  foreach history_table in array array[
    'weighing_operations',
    'loading_requests',
    'print_receipts'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists cloud_synced_at timestamptz not null default now()',
      history_table
    );

    execute format(
      'comment on column public.%I.cloud_synced_at is %L',
      history_table,
      'Quando esta linha foi gravada NA NUVEM. Recorte do pull incremental do desktop — nao confundir com updated_at, que e a hora da maquina que editou a pesagem.'
    );

    -- O pull filtra por unidade e por chegada.
    execute format(
      'create index if not exists %I on public.%I (unit_id, cloud_synced_at)',
      'idx_' || history_table || '_cloud_synced_at',
      history_table
    );

    execute format('drop trigger if exists stamp_cloud_synced_at on public.%I', history_table);
    execute format(
      'create trigger stamp_cloud_synced_at before insert or update on public.%I for each row execute function public.stamp_cloud_synced_at()',
      history_table
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
