export function normalizePlate(plate: string): string {
  return plate.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function normalizeDocument(document: string): string {
  return document.replace(/\D/g, "").slice(0, 14);
}

export function isValidPlate(plate: string): boolean {
  const normalized = normalizePlate(plate);
  if (normalized.length !== 7) return false;
  return /^[A-Z0-9]+$/.test(normalized);
}

export function isValidCpf(document: string): boolean {
  const digits = normalizeDocument(document);
  if (digits.length !== 11) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  const dv1 = computeCheckDigit(digits.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = computeCheckDigit(digits.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits.slice(9) === `${dv1}${dv2}`;
}

export function isValidCnpj(document: string): boolean {
  const digits = normalizeDocument(document);
  if (digits.length !== 14) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  const dv1 = computeCheckDigit(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = computeCheckDigit(digits.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits.slice(12) === `${dv1}${dv2}`;
}

export function isValidDocument(document: string): boolean {
  const digits = normalizeDocument(document);
  if (digits.length === 11) return isValidCpf(document);
  if (digits.length === 14) return isValidCnpj(document);
  return false;
}

export function formatPlate(plate: string): string {
  const normalized = normalizePlate(plate);
  if (normalized.length === 7 && /^[A-Z]{3}[0-9]{4}$/.test(normalized)) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
  }
  if (normalized.length === 7 && /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(normalized)) {
    return `${normalized.slice(0, 3)}${normalized.slice(3, 4)}${normalized.slice(4, 5)}${normalized.slice(5)}`;
  }
  return normalized;
}

export function formatDocument(document: string): string {
  const digits = normalizeDocument(document);
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  return digits;
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(0, 11);
}

export function formatPhone(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function normalizeCep(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

export function formatCep(value: string): string {
  const digits = normalizeCep(value);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function isValidCep(value: string): boolean {
  return normalizeCep(value).length === 8;
}

export function normalizeMoneyInput(value: string): string {
  if (!value) return "";
  const negative = value.trim().startsWith("-");
  const cleaned = value.replace(/[^\d,.-]/g, "");
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let result: string;
  if (hasComma && hasDot) {
    result = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    result = cleaned.replace(",", ".");
  } else if (hasDot) {
    const [, fractional = ""] = cleaned.split(".");
    if (fractional.length === 0 || fractional.length === 3) {
      result = cleaned.replace(/\./g, "");
    } else {
      result = cleaned;
    }
  } else {
    result = cleaned;
  }
  if (result.startsWith(".")) result = `0${result}`;
  if (result.startsWith("-.")) result = result.replace("-.", "-0.");
  const parts = result.replace(/^-/, "").split(".");
  if (parts.length > 2) {
    result = `${parts[0]}.${parts.slice(1).join("")}`;
    if (negative) result = `-${result}`;
  }
  return result;
}

export function formatMoneyInput(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const raw = typeof value === "number" ? String(value) : value;
  const negative = raw.trim().startsWith("-");
  const digitsOnly = raw.replace(/[^\d,.]/g, "");
  const normalized = normalizeMoneyInput(digitsOnly);
  if (!normalized || normalized === "-") return negative ? "-" : "";
  const abs = normalized.replace(/^-/, "");
  const [intPart = "0", decPart = ""] = abs.split(".");
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const formatted = decPart
    ? `${intFormatted},${decPart.slice(0, 2).padEnd(2, "0")}`
    : intFormatted;
  return negative ? `-${formatted}` : formatted;
}

export function parseMoneyInputToCents(value: string): number | null {
  if (!value || !value.trim()) return null;
  const normalized = normalizeMoneyInput(value);
  if (!normalized || normalized === "-") return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function isValidMoneyInput(value: string): boolean {
  if (!value.trim()) return true;
  return parseMoneyInputToCents(value) !== null;
}

export function normalizeIntInput(value: string): string {
  return value.replace(/\D/g, "");
}

function computeCheckDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += Number(base[i]) * weights[i];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}
