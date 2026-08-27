import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

/**
 * As placas de um cliente.
 *
 * Placa era cadastro solto: a nova entrada oferecia TODAS as placas da pedreira, e quem
 * registra a entrada — com o caminhao em cima da balanca e o motorista esperando — tinha
 * de achar a certa numa lista de milhares. Errar ali nao para a operacao na hora: a placa
 * sai no cupom, vai para a nota, e o erro so aparece na conferencia do fechamento.
 *
 * O vinculo e por CLIENTE, e nao por transportadora (que ja existe em `vehicle_carriers`):
 * quem chega para carregar e o caminhao do cliente, e e o nome dele que a balanca digita
 * primeiro.
 *
 * O vinculo FILTRA, mas nao PROIBE: a nova entrada mostra as placas do cliente quando o
 * campo abre e passa a mostrar todas assim que o operador digita. Caminhao emprestado,
 * frete contratado na hora e placa que ninguem cadastrou ainda sao a rotina da pedreira —
 * uma trava ali pararia a balanca.
 */

export interface CustomerVehicleRow {
  id: string;
  customer_id: string;
  vehicle_id: string;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CustomerVehicleSummary {
  id: string;
  plate: string;
  description: string | null;
}

export function linkCustomerVehicle(
  database: DesktopDatabase,
  customerId: string,
  vehicleId: string,
  now: Date = new Date()
): CustomerVehicleRow {
  const nowIso = now.toISOString();

  const existing = database
    .prepare(
      "SELECT * FROM customer_vehicles WHERE customer_id = ? AND vehicle_id = ? AND deleted_at IS NULL"
    )
    .get(customerId, vehicleId) as CustomerVehicleRow | undefined;

  if (existing) {
    if (existing.is_active === 0) {
      database
        .prepare("UPDATE customer_vehicles SET is_active = 1, updated_at = ? WHERE id = ?")
        .run(nowIso, existing.id);
      return database
        .prepare("SELECT * FROM customer_vehicles WHERE id = ?")
        .get(existing.id) as CustomerVehicleRow;
    }
    return existing;
  }

  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO customer_vehicles (id, customer_id, vehicle_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`
    )
    .run(id, customerId, vehicleId, nowIso, nowIso);

  return database
    .prepare("SELECT * FROM customer_vehicles WHERE id = ?")
    .get(id) as CustomerVehicleRow;
}

export function unlinkCustomerVehicle(
  database: DesktopDatabase,
  customerId: string,
  vehicleId: string,
  now: Date = new Date()
): void {
  const nowIso = now.toISOString();
  database
    .prepare(
      `UPDATE customer_vehicles SET deleted_at = ?, updated_at = ?
       WHERE customer_id = ? AND vehicle_id = ? AND deleted_at IS NULL`
    )
    .run(nowIso, nowIso, customerId, vehicleId);
}

export function listVehiclesByCustomer(
  database: DesktopDatabase,
  customerId: string
): CustomerVehicleSummary[] {
  return database
    .prepare(
      `SELECT v.id, v.plate, v.description
       FROM customer_vehicles cv
       JOIN vehicles v ON cv.vehicle_id = v.id
       WHERE cv.customer_id = ?
         AND cv.is_active = 1
         AND cv.deleted_at IS NULL
         AND v.deleted_at IS NULL
         AND v.is_active = 1
       ORDER BY v.plate ASC`
    )
    .all(customerId) as CustomerVehicleSummary[];
}
