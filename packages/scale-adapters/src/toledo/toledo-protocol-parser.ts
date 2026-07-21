import type { ParsedToledoReading, ToledoStatusFlags } from "./toledo-types.js";

const STX = 0x02;
const ETX = 0x03;
const CR = 0x0d;
const LF = 0x0a;

/**
 * Peso maximo plausivel (kg) para qualquer balanca rodoviaria. Leituras acima
 * disso sao sempre frames mal interpretados (ex.: peso e tara colados em um
 * numero so) e NUNCA podem chegar ao operador — melhor nenhuma leitura do que
 * uma leitura absurda.
 */
const MAX_PLAUSIBLE_WEIGHT_KG = 500_000;

const LB_TO_KG = 0.45359237;

/**
 * Posicao do ponto decimal codificada nos bits 0-2 do SWA (Status Word A) do
 * protocolo continuo Toledo/Mettler: 0=x100, 1=x10, 2=x1, 3=/10, 4=/100,
 * 5=/1000, 6=/10000, 7=/100000.
 */
const SWA_DECIMAL_MULTIPLIERS = [100, 10, 1, 0.1, 0.01, 0.001, 0.0001, 0.00001] as const;

/**
 * Parse a single line of data from a Toledo indicator (950i / TLC-G2 and
 * compatible). Tries, in order:
 *
 * 1. **Continuous protocol** (Toledo/Mettler standard, used by the 950i in
 *    continuous mode): STX + SWA + SWB + SWC + 6-digit displayed weight +
 *    6-digit tare + CR (+ optional checksum). Weight and tare have NO decimal
 *    point — the decimal position comes from SWA, and status (motion, sign,
 *    overload, gross/net, kg/lb) comes from SWB.
 * 2. **Demand/printer format**: `<status words> <weight><unit>` such as
 *    `0000000  00012340k g` or `       000015200kg`.
 * 3. A conservative numeric fallback for other simple formats.
 *
 * Any reading above MAX_PLAUSIBLE_WEIGHT_KG is rejected (returns null): a
 * mis-framed line must never surface as a weight.
 */
export function parseToledoLine(buffer: Buffer): ParsedToledoReading | null {
  let data = buffer;

  // Mantem apenas o conteudo apos o ultimo STX. Isso descarta lixo herdado do
  // frame anterior (ex.: byte de checksum enviado apos o CR, que o split de
  // linhas deixa grudado no inicio da proxima linha).
  const stxIndex = data.lastIndexOf(STX);
  if (stxIndex >= 0) {
    data = data.subarray(stxIndex + 1);
  }

  // Strip trailing ETX / CR / LF em qualquer ordem
  while (data.length > 0) {
    const last = data[data.length - 1];
    if (last === ETX || last === CR || last === LF) {
      data = data.subarray(0, data.length - 1);
    } else {
      break;
    }
  }

  if (data.length === 0) return null;

  const continuous = parseContinuousFrame(data);
  if (continuous) return continuous;

  return parseTextLine(data.toString("latin1").trim());
}

/**
 * Frame continuo Toledo/Mettler: SWA SWB SWC + 6 digitos de peso exibido +
 * 6 digitos de tara (15 bytes apos remover STX/CR; 16 quando o checksum vem
 * antes do CR). Assinatura: bit 5 ligado nos tres bytes de status e os 12
 * bytes de peso/tara sao todos digitos ASCII.
 */
function parseContinuousFrame(data: Buffer): ParsedToledoReading | null {
  if (data.length < 15 || data.length > 16) return null;

  // Mascara o bit de paridade (portas seriais 7E1/7O1 podem ligar o bit 7)
  const swa = (data[0] ?? 0) & 0x7f;
  const swb = (data[1] ?? 0) & 0x7f;
  const swc = (data[2] ?? 0) & 0x7f;

  // Bit 5 e "sempre 1" nos tres status words — assinatura do protocolo
  if ((swa & 0x20) === 0 || (swb & 0x20) === 0 || (swc & 0x20) === 0) return null;

  let weightDigits = 0;
  let tareDigits = 0;
  for (let i = 3; i < 15; i++) {
    const ch = (data[i] ?? 0) & 0x7f;
    if (ch < 0x30 || ch > 0x39) return null; // peso e tara sao sempre digitos
    const digit = ch - 0x30;
    if (i < 9) {
      weightDigits = weightDigits * 10 + digit;
    } else {
      tareDigits = tareDigits * 10 + digit;
    }
  }

  const multiplier = SWA_DECIMAL_MULTIPLIERS[swa & 0x07] ?? 1;
  const isNet = (swb & 0x01) !== 0;
  const negative = (swb & 0x02) !== 0;
  const outOfRange = (swb & 0x04) !== 0;
  const inMotion = (swb & 0x08) !== 0;
  const isKg = (swb & 0x10) !== 0;

  let weightKg = weightDigits * multiplier;
  if (!isKg) weightKg *= LB_TO_KG; // indicador configurado em libras
  if (negative) weightKg = -weightKg;

  // Frame de sobrecarga legitimo pode exceder o teto — vira status overload;
  // fora isso, valor implausivel e frame mal interpretado e deve ser descartado
  if (!outOfRange && Math.abs(weightKg) > MAX_PLAUSIBLE_WEIGHT_KG) return null;

  const statusFlags: ToledoStatusFlags = {
    outOfRange,
    negative,
    atZero: weightKg === 0,
    inMotion,
    tareActive: tareDigits > 0,
    isGross: !isNet,
    isNet
  };

  return {
    weightKg,
    unit: isKg ? "kg" : "lb",
    stable: !inMotion,
    statusFlags,
    raw: data.toString("latin1")
  };
}

/**
 * Formatos de texto/impressao: `<status> <peso><unidade>`, por exemplo
 * `0000000  00012340k g` ou `       000015200kg`.
 */
function parseTextLine(line: string): ParsedToledoReading | null {
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

  if (!Number.isFinite(weightValue)) {
    // Try fallback: scan the whole line for a numeric sequence
    return fallbackParse(line);
  }

  const statusFlags = parseStatusFlags(statusPart);
  if (weightValue < 0) statusFlags.negative = true;
  const stable = !statusFlags.inMotion;

  // Convert to kg
  const weightKg = unitRaw === "t" || unitRaw === "tn" ? weightValue * 1000 : weightValue;

  // Numero implausivel = frame mal interpretado; nunca entregar ao operador
  // (sobrecarga sinalizada pela balanca passa e vira status overload)
  if (!statusFlags.outOfRange && Math.abs(weightKg) > MAX_PLAUSIBLE_WEIGHT_KG) return null;

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

  // Sequencias numericas longas demais sao peso+tara colados ou lixo de
  // protocolo — jamais um peso real
  if (weightValue > MAX_PLAUSIBLE_WEIGHT_KG) return null;

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

function parseStatusFlags(statusPart: string): ToledoStatusFlags {
  const flags: ToledoStatusFlags = {
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
