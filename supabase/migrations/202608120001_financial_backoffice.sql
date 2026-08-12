-- Backoffice financeiro do KyberRock (cobranca da plataforma).
--
-- Escopo: quem cobra e a Kybernan; quem paga e a PEDREIRA (`public.companies`).
-- Nao tem relacao com o financeiro das operacoes da balanca (esse vive no OMIE
-- e no relatorio de vendas) — aqui e a mensalidade do sistema, acertada caso a
-- caso com o comercial.
--
-- Tres blocos:
--   1. `companies` ganha o cadastro de cobranca: dados fiscais do boleto, valor
--      acertado, data de virada (inicio do uso), dia do fechamento, dia do
--      vencimento e carencia antes do bloqueio.
--   2. `billing_settings`: linha unica e GLOBAL (mesmo padrao de
--      `ai_assistant_settings`) com a credencial do Mercado Pago, a instancia
--      de WhatsApp da Kybernan e os padroes aplicados a quem nao tem valor
--      proprio — inclusive os dias de inadimplencia que disparam o bloqueio.
--   3. `billing_invoices` + `billing_events`: a fatura gerada no fechamento,
--      o boleto do Mercado Pago, o envio por WhatsApp e a trilha do que
--      aconteceu com cada uma.
--
-- O bloqueio automatico reaproveita `companies.payment_blocked` (migracao
-- 202607070003), que o `desktop-status` ja consulta para barrar a balanca.

-- ---------------------------------------------------------------------------
-- 1. Cadastro de cobranca da pedreira
-- ---------------------------------------------------------------------------

alter table public.companies
  -- Dados do sacado do boleto. Ficam separados de `legal_name`/`document`
  -- porque o cadastro comercial e o cadastro de cobranca divergem na pratica
  -- (matriz x filial, contato do financeiro x contato da operacao). Vazio =
  -- "use o do cadastro principal", resolvido na aplicacao.
  add column if not exists billing_legal_name text,
  add column if not exists billing_document text,
  add column if not exists billing_email text,
  add column if not exists billing_phone text,
  add column if not exists billing_contact_name text,
  add column if not exists billing_zipcode text,
  add column if not exists billing_address_street text,
  add column if not exists billing_address_number text,
  add column if not exists billing_address_complement text,
  add column if not exists billing_neighborhood text,
  add column if not exists billing_city text,
  add column if not exists billing_state text,
  -- Valor acertado com a pedreira, em centavos. Cada uma negocia o seu.
  add column if not exists billing_monthly_amount_cents integer,
  -- Data de virada do sistema: primeiro dia de uso cobrado. A primeira fatura
  -- e proporcional aos dias entre esta data e o primeiro fechamento.
  add column if not exists billing_start_date date,
  -- Dia do mes em que o ciclo fecha e a fatura e gerada (1-31, ajustado para o
  -- ultimo dia em meses curtos).
  add column if not exists billing_closing_day smallint,
  -- Dia do mes do vencimento do boleto (1-31).
  add column if not exists billing_due_day smallint,
  -- Dias de inadimplencia tolerados antes do bloqueio automatico. NULL = usa o
  -- padrao global de `billing_settings`.
  add column if not exists billing_grace_days smallint,
  -- Liga a cobranca automatica desta pedreira. Desligado, ela some do fechamento
  -- automatico mas continua podendo receber fatura avulsa pelo painel.
  add column if not exists billing_enabled boolean not null default false,
  -- Isenta do bloqueio automatico (piloto, cortesia, acordo em andamento).
  add column if not exists billing_block_exempt boolean not null default false,
  add column if not exists billing_notes text;

alter table public.companies
  drop constraint if exists companies_billing_closing_day_check;
alter table public.companies
  add constraint companies_billing_closing_day_check
  check (billing_closing_day is null or (billing_closing_day between 1 and 31));

alter table public.companies
  drop constraint if exists companies_billing_due_day_check;
alter table public.companies
  add constraint companies_billing_due_day_check
  check (billing_due_day is null or (billing_due_day between 1 and 31));

alter table public.companies
  drop constraint if exists companies_billing_grace_days_check;
alter table public.companies
  add constraint companies_billing_grace_days_check
  check (billing_grace_days is null or (billing_grace_days between 0 and 365));

alter table public.companies
  drop constraint if exists companies_billing_monthly_amount_check;
alter table public.companies
  add constraint companies_billing_monthly_amount_check
  check (billing_monthly_amount_cents is null or billing_monthly_amount_cents >= 0);

-- ---------------------------------------------------------------------------
-- 2. Configuracao global da cobranca
-- ---------------------------------------------------------------------------

