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
 *  6. "q+15"          -> "fora periodo" + dias: o prazo conta do FIM do periodo em que
 *                       a venda caiu, e nao da venda. Semana (s, termina no domingo),
 *                       dezena (d: 1-10, 11-20, 21-fim do mes), quinzena (q: 1-15,
 *                       16-fim do mes) e mes (m). "q+15": venda de 01 a 15 vence dia 30
 *                       (15 + 15), venda de 16 a 31 vence dia 15 do mes seguinte;
 *                       "m+10" vence dia 10 do mes seguinte, qualquer que seja o dia da
 *                       venda. O periodo aceita um multiplicador colado ("2q" = o fim da
 *                       quinzena SEGUINTE a da venda) e vale tambem dentro da lista com
 *                       barras ("s+20/m").
 *
 * Por que do fim do periodo: e assim que a pedreira combina com o cliente — "compra na
 * quinzena, paga 15 dias depois do fechamento dela". Antes o periodo era so um apelido
 * de dias ("q+15" = 15 + 15 = 30 dias apos a VENDA), e a carga do dia 10 vencia dia 09
 * do mes seguinte em vez de dia 30.
 *
 * Por isso o prazo de uma parcela em periodo depende da data da venda: `dueDays` guarda
 * so o prazo NOMINAL (quantos dias o periodo "vale" — o mesmo numero de antes, que e o
 * que casa uma condicao ja gravada com o texto digitado), e quem precisa do vencimento
 * de verdade passa a data da venda a {@link conditionDueDaysForSale} /
 * {@link installmentDueDaysForSale}. As parcelas em dias continuam iguais.
 */

export type PaymentConditionKind = "fixed_days" | "single" | "monthly_count";

export interface ParsedInstallment {
  /** Numero da parcela (1-based). */
  number: number;
  /**
   * Dias apos o faturamento para o vencimento desta parcela. Na parcela em periodo e o
   * prazo NOMINAL ("q+15" = 30): o vencimento real depende da data da venda — ver
   * {@link installmentDueDaysForSale}.
   */
  dueDays: number;
  /** Presente quando a parcela foi escrita em periodo ("q+15"): conta do fim do periodo. */
  period?: PaymentConditionPeriod;
}

