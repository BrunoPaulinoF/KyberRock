import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";
import type { FreightRule } from "./freight.js";

export interface CustomerFreightRuleRow {
  id: string;
  customer_id: string;
  product_id: string | null;
  rule_json: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CustomerFreightRule {
  id: string;
  customerId: string;
  productId: string | null;
  productDescription: string | null;
  rule: FreightRule;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SetCustomerFreightRuleInput {
  customerId: string;
  productId?: string | null;
  rule: FreightRule;
}

export function getCustomerFreightRules(
  database: DesktopDatabase,
  customerId: string
): CustomerFreightRule[] {
  const rows = database
    .prepare(
      `SELECT r.id, r.customer_id, r.product_id, r.rule_json, r.is_active, r.created_at, r.updated_at,
              p.description AS product_description
       FROM customer_freight_rules r
       LEFT JOIN products p ON p.id = r.product_id
       WHERE r.customer_id = ? AND r.deleted_at IS NULL AND r.is_active = 1
       ORDER BY r.product_id IS NULL DESC, p.description ASC`
    )
    .all(customerId) as Array<{
    id: string;
    customer_id: string;
    product_id: string | null;
    rule_json: string;
    is_active: number;
    created_at: string;
    updated_at: string;
    product_description: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    productId: row.product_id,
    productDescription: row.product_description,
    rule: parseFreightRule(row.rule_json),
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }));
}

export function getCustomerFreightRuleForProduct(
  database: DesktopDatabase,
  customerId: string,
  productId: string
): CustomerFreightRule | null {
  const specific = database
    .prepare(
      `SELECT r.id, r.customer_id, r.product_id, r.rule_json, r.is_active, r.created_at, r.updated_at,
              p.description AS product_description
       FROM customer_freight_rules r
       LEFT JOIN products p ON p.id = r.product_id
       WHERE r.customer_id = ? AND r.product_id = ? AND r.deleted_at IS NULL AND r.is_active = 1
       LIMIT 1`
    )
    .get(customerId, productId) as CustomerFreightRuleRow | undefined;

  if (specific) {
    return mapRow(specific, database);
  }

  const defaultRule = database
    .prepare(
      `SELECT r.id, r.customer_id, r.product_id, r.rule_json, r.is_active, r.created_at, r.updated_at,
              p.description AS product_description
       FROM customer_freight_rules r
       LEFT JOIN products p ON p.id = r.product_id
       WHERE r.customer_id = ? AND r.product_id IS NULL AND r.deleted_at IS NULL AND r.is_active = 1
       LIMIT 1`
    )
    .get(customerId) as CustomerFreightRuleRow | undefined;

  if (defaultRule) {
    return mapRow(defaultRule, database);
  }

  return null;
}

export function setCustomerFreightRule(
  database: DesktopDatabase,
  input: SetCustomerFreightRuleInput,
  now: Date = new Date()
): CustomerFreightRule {
  const timestamp = now.toISOString();
  const existing = database
    .prepare(
      `SELECT id FROM customer_freight_rules
       WHERE customer_id = ? AND ${input.productId ? "product_id = ?" : "product_id IS NULL"}
       AND deleted_at IS NULL`
    )
    .get(input.customerId, ...(input.productId ? [input.productId] : [])) as
    | { id: string }
    | undefined;

  const id = existing?.id ?? randomUUID();

  database
    .prepare(
      `INSERT INTO customer_freight_rules (
         id, customer_id, product_id, rule_json, is_active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         product_id = excluded.product_id,
         rule_json = excluded.rule_json,
         is_active = 1,
         updated_at = excluded.updated_at`
    )
    .run(
      id,
      input.customerId,
      input.productId ?? null,
      JSON.stringify(input.rule),
      timestamp,
      timestamp
    );

  return getCustomerFreightRules(database, input.customerId).find((r) => r.id === id)!;
}

export function removeCustomerFreightRule(
  database: DesktopDatabase,
  ruleId: string,
  now: Date = new Date()
): void {
  database
    .prepare(
      `UPDATE customer_freight_rules SET deleted_at = ?, updated_at = ?, is_active = 0 WHERE id = ?`
    )
    .run(now.toISOString(), now.toISOString(), ruleId);
}

function parseFreightRule(value: string): FreightRule {
  try {
    const parsed = JSON.parse(value) as FreightRule;
    return parsed;
  } catch {
    return {
      id: "default",
      name: "Padrao",
      type: "per_ton",
      baseValueCents: 0,
      unit: "ton"
    };
  }
}

function mapRow(
  row: CustomerFreightRuleRow,
  database: DesktopDatabase
): CustomerFreightRule {
  const productDescription = row.product_id
    ? (
        database
          .prepare("SELECT description FROM products WHERE id = ?")
          .pluck()
          .get(row.product_id) as string | undefined
      ) ?? null
    : null;

  return {
    id: row.id,
    customerId: row.customer_id,
    productId: row.product_id,
    productDescription,
    rule: parseFreightRule(row.rule_json),
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
