import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";

export interface CreateVehicleInput {
  companyId: string;
  plate: string;
  /** UF de emplacamento (2 letras). Vai no `placa_estado` do frete do pedido no OMIE. */
  plateState?: string | null;
  description?: string;
  carrierId?: string;
}

export interface UpdateVehicleInput {
  plate?: string;
  plateState?: string | null;
  description?: string;
  carrierId?: string | null;
  isActive?: boolean;
}

export interface VehicleRow {
  id: string;
  company_id: string;
  plate: string;
  plate_state: string | null;
  description: string | null;
  carrier_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * UF em 2 letras maiusculas, ou null. O `placa_estado` do frete e campo fiscal: melhor
 * ficar vazio do que ir com texto invalido e o OMIE recusar a nota.
 */
function normalizePlateState(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(text) ? text : null;
}

/** Placa comparavel: so letras e numeros, em maiusculas ("hji-0517" e "HJI0517"). */
function comparablePlate(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Veiculo (nao apagado) que ja usa esta placa, ignorando tracos e espacos. A placa
 * identifica o caminhao: dois cadastros com a mesma placa sao sempre o mesmo veiculo.
 */
export function findVehicleByPlate(
  database: DesktopDatabase,
  companyId: string,
  plate: string,
  excludeId?: string
): VehicleRow | null {
  const normalized = comparablePlate(plate);
  if (!normalized) return null;
  const row = database
    .prepare(
      `SELECT * FROM vehicles
       WHERE company_id = ?
         AND deleted_at IS NULL
         AND UPPER(REPLACE(REPLACE(REPLACE(plate, '-', ''), ' ', ''), '.', '')) = ?
         AND (? IS NULL OR id <> ?)
       ORDER BY is_active DESC, created_at ASC
       LIMIT 1`
    )
    .get(companyId, normalized, excludeId ?? null, excludeId ?? null) as VehicleRow | undefined;
  return row ?? null;
}

/**
 * Cadastra a placa. Sem trava, cada tentativa criava mais um veiculo com a mesma placa:
 * era assim que a mesma placa aparecia 4, 6 vezes na base — o operador nao a encontrava
 * na lista, cadastrava de novo, e o duplicado nascia calado.
 *
 * Quando a placa ja existe:
 * - cadastro ATIVO: recusa e diz qual e, para o operador editar aquele em vez de duplicar;
 * - cadastro INATIVO: reativa e aplica o que ele acabou de digitar. Recusar aqui repetiria
 *   a armadilha do cadastro invisivel (a lista esconde os inativos) — a placa ficaria
 *   ocupada por um veiculo que ele nao tem como achar.
 */
export function createVehicle(
  database: DesktopDatabase,
  input: CreateVehicleInput,
  now: Date = new Date()
): VehicleRow {
  const nowIso = now.toISOString();
  const plate = input.plate.toUpperCase();

  const existing = findVehicleByPlate(database, input.companyId, plate);
  if (existing) {
    if (existing.is_active === 1) {
      const label = existing.description?.trim()
        ? `${existing.plate} (${existing.description.trim()})`
        : existing.plate;
      throw new Error(`Ja existe um veiculo com esta placa: ${label}.`);
    }
    return updateVehicle(
      database,
      existing.id,
      {
        plate,
        plateState: input.plateState ?? null,
        description: input.description,
        carrierId: input.carrierId ?? null,
        isActive: true
      },
      now
    );
  }

  const id = randomUUID();
  database
    .prepare(
      `INSERT INTO vehicles (id, company_id, plate, plate_state, description, carrier_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    )
    .run(
      id,
      input.companyId,
      plate,
      normalizePlateState(input.plateState),
      input.description ?? null,
      input.carrierId ?? null,
      nowIso,
      nowIso
    );

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

  if (input.plate !== undefined) {
    const twin = findVehicleByPlate(database, existing.company_id, input.plate, id);
    if (twin) {
      throw new Error(`Ja existe outro veiculo com a placa ${twin.plate}.`);
    }
    sets.push("plate = ?");
    values.push(input.plate.toUpperCase());
  }
  if (input.plateState !== undefined) {
    sets.push("plate_state = ?");
    values.push(normalizePlateState(input.plateState));
  }
  if (input.description !== undefined) {
    sets.push("description = ?");
    values.push(input.description);
  }
  if (input.carrierId !== undefined) {
    sets.push("carrier_id = ?");
    values.push(input.carrierId);
  }
  if (input.isActive !== undefined) {
    sets.push("is_active = ?");
    values.push(input.isActive ? 1 : 0);
  }

  if (sets.length === 0) return existing;

  sets.push("updated_at = ?");
  values.push(nowIso);
  values.push(id);

  database.prepare(`UPDATE vehicles SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return database.prepare("SELECT * FROM vehicles WHERE id = ?").get(id) as VehicleRow;
}

export function deleteVehicle(database: DesktopDatabase, id: string, now: Date = new Date()): void {
  const existing = database
    .prepare("SELECT id FROM vehicles WHERE id = ? AND deleted_at IS NULL")
    .get(id) as { id: string } | undefined;

  if (!existing) throw new Error("Veiculo nao encontrado.");

  database
    .prepare(
      "UPDATE vehicles SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL"
    )
    .run(now.toISOString(), now.toISOString(), id);
}

export function findOrCreateVehicle(
  database: DesktopDatabase,
  companyId: string,
  plate: string,
  now: Date = new Date()
): VehicleRow {
  const normalized = plate.trim().toUpperCase();
  // Comparacao ignorando traco/espaco: casar so pelo texto exato fazia "HJI-0517" nascer
  // como um segundo veiculo ao lado de "HJI0517".
  const existing = findVehicleByPlate(database, companyId, normalized);
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
    .prepare(
      "SELECT * FROM vehicle_carriers WHERE vehicle_id = ? AND carrier_id = ? AND deleted_at IS NULL"
    )
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

  return database
    .prepare("SELECT * FROM vehicle_carriers WHERE id = ?")
    .get(id) as VehicleCarrierRow;
}

export function unlinkVehicleFromCarrier(
  database: DesktopDatabase,
  vehicleId: string,
  carrierId: string,
  now: Date = new Date()
): void {
  database
    .prepare(
      "UPDATE vehicle_carriers SET deleted_at = ?, updated_at = ? WHERE vehicle_id = ? AND carrier_id = ? AND deleted_at IS NULL"
    )
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
    .all(vehicleId) as Array<{
    carrierId: string;
    carrierName: string;
    carrierDocument: string | null;
  }>;
}

export function listVehicles(database: DesktopDatabase, companyId: string): VehicleRow[] {
  return database
    .prepare(
      "SELECT * FROM vehicles WHERE company_id = ? AND deleted_at IS NULL ORDER BY plate ASC"
    )
    .all(companyId) as VehicleRow[];
}
