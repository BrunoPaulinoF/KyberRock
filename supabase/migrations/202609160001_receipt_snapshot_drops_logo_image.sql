-- A logo saia do banco: 66 MB dos 106 MB eram a MESMA imagem, 6.310 vezes.
--
-- `print_receipts.content_snapshot_json` e a copia congelada do cupom, e ela carregava a logo
-- da pedreira em base64 dentro de CADA via impressa. Medido aqui em 16/09/2026: 6.310 cupons,
-- 11 kB dos ~11,5 kB de cada linha eram a imagem, e as 6.310 copias somavam apenas 3 imagens
-- DISTINTAS. Tudo o mais que o cupom guarda -- linhas, cabecalho, pesos, valores, estilo --
-- somava 2,6 MB no total. Crescia ~1,6 MB por dia numa pedreira so, e o pull completo ainda
-- arrastava ate 2.000 dessas linhas (~23 MB numa resposta) para cada balanca da unidade.
--
-- A imagem NAO se perde. Ela mora no perfil de impressao de cada balanca
-- (`print_profiles.template_config_json`), que e de onde o cupom sempre a leu para imprimir --
-- e de onde a reimpressao a le, porque reimprimir remonta o cupom a partir da OPERACAO e nunca
-- leu este snapshot. No desktop, nenhum codigo le esta coluna: o proprio modulo de impressao
-- evita seleciona-la (`PRINT_RECEIPT_COLUMNS`). Ela existe para arquivo.
--
-- Fica a GEOMETRIA (`widthMm`, `heightMm`, `fit`): e barata e diz como a via saiu do papel.
-- Apagar o bloco `receiptLogo` inteiro faria o arquivo mentir sobre o layout impresso; o que
-- sai e so o `dataUrl`.
--
-- Daqui para a frente a via ja nasce sem a imagem (`archivableReceiptSnapshot`, em
-- printing.ts) e o que estava na fila da balanca e peneirado antes de subir
-- (`snapshotWithoutLogoImage`, em supabase-sync.ts). Esta migracao trata o que ja chegou.
--
-- `updated_at` fica INTACTO de proposito: e por ele que o pull incremental recorta o
-- historico, e toca-lo aqui mandaria toda balanca da frota rebaixar 6.310 cupons de uma vez --
-- exatamente o trafego que estamos cortando. Nao ha trigger de `updated_at` nesta tabela.
--
-- Reexecutar e seguro: o WHERE so pega quem ainda tem imagem.

update public.print_receipts
set content_snapshot_json = jsonb_set(
  content_snapshot_json,
  '{receiptLogo,dataUrl}',
  'null'::jsonb,
  false
)
where jsonb_typeof(content_snapshot_json) = 'object'
  and content_snapshot_json -> 'receiptLogo' ->> 'dataUrl' is not null;

-- O espaco so volta para o disco depois de um `VACUUM FULL public.print_receipts`, que NAO
-- cabe aqui: comando de vacuum nao roda dentro da transacao da migracao. Sem ele o Postgres
-- reaproveita as paginas internamente (o banco para de crescer), mas o numero do painel so
-- cai depois do vacuum. Rode-o a parte, fora do horario de pico -- ele tranca a tabela por
-- alguns segundos.
