/**
 * Parser das condicoes de pagamento no padrao OMIE.
 *
 * A condicao de pagamento e informada como texto e aceita seis formatos:
 *
 *  1. "10/20/30/40"  -> 4 parcelas com vencimentos fixos (10, 20, 30 e 40 dias).
 *  2. "A Vista/40/60" -> 3 parcelas: a primeira a vista (0 dias), depois 40 e 60 dias.
 *  3. "Para 93 dias"  -> 1 unica parcela para 93 dias apos o faturamento.
 *  4. "50"            -> um numero inteiro isolado = prazo em dias de uma unica
 *                       parcela (mesmo significado de "Para 50 dias").
 *  5. "50 Parcelas"   -> 50 parcelas mensais.
 *  6. "s+20"          -> periodo + dias: semana (s = 7 dias), quinzena (q = 15 dias)
 *                       e mes (m = 30 dias). "s+20" = uma semana e mais 20 dias
 *                       (27 dias), "q+20" = 35 dias, "m+20" = 50 dias. O periodo
 *                       aceita um multiplicador colado ("2s" = 2 semanas) e vale
 *                       tambem dentro da lista com barras ("s+20/m").
 *
 * Todos os formatos terminam em dias de vencimento (`installments[].dueDays`) — e
 * isso que segue para o OMIE (`lista_parcelas` do pedido / `Parcelas` da OS), entao
 * uma condicao em periodos cai exatamente nos mesmos dias que o prazo equivalente
 * digitado em dias.
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
/** Limite defensivo para o prazo (em dias) de uma parcela. */
const MAX_DUE_DAYS = 3650;

/** Dias de cada periodo aceito: semana, quinzena e mes. */
const PERIOD_UNIT_DAYS = { s: 7, q: 15, m: MONTHLY_INTERVAL_DAYS } as const;

type PeriodUnit = keyof typeof PERIOD_UNIT_DAYS;

const A_VISTA_CANONICAL = "A Vista";
const A_VISTA_PATTERN = /^(a|à)\s*vista$/i;
const PARA_DIAS_PATTERN = /^para\s+(\d+)\s*dias?$/i;
const PARCELAS_PATTERN = /^(\d+)\s*parcelas?$/i;
const INTEGER_PATTERN = /^\d+$/;
/**
 * Periodo com dias opcionais: "[quantidade] unidade [+ dias]".
 * Ex.: "s", "s+20", "S + 20 dias", "2q", "3 meses + 5".
 */
const PERIOD_PATTERN =
  /^(\d+)?\s*(semanas?|s|quinzenas?|q|m[eê]ses|m[eê]s|m)\s*(?:\+\s*(\d+)\s*(?:dias?)?)?$/i;

interface PeriodToken {
  unit: PeriodUnit;
  /** Quantidade de periodos ("2s" = 2 semanas). */
  count: number;
  /** Dias somados ao periodo ("s+20" = 20). */
  extraDays: number;
}

/** Uma parcela ja interpretada: prazo em dias + a forma canonica gravada no raw. */
interface ConditionToken {
  dueDays: number;
  canonical: string;
}

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

/** Interpreta "s+20", "2q", "mes + 5"...; retorna null quando nao e um periodo. */
function parsePeriodToken(token: string): PeriodToken | null {
  const match = token.trim().match(PERIOD_PATTERN);
  if (!match) return null;
  const count = match[1] === undefined ? 1 : Number(match[1]);
  if (count < 1) return null;
  const unit = match[2].trim().toLowerCase()[0] as PeriodUnit;
  return { unit, count, extraDays: match[3] === undefined ? 0 : Number(match[3]) };
}

function periodDueDays(period: PeriodToken): number {
  return PERIOD_UNIT_DAYS[period.unit] * period.count + period.extraDays;
}

/**
 * Forma canonica do periodo ("s", "s+20", "2m+5"). E ela que fica no `raw` da
 * condicao: o texto digitado varia em caixa e espacos, e o raw e comparado para
 * reusar uma condicao ja gravada em vez de duplicar.
 */
function formatPeriodToken(period: PeriodToken): string {
  const count = period.count > 1 ? String(period.count) : "";
  const extra = period.extraDays > 0 ? `+${period.extraDays}` : "";
  return `${count}${period.unit}${extra}`;
}

