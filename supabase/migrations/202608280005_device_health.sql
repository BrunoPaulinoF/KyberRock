-- Saude da fila de envio de cada balanca, vista do painel.
--
-- Da frota o painel enxergava duas coisas: `last_seen_at` ("esta ligada") e `app_version`
-- ("esta em tal versao"). Nenhuma delas responde a pergunta que o suporte realmente faz:
-- esta balanca esta ENTREGANDO o que fecha? Fila parada, envio esperando clique do operador
-- (dead_letter, e o bloqueado por cadastro incompleto para NF-e) e o motivo da ultima recusa
-- so existiam na tela daquele computador — entao o problema chegava por telefone, depois de
-- a pedreira ja ter parado.
--
-- Quem preenche e o proprio desktop, no `desktop-status`, o ping que ja roda a cada 5 s. Nao
-- ha chamada nova: o resumo viaja junto do pedido que ja existia. O desktop o recalcula no
-- maximo uma vez por minuto, entao o dado envelhece esse minuto mais o tempo que a balanca
-- passar offline (`health_collected_at` diz quando foi lido NA BALANCA, que e diferente de
-- quando chegou aqui).
--
-- E um RESUMO de proposito, nao um espelho da `sync_queue`: contagem, data mais antiga e uma
-- mensagem truncada. Replicar a fila na nuvem criaria um segundo lugar de onde os dados da
-- operacao vazam, e o painel nao precisa deles para dizer "esta balanca parou".
--
-- Nulo tem significado proprio e NAO pode virar zero na tela: e a balanca que ainda nao se
-- reportou depois desta migracao (instalacao antiga, maquina desligada). "Nao sei" e uma
-- resposta diferente de "fila limpa" — e a diferenca entre o painel calar e o painel mentir.

alter table public.device_registrations
  add column if not exists health_queue_pending integer;

alter table public.device_registrations
  add column if not exists health_queue_blocked integer;

alter table public.device_registrations
  add column if not exists health_oldest_pending_at timestamptz;

alter table public.device_registrations
  add column if not exists health_last_error text;

alter table public.device_registrations
  add column if not exists health_collected_at timestamptz;

comment on column public.device_registrations.health_queue_pending is
  'Envios que ainda andam sozinhos (pendentes, em curso e em backoff). Numero alto = fila comprida, nao fila parada. Nulo = a balanca nunca se reportou.';

comment on column public.device_registrations.health_queue_blocked is
  'Envios que PARARAM e esperam gente: dead_letter e os bloqueados por falha deterministica (cadastro incompleto). Maior que zero = alguem precisa agir nesta balanca.';

comment on column public.device_registrations.health_oldest_pending_at is
  'Quando entrou na fila a coisa mais antiga ainda nao entregue. E o que separa "10 envios agora" de "10 envios parados desde terca".';

comment on column public.device_registrations.health_last_error is
  'Motivo da recusa mais recente entre os envios nao entregues, truncado. Existe para o suporte saber o porque sem ligar para a pedreira.';

comment on column public.device_registrations.health_collected_at is
  'Quando este resumo foi lido NA BALANCA. Diferente de last_seen_at: o desktop recalcula no maximo uma vez por minuto.';

notify pgrst, 'reload schema';
