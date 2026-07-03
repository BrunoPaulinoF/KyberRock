/**
 * Parser das condicoes de pagamento no padrao OMIE.
 *
 * A condicao de pagamento e informada como texto e aceita cinco formatos:
 *
 *  1. "10/20/30/40"  -> 4 parcelas com vencimentos fixos (10, 20, 30 e 40 dias).
 *  2. "A Vista/40/60" -> 3 parcelas: a primeira a vista (0 dias), depois 40 e 60 dias.
 *  3. "Para 93 dias"  -> 1 unica parcela para 93 dias apos o faturamento.
 *  4. "50"            -> um numero inteiro isolado = quantidade total de parcelas mensais.
 *  5. "50 Parcelas"   -> mesma interpretacao do item 4 (parcelas mensais).
 */

export type PaymentConditionKind = "fixed_days" | "single" | "monthly_count";

export interface ParsedInstallment {
  /** Numero da parcela (1-based). */
  number: number;
  /** Dias apos o faturamento para o vencimento desta parcela. */
  dueDays: number;
}

export interface ParsedPaymentCondition {
  /** Texto original informado. */
  raw: string;
  kind: PaymentConditionKind;
  installmentCount: number;
  installments: ParsedInstallment[];
  /** Intervalo em dias entre parcelas quando aplicavel (monthly_count = 30). */
  intervalDays: number | null;
  /** Descricao legivel do parcelamento. */
  summary: string;
}

/** Numero de dias usado como "1 mes" nas parcelas mensais. */
const MONTHLY_INTERVAL_DAYS = 30;
/** Limite defensivo para a quantidade de parcelas geradas. */
const MAX_INSTALLMENTS = 360;

const A_VISTA_PATTERN = /^(a|à)\s*vista$/i;
const PARA_DIAS_PATTERN = /^para\s+(\d+)\s*dias?$/i;
const PARCELAS_PATTERN = /^(\d+)\s*parcelas?$/i;
const INTEGER_PATTERN = /^\d+$/;

export class PaymentConditionParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentConditionParseError";
  }
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function isAVista(token: string): boolean {
  return A_VISTA_PATTERN.test(token.trim());
}

function parseDaysToken(token: string, context: string): number {
  const trimmed = token.trim();
  if (isAVista(trimmed)) return 0;
  if (!INTEGER_PATTERN.test(trimmed)) {
    throw new PaymentConditionParseError(
      `Parcela invalida em "${context}": "${trimmed}". Use numeros de dias ou "A Vista".`
    );
  }
  return Number(trimmed);
}

function buildSummary(kind: PaymentConditionKind, installments: ParsedInstallment[]): string {
  const count = installments.length;
  if (count === 1) {
    const days = installments[0].dueDays;
    return days === 0 ? "A vista" : `1 parcela em ${days} dias`;
  }
  if (kind === "monthly_count") {
    return `${count} parcelas mensais`;
  }
  const days = installments.map((i) => (i.dueDays === 0 ? "a vista" : `${i.dueDays}`)).join("/");
  return `${count} parcelas (${days} dias)`;
}

/**
 * Interpreta o texto de uma condicao de pagamento no padrao OMIE.
 * Lanca {@link PaymentConditionParseError} quando o formato e invalido.
 */
export function parsePaymentCondition(raw: string): ParsedPaymentCondition {
  const value = normalize(raw ?? "");
  if (!value) {
    throw new PaymentConditionParseError("Informe a condicao de pagamento.");
  }

  // Formato 1 e 2: lista separada por barras (dias fixos, com "A Vista" opcional).
  if (value.includes("/")) {
    const tokens = value.split("/").map((t) => t.trim());
    if (tokens.some((t) => t.length === 0)) {
      throw new PaymentConditionParseError(
        `Condicao invalida: "${value}". Remova barras vazias.`
      );
    }
    const installments = tokens.map((token, index) => ({
      number: index + 1,
      dueDays: parseDaysToken(token, value)
    }));
    return {
      raw: value,
      kind: "fixed_days",
      installmentCount: installments.length,
      installments,
      intervalDays: null,
      summary: buildSummary("fixed_days", installments)
    };
  }

  // "A Vista" isolado -> 1 parcela em 0 dias.
  if (isAVista(value)) {
    const installments = [{ number: 1, dueDays: 0 }];
    return {
      raw: value,
      kind: "single",
      installmentCount: 1,
      installments,
      intervalDays: null,
      summary: buildSummary("single", installments)
    };
  }

  // Formato 3: "Para X dias" -> uma unica parcela.
  const paraMatch = value.match(PARA_DIAS_PATTERN);
  if (paraMatch) {
    const days = Number(paraMatch[1]);
    const installments = [{ number: 1, dueDays: days }];
    return {
      raw: value,
      kind: "single",
      installmentCount: 1,
      installments,
      intervalDays: null,
      summary: buildSummary("single", installments)
    };
  }

  // Formato 5: "N Parcelas" e Formato 4: "N" isolado -> N parcelas mensais.
  const parcelasMatch = value.match(PARCELAS_PATTERN);
  const countText = parcelasMatch ? parcelasMatch[1] : INTEGER_PATTERN.test(value) ? value : null;
  if (countText !== null) {
    const count = Number(countText);
    if (count < 1) {
      throw new PaymentConditionParseError(`Quantidade de parcelas invalida: "${value}".`);
    }
    if (count > MAX_INSTALLMENTS) {
      throw new PaymentConditionParseError(
        `Quantidade de parcelas acima do limite (${MAX_INSTALLMENTS}): "${value}".`
      );
    }
    const installments = Array.from({ length: count }, (_, index) => ({
      number: index + 1,
      dueDays: MONTHLY_INTERVAL_DAYS * (index + 1)
    }));
    return {
      raw: value,
      kind: "monthly_count",
      installmentCount: count,
      installments,
      intervalDays: MONTHLY_INTERVAL_DAYS,
      summary: buildSummary("monthly_count", installments)
    };
  }

  throw new PaymentConditionParseError(
    `Formato de condicao nao reconhecido: "${value}". ` +
      `Use por exemplo "10/20/30/40", "A Vista/40/60", "Para 93 dias" ou "50".`
  );
}

/** Retorna o resultado do parse ou null quando o texto e invalido. */
export function tryParsePaymentCondition(raw: string): ParsedPaymentCondition | null {
  try {
    return parsePaymentCondition(raw);
  } catch {
    return null;
  }
}
