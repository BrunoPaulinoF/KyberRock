import { randomUUID } from "node:crypto";

import type { ToledoTcpConfig } from "@kyberrock/scale-adapters";

import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";

export interface ScaleConnectionConfig extends ToledoTcpConfig {
  timeoutMs: number;
  reconnectIntervalMs: number;
  maxReconnectAttempts: number;
  autoConnect: boolean;
}

export interface ScaleStabilityConfig {
  sampleDurationMs: number;
  sampleIntervalMs: number;
  requireStable: boolean;
  minStableMs: number;
  maxVariationKg: number;
  minWeightKg: number;
}

export interface ScaleConfiguration {
  id: string | null;
  adapterType: "tcp" | "virtual";
  captureMode: "custom" | "default";
  manufacturer: string;
  model: string;
  connection: ScaleConnectionConfig;
  stability: ScaleStabilityConfig;
}

export interface ScaleConfigurationInput {
  adapterType?: "tcp" | "virtual";
  captureMode?: "custom" | "default";
  connection?: Partial<ScaleConnectionConfig>;
  stability?: Partial<ScaleStabilityConfig>;
}

export const DEFAULT_SCALE_CONNECTION_CONFIG: ScaleConnectionConfig = {
  host: "192.168.1.100",
  port: 4001,
  timeoutMs: 3000,
  reconnectIntervalMs: 5000,
  maxReconnectAttempts: 10,
  autoConnect: false
};

export const DEFAULT_SCALE_STABILITY_CONFIG: ScaleStabilityConfig = {
  sampleDurationMs: 5000,
  sampleIntervalMs: 250,
  requireStable: true,
  minStableMs: 1000,
  maxVariationKg: 50,
  minWeightKg: 1000
};

interface ScaleConfigRow {
  id: string;
  adapter_type: string;
  capture_mode: string;
  manufacturer: string | null;
  model: string | null;
  connection_config_json: string;
  stability_config_json: string;
}

