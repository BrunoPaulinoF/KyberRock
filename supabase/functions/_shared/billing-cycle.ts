// Regras de ciclo da cobranca da plataforma: data de virada, fechamento,
// vencimento, rateio da primeira fatura e inadimplencia.
//
// Puro de proposito (sem Deno, sem fetch, sem Supabase): e a unica parte do
// financeiro que erra em silencio. Uma conta errada aqui vira boleto errado no
// WhatsApp do cliente, entao ela vive isolada e coberta por teste
// (`billing-cycle_test.ts`, rodado pelo vitest — ver o `include` do
// vitest.config.ts).
//
// Datas sao sempre strings `YYYY-MM-DD` e a aritmetica e feita em UTC. O
// negocio opera em America/Sao_Paulo, que desde 2019 e um deslocamento fixo de
// -03:00; usar `new Date("2026-08-25")` (UTC) e comparar so a parte da data
// evita o classico "virou o dia" do fuso local do servidor.

/** Fuso operacional; o mesmo de `report-schedule.ts`. */
export const BILLING_UTC_OFFSET_HOURS = -3;

export interface BillingCycleConfig {
  /** Data de virada do sistema: primeiro dia de uso cobrado. */
  startDate: string;
  /** Dia do mes do fechamento (1-31). Meses curtos usam o ultimo dia. */
  closingDay: number;
  /** Dia do mes do vencimento (1-31). */
  dueDay: number;
}

export interface BillingPeriod {
  periodStart: string;
  /** Ultimo dia coberto — igual a `closingDate`. */
  periodEnd: string;
  closingDate: string;
  dueDate: string;
  /** Dias efetivamente cobrados (inclusivo nas duas pontas). */
  billedDays: number;
  /** Dias do ciclo cheio ao qual esse fechamento pertence. */
  fullPeriodDays: number;
  /** Primeira fatura mais curta que o ciclo: cobrada por rateio. */
  isProrated: boolean;
  /** "08/2026" — mes/ano do fechamento. */
  referenceLabel: string;
}

const MS_PER_DAY = 86_400_000;

function isValidDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toUtcDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** Data local (YYYY-MM-DD) de Sao Paulo para um instante UTC. */
export function billingToday(now: Date = new Date()): string {
  return toDateString(new Date(now.getTime() + BILLING_UTC_OFFSET_HOURS * 3_600_000));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Monta a data do dia `day` no mes informado, encurtando para o ultimo dia
 * quando o mes nao chega la. Fechamento no dia 31 acontece em 28/02 (ou 29/02);
 * sem isso, fevereiro simplesmente nao fechava.
 */
export function clampDayOfMonth(year: number, month: number, day: number): string {
  const safeDay = Math.min(Math.max(Math.trunc(day), 1), daysInMonth(year, month));
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  const value = toUtcDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  return toDateString(value);
}

/** Diferenca em dias (b - a). Negativa quando `b` e anterior a `a`. */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / MS_PER_DAY);
}

/** Dias cobertos por um intervalo fechado — 25/08 a 25/08 e um dia, nao zero. */
export function inclusiveDays(start: string, end: string): number {
  return diffDays(start, end) + 1;
}

function shiftMonth(date: string, months: number, day: number): string {
  const value = toUtcDate(date);
  const total = value.getUTCFullYear() * 12 + value.getUTCMonth() + months;
  return clampDayOfMonth(Math.floor(total / 12), (total % 12) + 1, day);
}

/** Primeiro fechamento em `date` ou depois dela. */
export function closingOnOrAfter(date: string, closingDay: number): string {
  const value = toUtcDate(date);
  const candidate = clampDayOfMonth(value.getUTCFullYear(), value.getUTCMonth() + 1, closingDay);
  return candidate >= date ? candidate : shiftMonth(date, 1, closingDay);
}

