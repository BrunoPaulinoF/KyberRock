-- Coluna para guardar a publishable key do Supabase retornada ao desktop na ativacao.
-- Configurada pelo admin no loader-web ao criar/editar a unidade. Sem ela, o desktop
-- instalado nao consegue inicializar o cliente Supabase em producao (process.env nao
-- expoe SUPABASE_PUBLISHABLE_KEY no Electron empacotado).

alter table public.units
  add column if not exists desktop_publishable_key text;

comment on column public.units.desktop_publishable_key is
  'Chave publica (publishable/anon) do Supabase retornada ao desktop durante a ativacao. Configurada pelo admin ao cadastrar a unidade.';
