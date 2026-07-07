-- Bloqueio automático de acesso por falta de pagamento (portal Kybernan Pay).
-- Aditivo e retrocompatível: separa o bloqueio por pagamento do toggle manual `is_active`.
-- O portal externo Kybernan Pay marca `payment_blocked = true` quando um boleto está vencido.

alter table public.companies add column if not exists payment_blocked boolean not null default false;
alter table public.companies add column if not exists payment_blocked_reason text;
alter table public.companies add column if not exists payment_blocked_at timestamptz;