/** Fechamento imediatamente anterior a `closingDate`. */
export function previousClosing(closingDate: string, closingDay: number): string {
  return shiftMonth(closingDate, -1, closingDay);
}

/**
 * Vencimento de um fechamento. Vencer DEPOIS de fechar e o unico arranjo que
 * faz sentido, entao o dia do vencimento maior que o do fechamento cai no mesmo
 * mes ("fecha dia 5, vence dia 20") e o menor ou igual cai no mes seguinte
 * ("fecha dia 25, vence dia 5").
 */
export function dueDateFor(closingDate: string, closingDay: number, dueDay: number): string {
  const normalizedClosingDay = Math.min(Math.max(Math.trunc(closingDay), 1), 31);
  const normalizedDueDay = Math.min(Math.max(Math.trunc(dueDay), 1), 31);
  const sameMonth = normalizedDueDay > normalizedClosingDay;
  const candidate = shiftMonth(closingDate, sameMonth ? 0 : 1, normalizedDueDay);
  // Rede de seguranca para o encurtamento de mes curto: fechamento 31/01 com
  // vencimento no dia 31 daria 28/02 no mes seguinte, o que continua depois do
  // fechamento; ja fechamento 28/02 (dia 31 encurtado) com vencimento no dia 30
  // cairia em 28/02 pelo "mesmo mes". Empurra um mes quando isso acontece.
  return candidate > closingDate ? candidate : shiftMonth(candidate, 1, normalizedDueDay);
}

export function referenceLabel(closingDate: string): string {
  const [year, month] = closingDate.split("-");
  return `${month}/${year}`;
}

function normalizeConfig(config: BillingCycleConfig): BillingCycleConfig {
  return {
    startDate: config.startDate,
    closingDay: Math.min(Math.max(Math.trunc(config.closingDay), 1), 31),
    dueDay: Math.min(Math.max(Math.trunc(config.dueDay), 1), 31)
  };
}

function buildPeriod(periodStartFloor: string, config: BillingCycleConfig): BillingPeriod {
  const closingDate = closingOnOrAfter(periodStartFloor, config.closingDay);
  const fullPeriodStart = addDays(previousClosing(closingDate, config.closingDay), 1);
  const periodStart = periodStartFloor > fullPeriodStart ? periodStartFloor : fullPeriodStart;
  const billedDays = inclusiveDays(periodStart, closingDate);
  const fullPeriodDays = inclusiveDays(fullPeriodStart, closingDate);
  return {
    periodStart,
    periodEnd: closingDate,
    closingDate,
    dueDate: dueDateFor(closingDate, config.closingDay, config.dueDay),
    billedDays,
    fullPeriodDays,
    isProrated: billedDays < fullPeriodDays,
    referenceLabel: referenceLabel(closingDate)
  };
}

/**
 * Primeiro ciclo da pedreira. Comeca na data de virada e termina no primeiro
 * fechamento a partir dela — por isso a primeira fatura costuma ser de menos de
 * um mes e sai por rateio.
 */
export function firstBillingPeriod(config: BillingCycleConfig): BillingPeriod {
  const normalized = normalizeConfig(config);
  return buildPeriod(normalized.startDate, normalized);
}

/** Ciclo seguinte ao que terminou em `previousPeriodEnd`. */
export function nextBillingPeriod(
  config: BillingCycleConfig,
  previousPeriodEnd: string
): BillingPeriod {
  const normalized = normalizeConfig(config);
  return buildPeriod(addDays(previousPeriodEnd, 1), normalized);
}

/**
 * Proximo ciclo a faturar. Sem fatura anterior, e o primeiro; com fatura, e o
 * seguinte ao ultimo periodo ja fechado.
 */
export function upcomingBillingPeriod(
  config: BillingCycleConfig,
  lastPeriodEnd: string | null | undefined
): BillingPeriod {
  return lastPeriodEnd ? nextBillingPeriod(config, lastPeriodEnd) : firstBillingPeriod(config);
}

