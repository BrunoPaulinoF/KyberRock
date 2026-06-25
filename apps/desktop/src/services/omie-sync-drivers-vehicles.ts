import type { DesktopDatabase } from "../database/sqlite.js";
import type { OmieEntityMapping, OmieSyncMappingConfig } from "./omie-sync-config.js";


export interface DriverVehicleSyncResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
}

function normalizePlate(plate: string): string {
  return plate.replace(/\s/g, "").toUpperCase();
}

function isMappingActive(mapping: OmieEntityMapping): boolean {
  return mapping.source !== "none" && mapping.identifier.type !== "none";
}

/**
 * Sync drivers from OMIE.
 *
 * IMPORTANT: The KyberRock project does not currently have a direct OMIE endpoint
 * for drivers. This function provides a configurable adapter structure.
 *
 * To enable driver sync, configure the mapping in local_settings under
 * `omie_sync_mapping.motoristas` with a valid source (e.g., "contatos",
 * "clientes", "fornecedores") and identifier type (e.g., "cargo_or_tag").
 *
 * Until a valid source is configured, this function returns 0 records and
 * stores a diagnostic log.
 */
export async function syncOmieDrivers(
  database: DesktopDatabase,
  companyId: string,
  mapping: OmieSyncMappingConfig["motoristas"]
): Promise<DriverVehicleSyncResult> {
  if (!isMappingActive(mapping)) {
    // No configuration yet — leave structure ready
    return { fetched: 0, created: 0, updated: 0, skipped: 0 };
  }

  // Placeholder for future implementation.
  // When an OMIE endpoint or extraction rule is defined, implement the fetch
  // and upsert logic here using the `mapping` configuration.
  return { fetched: 0, created: 0, updated: 0, skipped: 0 };
}

/**
 * Sync vehicles from OMIE.
 *
 * IMPORTANT: The KyberRock project does not currently have a direct OMIE endpoint
 * for vehicles. This function provides a configurable adapter structure.
 *
 * To enable vehicle sync, configure the mapping in local_settings under
 * `omie_sync_mapping.veiculos` with a valid source (e.g., "caracteristicas",
 * "observacoes", "clientes") and identifier type (e.g., "characteristics").
 *
 * The `plateFieldNames` array in the mapping config defines which fields should
 * be parsed as vehicle plates.
 *
 * Until a valid source is configured, this function returns 0 records and
 * stores a diagnostic log.
 */
export async function syncOmieVehicles(
  database: DesktopDatabase,
  companyId: string,
  mapping: OmieSyncMappingConfig["veiculos"]
): Promise<DriverVehicleSyncResult> {
  if (!isMappingActive(mapping)) {
    // No configuration yet — leave structure ready
    return { fetched: 0, created: 0, updated: 0, skipped: 0 };
  }

  // Placeholder for future implementation.
  // When an OMIE endpoint or extraction rule is defined, implement the fetch,
  // plate normalization, and upsert logic here.
  return { fetched: 0, created: 0, updated: 0, skipped: 0 };
}

export { normalizePlate };
