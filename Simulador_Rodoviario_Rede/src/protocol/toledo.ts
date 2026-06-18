import type { ScaleSnapshot } from "../state/scale-state.js";

/**
 * Frame Toledo 950i / TLC-G2 - formato simples aceito pelo parser do app desktop:
 *
 *   <8 status chars><1 espaco><9 digitos kg><2 chars unidade>\r\n
 *
 * Status (8 chars, posicao fixa):
 *   0: O - out of range / sobrecarga
 *   1: M - peso negativo
 *   2: C - centro de zero
 *   3: I - em movimento / instavel
 *   4: T - tara ativa
 *   5: G - modo bruto
 *   6: N - modo liquido
 *   7: reservado (espaco)
 */
const CR = "\r";
const LF = "\n";

export function buildStatusByte(snapshot: ScaleSnapshot): string {
  return [
    snapshot.overload ? "O" : " ",
    snapshot.negative ? "M" : " ",
    snapshot.atZero ? "C" : " ",
    snapshot.motion ? "I" : " ",
    snapshot.tareActive ? "T" : " ",
    snapshot.grossMode ? "G" : " ",
    snapshot.netMode ? "N" : " ",
    " "
  ].join("");
}

export function buildWeightField(snapshot: ScaleSnapshot): string {
  return Math.round(Math.abs(snapshot.weightKg)).toString().padStart(9, "0").slice(-9);
}

export function buildToledoFrame(snapshot: ScaleSnapshot): string {
  return `${buildStatusByte(snapshot)} ${buildWeightField(snapshot)}kg${CR}${LF}`;
}

/**
 * Faz o parse de uma linha Toledo. Aceita o frame completo (com ou sem STX/ETX)
 * e devolve peso, unidade e flags. Retorna null se a linha for invalida.
 */
export interface ParsedToledoReading {
  weightKg: number;
  unit: "kg" | "t";
  stable: boolean;
  overload: boolean;
  negative: boolean;
  atZero: boolean;
  inMotion: boolean;
  tareActive: boolean;
  isGross: boolean;
  isNet: boolean;
  raw: string;
}

const STX = 0x02;
const ETX = 0x03;

export function parseToledoLine(line: string): ParsedToledoReading | null {
  let working = line;
  if (working.length > 0 && working.charCodeAt(0) === STX) {
    working = working.slice(1);
  }
  if (working.length > 0 && working.charCodeAt(working.length - 1) === ETX) {
    working = working.slice(0, -1);
  }
  while (working.length > 0) {
    const last = working.charCodeAt(working.length - 1);
    if (last === 0x0d || last === 0x0a) {
      working = working.slice(0, -1);
    } else {
      break;
    }
  }
  if (working.length < 11) return null;

  const unitRaw = working.slice(-2).trim().toLowerCase();
  const beforeUnit = working.slice(0, -2).trimEnd();
  if (beforeUnit.length < 1) return null;

  const parts = beforeUnit.split(/\s+/);
  if (parts.length < 1) return null;
  const weightRaw = parts[parts.length - 1] ?? "";
  const statusPart = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";

  const weightValue = Number.parseFloat(weightRaw.replace(",", "."));
  if (!Number.isFinite(weightValue) || weightValue < 0) return null;

  const flags = parseStatus(statusPart);
  return {
    weightKg: unitRaw === "t" ? weightValue * 1000 : weightValue,
    unit: unitRaw === "t" ? "t" : "kg",
    stable: !flags.inMotion,
    overload: flags.outOfRange,
    negative: flags.negative,
    atZero: flags.atZero,
    inMotion: flags.inMotion,
    tareActive: flags.tareActive,
    isGross: flags.isGross,
    isNet: flags.isNet,
    raw: line
  };
}

function parseStatus(statusPart: string): {
  outOfRange: boolean;
  negative: boolean;
  atZero: boolean;
  inMotion: boolean;
  tareActive: boolean;
  isGross: boolean;
  isNet: boolean;
} {
  const upper = statusPart.toUpperCase();
  const flags = {
    outOfRange: false,
    negative: false,
    atZero: false,
    inMotion: false,
    tareActive: false,
    isGross: true,
    isNet: false
  };
  for (const char of upper) {
    switch (char) {
      case "O":
        flags.outOfRange = true;
        break;
      case "M":
        flags.negative = true;
        break;
      case "C":
        flags.atZero = true;
        break;
      case "I":
        flags.inMotion = true;
        break;
      case "T":
        flags.tareActive = true;
        break;
      case "G":
        flags.isGross = true;
        break;
      case "N":
        flags.isNet = true;
        break;
    }
  }
  return flags;
}
