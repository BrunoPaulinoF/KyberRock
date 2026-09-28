import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

/**
 * Historico das alteracoes de preco especial feitas nesta balanca.
 *
 * Mexer em preco especial pede a senha rotativa que o comercial ve no site; o comercial, por
 * sua vez, precisa ver o que foi feito com ela. Cada alteracao vira uma linha aqui, no mesmo
 * salvamento do preco, e sobe para a nuvem (`price_change_log`) pelo envio do cadastro —
 * chave `priceChangeLog`. A nuvem carimba de qual balanca veio; o site mostra na tela do
 * comercial. A mesma regra de "o que e alteracao" vive em `_shared/price-change-log.ts`.
 */

export type PriceChangeAction = "adicionado" | "alterado" | "removido";

export interface PriceChangeLogRow {
  id: string;
  company_id: string;
  kind: string;
  action: PriceChangeAction;
  customer_id: string | null;
  customer_name: string | null;
  product_id: string | null;
  product_description: string | null;
  old_price_cents: number | null;
  new_price_cents: number | null;
  changed_at: string;
  created_at: string;
}

/** A acao pelo preco de antes e o de depois; `null` quando nada mudou. */
export function priceChangeAction(
  oldPriceCents: number | null,
  newPriceCents: number | null
): PriceChangeAction | null {
  if (oldPriceCents === newPriceCents) return null;
  if (oldPriceCents === null) return "adicionado";
  if (newPriceCents === null) return "removido";
  return "alterado";
}

/** O preco especial vivo do par agora (antes da alteracao), ou `null`. */
export function currentSpecialPriceCents(
  database: DesktopDatabase,
  customerId: string,
  productId: string
): number | null {
  const row = database
    .prepare(
      `SELECT unit_price_cents FROM customer_special_prices
       WHERE customer_id = ? AND product_id = ? AND deleted_at IS NULL AND is_active = 1
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(customerId, productId) as { unit_price_cents: number | null } | undefined;
  return typeof row?.unit_price_cents === "number" ? row.unit_price_cents : null;
}

/**
 * Grava a alteracao no historico. Nao grava nada quando o preco nao mudou (salvar o mesmo valor
 * de novo nao e alteracao). Devolve a linha gravada.
 */
export function recordSpecialPriceChange(
  database: DesktopDatabase,
  input: {
    companyId: string;
    customerId: string;
    productId: string;
    oldPriceCents: number | null;
    newPriceCents: number | null;
  },
  now: Date = new Date()
): PriceChangeLogRow | null {
  const action = priceChangeAction(input.oldPriceCents, input.newPriceCents);
  if (!action) return null;

  // O nome que a tela mostra: a fantasia, e a razao social quando ela falta.
  const customer = database
    .prepare(
      "SELECT COALESCE(NULLIF(TRIM(trade_name), ''), legal_name) AS name FROM customers WHERE id = ?"
    )
    .get(input.customerId) as { name: string | null } | undefined;
  const product = database
    .prepare("SELECT description FROM products WHERE id = ?")
    .get(input.productId) as { description: string | null } | undefined;

  const nowIso = now.toISOString();
  const row: PriceChangeLogRow = {
    id: randomUUID(),
    company_id: input.companyId,
    kind: "preco_especial",
    action,
    customer_id: input.customerId,
    customer_name: customer?.name ?? null,
    product_id: input.productId,
    product_description: product?.description ?? null,
    old_price_cents: input.oldPriceCents,
    new_price_cents: input.newPriceCents,
    changed_at: nowIso,
    created_at: nowIso
  };

  database
    .prepare(
      `INSERT INTO price_change_log (
        id, company_id, kind, action, customer_id, customer_name, product_id,
        product_description, old_price_cents, new_price_cents, changed_at, created_at
      ) VALUES (
        @id, @company_id, @kind, @action, @customer_id, @customer_name, @product_id,
        @product_description, @old_price_cents, @new_price_cents, @changed_at, @created_at
      )`
    )
    .run(row);
  return row;
}
