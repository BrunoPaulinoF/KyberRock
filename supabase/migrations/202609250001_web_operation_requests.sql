-- Operacao pelo site: o site PEDE a pesagem, a balanca executora EXECUTA.
--
-- Contexto: `docs/plano-migracao-web.md` ("Operacao pelo site") e `docs/web-api.md`. Mesmo
-- desenho do fechamento de faturas (`202609220004_billing_projection_and_requests`), e pelo
-- mesmo motivo: a conta da pesagem (preco na entrada, frete, credito/adiantamento, faturamento
-- futuro, pedido do OMIE, fila do carregador, numero da pesagem, cupom) vive inteira no
-- desktop. Reescreve-la na nuvem seria uma segunda copia de regra fiscal — e duas copias foi o
-- que produziu os numeros diferentes entre maquinas. Entao o site nao pesa: ele deixa um
-- PEDIDO aqui, a balanca marcada como executora da unidade o executa pelas mesmas funcoes dos
-- botoes do desktop, imprime o cupom na impressora dela e devolve o resultado.
--
-- ## Tipos de pedido (`kind`)
--
--   entry   nova entrada, com o peso DIGITADO no site (como a balanca virtual)
--   exit    fechamento (peso de saida digitado); o cupom sai na impressora da executora
--   update  alterar pesagem (cliente, produto, veiculo, motorista, transportadora, forma e
--           condicao de pagamento, tipo, preco)
--   cancel  cancelar pesagem
--   reprint reimprimir o cupom na impressora da executora
--
-- ## Por que o pedido de ENTRADA carrega o id da pesagem
--
-- Um pedido `processing` sem resposta volta para a fila (a balanca caiu no meio). Se a balanca
-- chegou a registrar a entrada antes de cair, executar de novo criaria um SEGUNDO caminhao no
-- patio. Por isso o id da pesagem nasce aqui (`operation_id`, preenchido pela `web-api`) e a
-- balanca registra a entrada com ESSE id: a segunda execucao encontra a pesagem e so devolve o
-- resultado.

create table if not exists public.operation_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  unit_id uuid not null references public.units (id) on delete cascade,
  kind text not null check (kind in ('entry', 'exit', 'update', 'cancel', 'reprint')),
  -- Pesagem alvo. Na entrada e o id que a balanca vai usar (ver acima). Sem FK: a pesagem so
  -- chega a `weighing_operations` depois do push da balanca.
  operation_id text not null,
  payload jsonb not null default '{}'::jsonb,
  requested_by uuid references public.user_profiles (id) on delete set null,
  requested_by_name text,
  requested_at timestamptz not null default now(),
  -- pending: esperando a executora; processing: ela pegou; done/failed: resultado devolvido.
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  claimed_by_device_id text references public.device_registrations (id) on delete set null,
  claimed_at timestamptz,
  processed_at timestamptz,
  result_message text,
  -- Resumo da pesagem depois de executada (codigo, pesos, totais), para o site mostrar sem
  -- esperar o push da operacao.
  result jsonb,
  -- So no fechamento e na reimpressao: 'printed' | 'failed' | 'skipped'.
  print_status text check (print_status in ('printed', 'failed', 'skipped')),
  print_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.operation_requests is
  'Pedidos de pesagem feitos pelo site (web-api request_operation). A balanca executora da unidade os executa (desktop-operation-requests) e devolve o resultado.';

create index if not exists idx_operation_requests_unit_status
  on public.operation_requests (unit_id, status, requested_at);
create index if not exists idx_operation_requests_company_requested
  on public.operation_requests (company_id, requested_at desc);
create index if not exists idx_operation_requests_operation
  on public.operation_requests (operation_id);

-- A checagem da `web-api` ("ja existe fechamento ou cancelamento desta pesagem na fila") e
-- ler-e-depois-gravar: dois cliques simultaneos passariam os dois, e a balanca fecharia (cupom,
-- pedido no OMIE) e cancelaria em seguida. O indice e a garantia no banco.
create unique index if not exists operation_requests_one_close_or_cancel
  on public.operation_requests (operation_id)
  where status in ('pending', 'processing') and kind in ('exit', 'cancel');

alter table public.operation_requests enable row level security;

-- Escrita so pela web-api e pela desktop-operation-requests (chave de servico).
drop policy if exists "no direct client access" on public.operation_requests;
create policy "no direct client access"
  on public.operation_requests for all
  to anon, authenticated
  using (false);

