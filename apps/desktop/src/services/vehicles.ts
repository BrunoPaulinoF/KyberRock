import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface CreateVehicleInput {
  companyId: string;
  plate: string;
  description?: string;
  carrierId?: string;
}

export interface UpdateVehicleInput {
  plate?: string;
  description?: string;
  carrierId?: string | null;
  isActive?: boolean;
}

export interface VehicleRow {
  id: string;
  company_id: string;
  plate: string;
  description: string | null;
  carrier_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function createVehicle(
  database: DesktopDatabase,
  input: CreateVehicleInput,
  now: Date = new Date()
): VehicleRow {
  const id = randomUUID();
  const nowIso = now.toISOString();

  database
    .prepare(
      `INSERT INTO vehicles (id, company_id, plate, description, carrier_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(id, input.companyId, input.plate.toUpperCase(), input.description ?? null, input.carrierId ?? null, nowIso, nowIso);

  return database.prepare("SELECT * FROM vehicles WHERE id = ?").get(id) as VehicleRow;
}

export function updateVehicle(
  database: DesktopDatabase,
  id: string,
  input: UpdateVehicleInput,
  now: Date = new Date()
): VehicleRow {
  const existing = database
    .prepare("SELECT * FROM vehicles WHERE id = ? AND deleted_at IS NULL")
    .get(id) as VehicleRow | undefined;

  if (!existing) throw new Error("Veiculo nao encontrado.");

  const nowIso = now.toISOString();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.plate !== undefined) { sets.push("plate = ?"); values.push(input.plate.toUpperCase()); }
  if (input.description !== undefined) { sets.push("description = ?"); values.push(input.description); }
  if (input.carrierId !== undefined) { sets.push("carrier_id = ?"); values.push(input.carrierId); }
  if (input.isActive !== undefined) { sets.push("is_active = ?"); values.push(input.isActive ? 1 : 0); }

  if (sets.length === 0) return existing;

  sets.push("updated_at = ?");
  values.push(nowIso);
  values.push(id);

  database.prepare(`UPDATE vehicles SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return database.prepare("SELECT * FROM vehicles WHERE id = ?").get(id) as VehicleRow;
}

export function deleteVehicle(
  database: DesktopDatabase,
  id: string,
  now: Date = new Date()
): void {
  database
    .prepare("UPDATE vehicles SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .run(now.toISOString(), now.toISOString(), id);
}

export function findOrCreateVehicle(
  database: DesktopDatabase,
  companyId: string,
  plate: string,
  now: Date = new Date()
): VehicleRow {
  const normalized = plate.trim().toUpperCase();
  const existing = database
    .prepare("SELECT * FROM vehicles WHERE company_id = ? AND plate = ? AND deleted_at IS NULL")
    .get(companyId, normalized) as VehicleRow | undefined;

  if (existing) return existing;

  return createVehicle(database, { companyId, plate: normalized }, now);
}

export interface VehicleCarrierRow {
  id: string;
  vehicle_id: string;
  carrier_id: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function linkVehicleToCarrier(
  database: DesktopDatabase,
  vehicleId: string,
  carrierId: string,
  now: Date = new Date()
): VehicleCarrierRow {
  const nowIso = now.toISOString();
  const id = randomUUID();

  const existing = database
    .prepare("SELECT * FROM vehicle_carriers WHERE vehicle_id = ? AND carrier_id = ? AND deleted_at IS NULL")
    .get(vehicleId, carrierId) as VehicleCarrierRow | undefined;

  if (existing) {
    database
      .prepare("UPDATE vehicle_carriers SET is_active = 1, updated_at = ? WHERE id = ?")
      .run(nowIso, existing.id);
    return { ...existing, is_active: 1, updated_at: nowIso };
  }

  database
    .prepare(
      `INSERT INTO vehicle_carriers (id, vehicle_id, carrier_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    )
    .run(id, vehicleId, carrierId, nowIso, nowIso);

  return database.prepare("SELECT * FROM vehicle_carriers WHERE id = ?").get(id) as VehicleCarrierRow;
}

export function unlinkVehicleFromCarrier(
  database: DesktopDatabase,
  vehicleId: string,
  carrierId: string,
  now: Date = new Date()
): void {
  database
    .prepare("UPDATE vehicle_carriers SET deleted_at = ?, updated_at = ? WHERE vehicle_id = ? AND carrier_id = ? AND deleted_at IS NULL")
    .run(now.toISOString(), now.toISOString(), vehicleId, carrierId);
}

export function getVehicleCarriers(
  database: DesktopDatabase,
  vehicleId: string
): Array<{ carrierId: string; carrierName: string; carrierDocument: string | null }> {
  return database
    .prepare(
      `SELECT c.id AS "carrierId", c.name AS "carrierName", c.document AS "carrierDocument"
       FROM vehicle_carriers vc
       JOIN carriers c ON vc.carrier_id = c.id
       WHERE vc.vehicle_id = ? AND vc.deleted_at IS NULL AND vc.is_active = 1
       ORDER BY c.name ASC`
    )
    .all(vehicleId) as Array<{ carrierId: string; carrierName: string; carrierDocument: string | null }>;
}

export function listVehicles(database: DesktopDatabase, companyId: string): VehicleRow[] {
  return database
    .prepare("SELECT * FROM vehicles WHERE company_id = ? AND deleted_at IS NULL ORDER BY plate ASC")
    .all(companyId) as VehicleRow[];
}
