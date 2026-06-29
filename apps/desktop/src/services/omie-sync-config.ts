import type { DesktopDatabase } from "../database/sqlite.js";
import { readLocalSetting, writeLocalSetting } from "./local-settings.js";

export const OMIE_SYNC_MAPPING_KEY = "omie_sync_mapping";

export type OmieEntitySourceType =
  | "tag_or_characteristic"
  | "cargo_or_tag"
  | "characteristics"
  | "contacts"
  | "observations"
  | "none";

export interface OmieEntityMapping {
  source: string;
  identifier: {
    type: OmieEntitySourceType;
    values?: string[];
    fieldNames?: string[];
  };
}

export interface OmieSyncMappingConfig {
  transportadoras: OmieEntityMapping;
  motoristas: OmieEntityMapping;
  veiculos: OmieEntityMapping;
}

export const DEFAULT_OMIE_SYNC_MAPPING: OmieSyncMappingConfig = {
  transportadoras: {
    source: "clientes",
    identifier: {
      type: "tag_or_characteristic",
      values: ["TRANSPORTADORA", "Transportadora"]
    }
  },
  motoristas: {
    source: "none",
    identifier: {
      type: "none",
      values: ["MOTORISTA", "Motorista"]
    }
  },
  veiculos: {
    source: "none",
    identifier: {
      type: "none",
      fieldNames: ["PLACA", "PLACA_VEICULO", "VEICULO_PLACA"]
    }
  }
};

export function readOmieSyncMapping(database: DesktopDatabase): OmieSyncMappingConfig {
  const stored = readLocalSetting<Partial<OmieSyncMappingConfig>>(database, OMIE_SYNC_MAPPING_KEY);
  return {
    transportadoras: {
      ...DEFAULT_OMIE_SYNC_MAPPING.transportadoras,
      ...(stored?.transportadoras ?? {})
    },
    motoristas: {
      ...DEFAULT_OMIE_SYNC_MAPPING.motoristas,
      ...(stored?.motoristas ?? {})
    },
    veiculos: {
      ...DEFAULT_OMIE_SYNC_MAPPING.veiculos,
      ...(stored?.veiculos ?? {})
    }
  };
}

export function writeOmieSyncMapping(
  database: DesktopDatabase,
  config: Partial<OmieSyncMappingConfig>,
  updatedAt: string = new Date().toISOString()
): OmieSyncMappingConfig {
  const current = readOmieSyncMapping(database);
  const next: OmieSyncMappingConfig = {
    transportadoras: { ...current.transportadoras, ...(config.transportadoras ?? {}) },
    motoristas: { ...current.motoristas, ...(config.motoristas ?? {}) },
    veiculos: { ...current.veiculos, ...(config.veiculos ?? {}) }
  };
  writeLocalSetting(database, OMIE_SYNC_MAPPING_KEY, next, updatedAt);
  return next;
}

export function isOmieMappingConfigured(entity: keyof OmieSyncMappingConfig): boolean {
  const mapping = DEFAULT_OMIE_SYNC_MAPPING[entity];
  return mapping.source !== "none" && mapping.identifier.type !== "none";
}
