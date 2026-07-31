-- O loader-web atualiza loading_requests mexendo so em loader_completed_at
-- (concluir/cancelar carga), sem tocar updated_at. Como o pull incremental do
-- desktop (desktop-pull com historySince) filtra por updated_at, a conclusao
-- so chegava na balanca no pull completo — na pratica, ao reiniciar o app.
-- Este trigger carimba updated_at com o relogio do servidor quando um UPDATE
-- muda loader_completed_at sem trazer updated_at novo. A condicao dupla e
-- proposital: os reenvios de reconciliacao do desktop (linhas identicas, com
-- updated_at proprio) nao podem avancar o relogio da nuvem, senao o guard do
-- desktop-sync passaria a descartar um fechamento legitimo vindo da balanca.
create or replace function public.touch_loading_request_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.loader_completed_at is distinct from old.loader_completed_at
     and new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_loading_requests_touch_updated_at on public.loading_requests;

create trigger trg_loading_requests_touch_updated_at
  before update on public.loading_requests
  for each row
  execute function public.touch_loading_request_updated_at();
