/**
 * Calculo do fechamento e vencimento da fatura de credito do cliente (fiado).
 *
 * Suporta tres periodicidades (reuniao 06/07):
 *  - `monthly`  : fecha em um dia fixo do mes; boleto vence X dias depois.
 *  - `biweekly` : dois dias de fechamento no mes (ex.: 1 e 16), cada um com o
 *                 seu proprio prazo de boleto (dias apos o 1o e apos o 2o
 *                 fechamento). Cada venda entra no proximo fechamento.
 *  - `weekly`   : fecha num dia da semana; as vendas da semana entram no
 *                 proximo fechamento, evitando duplicidade de cobranca.
 *
 * Cada operacao pertence a exatamente um fechamento (o proximo, na data ou
 * depois dela), o que evita cobrar a mesma venda em dois periodos.
 */

export interface MonthlyClosingConfig {
  periodicity: "monthly";
  /** Dia do mes (1-31) em que a fatura fecha. */
  closingDay: number;
  /** Dias apos o fechamento para o vencimento do boleto (>= 0). */
  boletoDays: number;
}

export interface BiweeklyClosingConfig {
  periodicity: "biweekly";
  /** Primeiro dia de fechamento do mes (ex.: 1). */
  firstClosingDay: number;
  /** Segundo dia de fechamento do mes (ex.: 16). Deve ser maior que o primeiro. */
  secondClosingDay: number;
  /** Dias apos o primeiro fechamento para o vencimento. */
  firstBoletoDays: number;
  /** Dias apos o segundo fechamento para o vencimento. */
  secondBoletoDays: number;
}

export interface WeeklyClosingConfig {
  periodicity: "weekly";
  /** Dia da semana do fechamento (0 = domingo ... 6 = sabado). */
  closingWeekday: number;
  /** Dias apos o fechamento para o vencimento do boleto (>= 0). */
  boletoDays: number;
}

export type CreditClosingConfig =
  | MonthlyClosingConfig
  | BiweeklyClosingConfig
  | WeeklyClosingConfig;

export interface CreditInvoiceSchedule {
  /** Data de fechamento da fatura (YYYY-MM-DD). */
  closingDate: string;
  /** Data de vencimento do boleto (YYYY-MM-DD). */
  dueDate: string;
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function assertDay(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 31) {
    throw new Error(`${label} invalido. Informe um dia entre 1 e 31.`);
  }
}

