import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface CustomerCarrierRow {
  id: string;
  customer_id: string;
  carrier_id: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function linkCustomerCarrier(
  database: DesktopDatabase,
  customerId: string,
  carrierId: string,
  now: Date = new Date()
): CustomerCarrierRow {
  const nowIso = now.toISOString();

  const existing = database
    .prepare(
      "SELECT * FROM customer_carriers WHERE customer_id = ? AND carrier_id = ? AND deleted_at IS NULL"
    )
    .get(customerId, carrierId) as CustomerCarrierRow | undefined;

  if (existing) {
    if (existing.is_active === 0) {
      database
        .prepare(
          "UPDATE customer_carriers SET is_active = 1, updated_at = ? WHERE id = ?"
        )
        .run(nowIso, existing.id);
      return database
        .prepare("SELECT * FROM customer_carriers WHERE id = ?")
        .get(existing.id) as CustomerCarrierRow;
    }
    return existing;
  }

  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO customer_carriers (id, customer_id, carrier_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    )
    .run(id, customerId, carrierId, nowIso, nowIso);

  return database
    .prepare("SELECT * FROM customer_carriers WHERE id = ?")
    .get(id) as CustomerCarrierRow;
}

export function unlinkCustomerCarrier(
  database: DesktopDatabase,
  customerId: string,
  carrierId: string,
  now: Date = new Date()
): void {
  const nowIso = now.toISOString();
  database
    .prepare(
      `UPDATE customer_carriers SET deleted_at = ?, updated_at = ?
       WHERE customer_id = ? AND carrier_id = ? AND deleted_at IS NULL`
    )
    .run(nowIso, nowIso, customerId, carrierId);
}

export function listCarriersByCustomer(
  database: DesktopDatabase,
  customerId: string
): Array<{ id: string; name: string; document: string | null }> {
  return database
    .prepare(
      `SELECT c.id, c.name, c.document
       FROM customer_carriers cc
       JOIN carriers c ON cc.carrier_id = c.id
       WHERE cc.customer_id = ? AND cc.is_active = 1 AND cc.deleted_at IS NULL AND c.deleted_at IS NULL AND c.is_active = 1
       ORDER BY c.name ASC`
    )
    .all(customerId) as Array<{ id: string; name: string; document: string | null }>;
}

export function listCustomersByCarrier(
  database: DesktopDatabase,
  carrierId: string
): Array<{ id: string; trade_name: string; legal_name: string }> {
  return database
    .prepare(
      `SELECT c.id, c.trade_name, c.legal_name
       FROM customer_carriers cc
       JOIN customers c ON cc.customer_id = c.id
       WHERE cc.carrier_id = ? AND cc.is_active = 1 AND cc.deleted_at IS NULL AND c.deleted_at IS NULL AND c.is_active = 1
       ORDER BY c.trade_name ASC`
    )
    .all(carrierId) as Array<{ id: string; trade_name: string; legal_name: string }>;
}
