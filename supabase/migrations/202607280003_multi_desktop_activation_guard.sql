-- Varios desktops operando ao mesmo tempo na mesma pedreira.
--
-- Reafirma (de forma idempotente) o que a 202607220001 introduziu, para projetos
-- que ainda nao aplicaram aquela migracao: sem isto o banco continua com o indice
-- de "um unico desktop ativo por empresa" e o segundo computador da pedreira nao
-- consegue nem registrar, ou derruba o primeiro.

-- Trava antiga de desktop unico por empresa.
drop index if exists public.idx_device_registrations_one_active_desktop_per_company;

alter table public.device_registrations
  add column if not exists installation_id text;

alter table public.device_registrations
  add column if not exists color text;

-- Um registro por instalacao fisica (installation_id e gerado pelo desktop e
-- estavel por computador). Registros antigos sem installation_id continuam
-- validos e so sao readotados pelo proprio computador, que apresenta na ativacao
-- o id de dispositivo que ja usava.
create unique index if not exists idx_device_registrations_company_installation
  on public.device_registrations(company_id, installation_id)
  where installation_id is not null;

create index if not exists idx_device_registrations_company
  on public.device_registrations(company_id);
create index if not exists idx_device_registrations_unit
  on public.device_registrations(unit_id);

notify pgrst, 'reload schema';
