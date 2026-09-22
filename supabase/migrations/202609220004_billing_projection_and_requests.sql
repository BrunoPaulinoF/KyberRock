-- Fechamento de faturas pelo site: a nuvem passa a saber o que ja virou nota, e o site
-- passa a PEDIR o faturamento que a balanca EXECUTA.
--
-- Contexto: `docs/plano-migracao-web.md` (Etapa 2, item 6) e `docs/web-api.md` (secao 4.7).
--
-- ## Por que a balanca continua faturando
--
-- Faturar no OMIE e `create_and_bill_order`, e o pedido que vai para la e montado pela
-- balanca a partir do que so ela tem inteiro: parcelas da condicao de pagamento, meio de
-- pagamento e conta corrente, frete e transportador, abatimento do adiantamento
-- (`buildOmieBillingJob`, `processFiscalBillingNow`). Reconstruir isso na nuvem seria uma
-- segunda copia de regra fiscal — e pedido montado errado vira NF-e errada. Entao o site nao
-- fatura: ele deixa um PEDIDO nesta tabela, a balanca da unidade o pega no tique de 30 s da
-- fila OMIE, fatura pelo mesmo caminho do botao "Fazer fechamento" e devolve o resultado.
--
-- ## Por que projetar o status do faturamento
--
-- `omie_billing_status`, `omie_billing_message` e `omie_invoice_number` viviam so no SQLite.
-- Sem eles a tela de fechamento do site nao sabe o que ja tem nota (e nao pode pedir de novo:
-- refaturar e problema fiscal). A balanca passa a envia-los no push da operacao; a nuvem sem
-- as colunas continua aceitando o push (`upsertSkippingUnknownColumns`).

alter table public.weighing_operations
  add column if not exists omie_billing_status text,
  add column if not exists omie_billing_message text,
  add column if not exists omie_invoice_number text;

comment on column public.weighing_operations.omie_billing_status is
  'Situacao do faturamento no OMIE, como a balanca a conhece (billed, cadastro_incompleto, failed, ...). Projecao: quem decide e a balanca.';
comment on column public.weighing_operations.omie_invoice_number is
  'Numero da NF-e emitida pelo OMIE para esta pesagem, quando ja existe. Uma pesagem com numero nunca e faturada de novo.';

create table if not exists public.billing_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  unit_id uuid not null references public.units (id) on delete cascade,
  operation_id text not null references public.weighing_operations (id) on delete cascade,
  requested_by uuid references public.user_profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  -- pending: esperando uma balanca da unidade; processing: uma balanca pegou; done/failed:
  -- resultado devolvido pela balanca (`result_message` explica).
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  claimed_by_device_id text references public.device_registrations (id) on delete set null,
  claimed_at timestamptz,
  processed_at timestamptz,
  result_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.billing_requests is
  'Pedidos de faturamento feitos pelo site (web-api request_invoice_closing). A balanca da unidade os executa (desktop-billing-requests) e devolve o resultado.';

create index if not exists idx_billing_requests_unit_status
  on public.billing_requests (unit_id, status, requested_at);
create index if not exists idx_billing_requests_operation
  on public.billing_requests (operation_id);

alter table public.billing_requests enable row level security;

-- Escrita so pela web-api (chave de servico). Leitura pelo site, na propria empresa.
drop policy if exists "no direct client access" on public.billing_requests;
create policy "no direct client access"
  on public.billing_requests for all
  to anon, authenticated
  using (false);

drop policy if exists "web users can read billing_requests from own company" on public.billing_requests;
create policy "web users can read billing_requests from own company"
  on public.billing_requests for select
  to authenticated
  using (
    exists (
      select 1 from public.user_profiles p
      where p.id = (select auth.uid())
        and p.role in ('comercial', 'gestor')
        and p.company_id = billing_requests.company_id
        and p.is_active = true
    )
  );

notify pgrst, 'reload schema';
