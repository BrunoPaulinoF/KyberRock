/**
 * O valor unitario do OMIE que a balanca envia junto com o produto (`products.unit_price_cents`).
 *
 * Na balanca ele e o preco padrao do produto que nao tem tabela de preco padrao
 * (`PricingService`), e por isso o site precisa dele. So que nem toda maquina o tem: a que nunca
 * puxou o OMIE recebe o produto pelo pull da nuvem, que nao traz o preco, e enviaria nulo. Nulo
 * aqui e AUSENCIA, nao "o OMIE tirou o preco": o lote sai dividido, e a parte sem preco vai sem a
 * coluna — coluna ausente preserva o que a nuvem tem. Um lote so nao serve, porque o upsert em
 * lote preenche com nulo a chave que falta numa das linhas.
 */

export type ProductRow = Record<string, unknown>;

function hasPrice(row: ProductRow): boolean {
  const value = row.unit_price_cents;
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** `priced` vai como veio; `unpriced` vai sem `unit_price_cents`. Vazios ficam de fora. */
export function splitProductsByUnitPrice(rows: ProductRow[]): {
  priced: ProductRow[];
  unpriced: ProductRow[];
} {
  const priced: ProductRow[] = [];
  const unpriced: ProductRow[] = [];
  for (const row of rows) {
    if (hasPrice(row)) {
      priced.push(row);
      continue;
    }
    if (!Object.hasOwn(row, "unit_price_cents")) {
      unpriced.push(row);
      continue;
    }
    const rest = { ...row };
    delete rest.unit_price_cents;
    unpriced.push(rest);
  }
  return { priced, unpriced };
}
