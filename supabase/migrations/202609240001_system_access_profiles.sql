-- Acessos do sistema: um login do site por acesso cadastrado, com perfil.
--
-- Contexto: `docs/plano-migracao-web.md`. O painel da Kybernan deixa de ter uma aba
-- "Balancas" e passa a ter "Acessos do sistema": cada computador cadastrado (fernanda, RAFAELA
-- COMERCIAL, pc hellen...) ganha um login do site (e-mail e senha) e um PERFIL, que decide o que
-- aquela pessoa ve e edita no KyberRock Web. E esse login que ela usa quando o desktop daquele
-- computador for desligado na virada.
--
-- Perfis (`user_profiles.role`):
--   - `loader`        carregador: so a fila de carregamento da propria unidade (ja existia);
--   - `monitoramento` so consulta: cadastro e relatorios, sem editar nada (novo);
--   - `operacao`      consulta tudo e cadastra veiculo, motorista e transportadora — o cadastro
--                     rapido que a balanca ja faz na hora (novo);
--   - `comercial`     cadastro de clientes e frota + relatorios (ja existia);
--   - `gestor`        tudo do comercial + precos, bloco comercial, carteira e fechamento.
--
-- Para LEITURA os quatro perfis do site enxergam o mesmo (a empresa inteira); a diferenca de
-- escrita mora na `web-api` (`_shared/web-session.ts`), como na `202609220003`.

-- 1) Os dois perfis novos.
alter table public.user_profiles
  drop constraint if exists user_profiles_role_check;

alter table public.user_profiles
  add constraint user_profiles_role_check
  check (role in ('loader', 'monitoramento', 'operacao', 'comercial', 'gestor'));

-- 2) De qual acesso (computador cadastrado) e este login. Opcional: carregador e usuario sem
-- computador continuam sem. Um login por acesso; excluir o acesso solta o login, nao o apaga
-- (a pessoa continua entrando no site depois que o desktop dela sai do ar — e o objetivo).
alter table public.user_profiles
  add column if not exists device_id text
    references public.device_registrations (id) on delete set null;

create unique index if not exists user_profiles_device_id_key
  on public.user_profiles (device_id)
  where device_id is not null;

comment on column public.user_profiles.device_id is
  'Acesso do sistema (device_registrations.id) a que este login do site pertence. Um por acesso.';

-- 3) Leitura da empresa para os quatro perfis do site.
--
-- Todas as politicas "web users can read ..." (criadas na 202609220003 e na 202609220004) tem a
-- mesma forma e so diferem na tabela: recria cada uma com a lista nova de perfis. Percorrer o
-- catalogo, em vez de repetir a lista de tabelas, garante que nenhuma fique so com os perfis
-- antigos — inclusive o nome truncado em 63 caracteres de `customer_future_billing_invoices`.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and policyname like 'web users can read %'
  loop
    execute format('drop policy if exists %I on public.%I', policy_row.policyname, policy_row.tablename);
    execute format(
      'create policy %I on public.%I for select to authenticated using ('
      || 'exists (select 1 from public.user_profiles p '
      || 'where p.id = (select auth.uid()) '
      || 'and p.role in (''monitoramento'', ''operacao'', ''comercial'', ''gestor'') '
      || 'and p.company_id = %I.company_id '
      || 'and p.is_active = true))',
      policy_row.policyname,
      policy_row.tablename,
      policy_row.tablename
    );
  end loop;
end;
$$;

notify pgrst, 'reload schema';
