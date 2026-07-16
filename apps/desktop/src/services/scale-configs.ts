import { randomUUID } from "node:crypto";

import type { DesktopDatabase } from "../database/sqlite.js";
import type { LocalDesktopIdentity } from "./bootstrap.js";

/**
 * Tipos de conexao suportados pela balanca:
 * - "tcp": indicador ligado na rede (IP + porta)
 * - "serial": indicador ligado por cabo serial (COM) ou conversor USB-serial
 * - "virtual": balanca simulada para testes/demonstracao
 */
export type ScaleAdapterType = "tcp" | "serial" | "virtual";

/** Como a porta serial esta fisicamente ligada — apenas para exibicao na UI. */
export type ScaleSerialTransport = "usb" | "com";

/**
 * Configuracao de conexao definida pelo usuario. Somente os campos necessarios
 * para conectar em cada tipo: TCP usa host+port; serial usa serialPath+baudRate.
 * Os ajustes finos (timeouts, reconexao) sao fixos em SCALE_CONNECTION_TUNING.
 */
export interface ScaleConnectionConfig {
  /** IP ou hostname do indicador (conexao TCP) */
  host: string;
  /** Porta TCP do indicador */
  port: number;
  /** Caminho da porta serial: "COM3" no Windows, "/dev/ttyUSB0" no Linux */
  serialPath: string;
  /** Velocidade da porta serial (bps). Padrao Toledo: 9600 */
  baudRate: number;
  /** Origem fisica da porta serial (USB ou COM nativa) — apenas informativo */
  serialTransport: ScaleSerialTransport;
  /** Conectar automaticamente ao abrir o aplicativo/telas de pesagem */
  autoConnect: boolean;
}

/**
 * Ajustes internos de conexao. Nao sao expostos ao usuario final: valores
 * seguros e testados valem para qualquer instalacao.
 */
export const SCALE_CONNECTION_TUNING = {
  timeoutMs: 3000,
  reconnectIntervalMs: 5000,
  maxReconnectAttempts: 10
} as const;

export interface ScaleConfiguration {
  id: string | null;
  adapterType: ScaleAdapterType;
  connection: ScaleConnectionConfig;
}

export interface ScaleConfigurationInput {
  adapterType?: ScaleAdapterType;
  connection?: Partial<ScaleConnectionConfig>;
}

export const DEFAULT_SCALE_CONNECTION_CONFIG: ScaleConnectionConfig = {
  host: "192.168.1.100",
  port: 4001,
  serialPath: "",
  baudRate: 9600,
  serialTransport: "usb",
  autoConnect: true
};

/** Velocidades de porta serial aceitas (padroes de mercado). */
export const SCALE_SERIAL_BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

interface ScaleConfigRow {
  id: string;
  adapter_type: string;
  connection_config_json: string;
}

export function readScaleConfiguration(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity
): ScaleConfiguration {
  const row = database
    .prepare(
      `SELECT id, adapter_type, connection_config_json
       FROM scale_configs
       WHERE device_id = ? AND is_active = 1
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .get(identity.deviceId) as ScaleConfigRow | undefined;

  if (!row) {
    return {
      id: null,
      adapterType: "tcp",
      connection: { ...DEFAULT_SCALE_CONNECTION_CONFIG }
    };
  }

  return {
    id: row.id,
    adapterType: normalizeAdapterType(row.adapter_type),
    connection: normalizeScaleConnectionConfig(parseJsonObject(row.connection_config_json))
  };
}

export function writeScaleConfiguration(
  database: DesktopDatabase,
  identity: LocalDesktopIdentity,
  input: ScaleConfigurationInput,
  now: Date = new Date()
): ScaleConfiguration {
  const current = readScaleConfiguration(database, identity);
  const adapterType = normalizeAdapterType(input.adapterType ?? current.adapterType);
  const next: ScaleConfiguration = {
    id: current.id ?? randomUUID(),
    adapterType,
    connection: normalizeScaleConnectionConfig({ ...current.connection, ...input.connection })
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
           'custom',
           @manufacturer,
           @model,
           @connectionConfigJson,
           '{}',
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
        manufacturer: "Toledo",
        model: adapterTypeModelLabel(next.adapterType),
        connectionConfigJson: JSON.stringify(next.connection),
        createdAt: timestamp,
        updatedAt: timestamp
      });
  });

  save();
  return readScaleConfiguration(database, identity);
}

export function normalizeScaleConnectionConfig(
  config: Partial<ScaleConnectionConfig> | Record<string, unknown> | null | undefined
): ScaleConnectionConfig {
  const raw = (config ?? {}) as Partial<ScaleConnectionConfig>;
  const host = typeof raw.host === "string" ? raw.host.trim() : "";
  const serialPath = sanitizeSerialPath(raw.serialPath);

  return {
    host: host || DEFAULT_SCALE_CONNECTION_CONFIG.host,
    port: clampInteger(raw.port, 1, 65535, DEFAULT_SCALE_CONNECTION_CONFIG.port),
    serialPath,
    baudRate: normalizeBaudRate(raw.baudRate),
    serialTransport: raw.serialTransport === "com" ? "com" : "usb",
    autoConnect: raw.autoConnect !== false
  };
}

function adapterTypeModelLabel(adapterType: ScaleAdapterType): string {
  if (adapterType === "virtual") return "Virtual";
  if (adapterType === "serial") return "Serial";
  return "TCP";
}

function sanitizeSerialPath(value: unknown): string {
  if (typeof value !== "string") return "";
  // Remove caracteres de controle e limita o tamanho para nao propagar lixo
  // para o driver serial; "COM3" e "/dev/ttyUSB0" passam intactos.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 128);
}

function normalizeBaudRate(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SCALE_CONNECTION_CONFIG.baudRate;
  const rounded = Math.round(numeric);
  if (SCALE_SERIAL_BAUD_RATES.includes(rounded)) return rounded;
  return DEFAULT_SCALE_CONNECTION_CONFIG.baudRate;
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

function normalizeAdapterType(value: string | null | undefined): ScaleAdapterType {
  if (value === "virtual") return "virtual";
  if (value === "serial") return "serial";
  return "tcp";
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}
