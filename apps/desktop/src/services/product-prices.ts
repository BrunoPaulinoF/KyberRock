import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";
import { isSellableProduct } from "./product-classification.js";

export interface ProductDefaultPriceRow {
  id: string;
  company_id: string;
  product_id: string;
  unit_price_cents: number;
  unit: string;
  valid_from: string | null;
  valid_to: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CustomerSpecialPriceRow {
  id: string;
  company_id: string;
  customer_id: string;
  product_id: string;
  unit_price_cents: number;
  unit: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ProductDefaultPriceSummary {
  id: string | null;
  productId: string;
  productCode: string | null;
  productDescription: string;
  unitPriceCents: number | null;
  unit: string;
}

export interface CustomerSpecialPriceSummary {
  id: string;
  customerId: string;
  productId: string;
  productCode: string | null;
  productDescription: string;
  unitPriceCents: number;
  unit: string;
}

export function upsertProductDefaultPrice(
  database: DesktopDatabase,
  input: {
    companyId: string;
    productId: string;
    unitPriceCents: number;
    unit?: string;
  },
  now: Date = new Date()
): ProductDefaultPriceRow {
  validatePrice(input.unitPriceCents);

  const nowIso = now.toISOString();
  const existing = database
    .prepare(
      `SELECT id FROM product_default_prices
       WHERE company_id = ? AND product_id = ? AND deleted_at IS NULL
       LIMIT 1`
    )
    .get(input.companyId, input.productId) as { id: string } | undefined;

  if (existing) {
    database
      .prepare(
        `UPDATE product_default_prices
         SET unit_price_cents = ?, unit = ?, is_active = 1, updated_at = ?
         WHERE id = ?`
      )
      .run(input.unitPriceCents, input.unit ?? "ton", nowIso, existing.id);
    return database
      .prepare("SELECT * FROM product_default_prices WHERE id = ?")
      .get(existing.id) as ProductDefaultPriceRow;
  }

  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO product_default_prices (
        id, company_id, product_id, unit_price_cents, unit, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      id,
      input.companyId,
      input.productId,
      input.unitPriceCents,
      input.unit ?? "ton",
      nowIso,
      nowIso
    );

  return database
    .prepare("SELECT * FROM product_default_prices WHERE id = ?")
    .get(id) as ProductDefaultPriceRow;
}

export function removeProductDefaultPrice(
  database: DesktopDatabase,
  companyId: string,
  productId: string,
  now: Date = new Date()
): void {
  const existing = database
    .prepare(
      `SELECT id FROM product_default_prices
       WHERE company_id = ? AND product_id = ? AND deleted_at IS NULL AND is_active = 1
       LIMIT 1`
    )
    .get(companyId, productId) as { id: string } | undefined;

  if (!existing) return;

  database
    .prepare(
      `UPDATE product_default_prices
       SET deleted_at = ?, updated_at = ?, is_active = 0
       WHERE id = ?`
    )
    .run(now.toISOString(), now.toISOString(), existing.id);
}

export function setCustomerSpecialPrice(
  database: DesktopDatabase,
  input: {
    companyId: string;
    customerId: string;
    productId: string;
    unitPriceCents: number;
    unit?: string;
  },
  now: Date = new Date()
): CustomerSpecialPriceRow {
  validatePrice(input.unitPriceCents);

  const nowIso = now.toISOString();
  const existing = database
    .prepare(
      `SELECT id FROM customer_special_prices
       WHERE customer_id = ? AND product_id = ? AND deleted_at IS NULL
       LIMIT 1`
    )
    .get(input.customerId, input.productId) as { id: string } | undefined;

  if (existing) {
    database
      .prepare(
        `UPDATE customer_special_prices
         SET unit_price_cents = ?, unit = ?, is_active = 1, updated_at = ?
         WHERE id = ?`
      )
      .run(input.unitPriceCents, input.unit ?? "ton", nowIso, existing.id);
    return database
      .prepare("SELECT * FROM customer_special_prices WHERE id = ?")
      .get(existing.id) as CustomerSpecialPriceRow;
  }

  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO customer_special_prices (
        id, company_id, customer_id, product_id, unit_price_cents, unit, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      id,
      input.companyId,
      input.customerId,
      input.productId,
      input.unitPriceCents,
      input.unit ?? "ton",
      nowIso,
      nowIso
    );

  return database
    .prepare("SELECT * FROM customer_special_prices WHERE id = ?")
    .get(id) as CustomerSpecialPriceRow;
}

export function removeCustomerSpecialPrice(
  database: DesktopDatabase,
  customerId: string,
  productId: string,
  now: Date = new Date()
): void {
  const nowIso = now.toISOString();
  database
    .prepare(
      `UPDATE customer_special_prices
       SET deleted_at = ?, updated_at = ?, is_active = 0
       WHERE customer_id = ? AND product_id = ? AND deleted_at IS NULL`
    )
    .run(nowIso, nowIso, customerId, productId);
}

export function listCustomerSpecialPrices(
  database: DesktopDatabase,
  customerId: string
): CustomerSpecialPriceSummary[] {
  return database
    .prepare(
      `SELECT
         csp.id, csp.customer_id, csp.product_id, csp.unit_price_cents, csp.unit,
         p.code AS product_code, p.description AS product_description
       FROM customer_special_prices csp
       LEFT JOIN products p ON p.id = csp.product_id
       WHERE csp.customer_id = ? AND csp.deleted_at IS NULL AND csp.is_active = 1
       ORDER BY p.description ASC`
    )
    .all(customerId)
    .map((row) => {
      const r = row as {
        id: string;
        customer_id: string;
        product_id: string;
        product_code: string | null;
        product_description: string | null;
        unit_price_cents: number;
        unit: string;
      };
      return {
        id: r.id,
        customerId: r.customer_id,
        productId: r.product_id,
        productCode: r.product_code,
        productDescription: r.product_description ?? r.product_id,
        unitPriceCents: r.unit_price_cents,
        unit: r.unit
      };
    });
}

export function listProductDefaultPriceSummaries(
  database: DesktopDatabase,
  companyId: string
): ProductDefaultPriceSummary[] {
  return database
    .prepare(
       `SELECT
          p.id AS product_id, p.code AS product_code, p.description AS product_description,
          p.unit_price_cents AS product_unit_price_cents, p.omie_product_id, p.item_type,
          p.fiscal_recommendations_json, p.is_active AS product_is_active,
          pdp.id AS default_price_id, pdp.unit_price_cents AS default_unit_price_cents,
          COALESCE(pdp.unit, 'ton') AS unit
       FROM products p
       LEFT JOIN product_default_prices pdp
         ON pdp.product_id = p.id
        AND pdp.deleted_at IS NULL
        AND pdp.is_active = 1
        AND (pdp.valid_from IS NULL OR pdp.valid_from <= date('now'))
        AND (pdp.valid_to IS NULL OR pdp.valid_to >= date('now'))
       WHERE p.company_id = ? AND p.deleted_at IS NULL AND p.is_active = 1
       ORDER BY p.description ASC`
    )
     .all(companyId)
    .filter((row) => {
      const r = row as {
        omie_product_id: number | null;
        item_type: string | null;
        fiscal_recommendations_json: string | null;
        product_is_active: number;
      };
      return isSellableProduct({
        omieProductId: r.omie_product_id,
        itemType: r.item_type,
        fiscalRecommendationsJson: r.fiscal_recommendations_json,
        isActive: r.product_is_active === 1
      });
    })
    .map((row) => {
      const r = row as {
        product_id: string;
        product_code: string | null;
        product_description: string | null;
        product_unit_price_cents: number | null;
        default_price_id: string | null;
        default_unit_price_cents: number | null;
        unit: string | null;
      };
      return {
        id: r.default_price_id,
        productId: r.product_id,
        productCode: r.product_code,
        productDescription: r.product_description ?? r.product_id,
        unitPriceCents: r.default_unit_price_cents ?? r.product_unit_price_cents,
        unit: r.unit ?? "ton"
      };
    });
}

export function listProductDefaultPrices(
  database: DesktopDatabase,
  productIds: string[]
): Map<string, ProductDefaultPriceRow> {
  if (productIds.length === 0) return new Map();
  const placeholders = productIds.map(() => "?").join(",");
  const rows = database
    .prepare(
      `SELECT * FROM product_default_prices
       WHERE product_id IN (${placeholders}) AND deleted_at IS NULL AND is_active = 1
         AND (valid_from IS NULL OR valid_from <= date('now'))
         AND (valid_to IS NULL OR valid_to >= date('now'))`
    )
    .all(...productIds) as ProductDefaultPriceRow[];
  const map = new Map<string, ProductDefaultPriceRow>();
  for (const row of rows) {
    map.set(row.product_id, row);
  }
  return map;
}

function validatePrice(unitPriceCents: number): void {
  if (!Number.isInteger(unitPriceCents) || unitPriceCents <= 0) {
    throw new Error("Preco por tonelada deve ser maior que zero.");
  }
}
