-- O nome de cada secret do financeiro passa a ser fixo no codigo.
--
-- A migracao 202608120003 tirou o VALOR do banco e deixou o NOME da variavel
-- configuravel na tela. Na pratica isso nao paga o proprio custo: o nome muda
-- praticamente nunca, e um campo editavel ao lado de um rotulo de credencial e
-- exatamente onde alguem acaba colando o token. Com o nome fixo em
-- `_shared/billing-secrets.ts` (MERCADO_PAGO_ACCESS_TOKEN,
-- MERCADO_PAGO_WEBHOOK_SECRET, UAZAPI_INSTANCE_TOKEN), a tela de configuracao
-- deixa de ter qualquer campo de segredo: ela so exibe a situacao.
--
-- Colunas removidas em vez de ignoradas, pelo mesmo motivo da 202608120003:
-- coluna morta perto de credencial vira, com o tempo, coluna com credencial.

alter table public.billing_settings
  drop column if exists mercado_pago_access_token_env,
  drop column if exists mercado_pago_webhook_secret_env,
  drop column if exists whatsapp_instance_token_env;
