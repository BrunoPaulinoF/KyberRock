/**
 * Formatacao e regras de documento — espelho de `packages/shared/src/format.ts` do
 * repositorio principal. A regra que nao pode se perder: o CNPJ alfanumerico tem LETRA nas
 * 12 primeiras posicoes; nunca normalizar com `replace(/\D/g, "")`.
 */

export const CNPJ_LENGTH = 14;
const CPF_SHAPE = /^\d{11}$/;
const CNPJ_SHAPE = /^[0-9A-Z]{12}\d{2}$/;
const CNPJ_DV1_WEIGHTS = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_DV2_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeDocument(document: string): string {
  return document
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase()
    .slice(0, CNPJ_LENGTH);
}

export function documentKind(document: string): "cpf" | "cnpj" | null {
  const value = normalizeDocument(document);
  if (CPF_SHAPE.test(value)) return "cpf";
  if (CNPJ_SHAPE.test(value)) return "cnpj";
  return null;
}

function computeCheckDigit(base: string, weights: number[]): number {
  // Cada caractere vale `ASCII - 48`: digito vale o proprio numero, letra vale 17..42.
  const sum = base
    .split("")
    .reduce((total, char, index) => total + (char.charCodeAt(0) - 48) * weights[index], 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidCpf(document: string): boolean {
  const digits = normalizeDocument(document);
  if (!CPF_SHAPE.test(digits)) return false;
  if (/^(\d)\1+$/.test(digits)) return false;
  const dv1 = computeCheckDigit(digits.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = computeCheckDigit(digits.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return digits.slice(9) === `${dv1}${dv2}`;
}

export function isValidCnpj(document: string): boolean {
  const value = normalizeDocument(document);
  if (!CNPJ_SHAPE.test(value)) return false;
  if (/^(.)\1+$/.test(value)) return false;
  const dv1 = computeCheckDigit(value.slice(0, 12), CNPJ_DV1_WEIGHTS);
  const dv2 = computeCheckDigit(value.slice(0, 13), CNPJ_DV2_WEIGHTS);
  return value.slice(12) === `${dv1}${dv2}`;
}

export function isValidDocument(document: string): boolean {
  const kind = documentKind(document);
  if (kind === "cpf") return isValidCpf(document);
  if (kind === "cnpj") return isValidCnpj(document);
  return false;
}

export function formatDocument(document: string | null | undefined): string {
  if (!document) return "";
  const value = normalizeDocument(document);
  if (CPF_SHAPE.test(value)) {
    return `${value.slice(0, 3)}.${value.slice(3, 6)}.${value.slice(6, 9)}-${value.slice(9)}`;
  }
  if (value.length === CNPJ_LENGTH) {
    return `${value.slice(0, 2)}.${value.slice(2, 5)}.${value.slice(5, 8)}/${value.slice(8, 12)}-${value.slice(12)}`;
  }
  return value;
}

export function formatPlate(plate: string | null | undefined): string {
  if (!plate) return "";
  const normalized = plate.toUpperCase().replace(/[\s-]+/g, "");
  if (/^[A-Z]{3}[0-9]{4}$/.test(normalized))
    return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
  return normalized;
}

export function formatMoney(cents: number | null | undefined): string {
  return ((cents ?? 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "1.234,56" -> 123456 (centavos). `null` quando nao e um valor. */
export function parseMoneyToCents(value: string): number | null {
  const text = value.trim().replace(/\s|R\$/g, "");
  if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

export function formatTons(kg: number | null | undefined): string {
  return `${((kg ?? 0) / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3
  })} t`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Data local (AAAA-MM-DD) de hoje, no fuso da pedreira. */
export function todayIso(now: Date = new Date()): string {
  return now.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

/**
 * Dia local (AAAA-MM-DD) de um instante ISO, no fuso da pedreira. `iso.slice(0, 10)` daria o
 * dia em UTC: a pesagem fechada as 21h30 de Brasilia cairia no dia seguinte.
 */
export function localDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  return todayIso(date);
}

/** Primeiro dia do mes de uma data AAAA-MM-DD. */
export function firstDayOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

/**
 * Intervalo `[inicio, fim)` em ISO para filtrar `closed_at` a partir de datas locais
 * (Brasilia, UTC-3 — o mesmo offset fixo dos relatorios da nuvem).
 */
export function periodToIso(
  startDay: string,
  endDay: string
): { startIso: string; endIso: string } {
  const end = new Date(`${endDay}T00:00:00-03:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    startIso: new Date(`${startDay}T00:00:00-03:00`).toISOString(),
    endIso: end.toISOString()
  };
}
