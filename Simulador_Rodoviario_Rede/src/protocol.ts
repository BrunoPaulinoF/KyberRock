import type { SimulatorSnapshot } from "./types.js";

export const STX = "\x02";
export const ETX = "\x03";

export type TcpCommand =
  | { type: "ping" }
  | { type: "read" }
  | { type: "zero" }
  | { type: "tare"; data: Record<string, string | number> }
  | { type: "gross"; data: Record<string, string | number> }
  | { type: "newTruck" }
  | { type: "loadTruck" }
  | { type: "leaveScale" }
  | { type: "arriveTruck"; data: Record<string, string | number> }
  | { type: "exitTruck"; data: Record<string, string | number> }
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
  if (!raw) return { type: "unknown", raw };

  const spaceIdx = raw.indexOf(" ");
  const verb = (spaceIdx >= 0 ? raw.slice(0, spaceIdx) : raw).toUpperCase();
  const args = spaceIdx >= 0 ? raw.slice(spaceIdx + 1) : "";

  if (verb === "PING") return { type: "ping" };
  if (verb === "READ" || verb === "PESO" || verb === "WEIGHT") return { type: "read" };
  if (verb === "ZERO" || verb === "ZERAR") return { type: "zero" };
  if (verb === "TARE" || verb === "TARA") return { type: "tare", data: parseInlineArgs(args) };
  if (verb === "GROSS" || verb === "BRUTO") return { type: "gross", data: parseInlineArgs(args) };
  if (verb === "NEW" || verb === "TRUCK" || verb === "CAMINHAO") return { type: "newTruck" };
  if (verb === "LOAD" || verb === "CARREGAR") return { type: "loadTruck" };
  if (verb === "LEAVE" || verb === "SAIR") return { type: "leaveScale" };
  if (verb === "ARRIVE" || verb === "ENTRADA")
    return { type: "arriveTruck", data: parseInlineArgs(args) };
  if (verb === "EXIT" || verb === "SAIR_PESAGEM" || verb === "SAIDA")
    return { type: "exitTruck", data: parseInlineArgs(args) };
  if (raw.toUpperCase() === "AUTO ON") return { type: "startAuto" };
  if (raw.toUpperCase() === "AUTO OFF") return { type: "stopAuto" };

  const setMatch = raw.match(/^SET\s+(.+)$/i);
  if (setMatch) {
    return { type: "manualSet", data: parseInlineArgs(setMatch[1]) };
  }

  return { type: "unknown", raw };
}

function parseInlineArgs(input: string): Record<string, string | number> {
  const data: Record<string, string | number> = {};
  if (!input) return data;
  for (const part of input.split(/[;,]/)) {
    const [key, ...rest] = part.split("=");
    const value = rest.join("=").trim();
    if (!key || !value) continue;
    const normalizedKey = key.trim().toLowerCase();
    const numeric = Number(value.replace(",", "."));
    data[normalizedKey] = Number.isFinite(numeric) ? numeric : value.trim();
  }
  return data;
}
