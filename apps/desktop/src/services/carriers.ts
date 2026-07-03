import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface CreateCarrierInput {
  companyId: string;
  name: string;
  document?: string;
  phone?: string;
  email?: string;
  zipcode?: string;
  addressStreet?: string;
  addressNumber?: string;
  addressComplement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  nfRequired?: boolean;
  omieCustomerId?: number;
}

export interface UpdateCarrierInput {
  name?: string;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  zipcode?: string | null;
  addressStreet?: string | null;
  addressNumber?: string | null;
  addressComplement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  nfRequired?: boolean;
  omieCustomerId?: number | null;
  isActive?: boolean;
}

export function createCarrier(
  database: DesktopDatabase,
  input: CreateCarrierInput,
  now: Date = new Date()
): unknown {
  const id = randomUUID();
  const nowIso = now.toISOString();

  database
    .prepare(
      `INSERT INTO carriers (
        id, company_id, omie_customer_id, name, document, phone, email, zipcode, address_street,
        address_number, address_complement, neighborhood, city, state, nf_required, source, sync_status, needs_push,
        is_active, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', 'pending', 1, 1, ?, ?)`
    )
    .run(
      id,
      input.companyId,
      input.omieCustomerId ?? null,
      input.name,
      input.document ?? null,
      input.phone ?? null,
      input.email ?? null,
      input.zipcode ?? null,
      input.addressStreet ?? null,
      input.addressNumber ?? null,
      input.addressComplement ?? null,
      input.neighborhood ?? null,
      input.city ?? null,
      input.state ?? null,
      input.nfRequired ? 1 : 0,
      nowIso,
      nowIso
    );

  return database.prepare("SELECT * FROM carriers WHERE id = ?").get(id);
}

export function updateCarrier(
  database: DesktopDatabase,
  id: string,
  input: UpdateCarrierInput,
  now: Date = new Date()
): unknown {
  const existing = database
    .prepare("SELECT * FROM carriers WHERE id = ? AND deleted_at IS NULL")
    .get(id) as Record<string, unknown> | undefined;

  if (!existing) throw new Error("Transportadora nao encontrada.");

  const nowIso = now.toISOString();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.name !== undefined) {
    sets.push("name = ?");
    values.push(input.name);
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
  if (input.zipcode !== undefined) {
    sets.push("zipcode = ?");
    values.push(input.zipcode);
  }
  if (input.addressStreet !== undefined) {
    sets.push("address_street = ?");
    values.push(input.addressStreet);
  }
  if (input.addressNumber !== undefined) {
    sets.push("address_number = ?");
    values.push(input.addressNumber);
  }
  if (input.addressComplement !== undefined) {
    sets.push("address_complement = ?");
    values.push(input.addressComplement);
  }
  if (input.neighborhood !== undefined) {
    sets.push("neighborhood = ?");
    values.push(input.neighborhood);
  }
  if (input.city !== undefined) {
    sets.push("city = ?");
    values.push(input.city);
  }
  if (input.state !== undefined) {
    sets.push("state = ?");
    values.push(input.state);
  }
  if (input.nfRequired !== undefined) {
    sets.push("nf_required = ?");
    values.push(input.nfRequired ? 1 : 0);
  }
  if (input.omieCustomerId !== undefined) {
    sets.push("omie_customer_id = ?");
    values.push(input.omieCustomerId);
  }
  if (input.isActive !== undefined) {
    sets.push("is_active = ?");
    values.push(input.isActive ? 1 : 0);
  }

  if (sets.length === 0) return existing;

  sets.push("sync_status = 'pending'");
  sets.push("needs_push = 1");
  sets.push("updated_at = ?");
  values.push(nowIso);
  values.push(id);

  database.prepare(`UPDATE carriers SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return database.prepare("SELECT * FROM carriers WHERE id = ?").get(id);
}

export function deleteCarrier(database: DesktopDatabase, id: string, now: Date = new Date()): void {
  const existing = database
    .prepare("SELECT id FROM carriers WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { id: string } | undefined;

  if (!existing) throw new Error("Transportadora nao encontrada.");

  database
    .prepare(
      "UPDATE carriers SET deleted_at = ?, needs_push = 0, updated_at = ? WHERE id = ? AND deleted_at IS NULL"
    )
    .run(now.toISOString(), now.toISOString(), id);
}

export interface CarrierRow {
  id: string;
  company_id: string;
  omie_customer_id: number | null;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  zipcode: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  nf_required: number;
  source: string;
  sync_status: "synced" | "pending" | "error";
  needs_push: number;
  last_synced_at: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function listCarriers(database: DesktopDatabase, companyId: string): CarrierRow[] {
  return database
    .prepare("SELECT * FROM carriers WHERE company_id = ? AND deleted_at IS NULL ORDER BY name ASC")
    .all(companyId) as CarrierRow[];
}

export function getCarrierVehicles(
  database: DesktopDatabase,
  carrierId: string
): Array<{ id: string; plate: string; description: string | null }> {
  return database
    .prepare(
      `SELECT v.id, v.plate, v.description
       FROM vehicle_carriers vc
       JOIN vehicles v ON vc.vehicle_id = v.id
       WHERE vc.carrier_id = ? AND vc.deleted_at IS NULL AND vc.is_active = 1
       ORDER BY v.plate ASC`
    )
    .all(carrierId) as Array<{ id: string; plate: string; description: string | null }>;
}

export const DEFAULT_CARRIER_NAME_SUFFIX = " (padrao)";

export function buildDefaultCarrierName(tradeName: string, legalName: string): string {
  const base = (tradeName || legalName || "").trim();
  return `${base}${DEFAULT_CARRIER_NAME_SUFFIX}`;
}

export function findDefaultCarrierForCustomer(
  database: DesktopDatabase,
  companyId: string,
  carrierName: string
): CarrierRow | undefined {
  return database
    .prepare(
      `SELECT * FROM carriers
       WHERE company_id = ? AND name = ? AND deleted_at IS NULL
       LIMIT 1`
    )
    .get(companyId, carrierName) as CarrierRow | undefined;
}

export function ensureCustomerDefaultCarrier(
  database: DesktopDatabase,
  customerId: string,
  now: Date = new Date()
): CarrierRow | null {
  const customer = database
    .prepare("SELECT * FROM customers WHERE id = ? AND deleted_at IS NULL")
    .get(customerId) as
    | {
        id: string;
        company_id: string;
        trade_name: string;
        legal_name: string;
        default_carrier_id: string | null;
      }
    | undefined;

  if (!customer) return null;

  if (customer.default_carrier_id) {
    const existing = database
      .prepare("SELECT * FROM carriers WHERE id = ? AND deleted_at IS NULL")
      .get(customer.default_carrier_id) as CarrierRow | undefined;
    if (existing) return existing;
  }

  const carrierName = buildDefaultCarrierName(customer.trade_name, customer.legal_name);
  const reused = findDefaultCarrierForCustomer(database, customer.company_id, carrierName);
  let carrier: CarrierRow;
  if (reused) {
    carrier = reused;
  } else {
    const created = createCarrier(
      database,
      { companyId: customer.company_id, name: carrierName },
      now
    );
    carrier = created as CarrierRow;
  }

  database
    .prepare("UPDATE customers SET default_carrier_id = ?, updated_at = ? WHERE id = ?")
    .run(carrier.id, now.toISOString(), customerId);

  return carrier;
}
