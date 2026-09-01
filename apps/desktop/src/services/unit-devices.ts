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
  device_number?: unknown;
  is_active?: unknown;
}

export interface UnitDeviceInfo {
  id: string;
  name: string;
  color: string;
  /** Numero do computador na pedreira, sufixo do cupom que ele emite. */
  deviceNumber: number | null;
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
    INSERT INTO devices (id, company_id, unit_id, name, device_type, installation_id, color, device_number, is_active, created_at, updated_at)
    VALUES (@id, @companyId, @unitId, @name, 'desktop_scale', @installationId, @color, @deviceNumber, @isActive, @timestamp, @timestamp)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      color = COALESCE(excluded.color, devices.color),
      device_number = COALESCE(excluded.device_number, devices.device_number),
      is_active = excluded.is_active,
      -- A nuvem listou o computador: se ele estava fora da legenda por uma
      -- remocao anterior (ver pruneMissingUnitDevices), volta. Sem isto, uma
      -- lista incompleta que escapasse das travas do prune deixaria uma
      -- balanca de verdade escondida para sempre.
      deleted_at = NULL,
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
      const deviceNumber =
        typeof device.device_number === "number" && device.device_number > 0
          ? device.device_number
          : null;
      upsert.run({
        id,
        companyId: identity.companyId,
        unitId: identity.unitId,
        name,
        installationId: `remote-${id}`,
        color,
        deviceNumber,
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
      `SELECT id, name, color, device_number, is_active
       FROM devices
       WHERE unit_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`
    )
    .all(identity.unitId) as Array<{
    id: string;
    name: string;
    color: string | null;
    device_number: number | null;
    is_active: number;
  }>;

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: resolveDeviceColor(row.id, row.color),
    deviceNumber: row.device_number,
    isActive: row.is_active === 1,
    isSelf: row.id === identity.deviceId
  }));
}

/**
 * Tira da legenda os computadores que a nuvem NAO lista mais.
 *
 * O espelho so sabia somar. Balanca de teste, maquina trocada e ativacao
 * duplicada — tudo o que o painel apaga (`delete_device`) — continuava na
 * legenda de cada desktop para sempre, porque o pull nunca dizia "esta sumiu".
 * A tela do operador acumulava computador que nao existe (varios deles com o
 * nome generico da ativacao), e nao havia como limpar sem mexer no SQLite.
 *
 * A remocao e LOGICA (`deleted_at`), nunca um DELETE: a FK
 * `weighing_operations.device_id` continua valendo e o detalhe da operacao
 * antiga segue mostrando em que computador ela foi feita — quem filtra
 * `deleted_at` e so a legenda (`listUnitDevices`).
 *
 * Duas travas contra apagar a frota inteira por causa de uma resposta ruim:
 * a lista precisa vir com ESTA maquina dentro (o `desktop-status` e o
 * `desktop-pull` autenticam este dispositivo na unidade, entao a lista da
 * unidade sempre o contem — sem ele, o que chegou nao e a lista da unidade), e
 * o chamador so passa por aqui quando a nuvem entregou a lista inteira.
 */
export function pruneMissingUnitDevices(
  database: DesktopDatabase,
  identity: Pick<LocalDesktopIdentity, "unitId" | "deviceId">,
  devices: CloudUnitDevice[]
): number {
  const cloudIds = new Set<string>();
  for (const device of devices) {
    const id = typeof device.id === "string" ? device.id.trim() : "";
    if (id) cloudIds.add(id);
  }
  if (!cloudIds.has(identity.deviceId)) return 0;

  const timestamp = new Date().toISOString();
  const placeholders = Array.from(cloudIds, () => "?").join(", ");
  const result = database
    .prepare(
      `UPDATE devices
          SET deleted_at = ?, updated_at = ?
        WHERE unit_id = ?
          AND deleted_at IS NULL
          AND id NOT IN (${placeholders})`
    )
    .run(timestamp, timestamp, identity.unitId, ...cloudIds);

  return result.changes;
}
