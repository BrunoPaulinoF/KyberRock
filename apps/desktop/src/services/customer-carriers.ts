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
        .prepare("UPDATE customer_carriers SET is_active = 1, updated_at = ? WHERE id = ?")
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

  promoteDefaultCarrier(database, customerId, carrierId, nowIso);

  return database
    .prepare("SELECT * FROM customer_carriers WHERE id = ?")
    .get(id) as CustomerCarrierRow;
}

/**
 * Nome da transportadora automatica criada junto com o cliente quando nenhuma foi
 * informada ("<cliente> (padrão)"). Ela e apenas um marcador de "sem transportadora
 * definida" — nao representa uma transportadora real.
 */
export function isPlaceholderDefaultCarrierName(
  carrierName: string,
  tradeName: string | null,
  legalName: string | null
): boolean {
  const name = normalizeName(carrierName);
  if (!name.endsWith("(padrao)")) return false;
  const base = name.slice(0, -"(padrao)".length).trim();
  return base === normalizeName(tradeName ?? "") || base === normalizeName(legalName ?? "");
}

function normalizeName(value: string): string {
  return value
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Promove a transportadora recem-vinculada a padrao do cliente quando ele ainda nao
 * tem uma de verdade: sem padrao, ou com o marcador "<cliente> (padrão)" criado
 * automaticamente no cadastro. Sem isso o cadastro continuava mostrando (e a nova
 * entrada continuava puxando) o marcador mesmo depois de o usuario vincular uma
 * transportadora. Um padrao ja definido pelo usuario nunca e sobrescrito.
 */
function promoteDefaultCarrier(
  database: DesktopDatabase,
  customerId: string,
  carrierId: string,
  nowIso: string
): void {
  const customer = database
    .prepare(
      `SELECT trade_name, legal_name, default_carrier_id
       FROM customers WHERE id = ? AND deleted_at IS NULL`
    )
    .get(customerId) as
    | { trade_name: string | null; legal_name: string | null; default_carrier_id: string | null }
    | undefined;
  if (!customer) return;
  if (customer.default_carrier_id === carrierId) return;

  if (customer.default_carrier_id) {
    const current = database
      .prepare("SELECT name FROM carriers WHERE id = ? AND deleted_at IS NULL")
      .get(customer.default_carrier_id) as { name: string } | undefined;
    const replaceable =
      !current ||
      isPlaceholderDefaultCarrierName(current.name, customer.trade_name, customer.legal_name);
    if (!replaceable) return;
  }

  setDefaultCarrier(database, customerId, carrierId, nowIso);
}

/** Transportadora padrao atual do cliente, para o formulario nao salvar um valor velho. */
export function getCustomerDefaultCarrierId(
  database: DesktopDatabase,
  customerId: string
): string | null {
  const row = database
    .prepare("SELECT default_carrier_id FROM customers WHERE id = ? AND deleted_at IS NULL")
    .get(customerId) as { default_carrier_id: string | null } | undefined;
  return row?.default_carrier_id ?? null;
}

function setDefaultCarrier(
  database: DesktopDatabase,
  customerId: string,
  carrierId: string | null,
  nowIso: string
): void {
  database
    .prepare(
      `UPDATE customers
       SET default_carrier_id = ?, needs_push = 1, local_updated_at = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(carrierId, nowIso, nowIso, customerId);
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

  // Desvincular a transportadora padrao deixaria o cadastro apontando para uma
  // transportadora que o seletor da nova entrada nao lista mais: cai para outra
  // vinculada, ou fica sem padrao.
  const isDefault = database
    .prepare("SELECT 1 FROM customers WHERE id = ? AND default_carrier_id = ?")
    .get(customerId, carrierId);
  if (isDefault) {
    const remaining = listCarriersByCustomer(database, customerId);
    setDefaultCarrier(database, customerId, remaining[0]?.id ?? null, nowIso);
  }
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
