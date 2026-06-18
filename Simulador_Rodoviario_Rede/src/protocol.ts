import type { SimulatorSnapshot } from "./types.js";

export const STX = "\x02";
export const ETX = "\x03";

export type TcpCommand =
  | { type: "ping" }
  | { type: "read" }
  | { type: "zero" }
  | { type: "tare" }
  | { type: "newTruck" }
  | { type: "loadTruck" }
  | { type: "leaveScale" }
  | { type: "startAuto" }
  | { type: "stopAuto" }
  | { type: "manualSet"; data: Record<string, string | number> }
  | { type: "unknown"; raw: string };

export function formatKgField(value: number, width = 8): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded)
    .toString()
    .padStart(width - sign.length, "0");
  return `${sign}${abs}`.slice(-width);
}

export function formatToledoWeightField(value: number, width = 9): string {
  return Math.round(Math.abs(value)).toString().padStart(width, "0").slice(-width);
}

export function buildToledoStatus(snapshot: SimulatorSnapshot): string {
  return [
    snapshot.overload ? "O" : " ",
    snapshot.negative ? "M" : " ",
    snapshot.zeroed ? "C" : " ",
    snapshot.motion || !snapshot.stable ? "I" : " ",
    snapshot.tareActive ? "T" : " ",
    snapshot.grossMode ? "G" : " ",
    snapshot.netMode ? "N" : " ",
    " "
  ].join("");
}

export function sanitizeFrameValue(value: string | number | boolean | null | undefined): string {
  return String(value ?? "")
    .replace(/[\x00-\x1f\x7f;]/g, "")
    .trim()
    .slice(0, 32);
}

export function buildScaleFrame(snapshot: SimulatorSnapshot): string {
  return `${buildToledoStatus(snapshot)} ${formatToledoWeightField(snapshot.weightKg)}kg\r\n`;
}

export function parseTcpCommand(rawInput: string): TcpCommand {
  const raw = rawInput.trim();
  const normalized = raw.toUpperCase();

  if (!raw) return { type: "unknown", raw };
  if (normalized === "PING") return { type: "ping" };
  if (normalized === "READ" || normalized === "PESO" || normalized === "WEIGHT")
    return { type: "read" };
  if (normalized === "ZERO" || normalized === "ZERAR") return { type: "zero" };
  if (normalized === "TARE" || normalized === "TARA") return { type: "tare" };
  if (normalized === "NEW" || normalized === "TRUCK" || normalized === "CAMINHAO")
    return { type: "newTruck" };
  if (normalized === "LOAD" || normalized === "CARREGAR") return { type: "loadTruck" };
  if (normalized === "LEAVE" || normalized === "SAIR") return { type: "leaveScale" };
  if (normalized === "AUTO ON") return { type: "startAuto" };
  if (normalized === "AUTO OFF") return { type: "stopAuto" };

  const setMatch = raw.match(/^SET\s+(.+)$/i);
  if (setMatch) {
    const data: Record<string, string | number> = {};
    for (const part of setMatch[1].split(/[;,]/)) {
      const [key, ...rest] = part.split("=");
      const value = rest.join("=").trim();
      if (!key || !value) continue;
      const normalizedKey = key.trim().toLowerCase();
      const numeric = Number(value.replace(",", "."));
      data[normalizedKey] = Number.isFinite(numeric) ? numeric : value.trim();
    }
    return { type: "manualSet", data };
  }

  return { type: "unknown", raw };
}
