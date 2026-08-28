-- Versao do KyberRock que cada balanca esta REALMENTE rodando.
--
-- A aba "Atualizacoes do desktop" sabia o que foi PUBLICADO em cada anel, e nao o que
-- chegou: liberar uma versao para producao nao instala nada — a balanca so troca de versao
-- quando verifica (a cada 30 min) e o operador fecha o app. Entre a liberacao e a frota
-- inteira instalada passam horas ou dias, e ate agora nao havia como saber quanto falta,
-- nem qual computador ficou para tras (a maquina que fica dias sem fechar o app instala
-- dias depois, e era invisivel).
--
-- Quem preenche e o proprio desktop, no `desktop-status` — a validacao de acesso que ja
-- roda de 30 em 30 segundos quando ha internet. Nao ha chamada nova: a versao viaja junto
-- do pedido que ja existia, e por isso o dado envelhece no maximo o tempo que a balanca
-- passa offline (`app_version_seen_at` diz quando foi lida).
--
-- Nulo tem significado proprio e nao pode virar zero na tela: e a balanca que ainda nao se
-- reportou depois desta migracao (instalacao antiga, maquina desligada). "Nao sei" e uma
-- resposta diferente de "esta desatualizada".

alter table public.device_registrations
  add column if not exists app_version text;

alter table public.device_registrations
  add column if not exists app_version_seen_at timestamptz;

comment on column public.device_registrations.app_version is
  'Versao do desktop instalada nesta balanca (MAJOR.MINOR.PATCH), reportada pelo proprio app no desktop-status. Nulo = nunca se reportou.';

comment on column public.device_registrations.app_version_seen_at is
  'Quando a versao instalada foi reportada pela ultima vez. Balanca offline mantem a leitura antiga.';

notify pgrst, 'reload schema';
