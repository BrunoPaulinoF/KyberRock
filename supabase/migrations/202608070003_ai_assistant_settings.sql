-- Credenciais da IA do assistente da documentacao.
--
-- A configuracao e GLOBAL, nao por empresa: todas as pedreiras usam a mesma
-- conta de IA, cadastrada uma unica vez no painel administrativo do loader-web.
-- Por isso a tabela e um singleton (`id` boolean travado em true) em vez de ter
-- `company_id` — deixar a chave por empresa daria a impressao de que cada
-- pedreira precisa da sua, que e o contrario da decisao de produto.
--
-- A chave fica em texto puro porque a Edge Function precisa envia-la ao
-- provedor. A protecao e o RLS abaixo: sem policy de leitura, nem `anon` nem
-- `authenticated` enxergam a linha — so o service_role das Edge Functions. O
-- painel administrativo nunca le a chave de volta, so grava e recebe os quatro
-- ultimos caracteres para conferencia.

create table if not exists public.ai_assistant_settings (
  id boolean primary key default true,
  provider text not null default 'openai',
  api_key text,
  model text not null default 'gpt-4.1-mini',
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint ai_assistant_settings_singleton check (id)
);

alter table public.ai_assistant_settings enable row level security;

create policy "no direct client access"
  on public.ai_assistant_settings for all
  to anon, authenticated
  using (false)
  with check (false);

-- Linha unica ja criada: assim a Edge Function e o painel leem/atualizam sem
-- precisar tratar o caso "ainda nao existe".
insert into public.ai_assistant_settings (id)
values (true)
on conflict (id) do nothing;
