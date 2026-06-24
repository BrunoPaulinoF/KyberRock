import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface DriverCarrierRow {
  id: string;
  driver_id: string;
  carrier_id: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export function linkDriverCarrier(
  database: DesktopDatabase,
  driverId: string,
  carrierId: string,
  now: Date = new Date()
): DriverCarrierRow {
  const nowIso = now.toISOString();

  const existing = database
    .prepare(
      "SELECT * FROM driver_carriers WHERE driver_id = ? AND carrier_id = ? AND deleted_at IS NULL"
    )
    .get(driverId, carrierId) as DriverCarrierRow | undefined;

  if (existing) {
    if (existing.is_active === 0) {
      database
        .prepare(
          "UPDATE driver_carriers SET is_active = 1, updated_at = ? WHERE id = ?"
        )
        .run(nowIso, existing.id);
      return database
        .prepare("SELECT * FROM driver_carriers WHERE id = ?")
        .get(existing.id) as DriverCarrierRow;
    }
    return existing;
  }

  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO driver_carriers (id, driver_id, carrier_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    )
    .run(id, driverId, carrierId, nowIso, nowIso);

  return database
    .prepare("SELECT * FROM driver_carriers WHERE id = ?")
    .get(id) as DriverCarrierRow;
}

export function unlinkDriverCarrier(
  database: DesktopDatabase,
  driverId: string,
  carrierId: string,
  now: Date = new Date()
): void {
  const nowIso = now.toISOString();
  database
    .prepare(
      `UPDATE driver_carriers SET deleted_at = ?, updated_at = ?
       WHERE driver_id = ? AND carrier_id = ? AND deleted_at IS NULL`
    )
    .run(nowIso, nowIso, driverId, carrierId);
}

export function listCarriersByDriver(
  database: DesktopDatabase,
  driverId: string
): Array<{ id: string; name: string; document: string | null }> {
  return database
    .prepare(
      `SELECT c.id, c.name, c.document
       FROM driver_carriers dc
       JOIN carriers c ON dc.carrier_id = c.id
       WHERE dc.driver_id = ? AND dc.is_active = 1 AND dc.deleted_at IS NULL AND c.deleted_at IS NULL AND c.is_active = 1
       ORDER BY c.name ASC`
    )
    .all(driverId) as Array<{ id: string; name: string; document: string | null }>;
}

export function listDriversByCarrier(
  database: DesktopDatabase,
  carrierId: string
): Array<{ id: string; name: string; document: string | null; is_independent: number }> {
  return database
    .prepare(
      `SELECT d.id, d.name, d.document, d.is_independent
       FROM driver_carriers dc
       JOIN drivers d ON dc.driver_id = d.id
       WHERE dc.carrier_id = ? AND dc.is_active = 1 AND dc.deleted_at IS NULL AND d.deleted_at IS NULL AND d.is_active = 1
       ORDER BY d.name ASC`
    )
    .all(carrierId) as Array<{ id: string; name: string; document: string | null; is_independent: number }>;
}

export function listIndependentDrivers(
  database: DesktopDatabase,
  companyId: string
): Array<{ id: string; name: string; document: string | null }> {
  return database
    .prepare(
      `SELECT id, name, document
       FROM drivers
       WHERE company_id = ? AND is_independent = 1 AND deleted_at IS NULL AND is_active = 1
       ORDER BY name ASC`
    )
    .all(companyId) as Array<{ id: string; name: string; document: string | null }>;
}
