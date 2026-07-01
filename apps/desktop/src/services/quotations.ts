import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export type QuotationStatus = "open" | "consumed" | "cancelled";

export interface QuotationRow {
  id: string;
  company_id: string;
  customer_id: string;
  product_id: string;
  payment_term_id: string | null;
  unit_price_cents: number;
  estimated_quantity_kg: number;
  notes: string | null;
  status: QuotationStatus;
  consumed_operation_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface QuotationSummary {
  id: string;
  customerId: string;
  customerName: string;
  productId: string;
  productDescription: string;
  paymentTermId: string | null;
  paymentTermName: string | null;
  unitPriceCents: number;
  estimatedQuantityKg: number;
  status: QuotationStatus;
  createdAt: string;
}

export interface CreateQuotationInput {
  companyId: string;
  customerId: string;
  productId: string;
  paymentTermId?: string | null;
  unitPriceCents: number;
  estimatedQuantityKg: number;
  notes?: string | null;
}

export function createQuotation(
  database: DesktopDatabase,
  input: CreateQuotationInput,
  now: Date = new Date()
): QuotationRow {
  const id = randomUUID();
  const nowIso = now.toISOString();
  database
    .prepare(
      `INSERT INTO quotations (
        id, company_id, customer_id, product_id, payment_term_id, unit_price_cents,
        estimated_quantity_kg, notes, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    )
    .run(
      id,
      input.companyId,
      input.customerId,
      input.productId,
      input.paymentTermId ?? null,
      input.unitPriceCents,
      input.estimatedQuantityKg,
      input.notes ?? null,
      nowIso,
      nowIso
    );
  return database
    .prepare("SELECT * FROM quotations WHERE id = ?")
    .get(id) as QuotationRow;
}

export function cancelQuotation(
  database: DesktopDatabase,
  id: string,
  now: Date = new Date()
): void {
  const nowIso = now.toISOString();
  database
    .prepare(
      `UPDATE quotations SET status = 'cancelled', updated_at = ? WHERE id = ?`
    )
    .run(nowIso, id);
}

export function consumeQuotation(
  database: DesktopDatabase,
  quotationId: string,
  operationId: string,
  now: Date = new Date()
): void {
  const nowIso = now.toISOString();
  database
    .prepare(
      `UPDATE quotations
       SET status = 'consumed', consumed_operation_id = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(operationId, nowIso, quotationId);
}

export function listOpenQuotationsForCustomer(
  database: DesktopDatabase,
  customerId: string
): QuotationSummary[] {
  return database
    .prepare(
      `SELECT
         q.id, q.customer_id, q.product_id, q.payment_term_id, q.unit_price_cents,
         q.estimated_quantity_kg, q.status, q.created_at,
         c.trade_name AS customer_name,
         p.description AS product_description,
         pt.name AS payment_term_name
       FROM quotations q
       LEFT JOIN customers c ON c.id = q.customer_id
       LEFT JOIN products p ON p.id = q.product_id
       LEFT JOIN payment_terms pt ON pt.id = q.payment_term_id
       WHERE q.customer_id = ? AND q.status = 'open' AND q.deleted_at IS NULL
       ORDER BY q.created_at DESC`
    )
    .all(customerId)
    .map((row) => {
      const r = row as {
        id: string;
        customer_id: string;
        customer_name: string | null;
        product_id: string;
        product_description: string | null;
        payment_term_id: string | null;
        payment_term_name: string | null;
        unit_price_cents: number;
        estimated_quantity_kg: number;
        status: QuotationStatus;
        created_at: string;
      };
      return {
        id: r.id,
        customerId: r.customer_id,
        customerName: r.customer_name ?? "",
        productId: r.product_id,
        productDescription: r.product_description ?? "",
        paymentTermId: r.payment_term_id,
        paymentTermName: r.payment_term_name,
        unitPriceCents: r.unit_price_cents,
        estimatedQuantityKg: r.estimated_quantity_kg,
        status: r.status,
        createdAt: r.created_at
      };
    });
}
