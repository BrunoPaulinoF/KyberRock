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

## CI/CD

Inclua um job dedicado antes do deploy das Edge Functions:

```yaml
omie-sync-deno-tests:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: denoland/setup-deno@v2
      with:
        deno-version: v2.x
    - run: deno test --allow-env --import-map=supabase/functions/omie-sync/deno.test.import_map.json supabase/functions/omie-sync
```

Recomendacao: mantenha este job junto de `npm run lint`, `npm test` e `npm run build`, bloqueando merge/deploy se qualquer um falhar.