/** Periodo de uma parcela "fora periodo": unidade, quantos periodos e os dias somados. */
export interface PaymentConditionPeriod {
  unit: PeriodUnit;
  /** Quantidade de periodos ("2q" = fim da quinzena seguinte a da venda). */
  count: number;
  /** Dias somados ao fim do periodo ("q+15" = 15). */
  extraDays: number;
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

/** Dias de cada periodo aceito: semana, dezena, quinzena e mes. */
const PERIOD_UNIT_DAYS = { s: 7, d: 10, q: 15, m: MONTHLY_INTERVAL_DAYS } as const;

export type PeriodUnit = keyof typeof PERIOD_UNIT_DAYS;

const A_VISTA_CANONICAL = "A Vista";
const A_VISTA_PATTERN = /^(a|à)\s*vista$/i;
const PARA_DIAS_PATTERN = /^para\s+(\d+)\s*dias?$/i;
const PARCELAS_PATTERN = /^(\d+)\s*parcelas?$/i;
const INTEGER_PATTERN = /^\d+$/;
/**
 * Periodo com dias opcionais: "[quantidade] unidade [+ dias]".
 * Ex.: "s", "s+20", "S + 20 dias", "2q", "3 meses + 5", "d+20".
 */
const PERIOD_PATTERN =
  /^(\d+)?\s*(semanas?|s|dezenas?|d|quinzenas?|q|m[eê]ses|m[eê]s|m)\s*(?:\+\s*(\d+)\s*(?:dias?)?)?$/i;

type PeriodToken = PaymentConditionPeriod;

/** Uma parcela ja interpretada: prazo em dias + a forma canonica gravada no raw. */
interface ConditionToken {
  dueDays: number;
  canonical: string;
  period?: PeriodToken;
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
      canonical: formatPeriodToken(period),
      period
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

const PERIOD_UNIT_LABEL: Record<PeriodUnit, string> = {
  s: "semana",
  d: "dezena",
  q: "quinzena",
  m: "mes"
};

/** "fim da quinzena + 15 dias", "fim do 2o mes", "fim da semana". */
export function describePeriod(period: PaymentConditionPeriod): string {
  const masculine = period.unit === "m";
  const ordinal = period.count > 1 ? `${period.count}${masculine ? "o" : "a"} ` : "";
  const base = `fim ${masculine ? "do" : "da"} ${ordinal}${PERIOD_UNIT_LABEL[period.unit]}`;
  return period.extraDays > 0 ? `${base} + ${period.extraDays} dias` : base;
}

function buildSummary(kind: PaymentConditionKind, installments: ParsedInstallment[]): string {
  const count = installments.length;
  if (installments.some((installment) => installment.period)) {
    const parts = installments.map((installment) =>
      installment.period
        ? describePeriod(installment.period)
        : installment.dueDays === 0
          ? "a vista"
          : `${installment.dueDays} dias`
    );
    return count === 1 ? `1 parcela no ${parts[0]}` : `${count} parcelas (${parts.join(" / ")})`;
  }
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
  const installments: ParsedInstallment[] = tokens.map((token, index) => ({
    number: index + 1,
    dueDays: token.dueDays,
    ...(token.period ? { period: token.period } : {})
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

  // Formato 6: periodo isolado ("q+15", "m", "2s+5") -> uma unica parcela contada do
  // fim do periodo da venda.
  const period = parsePeriodToken(value);
  if (period !== null) {
    return buildFixedDays(formatPeriodToken(period), [
      {
        dueDays: assertDueDays(periodDueDays(period), value),
        canonical: formatPeriodToken(period),
        period
      }
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
      `"3 parcelas" ou "s+20" (semana + dias; "d" dezena, "q" quinzena, "m" mes).`
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

/** Data ISO (yyyy-mm-dd) -> Date em UTC, para a conta de dias nao sofrer com fuso. */
function isoToUtcDate(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? "");
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Ultimo dia do periodo (semana/dezena/quinzena/mes) que contem `date`. */
function endOfPeriod(date: Date, unit: PeriodUnit): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const last = lastDayOfMonth(year, month);
  switch (unit) {
    case "s": {
      // Semana de segunda a domingo: termina no domingo (getUTCDay 0).
      const toSunday = (7 - date.getUTCDay()) % 7;
      return new Date(Date.UTC(year, month, day + toSunday));
    }
    case "d":
      return new Date(Date.UTC(year, month, day <= 10 ? 10 : day <= 20 ? 20 : last));
    case "q":
      return new Date(Date.UTC(year, month, day <= 15 ? 15 : last));
    case "m":
      return new Date(Date.UTC(year, month, last));
  }
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

/**
 * Vencimento (yyyy-mm-dd) de uma parcela "fora periodo" para a venda de `saleDate`: o fim
 * do periodo da venda — avancando mais `count - 1` periodos —, mais os dias informados.
 * "q+15" com venda em 02/10 -> 15/10 + 15 = 30/10; com venda em 20/10 -> 31/10 + 15 = 15/11.
 * Retorna null quando a data da venda nao e uma data ISO.
 */
export function periodDueDate(saleDate: string, period: PaymentConditionPeriod): string | null {
  const sale = isoToUtcDate(saleDate);
  if (!sale) return null;
  let end = endOfPeriod(sale, period.unit);
  for (let index = 1; index < period.count; index++) {
    end = endOfPeriod(addUtcDays(end, 1), period.unit);
  }
  return addUtcDays(end, period.extraDays).toISOString().slice(0, 10);
}

/**
 * Prazo REAL, em dias contados da venda, de cada parcela — o numero que vai para o OMIE
 * (que soma os dias a data de emissao). Parcela em dias fica como esta; parcela em
 * periodo vira a distancia entre a venda e {@link periodDueDate}.
 */
export function installmentDueDaysForSale(
  parsed: Pick<ParsedPaymentCondition, "installments">,
  saleDate: string
): number[] {
  const sale = isoToUtcDate(saleDate);
  return parsed.installments.map((installment) => {
    if (!installment.period || !sale) return installment.dueDays;
    const due = periodDueDate(saleDate, installment.period);
    const dueAt = due ? isoToUtcDate(due) : null;
    if (!dueAt) return installment.dueDays;
    return Math.round((dueAt.getTime() - sale.getTime()) / 86_400_000);
  });
}

/**
 * Prazos reais de uma condicao gravada (`rules_json.raw`) para a venda de `saleDate`, ou
 * null quando o texto nao e uma condicao valida OU nao tem parcela em periodo — nesse
 * caso os prazos gravados ja sao os de verdade e quem chamou fica com eles.
 *
 * Le do texto, e nao do `installments` gravado, de proposito: a condicao "q+12" gravada
 * antes desta regra tem so os dias nominais no rules_json, e e o texto que diz que ela e
 * em periodo.
 */
export function conditionDueDaysForSale(
  raw: string | null | undefined,
  saleDate: string
): number[] | null {
  if (!raw) return null;
  const parsed = tryParsePaymentCondition(raw);
  if (!parsed || !parsed.installments.some((installment) => installment.period)) return null;
  return installmentDueDaysForSale(parsed, saleDate);
}
