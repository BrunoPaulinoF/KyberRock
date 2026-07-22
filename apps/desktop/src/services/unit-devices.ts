import { resolveDeviceColor } from "@kyberrock/shared";

import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";

/**
 * Espelho local dos computadores da unidade (multi-desktop por pedreira).
 * As linhas chegam de `desktop-status`/`desktop-pull` e alimentam a legenda de
 * cores da tela de Operacoes, alem de satisfazer a FK
 * `weighing_operations.device_id` para operacoes criadas em outras maquinas.
 */

export interface CloudUnitDevice {
  id?: unknown;
  name?: unknown;
  color?: unknown;
  is_active?: unknown;
}

export interface UnitDeviceInfo {
  id: string;
  name: string;
  color: string;
  isActive: boolean;
  isSelf: boolean;
}

export function upsertUnitDevices(
  database: DesktopDatabase,
  identity: Pick<LocalDesktopIdentity, "companyId" | "unitId">,
  devices: CloudUnitDevice[]
): number {
  if (!devices.length) return 0;
  const timestamp = new Date().toISOString();
  // Conflito por id: nunca troca o installation_id de uma linha existente (a
  // linha desta instalacao e gerida pelo bootstrap). Insercoes de maquinas
  // remotas usam um placeholder unico e estavel, ja que o installation_id real
  // de outra maquina nao interessa localmente.
  const upsert = database.prepare(`
    INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, color, is_active, created_at, updated_at)
    VALUES (@id, @companyId, @unitId, @name, 'desktop_scale', @installationId, @color, @isActive, @timestamp, @timestamp)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      color = COALESCE(excluded.color, devices.color),
      is_active = excluded.is_active,
      updated_at = excluded.updated_at
  `);

  const apply = database.transaction(() => {
    let count = 0;
    for (const device of devices) {
      const id = typeof device.id === "string" ? device.id.trim() : "";
      if (!id) continue;
      const name =
        typeof device.name === "string" && device.name.trim() ? device.name.trim() : "Computador";
      const color =
        typeof device.color === "string" && device.color.trim() ? device.color.trim() : null;
      upsert.run({
        id,
        companyId: identity.companyId,
        unitId: identity.unitId,
        name,
        installationId: `remote-${id}`,
        color,
        isActive: device.is_active === false ? 0 : 1,
        timestamp
      });
      count++;
    }
    return count;
  });

  return apply();
}

export function listUnitDevices(
  database: DesktopDatabase,
  identity: Pick<LocalDesktopIdentity, "unitId" | "deviceId">
): UnitDeviceInfo[] {
  const rows = database
    .prepare(
      `SELECT id, name, color, is_active
       FROM devices
       WHERE unit_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`
    )
    .all(identity.unitId) as Array<{
    id: string;
    name: string;
    color: string | null;
    is_active: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: resolveDeviceColor(row.id, row.color),
    isActive: row.is_active === 1,
    isSelf: row.id === identity.deviceId
  }));
}
