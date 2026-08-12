-- Segredos do financeiro saem do banco e passam a viver nos secrets do Supabase.
--
-- Antes, `billing_settings` guardava o VALOR do access token do Mercado Pago, do
-- segredo do webhook e do token da instancia de WhatsApp. Funcionava, mas
-- colocava credencial de plataforma numa tabela: qualquer dump, backup ou
-- consulta com service role passava a carregar o token que emite boleto.
--
-- Agora a tabela guarda apenas o NOME da variavel de ambiente, e o valor e lido
-- com `Deno.env.get()` dentro da Edge Function. Consequencias:
--   - o segredo nunca entra no banco, no repositorio nem no navegador;
--   - trocar a credencial e trocar o secret no Supabase, sem deploy e sem SQL;
--   - a tela de configuracao mostra o nome da variavel e se ela esta preenchida,
--     nunca o valor.
--
-- As colunas de valor sao removidas de proposito, e nao apenas ignoradas:
-- deixa-las ali seria um convite para alguem voltar a gravar segredo no banco.
-- Elas estao vazias — o backoffice foi aplicado hoje e nenhuma credencial chegou
-- a ser salva por lá.

alter table public.billing_settings
  drop column if exists mercado_pago_access_token,
  drop column if exists mercado_pago_webhook_secret,
  drop column if exists whatsapp_instance_token;

alter table public.billing_settings
  -- Vazio = usa o nome padrao embutido no codigo. O campo existe para o caso de
  -- uma instalacao precisar de outro nome (duas contas do Mercado Pago no mesmo
  -- projeto, migracao de credencial em paralelo).
  add column if not exists mercado_pago_access_token_env text,
  add column if not exists mercado_pago_webhook_secret_env text,
  add column if not exists whatsapp_instance_token_env text;

comment on column public.billing_settings.mercado_pago_access_token_env is
  'Nome da variavel de ambiente (secret do Supabase) que guarda o access token do Mercado Pago. Vazio usa MERCADO_PAGO_ACCESS_TOKEN. Nunca guarde o valor aqui.';
comment on column public.billing_settings.mercado_pago_webhook_secret_env is
  'Nome da variavel de ambiente que guarda o segredo de assinatura do webhook. Vazio usa MERCADO_PAGO_WEBHOOK_SECRET. Nunca guarde o valor aqui.';
comment on column public.billing_settings.whatsapp_instance_token_env is
  'Nome da variavel de ambiente que guarda o token da instancia UAZAPI da cobranca. Vazio usa UAZAPI_INSTANCE_TOKEN. Nunca guarde o valor aqui.';
