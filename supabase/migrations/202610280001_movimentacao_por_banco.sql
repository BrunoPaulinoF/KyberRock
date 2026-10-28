-- Movimentacao por banco no relatorio financeiro (OMIE).
--
-- O relatorio financeiro (`financial-report-email`) mandava contas a pagar e um extrato unico
-- com TODAS as contas correntes do OMIE misturadas. Em 27/10/2026 a Pedreira Ibiuna pediu um
-- resumo separado de cada banco que ela acompanha (Itau, Santander e Caixinha), no mesmo
-- WhatsApp que ja recebe o financeiro, sempre do dia anterior.
--
-- `financial_bank_accounts` guarda quais contas do OMIE ganham relatorio proprio:
-- `[{"code": 11455922450, "name": "Santander"}, ...]`, onde `code` e o nCodCC da conta. O nome e
-- o que estava no OMIE quando a conta foi escolhida, so para o painel mostrar a escolha sem
-- consultar o OMIE; o PDF usa o nome que o extrato devolver. Escolhido no painel (`/admin`,
-- editar pedreira) e gravado pelo `admin-api`; lista vazia = nenhum relatorio a mais.
--
-- Sem indice: lida por id, uma vez por envio.

alter table public.companies
  add column if not exists financial_bank_accounts jsonb not null default '[]'::jsonb;

comment on column public.companies.financial_bank_accounts is
  'Contas correntes do OMIE com relatorio de movimentacao proprio no envio financeiro: [{code (nCodCC), name}]. Vazio = nenhuma.';

-- A pedreira que pediu ja sai configurada: Itau Unibanco, Santander e Caixinha (nCodCC lidos do
-- ListarContasCorrentes dela em 28/10/2026). So preenche se ninguem escolheu nada ainda.
update public.companies
set financial_bank_accounts = '[
  {"code": 11455922417, "name": "Itaú Unibanco"},
  {"code": 11455922450, "name": "Santander"},
  {"code": 11455896303, "name": "Caixinha"}
]'::jsonb
where name = 'Pedreira Ibiuna'
  and financial_bank_accounts = '[]'::jsonb;