function assertDueDays(days: number, context: string): number {
  if (days > MAX_DUE_DAYS) {
    throw new PaymentConditionParseError(
      `Prazo acima do limite (${MAX_DUE_DAYS} dias) em "${context}".`
    );
  }
  return days;
}

/** Interpreta uma parcela: "A Vista", dias ("30") ou periodo ("s+20"). */
function parseConditionToken(token: string, context: string): ConditionToken {
  const trimmed = token.trim();
  if (isAVista(trimmed)) return { dueDays: 0, canonical: A_VISTA_CANONICAL };

  const period = parsePeriodToken(trimmed);
  if (period !== null) {
    return {
      dueDays: assertDueDays(periodDueDays(period), context),
      canonical: formatPeriodToken(period)
    };
  }

  if (!INTEGER_PATTERN.test(trimmed)) {
    throw new PaymentConditionParseError(
      `Parcela invalida em "${context}": "${trimmed}". ` +
        `Use dias ("30"), periodos ("s+20", "q", "2m") ou "A Vista".`
    );
  }
  const days = assertDueDays(Number(trimmed), context);
  return { dueDays: days, canonical: String(days) };
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

function buildFixedDays(raw: string, tokens: ConditionToken[]): ParsedPaymentCondition {
  const installments = tokens.map((token, index) => ({
    number: index + 1,
    dueDays: token.dueDays
  }));
  const kind: PaymentConditionKind = installments.length === 1 ? "single" : "fixed_days";
  return {
    raw,
    kind,
    installmentCount: installments.length,
    installments,
    intervalDays: null,
    summary: buildSummary(kind, installments)
  };
}

/**
 * Interpreta o texto de uma condicao de pagamento no padrao OMIE.
 * Lanca {@link PaymentConditionParseError} quando o formato e invalido.
 */
export function parsePaymentCondition(raw: string): ParsedPaymentCondition {
  let value = normalize(raw ?? "");
  if (!value) {
    throw new PaymentConditionParseError("Informe a condicao de pagamento.");
  }

  // Dias separados por espaco ("7 14 21") equivalem a lista com barras ("7/14/21").
  if (/^\d+(?: \d+)+$/.test(value)) {
    value = value.replace(/ /g, "/");
  }

  // Formato 1 e 2: lista separada por barras (dias fixos, "A Vista" e periodos).
  if (value.includes("/")) {
    const tokens = value.split("/").map((t) => t.trim());
    if (tokens.some((t) => t.length === 0)) {
      throw new PaymentConditionParseError(`Condicao invalida: "${value}". Remova barras vazias.`);
    }
    const parsed = tokens.map((token) => parseConditionToken(token, value));
    return buildFixedDays(parsed.map((token) => token.canonical).join("/"), parsed);
  }

  // "A Vista" isolado -> 1 parcela em 0 dias.
  if (isAVista(value)) {
    return buildFixedDays(A_VISTA_CANONICAL, [{ dueDays: 0, canonical: A_VISTA_CANONICAL }]);
  }

  // Formato 6: periodo isolado ("s+20", "q", "2m+5") -> uma unica parcela no dia
  // equivalente (semana = 7, quinzena = 15, mes = 30, mais os dias informados).
  const period = parsePeriodToken(value);
  if (period !== null) {
    return buildFixedDays(formatPeriodToken(period), [
      { dueDays: assertDueDays(periodDueDays(period), value), canonical: formatPeriodToken(period) }
    ]);
  }

  // Formato 3: "Para X dias" e Formato 4: "X" isolado -> uma unica parcela X dias
  // apos a venda. Um numero solto e o jeito mais curto de dizer o prazo; quando o
  // operador quer parcelar, ele escreve "X parcelas" ou a lista de prazos.
  const paraMatch = value.match(PARA_DIAS_PATTERN);
  const singleDaysText = paraMatch ? paraMatch[1] : INTEGER_PATTERN.test(value) ? value : null;
  if (singleDaysText !== null) {
    const days = assertDueDays(Number(singleDaysText), value);
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

  // Formato 5: "N Parcelas" -> N parcelas mensais.
  const parcelasMatch = value.match(PARCELAS_PATTERN);
  if (parcelasMatch !== null) {
    const count = Number(parcelasMatch[1]);
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
      `Use por exemplo "30" (30 dias), "10/20/30/40", "A Vista/40/60", "Para 93 dias", ` +
      `"3 parcelas" ou "s+20" (semana + dias; "q" quinzena, "m" mes).`
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
