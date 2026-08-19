-- Link temporario de conexao do WhatsApp (tela de Relatorios do desktop).
--
-- O QR code da UAZAPI so serve a quem esta na frente do computador da balanca,
-- e quase nunca e ali que fica o celular dono do numero. Este link resolve
-- isso: a balanca gera um endereco publico e curto, quem tem o aparelho abre no
-- proprio celular e escaneia o QR de la.
--
-- Por isso o registro guarda apenas o HASH do token (o valor em claro so existe
-- na URL que o operador enviou) e nasce com prazo: 15 minutos depois de criado
-- ele nao abre mais. Revogar, expirar e conectar sao estados distintos de
-- proposito -- a pagina precisa dizer ao visitante o que aconteceu, e um link ja
-- usado nao pode virar uma segunda janela de pareamento.

create table if not exists public.whatsapp_connection_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  -- Quem gerou o link (device_registrations.id e text, nao uuid).
  device_id text references public.device_registrations(id) on delete set null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  connected_at timestamptz,
  last_opened_at timestamptz,
  open_count integer not null default 0
);

comment on table public.whatsapp_connection_links is
  'Links temporarios (15 min) para parear o WhatsApp da pedreira fora do computador da balanca. Guarda so o hash do token.';

-- A busca por token usa o unique de token_hash; este indice serve a listagem
-- por empresa (revogar os links ativos ao gerar um novo).
create index if not exists whatsapp_connection_links_company_active_idx
  on public.whatsapp_connection_links (company_id, expires_at desc);

alter table public.whatsapp_connection_links enable row level security;

-- Ninguem fala com esta tabela pelo PostgREST: quem le e escreve e a Edge
-- Function `whatsapp-link`, com a service role. O token em claro nunca esta
-- aqui, mas a linha ainda diz qual pedreira esta pareando e quando -- nao ha
-- motivo para isso viajar ate um navegador.
drop policy if exists "no direct client access" on public.whatsapp_connection_links;
create policy "no direct client access"
  on public.whatsapp_connection_links for all
  to anon, authenticated
  using (false)
  with check (false);