create table if not exists public.billing_settings (
  -- Linha unica: `id` boolean travado em true, igual a `ai_assistant_settings`.
  id boolean primary key default true check (id),
  -- Mercado Pago. O access token NUNCA volta para o navegador: o admin-billing
  -- devolve apenas os quatro ultimos caracteres.
  mercado_pago_access_token text,
  mercado_pago_environment text not null default 'production'
    check (mercado_pago_environment in ('production', 'sandbox')),
  -- Segredo da assinatura das notificacoes (Webhooks > Assinatura secreta no
  -- painel do Mercado Pago). Opcional: sem ele o webhook ainda confirma o
  -- pagamento consultando a API, que e a fonte autoritativa.
  mercado_pago_webhook_secret text,
  -- Instancia UAZAPI da Kybernan usada para mandar fatura e boleto. E global,
  -- diferente de `report_channel_settings`, que e a instancia de cada pedreira.
  whatsapp_url text,
  whatsapp_instance_token text,
  whatsapp_instance_name text,
  whatsapp_status text,
  -- Padroes aplicados a pedreira que nao definiu o seu.
  default_closing_day smallint not null default 25
    check (default_closing_day between 1 and 31),
  default_due_day smallint not null default 5
    check (default_due_day between 1 and 31),
  -- "Depois de X dias de inadimplencia, bloqueio automatico."
  default_grace_days smallint not null default 5
    check (default_grace_days between 0 and 365),
  -- Chaves gerais do motor: fechar/cobrar/enviar/bloquear sozinho.
  auto_close_enabled boolean not null default true,
  auto_boleto_enabled boolean not null default true,
  auto_whatsapp_enabled boolean not null default true,
  auto_block_enabled boolean not null default true,
  -- Emitente impresso na fatura em PDF e no texto do WhatsApp.
  issuer_name text,
  issuer_document text,
  issuer_email text,
  issuer_phone text,
  issuer_pix_key text,
  invoice_description_template text,
  whatsapp_message_template text,
  updated_at timestamptz not null default now()
);

alter table public.billing_settings enable row level security;

drop policy if exists "no direct client access" on public.billing_settings;
create policy "no direct client access"
  on public.billing_settings for all
  to anon, authenticated
  using (false)
  with check (false);

insert into public.billing_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Faturas
-- ---------------------------------------------------------------------------

create sequence if not exists public.billing_invoice_number_seq;

create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Numero legivel da fatura. A sequence garante unicidade sem race; o ano so
  -- entra para leitura humana.
  number text not null unique default (
    'FAT-'
    || to_char(timezone('America/Sao_Paulo', now()), 'YYYY')
    || '-'
    || lpad(nextval('public.billing_invoice_number_seq')::text, 5, '0')
  ),
  status text not null default 'open'
    check (status in ('draft', 'open', 'paid', 'overdue', 'canceled')),
  -- Periodo coberto. `period_end` e o proprio dia do fechamento.
  period_start date not null,
  period_end date not null,
  closing_date date not null,
  due_date date not null,
  reference_label text not null,
  -- `base_amount_cents` e o valor do PERIODO ja rateado (na primeira fatura sai
  -- menor que a mensalidade); `amount_cents` e o que vai no boleto, ou seja
  -- base + acrescimo - desconto.
  base_amount_cents integer not null default 0 check (base_amount_cents >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  discount_cents integer not null default 0 check (discount_cents >= 0),
  addition_cents integer not null default 0 check (addition_cents >= 0),
  -- Rateio da fatura parcial: dias cobrados sobre dias do ciclo cheio.
  prorated_days integer,
  full_period_days integer,
  is_prorated boolean not null default false,
  notes text,
  -- Boleto no provedor (hoje sempre Mercado Pago).
  boleto_provider text not null default 'mercado_pago',
  boleto_status text,
  boleto_payment_id text,
  boleto_url text,
  boleto_barcode text,
  boleto_expires_at date,
  boleto_error text,
  boleto_attempts integer not null default 0,
  boleto_issued_at timestamptz,
  -- Envio pelo WhatsApp.
  whatsapp_to text,
  whatsapp_sent_at timestamptz,
  whatsapp_error text,
  whatsapp_attempts integer not null default 0,
  -- Liquidacao e bloqueio.
  paid_at timestamptz,
  paid_amount_cents integer,
  payment_method text,
  canceled_at timestamptz,
  cancel_reason text,
  blocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Idempotencia do fechamento: uma fatura viva por ciclo. Faturas canceladas
-- ficam de fora para permitir refazer um fechamento errado.
create unique index if not exists idx_billing_invoices_company_period
  on public.billing_invoices(company_id, period_end)
  where status <> 'canceled';

create index if not exists idx_billing_invoices_company_created
  on public.billing_invoices(company_id, created_at desc);
create index if not exists idx_billing_invoices_status_due
  on public.billing_invoices(status, due_date);
create index if not exists idx_billing_invoices_payment_id
  on public.billing_invoices(boleto_payment_id)
  where boleto_payment_id is not null;

alter table public.billing_invoices enable row level security;

drop policy if exists "no direct client access" on public.billing_invoices;
create policy "no direct client access"
  on public.billing_invoices for all
  to anon, authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------------------------
-- 4. Trilha do que aconteceu com cada fatura
-- ---------------------------------------------------------------------------

create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  invoice_id uuid references public.billing_invoices(id) on delete cascade,
  event_type text not null,
  message text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_billing_events_invoice
  on public.billing_events(invoice_id, created_at desc);
create index if not exists idx_billing_events_company
  on public.billing_events(company_id, created_at desc);

alter table public.billing_events enable row level security;

drop policy if exists "no direct client access" on public.billing_events;
create policy "no direct client access"
  on public.billing_events for all
  to anon, authenticated
  using (false)
  with check (false);
