-- Cadastro comercial e de credito do cliente na projecao da nuvem.
--
-- Estes campos nasceram e morreram no SQLite de cada balanca: a forma de pagamento padrao,
-- a transportadora padrao, o "exige nota fiscal" e TODA a configuracao da conta de credito
-- (habilitada, periodicidade, dia de fechamento, dias para o boleto) nunca entraram no
-- payload do `desktop-sync`. Numa pedreira com duas balancas isso aparece como o mesmo
-- cliente tendo credito habilitado num computador e nao no outro — e o operador refazendo
-- a configuracao maquina a maquina.
--
-- O dono e o mesmo do cadastro de preco: a balanca principal eleita no painel
-- (`device_registrations.is_price_master`). A secundaria exibe e nao publica.
--
-- `credit_mode` ja existia aqui desde 202606240001, mas nenhuma funcao jamais o gravou:
-- toda linha esta com o default 'normal'. Ele entra na lista de colunas publicadas agora.

alter table public.customers
  add column if not exists default_payment_method_id text,
  add column if not exists default_carrier_id text,
  add column if not exists nf_required boolean,
  add column if not exists credit_account_enabled boolean,
  add column if not exists credit_periodicity text,
  add column if not exists credit_closing_day integer,
  add column if not exists credit_second_closing_day integer,
  add column if not exists credit_boleto_days integer,
  add column if not exists credit_second_boleto_days integer,
  add column if not exists credit_closing_weekday integer,
  add column if not exists commercial_published_at timestamptz;

-- Sem FOREIGN KEY de proposito, nas duas colunas de id.
--
-- A ordem do push do cadastro (`CADASTRO_PUSH_ENTITIES`) manda os clientes ANTES das
-- transportadoras e das formas de pagamento. Com FK, o primeiro cliente que apontasse para
-- uma transportadora que a nuvem ainda nao recebeu derrubaria o lote inteiro de clientes —
-- e o cadastro da pedreira pararia por causa de um padrao. O lado que le resolve o id
-- ausente mantendo o vinculo local anterior (ver `resolveMirroredId` no desktop).
comment on column public.customers.default_payment_method_id is
  'Forma de pagamento padrao do cliente (payment_methods.id). Sem FK: os clientes sao publicados antes das formas de pagamento.';
comment on column public.customers.default_carrier_id is
  'Transportadora padrao do cliente (carriers.id). Sem FK: os clientes sao publicados antes das transportadoras.';
comment on column public.customers.nf_required is
  'Cliente exige nota fiscal. Nulo = a balanca principal ainda nao publicou o bloco comercial.';
comment on column public.customers.credit_account_enabled is
  'Conta de credito (fiado com fechamento periodico) habilitada para o cliente.';
comment on column public.customers.credit_periodicity is
  'Periodicidade do fechamento da conta de credito: monthly | biweekly | weekly.';
comment on column public.customers.credit_closing_day is
  'Dia do mes do fechamento (1..31). No modo weekly quem vale e credit_closing_weekday.';
comment on column public.customers.credit_second_closing_day is
  'Segundo dia de fechamento, so no modo biweekly.';
comment on column public.customers.credit_boleto_days is
  'Dias entre o fechamento e o vencimento do boleto.';
comment on column public.customers.credit_second_boleto_days is
  'Dias ate o vencimento do segundo boleto, so no modo biweekly.';
comment on column public.customers.credit_closing_weekday is
  'Dia da semana do fechamento (0=domingo..6=sabado), so no modo weekly.';

-- A marca que separa "a principal publicou este bloco" de "ninguem publicou ainda".
--
-- Sem ela, nulo seria ambiguo, e a ambiguidade custa caro nos dois sentidos: a secundaria
-- que tratasse nulo como valor apagaria a configuracao boa que ela ja tem enquanto a
-- migracao nao roda ou enquanto a principal nao republica; a que tratasse nulo como
-- "ignore" nunca deixaria a principal LIMPAR uma transportadora padrao. Com a marca, a
-- secundaria aplica o bloco inteiro — nulos incluidos — apenas depois que alguem publicou.
comment on column public.customers.commercial_published_at is
  'Quando o bloco comercial/credito foi publicado por uma balanca (principal ou sem principal eleita). Nulo = nunca publicado; a secundaria mantem o que tem localmente.';
