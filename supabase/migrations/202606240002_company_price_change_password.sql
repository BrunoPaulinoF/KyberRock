-- Add price_change_password to companies for protecting default price changes
alter table public.companies add column if not exists price_change_password text not null default '0000';
