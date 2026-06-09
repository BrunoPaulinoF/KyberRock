import type { ParsedToledoReading } from "./toledo-types.js";

const STX = 0x02;
const ETX = 0x03;
const CR = 0x0d;
const LF = 0x0a;

/**
 * Parse a single line of data from a Toledo 950i (TLC-G2) indicator.
 *
 * Supports two formats:
 * 1. Full: STX + 8 status chars + 9 weight chars + 2 unit chars + CR + ETX
 * 2. Simple: 8 status chars + 9 weight chars + 2 unit chars + CR (no STX/ETX)
 *
 * Example full: \x02       0000000  00001234k g\r\x03
 * Example simple:          0000000  00001234k g\r
 *
 * Status byte meanings (positional, 8 chars):
 *   0: O = out of range / overload
 *   1: M = minus (negative)
 *   2: C = center of zero
 *   3: I = in motion (unstable)
 *   4: T = tare active
 *   5: G = gross
 *   6: N = net
 *   7: spare
 */
export function parseToledoLine(buffer: Buffer): ParsedToledoReading | null {
  let data = buffer;

  // Strip STX prefix if present
  if (data.length > 0 && data[0] === STX) {
    data = data.subarray(1);
  }

  // Strip ETX suffix if present
  if (data.length > 0 && data[data.length - 1] === ETX) {
    data = data.subarray(0, data.length - 1);
  }

  // Strip trailing CR and/or LF
  while (data.length > 0 && (data[data.length - 1] === CR || data[data.length - 1] === LF)) {
    data = data.subarray(0, data.length - 1);
  }

  const line = buffer.toString("ascii").trim();

  if (!line) return null;

  // Try to parse: <status 8 chars> <weight> <unit 2 chars>
  // Minimum: 8 + 1 + 2 = 11 chars
  if (line.length < 10) return null;

  // Extract last 2 chars as unit
  const unitRaw = line.slice(-2).trim().toLowerCase();

  // Remaining before unit
  const beforeUnit = line.slice(0, -2).trimEnd();

  if (beforeUnit.length < 1) return null;

  // Split: last word is weight, everything before it is status
  const parts = beforeUnit.split(/\s+/);
  if (parts.length < 1) return null;

  const weightRaw = parts[parts.length - 1] ?? "";
  const statusPart = parts.length > 1 ? parts.slice(0, -1).join(" ") : "";

  // Parse weight
  const weightStr = weightRaw.replace(",", ".");
  const weightValue = parseFloat(weightStr);

  if (!Number.isFinite(weightValue) || weightValue < 0) {
    // Try fallback: scan the whole line for a numeric sequence
    return fallbackParse(line);
  }

  const statusFlags = parseStatusFlags(statusPart);
  const stable = !statusFlags.inMotion;

  // Convert to kg
  const weightKg = (unitRaw === "t" || unitRaw === "tn") ? weightValue * 1000 : weightValue;

  return {
    weightKg,
    unit: unitRaw === "t" || unitRaw === "tn" ? "t" : "kg",
    stable,
    statusFlags,
    raw: line
  };
}

function fallbackParse(line: string): ParsedToledoReading | null {
  // Attempt to find a numeric value in the line
  const numericMatch = line.match(/[\d,.]+/);
  if (!numericMatch) return null;

  const weightStr = numericMatch[0].replace(",", ".");
  const weightValue = parseFloat(weightStr);

  if (!Number.isFinite(weightValue) || weightValue < 0) return null;

  const weightKg = weightValue;

  return {
    weightKg,
    unit: "kg" as const,
    stable: true, // Assume stable for fallback
    statusFlags: {
      outOfRange: false,
      negative: false,
      atZero: weightValue === 0,
      inMotion: false,
      tareActive: false,
      isGross: true,
      isNet: false
    },
    raw: line
  };
}

function parseStatusFlags(statusPart: string) {
  const flags = {
    outOfRange: false,
    negative: false,
    atZero: false,
    inMotion: false,
    tareActive: false,
    isGross: true,
    isNet: false
  };

  const upper = statusPart.toUpperCase();

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
