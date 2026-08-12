-- Cofre da senha que o painel definiu, para o administrador poder ve-la depois.
--
-- O problema: o Supabase Auth guarda bcrypt, que nao volta. Na pratica isso
-- significa que quem cadastra um carregador e precisa repassar a senha por
-- telefone dias depois nao tem onde consultar — e a saida virava redefinir a
-- senha de alguem que estava trabalhando normalmente.
--
-- A solucao aqui e capturar a senha NO MOMENTO em que o painel a define (criacao
-- do usuario ou redefinicao) e guardar CIFRADA. A chave nao fica no banco: vem
-- do secret `KYBERROCK_CREDENTIAL_KEY` do Supabase, entao um dump, um backup ou
-- uma consulta com service role nao abrem nada sozinhos. Ver
-- `_shared/credential-cipher.ts`.
--
-- Por que TABELA SEPARADA e nao coluna em `user_profiles`: o `admin-api` lista
-- os perfis com `select("*")`. Uma coluna ali viajaria para o navegador em todo
-- carregamento da tela de usuarios, mesmo sem ninguem pedir para ver senha
-- nenhuma. Aqui o valor so sai quando o botao de olho pergunta por ele.
--
-- Senha definida ANTES desta migracao continua irrecuperavel — nao existe em
-- lugar nenhum a nao ser como bcrypt. A tela diz isso e oferece redefinir.

create table if not exists public.user_password_vault (
  user_id uuid primary key references public.user_profiles(id) on delete cascade,
  -- Formato `v1.<base64(iv)>.<base64(ciphertext)>` (AES-GCM).
  ciphertext text not null,
  -- Quando a senha guardada aqui foi definida. Serve para a tela avisar quando
  -- ela esta velha em relacao a uma redefinicao feita por fora do painel.
  updated_at timestamptz not null default now()
);

comment on table public.user_password_vault is
  'Senha definida pelo painel administrativo, cifrada com a chave do secret KYBERROCK_CREDENTIAL_KEY. Nunca gravar texto puro aqui.';

alter table public.user_password_vault enable row level security;

-- Somente service role (Edge Functions). Nem anon nem authenticated enxergam.
drop policy if exists "no direct client access" on public.user_password_vault;
create policy "no direct client access"
  on public.user_password_vault for all
  to anon, authenticated
  using (false)
  with check (false);