function assertBoletoDays(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} invalido. Informe zero ou mais dias.`);
  }
}

function scheduleFrom(closing: Date, boletoDays: number): CreditInvoiceSchedule {
  const due = new Date(closing.getTime());
  due.setUTCDate(due.getUTCDate() + boletoDays);
  return { closingDate: formatUtcDate(closing), dueDate: formatUtcDate(due) };
}

function computeMonthly(config: MonthlyClosingConfig, operationDate: Date): CreditInvoiceSchedule {
  assertDay(config.closingDay, "Dia de fechamento");
  assertBoletoDays(config.boletoDays, "Dias para vencimento");

  const year = operationDate.getFullYear();
  const month = operationDate.getMonth();
  const day = operationDate.getDate();

  const clampedThisMonth = Math.min(config.closingDay, daysInMonth(year, month));

  let closingYear = year;
  let closingMonth = month;
  if (day > clampedThisMonth) {
    closingMonth += 1;
    if (closingMonth > 11) {
      closingMonth = 0;
      closingYear += 1;
    }
  }

  const closingDayActual = Math.min(config.closingDay, daysInMonth(closingYear, closingMonth));
  return scheduleFrom(new Date(Date.UTC(closingYear, closingMonth, closingDayActual)), config.boletoDays);
}

function computeBiweekly(config: BiweeklyClosingConfig, operationDate: Date): CreditInvoiceSchedule {
  assertDay(config.firstClosingDay, "Primeiro dia de fechamento");
  assertDay(config.secondClosingDay, "Segundo dia de fechamento");
  if (config.secondClosingDay <= config.firstClosingDay) {
    throw new Error("O segundo dia de fechamento deve ser maior que o primeiro.");
  }
  assertBoletoDays(config.firstBoletoDays, "Dias para vencimento do primeiro fechamento");
  assertBoletoDays(config.secondBoletoDays, "Dias para vencimento do segundo fechamento");

  const year = operationDate.getFullYear();
  const month = operationDate.getMonth();
  const day = operationDate.getDate();
  const dim = daysInMonth(year, month);

  const firstThisMonth = Math.min(config.firstClosingDay, dim);
  const secondThisMonth = Math.min(config.secondClosingDay, dim);

  // A venda entra no proximo fechamento na data ou depois dela.
  if (day <= firstThisMonth) {
    return scheduleFrom(new Date(Date.UTC(year, month, firstThisMonth)), config.firstBoletoDays);
  }
  if (day <= secondThisMonth) {
    return scheduleFrom(new Date(Date.UTC(year, month, secondThisMonth)), config.secondBoletoDays);
  }
  // Passou do segundo fechamento: entra no primeiro fechamento do mes seguinte.
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 11) {
    nextMonth = 0;
    nextYear += 1;
  }
  const firstNextMonth = Math.min(config.firstClosingDay, daysInMonth(nextYear, nextMonth));
  return scheduleFrom(new Date(Date.UTC(nextYear, nextMonth, firstNextMonth)), config.firstBoletoDays);
}

function computeWeekly(config: WeeklyClosingConfig, operationDate: Date): CreditInvoiceSchedule {
  if (!Number.isInteger(config.closingWeekday) || config.closingWeekday < 0 || config.closingWeekday > 6) {
    throw new Error("Dia da semana de fechamento invalido. Informe de 0 (domingo) a 6 (sabado).");
  }
  assertBoletoDays(config.boletoDays, "Dias para vencimento");

  const year = operationDate.getFullYear();
  const month = operationDate.getMonth();
  const day = operationDate.getDate();
  const weekday = operationDate.getDay();

  // Proximo dia de fechamento na semana (0-6 dias a frente; mesmo dia = hoje).
  const delta = (config.closingWeekday - weekday + 7) % 7;
  const closing = new Date(Date.UTC(year, month, day));
  closing.setUTCDate(closing.getUTCDate() + delta);
  return scheduleFrom(closing, config.boletoDays);
}

/**
 * Calcula a data de fechamento e a data de vencimento da fatura de credito para
 * uma operacao realizada em `operationDate`, de acordo com a periodicidade
 * configurada no cliente.
 */
export function computeCreditInvoiceSchedule(
  config: CreditClosingConfig,
  operationDate: Date
): CreditInvoiceSchedule {
  switch (config.periodicity) {
    case "monthly":
      return computeMonthly(config, operationDate);
    case "biweekly":
      return computeBiweekly(config, operationDate);
    case "weekly":
      return computeWeekly(config, operationDate);
  }
}

/** Campos de credito do cliente (fiado) usados para montar a periodicidade. */
export interface CustomerCreditFields {
  creditAccountEnabled: boolean;
  creditPeriodicity: "monthly" | "biweekly" | "weekly";
  creditClosingDay: number | null;
  creditBoletoDays: number | null;
  creditSecondClosingDay: number | null;
  creditSecondBoletoDays: number | null;
  creditClosingWeekday: number | null;
}

/**
 * Monta a configuracao de fechamento a partir dos campos de credito do cliente.
 * Retorna `null` quando o cliente nao tem conta de credito (fiado) habilitada.
 */
export function creditClosingConfigFromCustomer(
  customer: CustomerCreditFields
): CreditClosingConfig | null {
  if (!customer.creditAccountEnabled) return null;
  switch (customer.creditPeriodicity) {
    case "weekly":
      return {
        periodicity: "weekly",
        closingWeekday: customer.creditClosingWeekday ?? 0,
        boletoDays: customer.creditBoletoDays ?? 0
      };
    case "biweekly":
      return {
        periodicity: "biweekly",
        firstClosingDay: customer.creditClosingDay ?? 1,
        secondClosingDay: customer.creditSecondClosingDay ?? 16,
        firstBoletoDays: customer.creditBoletoDays ?? 0,
        secondBoletoDays: customer.creditSecondBoletoDays ?? 0
      };
    default:
      return {
        periodicity: "monthly",
        closingDay: customer.creditClosingDay ?? 1,
        boletoDays: customer.creditBoletoDays ?? 0
      };
  }
}
