# Testes da Edge Function `omie-sync`

Esta pasta contem testes Deno unitarios e de integracao para a sincronizacao entre o POS local, a Edge Function e a API OMIE.

## Execucao local

Instale o Deno 2.x e rode:

```bash
deno test --allow-env --import-map=supabase/functions/omie-sync/deno.test.import_map.json supabase/functions/omie-sync
```

Use `--allow-env` porque o handler le `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Os testes injetam stubs de Supabase e OMIE, portanto nao fazem chamadas reais para banco, SQLite local ou OMIE.

## Cobertura

- Credenciais dinamicas por `companyId`, garantindo que `OMIE_APP_KEY` e `OMIE_APP_SECRET` de uma empresa nao vazam para outra.
- Resiliencia da fila OMIE com HTTP 429, `retry-after`, backoff exponencial e repeticao exata do payload original.
- Push de clientes e transportadoras a partir de uma fila local simulada com `needs_push = 1`, incluindo limpeza do flag apos sucesso mockado.
- Pull paginado de clientes OMIE, com mapeamento de registros marcados com `transportadora` para a tabela local simulada de `carriers`.
- Pull das categorias do plano gerencial (`ListarCategorias`), incluindo o descarte de categorias totalizadoras (`nao_exibir`) e o retomar por `resume` sem chamadas repetidas ao OMIE.

## CI/CD

Ja existe: `.github/workflows/ci.yml` roda esta suite no job `deno`, em todo pull request e em todo push na `main`, ao lado do job `node` (`npm run lint`, `npm run build`, `npm test`). Um PR com a suite vermelha nao fica verde.

O job roda o mesmo comando da secao anterior, sem `--no-check` — o type-check faz parte do que ele protege.

Dois detalhes que valem lembrar ao mexer nisso:

- O escopo e `supabase/functions/omie-sync`, nao `supabase/functions`. Os outros `*_test.ts` da pasta sao testes vitest (ver o `include` do `vitest.config.ts`) e reprovariam no type-check do Deno.
- Este e o unico teste do repositorio que o `npm test` nao cobre: o vitest coleta `*.test.ts`, e os arquivos Deno usam `*_test.ts`. Foi por isso que a suite ficou vermelha na `main` sem ninguem notar antes da CI existir.
