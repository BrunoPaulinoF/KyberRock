-- Liberar a balanca sem a senha de preco.
--
-- A senha rotativa de preco (migracao `202609280001`) obriga o comercial a ditar um codigo de
-- 6 digitos a cada alteracao feita na balanca. Num dia de muito ajuste de preco isso vira um
-- telefonema atras do outro. Agora o comercial pode LIBERAR as balancas da pedreira, na tela
-- "Senha de preco" do site, por um tempo (15 min, 1 h, ...) ou sem prazo — e voltar a pedir a
-- senha quando quiser. Enquanto liberada, a balanca faz sem senha tudo o que a senha protege la
-- (mudar preco, limpar operacoes, liberar o relatorio financeiro). O site continua pedindo a
-- senha para quem tem `requiresPricePassword`: a liberacao e so da balanca.
--
-- ## Por que uma linha por mudanca, e nao uma coluna em `company_price_codes`
--
-- Cada liberar / trocar o tempo / voltar a pedir senha e UMA linha nova, e o estado atual e a
-- linha mais recente da pedreira. Assim fica de graca o historico de quem liberou e quando, e a
-- `web-api` so insere (o mesmo jeito do resto do banco: nada e reescrito por cima).
--
-- ## Quem le
--
-- So a chave de servico (RLS sem politica), como `company_price_codes`: quem liberou e ate quando
-- e assunto do comercial. A `web-api` (`price_code` / `set_price_unlock`) e o `desktop-status`
-- leem por ela.

create table if not exists public.price_unlocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  -- Sem prazo: so volta a pedir senha quando o comercial mandar.
  indefinite boolean not null default false,
  -- Liberada ate esta hora (na hora da nuvem). Nulo e `indefinite = false` = pede senha.
  unlocked_until timestamptz,
  -- Quem mexeu (login do site) e o nome na hora, para o historico continuar legivel.
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  constraint price_unlocks_one_mode check (not (indefinite and unlocked_until is not null))
);

comment on table public.price_unlocks is
  'Liberacao da balanca sem a senha de preco: uma linha por mudanca, a mais recente vale. So a chave de servico le.';

create index if not exists idx_price_unlocks_company_created
  on public.price_unlocks (company_id, created_at desc);

alter table public.price_unlocks enable row level security;
revoke all on public.price_unlocks from anon, authenticated;
