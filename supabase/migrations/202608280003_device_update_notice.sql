-- Aviso de atualizacao que o painel manda para uma balanca.
--
-- Liberar uma versao para producao nao instala nada: a balanca verifica a cada 30 min, baixa
-- em segundo plano e so aplica quando o operador fecha o app. O computador que fica dias sem
-- fechar continua na versao velha, e ate agora o unico jeito de apressar isso era telefonar
-- para a pedreira. Estas colunas sao esse telefonema: o painel marca a versao pedida, o
-- `desktop-status` entrega o aviso no ping que ja existe e o desktop avisa o operador na tela
-- — que continua sendo quem decide reiniciar, porque instalar reinicia o app e uma balanca
-- pesando caminhao nao pode ser interrompida pela nuvem.
--
-- `update_notice_version` guarda a VERSAO pedida, e nao um booleano, por dois motivos: a tela
-- do operador precisa dizer para qual versao ele esta sendo chamado, e o aviso se apaga
-- sozinho quando a balanca reporta estar naquela versao (`desktop-status`) — sem isso o
-- painel acumularia avisos vencidos que alguem teria de limpar a mao.
--
-- `update_notice_seen_at` marca quando o aviso foi ENTREGUE aquela balanca, e nao quando o
-- operador respondeu: e o que separa "a maquina esta desligada / sem internet" de "ela
-- recebeu o recado e ninguem clicou".

alter table public.device_registrations
  add column if not exists update_notice_version text;

alter table public.device_registrations
  add column if not exists update_notice_sent_at timestamptz;

alter table public.device_registrations
  add column if not exists update_notice_seen_at timestamptz;

comment on column public.device_registrations.update_notice_version is
  'Versao para a qual o painel pediu que esta balanca atualize. Nulo = nenhum aviso pendente; o proprio desktop-status limpa quando a balanca passa a reportar essa versao.';

comment on column public.device_registrations.update_notice_sent_at is
  'Quando o aviso de atualizacao foi disparado no painel.';

comment on column public.device_registrations.update_notice_seen_at is
  'Quando o aviso foi entregue a balanca (primeiro desktop-status depois do disparo). Nulo com aviso pendente = maquina desligada ou sem internet.';

notify pgrst, 'reload schema';