drop policy if exists "web users can read operation_requests from own company" on public.operation_requests;
create policy "web users can read operation_requests from own company"
  on public.operation_requests for select
  to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.id = (select auth.uid())
        and p.role in ('monitoramento', 'operacao', 'comercial', 'gestor')
        and p.company_id = operation_requests.company_id
        and p.is_active = true
    )
  );

-- O site acompanha o pedido ao vivo (enviando -> registrando -> pronto) pelo Realtime, com o
-- login do usuario: a politica acima e o que decide o que ele recebe.
do $$
begin
  alter publication supabase_realtime add table public.operation_requests;
exception
  when duplicate_object then null;
end;
$$;

-- O aviso para a balanca. Mesmo desenho de `cadastro_change_pings` (202609220001): a balanca
-- entra no Realtime com a chave publicavel, sem sessao, e nao pode ler `operation_requests`.
-- Esta tabela so diz "chegou pedido para a unidade X as 14:32" — nenhum dado da pesagem —, e a
-- balanca busca o pedido pelo caminho autenticado (`desktop-operation-requests`). O tique de
-- 30 s da balanca continua cobrindo aviso perdido e Realtime fora do ar.
create table if not exists public.operation_request_pings (
  unit_id uuid primary key references public.units (id) on delete cascade,
  requested_at timestamptz not null default now()
);

comment on table public.operation_request_pings is
  'Uma linha por unidade com a hora do ultimo pedido de pesagem do site. Publicada no Realtime para a balanca executora pegar na hora. Nao carrega dado da pesagem.';

alter table public.operation_request_pings enable row level security;

drop policy if exists "read operation request pings" on public.operation_request_pings;
create policy "read operation request pings"
  on public.operation_request_pings
  for select
  to anon, authenticated
  using (true);

revoke all on public.operation_request_pings from anon, authenticated;
grant select on public.operation_request_pings to anon, authenticated;

do $$
begin
  alter publication supabase_realtime add table public.operation_request_pings;
exception
  when duplicate_object then null;
end;
$$;

create or replace function public.ping_operation_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.operation_request_pings (unit_id, requested_at)
    values (new.unit_id, now())
    on conflict (unit_id) do update set requested_at = excluded.requested_at;
  exception
    -- Perder o aviso atrasa o pedido ate o proximo tique da balanca (30 s). Perder o pedido por
    -- causa do aviso seria pior.
    when others then
      raise warning 'ping_operation_request falhou: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists operation_requests_ping on public.operation_requests;
create trigger operation_requests_ping
  after insert on public.operation_requests
  for each row execute function public.ping_operation_request();

-- Qual balanca executa os pedidos do site: uma por unidade, marcada no painel (Acessos do
-- sistema). `web_executor_seen_at` e carimbado pela `desktop-operation-requests` a cada vez que
-- a executora pergunta por pedidos — e o que o site usa para mostrar "PC PRINCIPAL conectada".
alter table public.device_registrations
  add column if not exists executes_web_operations boolean not null default false,
  add column if not exists web_executor_seen_at timestamptz;

create unique index if not exists device_registrations_one_web_executor_per_unit
  on public.device_registrations (unit_id)
  where executes_web_operations;

comment on column public.device_registrations.executes_web_operations is
  'Esta balanca executa os pedidos de pesagem do site (operation_requests) da unidade dela. Uma por unidade.';

-- Senha de alteracao de preco por login: quem tiver a marca precisa digitar a senha da pedreira
-- (`companies.price_change_password`) para mudar o preco de uma pesagem pelo site. Conferida na
-- `web-api`, nunca no navegador.
alter table public.user_profiles
  add column if not exists requires_price_password boolean not null default false;

-- Tentativas erradas da senha de preco pelo site. A senha e de 4 digitos e vale tambem na
-- balanca: sem limite, 10 mil pedidos descobririam. A `web-api` recusa depois de 5 erros em
-- 15 minutos por login.
create table if not exists public.price_password_failures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index if not exists idx_price_password_failures_user
  on public.price_password_failures (user_id, attempted_at desc);

alter table public.price_password_failures enable row level security;

drop policy if exists "no direct client access" on public.price_password_failures;
create policy "no direct client access"
  on public.price_password_failures for all
  to anon, authenticated
  using (false);

comment on column public.user_profiles.requires_price_password is
  'Pede a senha de alteracao de preco da pedreira quando este login muda o preco de uma pesagem pelo site.';

notify pgrst, 'reload schema';
