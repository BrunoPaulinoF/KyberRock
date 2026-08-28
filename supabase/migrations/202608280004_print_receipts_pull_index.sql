-- O pull completo do desktop le os cupons com
--   select * from print_receipts where unit_id = ? order by printed_at desc, id asc
-- e os indices existentes cobrem so o WHERE: (unit_id) e (unit_id, updated_at). O ORDER BY
-- ficava para um sort em memoria de linhas de ~11 kB cada (o content_snapshot_json), e essa
-- passou a ser a consulta mais cara do projeto -- 380 ms de media, 7,6 s no pior caso, mais
-- tempo de banco somado que todo o resto junto.
--
-- Com (unit_id, printed_at desc, id) o planner percorre o indice ja na ordem pedida e para
-- no LIMIT da pagina, em vez de ordenar a unidade inteira para descartar quase tudo.
-- `id asc` entra no indice porque e o desempate do ORDER BY: sem ele a paginacao por range
-- pode repetir ou pular cupom impresso no mesmo instante.
create index if not exists idx_print_receipts_unit_printed
  on public.print_receipts (unit_id, printed_at desc, id);
