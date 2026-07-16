import type { ParsedToledoReading } from "./toledo-types.js";
import type { ScaleReading, ScaleStatus } from "../scale-adapter.js";

/**
 * Converte uma leitura Toledo parseada para a leitura normalizada usada pelo
 * resto do sistema. Compartilhado entre os adaptadores TCP e serial para que
 * ambos classifiquem status (estavel/instavel/zero/sobrecarga) do mesmo jeito.
 */
export function normalizeParsedReading(
  reading: ParsedToledoReading,
  receivedAt: string,
  adapterName: string,
  deviceId?: string
): ScaleReading {
  const status = getScaleStatusFromParsedReading(reading);
  return {
    weightKg: Math.round(reading.weightKg),
    unit: "kg",
    status,
    stable: status === "stable",
    capturedAt: receivedAt,
    receivedAt,
    rawFrame: reading.raw,
    adapterName,
    deviceId
  };
}

export function getScaleStatusFromParsedReading(reading: ParsedToledoReading): ScaleStatus {
  if (!Number.isFinite(reading.weightKg)) return "error";
  if (reading.statusFlags.outOfRange || reading.weightKg === 90_000) return "overload";
  if (reading.statusFlags.negative || reading.weightKg < 0) return "negative";
  if (!reading.stable || reading.statusFlags.inMotion) return "unstable";
  if (reading.statusFlags.atZero || reading.weightKg === 0) return "zero";
  return "stable";
}