/**
 * Ciclos ja fechados e ainda nao faturados ate `today`. Devolve lista porque
 * uma pedreira cadastrada com atraso (ou um motor parado por dias) tem mais de
 * um fechamento pendente, e pular ciclo significaria mes nao cobrado.
 */
export function pendingBillingPeriods(input: {
  config: BillingCycleConfig;
  lastPeriodEnd: string | null | undefined;
  today: string;
  /** Trava de seguranca contra configuracao absurda (data de virada em 1990). */
  maxPeriods?: number;
}): BillingPeriod[] {
  const maxPeriods = input.maxPeriods ?? 24;
  const periods: BillingPeriod[] = [];
  let cursor = input.lastPeriodEnd ?? null;
  for (let i = 0; i < maxPeriods; i++) {
    const period = upcomingBillingPeriod(input.config, cursor);
    if (period.closingDate > input.today) break;
    periods.push(period);
    cursor = period.periodEnd;
  }
  return periods;
}

/** Valor da fatura em centavos, rateado quando o ciclo e parcial. */
export function proratedAmountCents(input: {
  monthlyAmountCents: number;
  billedDays: number;
  fullPeriodDays: number;
}): number {
  const monthly = Math.max(0, Math.round(input.monthlyAmountCents));
  if (input.fullPeriodDays <= 0) return monthly;
  if (input.billedDays >= input.fullPeriodDays) return monthly;
  const billedDays = Math.max(0, input.billedDays);
  return Math.round((monthly * billedDays) / input.fullPeriodDays);
}

/** Total da fatura depois dos ajustes manuais do painel. */
export function invoiceTotalCents(input: {
  baseAmountCents: number;
  discountCents?: number | null;
  additionCents?: number | null;
}): number {
  const total =
    Math.max(0, Math.round(input.baseAmountCents)) +
    Math.max(0, Math.round(input.additionCents ?? 0)) -
    Math.max(0, Math.round(input.discountCents ?? 0));
  return Math.max(0, total);
}

/** Dias de atraso de um vencimento. Zero (ou negativo) enquanto esta em dia. */
export function daysOverdue(dueDate: string, today: string): number {
  return diffDays(dueDate, today);
}

export function isOverdue(dueDate: string, today: string): boolean {
  return daysOverdue(dueDate, today) > 0;
}

/** Data em que a inadimplencia passa a bloquear. Carencia 0 = dia seguinte ao vencimento. */
export function blockDateFor(dueDate: string, graceDays: number): string {
  return addDays(dueDate, Math.max(0, Math.trunc(graceDays)) + 1);
}

/**
 * "Depois de X dias de inadimplencia, bloqueio automatico." Com carencia 5 e
 * vencimento em 05/09, bloqueia em 11/09 — 10/09 ainda e o quinto dia tolerado.
 */
export function shouldBlockForOverdue(input: {
  dueDate: string;
  graceDays: number;
  today: string;
}): boolean {
  return daysOverdue(input.dueDate, input.today) > Math.max(0, Math.trunc(input.graceDays));
}

/** Configuracao efetiva da pedreira: o que ela definiu, senao o padrao global. */
export function resolveBillingConfig(input: {
  startDate: string | null | undefined;
  closingDay: number | null | undefined;
  dueDay: number | null | undefined;
  defaults: { closingDay: number; dueDay: number };
}): BillingCycleConfig | null {
  if (!input.startDate || !isValidDateString(input.startDate)) return null;
  return {
    startDate: input.startDate,
    closingDay: input.closingDay ?? input.defaults.closingDay,
    dueDay: input.dueDay ?? input.defaults.dueDay
  };
}

/** Carencia efetiva: a da pedreira quando definida, senao a global. */
export function resolveGraceDays(
  companyGraceDays: number | null | undefined,
  defaultGraceDays: number
): number {
  const value = companyGraceDays ?? defaultGraceDays;
  return Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0));
}
