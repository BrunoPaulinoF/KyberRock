import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface CreateCustomerInput {
  companyId: string;
  tradeName: string;
  legalName: string;
  document?: string;
  phone?: string;
  email?: string;
  creditLimitCents?: number;
  omieBillingBlocked?: boolean;
  observations?: string;
  defaultCarrierId?: string;
}

export interface UpdateCustomerInput {
  tradeName?: string;
  legalName?: string;
  document?: string;
  phone?: string;
  email?: string;
  creditLimitCents?: number;
  omieBillingBlocked?: boolean;
  observations?: string;
  isActive?: boolean;
  defaultCarrierId?: string | null;
}

export interface CustomerRow {
  id: string;
  company_id: string;
  omie_customer_id: number | null;
  omie_integration_code: string | null;
  source: "omie" | "local" | "hybrid";
  legal_name: string;
  trade_name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  credit_limit_cents: number | null;
  open_receivables_cents: number;
  omie_billing_blocked: number;
  observations: string | null;
  financial_cache_at: string | null;
  sync_status: "synced" | "pending" | "error";
  needs_push: number;
  omie_updated_at: string | null;
  local_updated_at: string | null;
  last_synced_at: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function createCustomer(
  database: DesktopDatabase,
  input: CreateCustomerInput,
  now: Date = new Date()
): CustomerRow {
  const id = randomUUID();
  const nowIso = now.toISOString();

  database
    .prepare(
      `INSERT INTO customers (
        id, company_id, source, legal_name, trade_name, document, phone, email,
        credit_limit_cents, open_receivables_cents, omie_billing_blocked,
        observations, default_carrier_id, sync_status, needs_push, local_updated_at, is_active,
        created_at, updated_at
      ) VALUES (?, ?, 'local', ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'pending', 1, ?, 1, ?, ?)`
    )
    .run(
      id,
      input.companyId,
      input.legalName,
      input.tradeName,
      input.document ?? null,
      input.phone ?? null,
      input.email ?? null,
      input.creditLimitCents ?? null,
      input.omieBillingBlocked ? 1 : 0,
      input.observations ?? null,
      input.defaultCarrierId ?? null,
      nowIso,
      nowIso,
      nowIso
    );

  return database
    .prepare("SELECT * FROM customers WHERE id = ?")
    .get(id) as CustomerRow;
}

export function updateCustomer(
  database: DesktopDatabase,
  id: string,
  input: UpdateCustomerInput,
  now: Date = new Date()
): CustomerRow {
  const existing = database
    .prepare("SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL")
    .get(id) as CustomerRow | undefined;

  if (!existing) {
    throw new Error("Cliente nao encontrado.");
  }

  const nowIso = now.toISOString();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.legalName !== undefined) {
    sets.push("legal_name = ?");
    values.push(input.legalName);
  }
  if (input.tradeName !== undefined) {
    sets.push("trade_name = ?");
    values.push(input.tradeName);
  }
  if (input.document !== undefined) {
    sets.push("document = ?");
    values.push(input.document);
  }
  if (input.phone !== undefined) {
    sets.push("phone = ?");
    values.push(input.phone);
  }
  if (input.email !== undefined) {
    sets.push("email = ?");
    values.push(input.email);
  }
  if (input.creditLimitCents !== undefined) {
    sets.push("credit_limit_cents = ?");
    values.push(input.creditLimitCents);
  }
  if (input.omieBillingBlocked !== undefined) {
    sets.push("omie_billing_blocked = ?");
    values.push(input.omieBillingBlocked ? 1 : 0);
  }
  if (input.observations !== undefined) {
    sets.push("observations = ?");
    values.push(input.observations);
  }
  if (input.defaultCarrierId !== undefined) {
    sets.push("default_carrier_id = ?");
    values.push(input.defaultCarrierId);
  }
  if (input.isActive !== undefined) {
    sets.push("is_active = ?");
    values.push(input.isActive ? 1 : 0);
  }

  if (sets.length === 0) {
    return existing;
  }

  sets.push("needs_push = 1");
  sets.push("local_updated_at = ?");
  values.push(nowIso);
  sets.push("updated_at = ?");
  values.push(nowIso);

  values.push(id);

  database
    .prepare(`UPDATE customers SET ${sets.join(", ")} WHERE id = ?`)
    .run(...values);

  return database
    .prepare("SELECT * FROM customers WHERE id = ?")
    .get(id) as CustomerRow;
}

export function deleteCustomer(
  database: DesktopDatabase,
  id: string,
  now: Date = new Date()
): void {
  const existing = database
    .prepare("SELECT id FROM customers WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { id: string } | undefined;

  if (!existing) {
    throw new Error("Cliente nao encontrado.");
  }

  const nowIso = now.toISOString();

  database
    .prepare(
      `UPDATE customers SET deleted_at = ?, updated_at = ?, needs_push = 1, local_updated_at = ? WHERE id = ?`
    )
    .run(nowIso, nowIso, nowIso, id);
}

export function listCustomers(
  database: DesktopDatabase,
  companyId: string
): CustomerRow[] {
  return database
    .prepare(
      `SELECT * FROM customers
       WHERE company_id = ? AND deleted_at IS NULL
       ORDER BY trade_name ASC`
    )
    .all(companyId) as CustomerRow[];
}

export function getCustomersByCarrier(
  database: DesktopDatabase,
  carrierId: string
): CustomerRow[] {
  return database
    .prepare(
      `SELECT * FROM customers
       WHERE default_carrier_id = ? AND deleted_at IS NULL AND is_active = 1
       ORDER BY trade_name ASC`
    )
    .all(carrierId) as CustomerRow[];
}
