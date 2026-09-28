-- KyberRock Web: consulta de cupom pelo codigo (tela "Cupons").
--
-- As vias impressas (`print_receipts`) sobem da balanca com a copia congelada do cupom
-- (`content_snapshot_json`, com as linhas exatamente como sairam no papel), mas so a chave de
-- servico lia a tabela (politica "no direct client access"). A tela nova do site mostra o cupom
-- como foi impresso, entao os perfis do site passam a LER as vias da propria empresa.
--
-- `print_receipts` nao tem `company_id`: a empresa vem pela unidade. Por isso o nome NAO comeca
-- com "web users can read " — o laco das migracoes `202609240001`/`202609260001` recria toda
-- politica com esse prefixo comparando `company_id` da propria tabela, e aqui essa coluna nao
-- existe. So leitura: a escrita continua sendo do `desktop-sync`.
drop policy if exists "web users read print receipts of own company" on public.print_receipts;

create policy "web users read print receipts of own company"
  on public.print_receipts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.user_profiles p
      join public.units u on u.company_id = p.company_id
      where p.id = (select auth.uid())
        and p.role in ('monitoramento', 'comercial', 'gestor', 'operacao', 'administrador')
        and p.is_active = true
        and u.id = print_receipts.unit_id
    )
  );

-- A busca da tela e pelo numero impresso na via.
create index if not exists idx_print_receipts_receipt_number
  on public.print_receipts (receipt_number);

notify pgrst, 'reload schema';