export function readScaleConfiguration(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): ScaleConfiguration {
  const row = database
    .prepare(
      `SELECT id, adapter_type, capture_mode, manufacturer, model, connection_config_json, stability_config_json
       FROM scale_configs
       WHERE device_id = ? AND is_active = 1
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(identity.deviceId) as ScaleConfigRow | undefined;

  if (!row) {
    return createDefaultScaleConfiguration(null);
  }

  return {
    id: row.id,
    adapterType: normalizeAdapterType(row.adapter_type),
    captureMode: normalizeCaptureMode(row.capture_mode),
    manufacturer: row.manufacturer?.trim() || "Toledo",
    model: row.model?.trim() || (row.adapter_type === "virtual" ? "Virtual" : "TCP"),
    connection: normalizeScaleConnectionConfig(parseJsonObject(row.connection_config_json)),
    stability: normalizeScaleStabilityConfig(parseJsonObject(row.stability_config_json))
  };
}

export function writeScaleConfiguration(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  input: ScaleConfigurationInput,
  now: Date = new Date()
): ScaleConfiguration {
  const current = readScaleConfiguration(database, identity);
  const next: ScaleConfiguration = {
    id: current.id ?? randomUUID(),
    adapterType: normalizeAdapterType(input.adapterType ?? current.adapterType),
    captureMode: normalizeCaptureMode(input.captureMode ?? current.captureMode),
    manufacturer: "Toledo",
    model: input.adapterType === "virtual" || current.adapterType === "virtual" ? "Virtual" : "TCP",
    connection: normalizeScaleConnectionConfig({ ...current.connection, ...input.connection }),
    stability: normalizeScaleStabilityConfig({ ...current.stability, ...input.stability })
  };
  const timestamp = now.toISOString();

  const save = database.transaction(() => {
    database
      .prepare(
        `UPDATE scale_configs
         SET is_active = 0, updated_at = ?
         WHERE device_id = ? AND id <> ?`
      )
      .run(timestamp, identity.deviceId, next.id);

    database
      .prepare(
        `INSERT INTO scale_configs (
           id,
           device_id,
           adapter_type,
           capture_mode,
           manufacturer,
           model,
           connection_config_json,
           stability_config_json,
           unit,
           kg_factor,
           is_active,
           created_at,
           updated_at
         ) VALUES (
           @id,
           @deviceId,
           @adapterType,
           @captureMode,
           @manufacturer,
           @model,
           @connectionConfigJson,
           @stabilityConfigJson,
           'kg',
           1,
           1,
           @createdAt,
           @updatedAt
         )
         ON CONFLICT(id) DO UPDATE SET
           adapter_type = excluded.adapter_type,
           capture_mode = excluded.capture_mode,
           manufacturer = excluded.manufacturer,
           model = excluded.model,
           connection_config_json = excluded.connection_config_json,
           stability_config_json = excluded.stability_config_json,
           unit = excluded.unit,
           kg_factor = excluded.kg_factor,
           is_active = 1,
           updated_at = excluded.updated_at`
      )
      .run({
        id: next.id,
        deviceId: identity.deviceId,
        adapterType: next.adapterType,
        captureMode: next.captureMode,
        manufacturer: next.manufacturer,
        model: next.model,
        connectionConfigJson: JSON.stringify(next.connection),
        stabilityConfigJson: JSON.stringify(next.stability),
        createdAt: timestamp,
        updatedAt: timestamp
      });
  });

  save();
  return readScaleConfiguration(database, identity);
}

export function normalizeScaleConnectionConfig(
  config: Partial<ScaleConnectionConfig> | null | undefined
): ScaleConnectionConfig {
  const host = typeof config?.host === "string" ? config.host.trim() : "";

  return {
    host: host || DEFAULT_SCALE_CONNECTION_CONFIG.host,
    port: clampInteger(config?.port, 1, 65535, DEFAULT_SCALE_CONNECTION_CONFIG.port),
    timeoutMs: clampInteger(config?.timeoutMs, 500, 30000, DEFAULT_SCALE_CONNECTION_CONFIG.timeoutMs),
    reconnectIntervalMs: clampInteger(
      config?.reconnectIntervalMs,
      1000,
      60000,
      DEFAULT_SCALE_CONNECTION_CONFIG.reconnectIntervalMs
    ),
    maxReconnectAttempts: clampInteger(
      config?.maxReconnectAttempts,
      0,
      100,
      DEFAULT_SCALE_CONNECTION_CONFIG.maxReconnectAttempts
    ),
    autoConnect: config?.autoConnect === true
  };
}

export function normalizeScaleStabilityConfig(
  config: Partial<ScaleStabilityConfig> | null | undefined
): ScaleStabilityConfig {
  const sampleDurationMs = clampInteger(
    config?.sampleDurationMs,
    500,
    30000,
    DEFAULT_SCALE_STABILITY_CONFIG.sampleDurationMs
  );
  const minStableMs = Math.min(
    clampInteger(config?.minStableMs, 0, 30000, DEFAULT_SCALE_STABILITY_CONFIG.minStableMs),
    sampleDurationMs
  );

  return {
    sampleDurationMs,
    sampleIntervalMs: clampInteger(
      config?.sampleIntervalMs,
      50,
      5000,
      DEFAULT_SCALE_STABILITY_CONFIG.sampleIntervalMs
    ),
    requireStable: config?.requireStable !== false,
    minStableMs,
    maxVariationKg: clampInteger(
      config?.maxVariationKg,
      0,
      10000,
      DEFAULT_SCALE_STABILITY_CONFIG.maxVariationKg
    ),
    minWeightKg: clampInteger(
      config?.minWeightKg,
      0,
      200000,
      DEFAULT_SCALE_STABILITY_CONFIG.minWeightKg
    )
  };
}

function createDefaultScaleConfiguration(id: string | null): ScaleConfiguration {
  return {
    id,
    adapterType: "tcp",
    captureMode: "custom",
    manufacturer: "Toledo",
    model: "TCP",
    connection: { ...DEFAULT_SCALE_CONNECTION_CONFIG },
    stability: { ...DEFAULT_SCALE_STABILITY_CONFIG }
  };
}

function normalizeCaptureMode(value: string | null | undefined): "custom" | "default" {
  if (value === "default") return "default";
  return "custom";
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeAdapterType(value: string | null | undefined): "tcp" | "virtual" {
  if (value === "virtual") return "virtual";
  return "tcp";
}

function clampInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}
