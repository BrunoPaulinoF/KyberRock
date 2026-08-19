-- Anel de atualizacao de cada balanca: quem recebe versao em avaliacao e quem so recebe
-- versao ja liberada.
--
-- Desde que compilar deixou de ser distribuir (ver "Desktop versioning" no AGENTS.md), todo
-- build fica parado numa release pre-release com um metadado de nome neutro. O
-- `desktop-promote.yml` copia esse metadado para o anel escolhido:
--
--   `beta.yml`   -> so as balancas com update_channel = 'beta' (as de teste)
--   `latest.yml` -> todas as demais (producao)
--
-- Esta coluna e o outro lado dessa mecanica: sem ela, `beta.yml` existe na release mas nao
-- e consumido por maquina nenhuma. O `desktop-status` devolve o valor a cada validacao de
-- acesso e o desktop grava localmente, para o canal sobreviver a reinicio e a queda de
-- internet.
--
-- `default 'latest'` e o ponto que protege a frota: balanca ja instalada, balanca nova e
-- balanca cujo valor nao seja reconhecido ficam todas em producao. Entrar no anel de teste
-- e sempre um ato explicito do administrador — o desktop tambem normaliza nesse sentido
-- (`normalizeUpdateChannel`), entao um valor estranho aqui nunca tira uma pedreira do
-- canal estavel.

alter table public.device_registrations
  add column if not exists update_channel text not null default 'latest';

alter table public.device_registrations
  drop constraint if exists device_registrations_update_channel_check;

alter table public.device_registrations
  add constraint device_registrations_update_channel_check
  check (update_channel in ('latest', 'beta'));

comment on column public.device_registrations.update_channel is
  'Anel de atualizacao desta balanca: latest (producao, padrao) ou beta (recebe as versoes em avaliacao antes da frota). Definido no painel administrativo e entregue ao desktop pelo desktop-status.';

notify pgrst, 'reload schema';
