-- Forma de pagamento "em carteira" na projecao do cadastro compartilhado.
--
-- A venda em carteira sai da balanca sem forma de recebimento definida: ela fica
-- na carteira ate um fechamento futuro, onde o operador define COMO o cliente
-- paga. Quem classifica a forma e a flag `is_wallet` — sem ela na projecao, a
-- segunda balanca da pedreira receberia a forma "Em carteira" como uma forma
-- comum e a venda nunca apareceria na carteira daquele computador.

alter table public.payment_methods
  add column if not exists is_wallet boolean not null default false;
