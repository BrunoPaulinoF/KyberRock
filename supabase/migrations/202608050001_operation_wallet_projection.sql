-- Carteira compartilhada entre as balancas da pedreira.
--
-- A carteira (vendas fechadas na forma "em carteira", aguardando o fechamento que define
-- COMO o cliente vai pagar) vivia so no SQLite da maquina que fez a venda: a projecao da
-- nuvem nunca levou nem a forma de pagamento da operacao nem as colunas do fechamento.
-- Resultado: a tela Carteira de cada computador so mostrava as vendas dele, e o
-- fechamento lancado numa balanca nao aparecia na outra.
--
-- `payment_method_id` e o que classifica a venda como "em carteira" (via
-- payment_methods.is_wallet, ja projetado); as quatro colunas `wallet_*` sao o
-- fechamento em si (espelham a migracao local 47). Enquanto `wallet_settled_at` for
-- nulo a venda esta em aberto na carteira.
--
-- Sem NOT NULL e sem default: as operacoes ja projetadas nasceram antes das colunas
-- existirem e recebem os valores no proximo push do desktop.

alter table public.weighing_operations
  add column if not exists payment_method_id text,
  add column if not exists wallet_settlement_method_id text,
  add column if not exists wallet_settlement_due_date date,
  add column if not exists wallet_settled_at timestamptz,
  add column if not exists wallet_settlement_note text;

-- Leitura da carteira da pedreira: as vendas em carteira de uma unidade, separando as
-- em aberto das ja fechadas, na mesma ordem de leitura (created_at desc) das demais
-- consultas da tabela.
create index if not exists idx_weighing_operations_unit_wallet
  on public.weighing_operations(unit_id, payment_method_id, wallet_settled_at, created_at desc);

-- Apelido da forma de pagamento ("Em carteira" -> "Fiado", ...). E o rotulo que a
-- Carteira e o seletor de pagamento exibem: sem ele na projecao do cadastro
-- compartilhado, a mesma forma aparecia com nome diferente em cada computador.
alter table public.payment_methods
  add column if not exists alias text;
