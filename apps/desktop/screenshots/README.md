# Harness de capturas de tela (dados ficticios)

Monta o renderer real do desktop com uma implementacao **falsa** da API do preload
(`window.kyberrockDesktop`), para gerar imagens de documentacao/portfolio sem abrir o
Electron e sem tocar em banco, balanca, nuvem ou OMIE.

Nenhum dado aqui e real: empresa, clientes, transportadoras, motoristas, placas,
documentos, telefones e valores sao inventados (`demo-data.ts`, `demo-operations.ts`).

## Como rodar

```bash
npm run build --workspace=@kyberrock/shared --workspace=@kyberrock/scale-adapters \
  --workspace=@kyberrock/print-templates --workspace=@kyberrock/omie-client
cd apps/desktop && npx vite --config vite.config.ts --port 5199
# abra http://127.0.0.1:5199/screenshots.html
```

A tela de abertura (video) e pulada com Enter. Para capturas automatizadas, congele o
relogio do navegador (ex.: `page.clock.setFixedTime(...)` no Playwright) antes de abrir
a pagina: os horarios das telas saem de `NOW` em `demo-data.ts`, que le o relogio local.

## Arquivos

- `demo-data.ts` — cadastros ficticios (clientes, produtos, transporte, pagamento).
- `demo-operations.ts` — operacoes abertas/concluidas/canceladas e a serie diaria.
- `mock-api.ts` — a API do preload inteira, metodo a metodo. O que nao estiver
  implementado cai num proxy que devolve `null` e avisa no console.
- `main.tsx` — entrada montada por `apps/desktop/screenshots.html`.

O equivalente do loader-web esta em `apps/loader-web/screenshots/`, com o cliente
Supabase trocado por um mock via `vite.screenshots.config.ts`.
