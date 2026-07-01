import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface CreatePriceTableInput {
  companyId: string;
  name: string;
}

export interface AddPriceTableItemInput {
  priceTableId: string;
  productId: string;
  unitPriceCents: number;
  unit: string;
}

export interface UpdatePriceTableItemInput {
  unitPriceCents?: number;
  unit?: string;
}

export interface LinkCustomerToPriceTableInput {
  customerId: string;
  priceTableId: string;
}

export interface PriceTableRow {
  id: string;
  company_id: string;
  name: string;
  omie_table_id: number | null;
  needs_push: number;
  omie_updated_at: string | null;
  local_updated_at: string | null;
  last_synced_at: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PriceTableItemRow {
  id: string;
  price_table_id: string;
  product_id: string;
  unit_price_cents: number;
  unit: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PriceTableItemSummary {
  id: string;
  priceTableId: string;
  productId: string;
  productCode: string | null;
  productDesc: string;
  unitPriceCents: number;
  unit: string;
}

export interface CustomerPriceTableRow {
  id: string;
  customer_id: string;
  price_table_id: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CustomerPriceTableSummary {
  id: string;
  customerId: string;
  priceTableId: string;
  customerTradeName: string;
}

export function createPriceTable(
  database: DesktopDatabase,
  input: CreatePriceTableInput,
  now: Date = new Date()
): PriceTableRow {
  const id = randomUUID();
  const nowIso = now.toISOString();

  database
    .prepare(
      `INSERT INTO price_tables (
        id, company_id, name, needs_push, is_active, created_at, updated_at, local_updated_at
      ) VALUES (?, ?, ?, 1, 1, ?, ?, ?)`
    )
    .run(id, input.companyId, input.name, nowIso, nowIso, nowIso);

  return database
    .prepare("SELECT * FROM price_tables WHERE id = ?")
    .get(id) as PriceTableRow;
}

export function updatePriceTableName(
  database: DesktopDatabase,
  id: string,
  name: string,
  now: Date = new Date()
): PriceTableRow {
  const nowIso = now.toISOString();

  database
    .prepare(
      `UPDATE price_tables SET name = ?, needs_push = 1, local_updated_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(name, nowIso, nowIso, id);

  return database
    .prepare("SELECT * FROM price_tables WHERE id = ?")
    .get(id) as PriceTableRow;
}

export function deletePriceTable(
  database: DesktopDatabase,
  id: string,
  now: Date = new Date()
): void {
  const nowIso = now.toISOString();

  database
    .prepare(
      `UPDATE price_table_items SET deleted_at = ?, updated_at = ? WHERE price_table_id = ? AND deleted_at IS NULL`
    )
    .run(nowIso, nowIso, id);

  database
    .prepare(
      `UPDATE customer_price_tables SET deleted_at = ?, updated_at = ? WHERE price_table_id = ? AND deleted_at IS NULL`
    )
    .run(nowIso, nowIso, id);

  database
    .prepare(
      `UPDATE price_tables SET deleted_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(nowIso, nowIso, id);
}

export function addPriceTableItem(
  database: DesktopDatabase,
  input: AddPriceTableItemInput,
  now: Date = new Date()
): PriceTableItemRow {
  const id = randomUUID();
  const nowIso = now.toISOString();

  database
    .prepare(
      `INSERT INTO price_table_items (
        id, price_table_id, product_id, unit_price_cents, unit, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.priceTableId, input.productId, input.unitPriceCents, input.unit, nowIso, nowIso);

  return database
    .prepare("SELECT * FROM price_table_items WHERE id = ?")
    .get(id) as PriceTableItemRow;
}

export function updatePriceTableItem(
  database: DesktopDatabase,
  id: string,
  input: UpdatePriceTableItemInput,
  now: Date = new Date()
): PriceTableItemRow {
  const nowIso = now.toISOString();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.unitPriceCents !== undefined) {
    sets.push("unit_price_cents = ?");
    values.push(input.unitPriceCents);
  }
  if (input.unit !== undefined) {
    sets.push("unit = ?");
    values.push(input.unit);
  }

  if (sets.length === 0) {
    return database
      .prepare("SELECT * FROM price_table_items WHERE id = ?")
      .get(id) as PriceTableItemRow;
  }

  sets.push("updated_at = ?");
  values.push(nowIso);
  values.push(id);

  database
    .prepare(`UPDATE price_table_items SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);

  return database
    .prepare("SELECT * FROM price_table_items WHERE id = ?")
    .get(id) as PriceTableItemRow;
}

export function removePriceTableItem(
  database: DesktopDatabase,
  id: string,
  now: Date = new Date()
): void {
  const nowIso = now.toISOString();

  database
    .prepare(
      `UPDATE price_table_items SET deleted_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(nowIso, nowIso, id);
}

export function linkCustomerToPriceTable(
  database: DesktopDatabase,
  input: LinkCustomerToPriceTableInput,
  now: Date = new Date()
): CustomerPriceTableRow {
  // Deactivate any existing link for this customer
  const nowIso = now.toISOString();
  database
    .prepare(
      `UPDATE customer_price_tables SET is_active = 0, updated_at = ? WHERE customer_id = ? AND is_active = 1`
    )
    .run(nowIso, input.customerId);

  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO customer_price_tables (
        id, customer_id, price_table_id, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?)`
    )
    .run(id, input.customerId, input.priceTableId, nowIso, nowIso);

  return database
    .prepare("SELECT * FROM customer_price_tables WHERE id = ?")
    .get(id) as CustomerPriceTableRow;
}

export function unlinkCustomerFromPriceTable(
  database: DesktopDatabase,
  linkId: string,
  now: Date = new Date()
): void {
  const nowIso = now.toISOString();

  database
    .prepare(
      `UPDATE customer_price_tables SET is_active = 0, updated_at = ? WHERE id = ?`
    )
    .run(nowIso, linkId);
}

export function listPriceTables(
  database: DesktopDatabase,
  companyId: string
): PriceTableRow[] {
  return database
    .prepare(
      `SELECT * FROM price_tables WHERE company_id = ? AND deleted_at IS NULL ORDER BY name ASC`
    )
    .all(companyId) as PriceTableRow[];
}

export function listPriceTableItems(
  database: DesktopDatabase,
  priceTableId: string
): PriceTableItemSummary[] {
  return database
    .prepare(
      `SELECT
         pti.id,
         pti.price_table_id,
         pti.product_id,
         pti.unit_price_cents,
         pti.unit,
         p.code AS product_code,
         p.description AS product_description
       FROM price_table_items pti
       LEFT JOIN products p ON p.id = pti.product_id
       WHERE pti.price_table_id = ? AND pti.deleted_at IS NULL
       ORDER BY pti.created_at ASC`
    )
    .all(priceTableId)
    .map((row) => {
      const item = row as {
        id: string;
        price_table_id: string;
        product_id: string;
        unit_price_cents: number;
        unit: string;
        product_code: string | null;
        product_description: string | null;
      };
      return {
        id: item.id,
        priceTableId: item.price_table_id,
        productId: item.product_id,
        productCode: item.product_code,
        productDesc: item.product_description ?? item.product_id,
        unitPriceCents: item.unit_price_cents,
        unit: item.unit
      };
    });
}

export function listCustomerLinks(
  database: DesktopDatabase,
  priceTableId: string
): CustomerPriceTableSummary[] {
  return database
    .prepare(
      `SELECT cpt.*, c.trade_name as customer_trade_name
       FROM customer_price_tables cpt
       JOIN customers c ON c.id = cpt.customer_id
       WHERE cpt.price_table_id = ? AND cpt.deleted_at IS NULL AND cpt.is_active = 1
       ORDER BY c.trade_name ASC`
    )
    .all(priceTableId)
    .map((row) => {
      const link = row as CustomerPriceTableRow & { customer_trade_name: string };
      return {
        id: link.id,
        customerId: link.customer_id,
        priceTableId: link.price_table_id,
        customerTradeName: link.customer_trade_name
      };
    });
}
