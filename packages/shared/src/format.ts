export function normalizePlate(plate: string): string {
  return plate.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function normalizeDocument(document: string): string {
  return document.replace(/\D/g, "").slice(0, 18);
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

function computeCheckDigit(base: string, weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += Number(base[i]) * weights[i];
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}
