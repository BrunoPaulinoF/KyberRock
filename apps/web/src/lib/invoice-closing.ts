/**
 * Fechamento de faturas no site — espelho do servico da balanca
 * (`apps/desktop/src/services/invoice-closing.ts` e vizinhos), lendo a projecao da nuvem.
 *
 * Aqui mora tudo o que a tela do desktop recebe PRONTO do processo principal: o periodo
 * (quinzena, mes, semana, personalizado), a fatura de cada cliente, a data de fechamento e o
 * vencimento, as cargas repetidas, o resumo por transportador e a situacao de cada pesagem no
 * OMIE. As regras sao as MESMAS da balanca de proposito: a atendente compara as duas telas, e
 * uma quinzena que fecha um valor la e outro aqui e pior que nenhuma das duas.
 *
 * O que muda em relacao ao desktop:
 *  - o recorte e da EMPRESA (a balanca fecha a propria unidade);
 *  - o "Fazer fechamento" nao fatura: ele PEDE, em `billing_requests`, e a balanca da unidade
 *    executa (docs/web-api.md 4.8). O andamento de cada pedido entra na linha da pesagem;
 *  - o numero visivel do pedido no OMIE nao e projetado na nuvem: a referencia sai pelo codigo
 *    interno do pedido/OS.
 */

import { formatDocument, localDay, normalizeDocument } from "./format";
import { matchesSearch } from "./operation";
import type { BillingRequest, Carrier, Customer, Operation, Product, Vehicle } from "./queries";
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// Periodo do fechamento (espelho de `invoice-closing-period.ts`)
// ---------------------------------------------------------------------------

export type InvoiceClosingCycle = "biweekly" | "monthly" | "weekly";

export const INVOICE_CLOSING_CYCLES: readonly InvoiceClosingCycle[] = [
  "biweekly",
  "monthly",
  "weekly"
];

export const INVOICE_CLOSING_CYCLE_LABEL: Record<InvoiceClosingCycle, string> = {
  biweekly: "Quinzenal",
  monthly: "Mensal",
  weekly: "Semanal"
};

export function isInvoiceClosingCycle(value: unknown): value is InvoiceClosingCycle {
  return value === "biweekly" || value === "monthly" || value === "weekly";
}

export type InvoiceClosingPeriodKind = "biweekly" | "monthly" | "weekly" | "custom";

export const INVOICE_CLOSING_PERIOD_KINDS: readonly InvoiceClosingPeriodKind[] = [
  "biweekly",
  "monthly",
  "weekly",
  "custom"
];

export const INVOICE_CLOSING_PERIOD_KIND_LABEL: Record<InvoiceClosingPeriodKind, string> = {
  biweekly: "Quinzena",
  monthly: "Mes",
  weekly: "Semana",
  custom: "Personalizado"
};

export interface InvoiceClosingPeriodSelection {
  kind: InvoiceClosingPeriodKind;
  /** Mes de referencia (`YYYY-MM`) da quinzena e do mes. */
  month: string;
  half: 1 | 2;
  /** Dia dentro da semana escolhida (`YYYY-MM-DD`). */
  weekDay: string;
  customStart: string;
  customEnd: string;
}

export interface InvoiceClosingPeriodRange {
  start: string;
  end: string;
  label: string;
  /** O ciclo que o periodo representa; null no personalizado. */
  cycle: InvoiceClosingCycle | null;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "marco",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro"
];

/** `YYYY-MM-DD` de uma data LOCAL (nunca via ISO/UTC). */
export function toIsoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Data LOCAL a partir de `YYYY-MM-DD`. `new Date("2026-08-16")` e meia-noite UTC e, no fuso
 * do Brasil, volta como dia 15 — jogando o primeiro dia da segunda quinzena na primeira.
 */
export function parseLocalDate(iso: string): Date {
  const [year, month, day] = iso.split("-").map((part) => Number(part));
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

/** Segunda-feira da semana de `date` — a semana comercial comeca na segunda. */
export function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

/** `DD/MM/YYYY` a partir de `YYYY-MM-DD`. */
export function formatDayLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

/**
 * O intervalo do periodo escolhido. A quinzena e sempre 1-15 / 16-fim do mes; intervalo
 * invertido no personalizado e trocado de lugar em vez de devolver periodo impossivel.
 */
export function resolveInvoiceClosingPeriod(
  selection: InvoiceClosingPeriodSelection,
  now: Date = new Date()
): InvoiceClosingPeriodRange {
  if (selection.kind === "custom") {
    const today = toIsoDay(now);
    const start = DATE_PATTERN.test(selection.customStart) ? selection.customStart : today;
    const end = DATE_PATTERN.test(selection.customEnd) ? selection.customEnd : today;
    const [from, to] = start <= end ? [start, end] : [end, start];
    return {
      start: from,
      end: to,
      label: `Periodo de ${formatDayLabel(from)} a ${formatDayLabel(to)}`,
      cycle: null
    };
  }

  if (selection.kind === "weekly") {
    const reference = DATE_PATTERN.test(selection.weekDay)
      ? parseLocalDate(selection.weekDay)
      : now;
    const start = startOfWeek(reference);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return {
      start: toIsoDay(start),
      end: toIsoDay(end),
      label: `Semana de ${formatDayLabel(toIsoDay(start))} a ${formatDayLabel(toIsoDay(end))}`,
      cycle: "weekly"
    };
  }

  const [year, monthIndex0] = MONTH_PATTERN.test(selection.month)
    ? [Number(selection.month.slice(0, 4)), Number(selection.month.slice(5, 7)) - 1]
    : [now.getFullYear(), now.getMonth()];
  const lastDay = String(daysInMonth(year, monthIndex0)).padStart(2, "0");
  const prefix = `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
  const monthName = `${MONTH_NAMES[monthIndex0]} de ${year}`;

  if (selection.kind === "monthly") {
    return {
      start: `${prefix}-01`,
      end: `${prefix}-${lastDay}`,
      label: `Mes de ${monthName}`,
      cycle: "monthly"
    };
  }

  const first = selection.half !== 2;
  return {
    start: first ? `${prefix}-01` : `${prefix}-16`,
    end: first ? `${prefix}-15` : `${prefix}-${lastDay}`,
    label: `${first ? "1a" : "2a"} quinzena de ${monthName}`,
    cycle: "biweekly"
  };
}

/** A selecao inicial das telas: a quinzena em que hoje esta. */
export function defaultInvoiceClosingPeriod(now: Date = new Date()): InvoiceClosingPeriodSelection {
  const today = toIsoDay(now);
  return {
    kind: "biweekly",
    month: today.slice(0, 7),
    half: now.getDate() <= 15 ? 1 : 2,
    weekDay: today,
    customStart: today,
    customEnd: today
  };
}

/** Dias somados a uma data `YYYY-MM-DD`, sem passar por UTC. */
export function addDays(iso: string, days: number): string {
  const date = parseLocalDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDay(date);
}

// ---------------------------------------------------------------------------
// Fechamento do credito do cliente (espelho de `credit-invoice.ts`)
// ---------------------------------------------------------------------------

export type CreditClosingConfig =
  | { periodicity: "monthly"; closingDay: number; boletoDays: number }
  | {
      periodicity: "biweekly";
      firstClosingDay: number;
      secondClosingDay: number;
      firstBoletoDays: number;
      secondBoletoDays: number;
    }
  | { periodicity: "weekly"; closingWeekday: number; boletoDays: number };

export interface CreditInvoiceSchedule {
  closingDate: string;
  dueDate: string;
}

function scheduleFrom(year: number, month: number, day: number, boletoDays: number) {
  const closing = toIsoDay(new Date(year, month, day));
  return { closingDate: closing, dueDate: addDays(closing, boletoDays) };
}

/** Configuracao de fechamento do cadastro; null quando o cliente nao tem credito habilitado. */
export function creditClosingConfigFromCustomer(
  customer: Pick<
    Customer,
    | "credit_account_enabled"
    | "credit_periodicity"
    | "credit_closing_day"
    | "credit_boleto_days"
    | "credit_second_closing_day"
    | "credit_second_boleto_days"
    | "credit_closing_weekday"
  >
): CreditClosingConfig | null {
  if (!customer.credit_account_enabled) return null;
  switch (customer.credit_periodicity) {
    case "weekly":
      return {
        periodicity: "weekly",
        closingWeekday: customer.credit_closing_weekday ?? 0,
        boletoDays: customer.credit_boleto_days ?? 0
      };
    case "biweekly":
      return {
        periodicity: "biweekly",
        firstClosingDay: customer.credit_closing_day ?? 1,
        secondClosingDay: customer.credit_second_closing_day ?? 16,
        firstBoletoDays: customer.credit_boleto_days ?? 0,
        secondBoletoDays: customer.credit_second_boleto_days ?? 0
      };
    default:
      return {
        periodicity: "monthly",
        closingDay: customer.credit_closing_day ?? 1,
        boletoDays: customer.credit_boleto_days ?? 0
      };
  }
}

/** A venda entra no PROXIMO fechamento na data dela ou depois — igual a fatura de fiado. */
export function computeCreditInvoiceSchedule(
  config: CreditClosingConfig,
  operationDay: string
): CreditInvoiceSchedule {
  const date = parseLocalDate(operationDay);
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  if (config.periodicity === "weekly") {
    const delta = (config.closingWeekday - date.getDay() + 7) % 7;
    return scheduleFrom(year, month, day + delta, config.boletoDays);
  }

  if (config.periodicity === "biweekly") {
    const dim = daysInMonth(year, month);
    const first = Math.min(config.firstClosingDay, dim);
    const second = Math.min(config.secondClosingDay, dim);
    if (day <= first) return scheduleFrom(year, month, first, config.firstBoletoDays);
    if (day <= second) return scheduleFrom(year, month, second, config.secondBoletoDays);
    const next = new Date(year, month + 1, 1);
    const nextFirst = Math.min(
      config.firstClosingDay,
      daysInMonth(next.getFullYear(), next.getMonth())
    );
    return scheduleFrom(next.getFullYear(), next.getMonth(), nextFirst, config.firstBoletoDays);
  }

  const thisMonth = Math.min(config.closingDay, daysInMonth(year, month));
  const target = day > thisMonth ? new Date(year, month + 1, 1) : new Date(year, month, 1);
  const closingDay = Math.min(
    config.closingDay,
    daysInMonth(target.getFullYear(), target.getMonth())
  );
  return scheduleFrom(target.getFullYear(), target.getMonth(), closingDay, config.boletoDays);
}

/**
 * O fechamento da base `period`: fecha no ULTIMO dia do periodo, e vence no prazo de boleto
 * do cadastro contado dali (na quinzena, o do segundo fechamento). Sem prazo, vence no fechamento.
 */
export function periodSchedule(
  endDate: string,
  config: CreditClosingConfig | null
): CreditInvoiceSchedule {
  const boletoDays = !config
    ? 0
    : config.periodicity === "biweekly"
      ? config.secondBoletoDays
      : config.boletoDays;
  return { closingDate: endDate, dueDate: boletoDays > 0 ? addDays(endDate, boletoDays) : endDate };
}

// ---------------------------------------------------------------------------
// Situacao no OMIE e nota fiscal (espelho de `weighing-billing-situation.ts`)
// ---------------------------------------------------------------------------

export type WeighingBillingSituation =
  | "billed"
  | "sent"
  | "pending"
  | "cadastro_incompleto"
  | "failed";

export const WEIGHING_BILLING_SITUATION_LABEL: Record<WeighingBillingSituation, string> = {
  billed: "Faturada",
  sent: "No OMIE, falta faturar",
  pending: "Nao enviada ao OMIE",
  cadastro_incompleto: "Cadastro incompleto",
  failed: "Recusada pelo OMIE"
};

export const SITUATION_TONE: Record<
  WeighingBillingSituation,
  "success" | "warning" | "danger" | "info"
> = {
  billed: "success",
  sent: "info",
  pending: "warning",
  cadastro_incompleto: "warning",
  failed: "danger"
};

type SituationInput = Pick<
  Operation,
  "operation_type" | "omie_sales_order_id" | "omie_service_order_id" | "omie_billing_status"
>;

export function resolveSituation(row: SituationInput): WeighingBillingSituation {
  if (row.omie_billing_status === "billed") return "billed";
  if (row.operation_type !== "invoice") {
    if (row.omie_service_order_id) return "sent";
    if (row.omie_billing_status === "cadastro_incompleto") return "cadastro_incompleto";
    if (row.omie_billing_status === "service_order_failed") return "failed";
    return "pending";
  }
  if (row.omie_sales_order_id) return "sent";
  if (row.omie_billing_status === "cadastro_incompleto") return "cadastro_incompleto";
  if (row.omie_billing_status === "failed") return "failed";
  return "pending";
}

export function resolveSituationDetail(
  row: SituationInput & Pick<Operation, "omie_billing_message">,
  situation: WeighingBillingSituation
): string | null {
  const message = row.omie_billing_message?.trim();
  if (message) return message;
  if (situation === "billed" || situation === "sent") {
    if (row.omie_sales_order_id) return `Pedido OMIE ${row.omie_sales_order_id}`;
    if (row.omie_service_order_id) return `Ordem de servico OMIE ${row.omie_service_order_id}`;
  }
  return null;
}

/** A coluna "Nota fiscal": numero, venda com nota ainda sem numero, ou interna (nao se aplica). */
export function invoiceNumberLabel(
  invoiceNumber: string | null,
  operationType: "invoice" | "internal"
): { state: "number" | "pending" | "not_applicable"; text: string; title: string | null } {
  const number = (invoiceNumber ?? "").trim();
  if (number) return { state: "number", text: number, title: null };
  if (operationType === "internal") {
    return {
      state: "not_applicable",
      text: "—",
      title:
        "Venda interna: vira ordem de servico no OMIE e nao emite NF-e. Se a pedreira emitir nota de servico a partir da OS, o numero aparece aqui."
    };
  }
  return {
    state: "pending",
    text: "Sem nota",
    title:
      "Venda com nota ainda sem numero: ou a NF-e nao foi emitida no OMIE, ou a conferencia ainda nao chegou nesta carga."
  };
}

/** O vale como sai impresso no cupom ("000123"). */
export function formatCouponNumber(code: number | null): string {
  return code === null ? "-" : String(code).padStart(6, "0");
}

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/** Tonelagem com uma casa ("79,7 t") — o KPI do desktop. */
export function formatTonsShort(kg: number): string {
  return `${(kg / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} t`;
}

/** Peso em quilos, so o numero: a coluna ja diz "Peso". */
export function formatKg(kg: number): string {
  return kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export function formatCount(value: number): string {
  return value.toLocaleString("pt-BR");
}

/** Preco unitario com a unidade ("R$ 65,00/t"): sem ela o numero nao se confere. */
export function unitPriceLabel(line: {
  unitPriceCents: number | null;
  priceUnit: string | null;
}): string {
  if (line.unitPriceCents === null) return "-";
  return `${formatBRL(line.unitPriceCents)}/${line.priceUnit === "kg" ? "kg" : "t"}`;
}

/** Como a pesagem e procurada no OMIE (a nuvem nao traz o numero visivel do pedido). */
export function omieReference(line: {
  omieSalesOrderId: number | null;
  omieServiceOrderId: number | null;
}): string {
  if (line.omieSalesOrderId) return `Pedido ${line.omieSalesOrderId}`;
  if (line.omieServiceOrderId) return `OS ${line.omieServiceOrderId}`;
  return "-";
}

// ---------------------------------------------------------------------------
// Cliente real (espelho de `customer-identity.ts`)
// ---------------------------------------------------------------------------

type IdentityCustomer = Pick<Customer, "id" | "document" | "omie_customer_id">;

/** O mesmo cliente cadastrado duas vezes (o do OMIE e o da balanca) cai na mesma chave. */
export function customerIdentityKey(customer: IdentityCustomer): string {
  const document = normalizeDocument(customer.document ?? "");
  if (document) return `doc:${document}`;
  if (customer.omie_customer_id) return `omie:${customer.omie_customer_id}`;
  return `id:${customer.id}`;
}

export function buildIdentityIndex(customers: readonly IdentityCustomer[]): Map<string, string> {
  return new Map(customers.map((customer) => [customer.id, customerIdentityKey(customer)]));
}

export function identityKeyFor(index: Map<string, string>, customerId: string | null): string {
  if (!customerId) return "none";
  return index.get(customerId) ?? `id:${customerId}`;
}

// ---------------------------------------------------------------------------
// Pesagens repetidas (espelho de `weighing-duplicates.ts`)
// ---------------------------------------------------------------------------

/** Quantos dias antes e depois do periodo a busca de repetidas olha. */
export const DUPLICATE_WEIGHING_WINDOW_DAYS = 60;

export interface DuplicateCandidate {
  operationId: string;
  couponNumber: number | null;
  createdAt: string;
  date: string;
  customerKey: string;
  customerName: string;
  plate: string;
  productKey: string;
  productDescription: string;
  entryWeightKg: number | null;
  exitWeightKg: number | null;
  totalCents: number;
  operationType: "invoice" | "internal";
  invoiceNumber: string | null;
}

export interface DuplicateWeighingGroup {
  key: string;
  customerName: string;
  plate: string;
  productDescription: string;
  entryWeightKg: number;
  exitWeightKg: number;
  keepers: DuplicateCandidate[];
  duplicates: DuplicateCandidate[];
  billedMoreThanOnce: boolean;
}

/**
 * A mesma carga registrada mais de uma vez: mesmo cliente real, mesma placa, mesmo produto e
 * os DOIS pesos iguais ao quilo. Fica quem tem nota; sem nota nenhuma, a ultima registrada.
 */
export function groupDuplicateWeighings(
  candidates: readonly DuplicateCandidate[]
): DuplicateWeighingGroup[] {
  const groups = new Map<string, DuplicateCandidate[]>();
  for (const candidate of candidates) {
    const plate = candidate.plate.trim().toUpperCase();
    const entry = candidate.entryWeightKg;
    const exit = candidate.exitWeightKg;
    if (!plate || !entry || !exit || entry <= 0 || exit <= 0) continue;
    const key = [candidate.customerKey, plate, candidate.productKey, entry, exit].join("|");
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  const result: DuplicateWeighingGroup[] = [];
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const ordered = [...group].sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        (a.couponNumber ?? 0) - (b.couponNumber ?? 0) ||
        a.operationId.localeCompare(b.operationId)
    );
    const billed = ordered.filter((candidate) => (candidate.invoiceNumber ?? "").trim());
    const keepers = billed.length > 0 ? billed : [ordered[ordered.length - 1]];
    const keeperIds = new Set(keepers.map((candidate) => candidate.operationId));
    const duplicates = ordered.filter((candidate) => !keeperIds.has(candidate.operationId));
    if (duplicates.length === 0 && billed.length < 2) continue;
    const reference = keepers[0];
    result.push({
      key,
      customerName: reference.customerName,
      plate: reference.plate,
      productDescription: reference.productDescription,
      entryWeightKg: reference.entryWeightKg ?? 0,
      exitWeightKg: reference.exitWeightKg ?? 0,
      keepers,
      duplicates,
      billedMoreThanOnce: billed.length > 1
    });
  }
  return result.sort(
    (a, b) =>
      (b.duplicates[0]?.createdAt ?? "").localeCompare(a.duplicates[0]?.createdAt ?? "") ||
      a.plate.localeCompare(b.plate, "pt-BR")
  );
}

/** Colunas lidas para a deteccao de repetidas (a janela e maior que o periodo). */
export type DuplicateSourceRow = Pick<
  Operation,
  | "id"
  | "operation_code"
  | "created_at"
  | "operation_type"
  | "customer_id"
  | "customer_name"
  | "product_id"
  | "product_description"
  | "plate"
  | "entry_weight_kg"
  | "exit_weight_kg"
  | "total_cents"
  | "omie_invoice_number"
>;

// ---------------------------------------------------------------------------
// O relatorio (espelho de `InvoiceClosingService.getReport`)
// ---------------------------------------------------------------------------

export type InvoiceClosingBasis = "period" | "customer";

/** O ultimo pedido de faturamento feito pelo site para a pesagem. */
export interface LineRequest {
  status: string;
  message: string | null;
  at: string;
}

export interface InvoiceClosingLine {
  operationId: string;
  customerId: string;
  customerName: string;
  customerDocument: string | null;
  couponNumber: number | null;
  /** Dia da pesagem (saida da balanca; sem ela, a criacao), no fuso da pedreira. */
  date: string;
  closedAt: string | null;
  closingDate: string | null;
  dueDate: string | null;
  invoiceNumber: string | null;
  omieSalesOrderId: number | null;
  omieServiceOrderId: number | null;
  plate: string;
  carrierName: string;
  driverName: string;
  productCode: string | null;
  productDescription: string;
  netWeightKg: number;
  unitPriceCents: number | null;
  priceUnit: string | null;
  productTotalCents: number;
  freightTotalCents: number;
  totalCents: number;
  operationType: "invoice" | "internal";
  operationTypeLabel: string;
  situation: WeighingBillingSituation;
  situationLabel: string;
  situationDetail: string | null;
  isDuplicate: boolean;
  duplicateOfCouponNumber: number | null;
  /** Pedido de faturamento do site (null quando nunca houve). */
  request: LineRequest | null;
}

export interface InvoiceClosingTotals {
  operations: number;
  netWeightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
}

export interface InvoiceClosingInvoice {
  key: string;
  customerId: string;
  customerName: string;
  customerDocument: string | null;
  plate: string | null;
  cycle: InvoiceClosingCycle | null;
  cycleLabel: string;
  closingDate: string;
  dueDate: string;
  lines: InvoiceClosingLine[];
  totals: InvoiceClosingTotals;
  operationsWithoutInvoice: number;
}

export interface InvoiceClosingCarrierRow {
  carrierName: string;
  trips: number;
  netWeightKg: number;
  freightCents: number;
  totalCents: number;
  plates: Array<{
    plate: string;
    trips: number;
    netWeightKg: number;
    freightCents: number;
    totalCents: number;
  }>;
}

export interface InvoiceClosingPendingCustomer {
  key: string;
  customerName: string;
  operations: number;
  totalCents: number;
}

export interface InvoiceClosingDuplicateEntry {
  operationId: string;
  couponNumber: number | null;
  date: string;
  totalCents: number;
  invoiceNumber: string | null;
}

export interface InvoiceClosingDuplicateGroup {
  key: string;
  customerName: string;
  plate: string;
  productDescription: string;
  entryWeightKg: number;
  exitWeightKg: number;
  kept: InvoiceClosingDuplicateEntry[];
  repeats: InvoiceClosingDuplicateEntry[];
  removedTotalCents: number;
  billedMoreThanOnce: boolean;
}

export interface InvoiceClosingReport {
  invoices: InvoiceClosingInvoice[];
  rows: InvoiceClosingLine[];
  rowTotals: InvoiceClosingTotals;
  totals: InvoiceClosingTotals;
  duplicates: InvoiceClosingDuplicateGroup[];
  duplicateTotals: InvoiceClosingTotals;
  customers: number;
  withoutInvoice: InvoiceClosingTotals;
  byCarrier: InvoiceClosingCarrierRow[];
  pendingSetup: InvoiceClosingPendingCustomer[];
  availablePlates: string[];
}

export interface InvoiceClosingSource {
  operations: readonly Operation[];
  customers: readonly Customer[];
  products?: ReadonlyArray<Pick<Product, "id" | "code">>;
  vehicles?: ReadonlyArray<Pick<Vehicle, "plate" | "carrier_id">>;
  carriers?: ReadonlyArray<Pick<Carrier, "id" | "name">>;
  /** Pesagens da janela larga (periodo +- 60 dias) para achar as repetidas. */
  duplicateRows?: readonly DuplicateSourceRow[];
  billingRequests?: readonly BillingRequest[];
}

export interface InvoiceClosingOptions {
  startDate: string;
  endDate: string;
  basis: InvoiceClosingBasis;
  periodCycle: InvoiceClosingCycle | null;
  cycles: InvoiceClosingCycle[];
  customerId: string | null;
  plates: string[];
  search: string;
}

/** A placa como o filtro compara: sem espacos nas pontas e em maiuscula. */
export function normalizePlate(plate: string): string {
  return plate.trim().toUpperCase();
}

function emptyTotals(): InvoiceClosingTotals {
  return { operations: 0, netWeightKg: 0, productCents: 0, freightCents: 0, totalCents: 0 };
}

export function buildTotals(lines: readonly InvoiceClosingLine[]): InvoiceClosingTotals {
  return lines.reduce((acc, line) => {
    acc.operations += 1;
    acc.netWeightKg += line.netWeightKg;
    acc.productCents += line.productTotalCents;
    acc.freightCents += line.freightTotalCents;
    acc.totalCents += line.totalCents;
    return acc;
  }, emptyTotals());
}

function customerLabel(customer: Customer | undefined, fallback: string | null): string {
  return (
    customer?.trade_name?.trim() ||
    customer?.legal_name?.trim() ||
    fallback?.trim() ||
    "Sem cliente"
  );
}

/** Pedidos mais novos primeiro: o primeiro de cada pesagem e o que vale. */
function latestRequests(requests: readonly BillingRequest[]): Map<string, LineRequest> {
  const map = new Map<string, LineRequest>();
  const ordered = [...requests].sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  for (const request of ordered) {
    if (map.has(request.operation_id)) continue;
    map.set(request.operation_id, {
      status: request.status,
      message: request.result_message,
      at: request.processed_at ?? request.requested_at
    });
  }
  return map;
}

/** Pedido do site ainda na fila da balanca — nao pode ser pedido de novo. */
export function isLiveRequest(request: LineRequest | null): boolean {
  return request?.status === "pending" || request?.status === "processing";
}

/**
 * O que o "Fazer fechamento" pediria: venda com nota, sem nota emitida, nao repetida, com
 * cliente e sem pedido ainda na fila — a mesma peneira da balanca (`countBillableCandidates`)
 * mais a da `web-api`.
 */
export function isBillable(line: InvoiceClosingLine): boolean {
  return (
    line.operationType === "invoice" &&
    !line.invoiceNumber &&
    line.situation !== "billed" &&
    !line.isDuplicate &&
    Boolean(line.customerId) &&
    !isLiveRequest(line.request)
  );
}

/**
 * A etiqueta da coluna "Situacao". E a do desktop, mais o que so o site tem: o pedido de
 * faturamento que ainda esta na fila da balanca, ou que ela devolveu com erro.
 */
export function lineSituation(line: InvoiceClosingLine): {
  label: string;
  tone: "success" | "warning" | "danger" | "info";
  title: string | null;
} {
  const request = line.request;
  if (line.situation !== "billed" && request) {
    if (request.status === "pending") {
      return {
        label: "Aguardando a balanca",
        tone: "info",
        title: "Pedido de faturamento feito pelo site: a balanca da unidade fatura no OMIE."
      };
    }
    if (request.status === "processing") {
      return { label: "Faturando na balanca", tone: "info", title: request.message };
    }
    if (request.status === "failed" && !line.invoiceNumber) {
      return {
        label: "Fechamento falhou",
        tone: "danger",
        title: request.message ?? line.situationDetail
      };
    }
  }
  return {
    label: line.situationLabel,
    tone: SITUATION_TONE[line.situation],
    title: line.situationDetail
  };
}

/** As pesagens da janela larga como a deteccao de repetidas as enxerga. */
function duplicateCandidates(
  rows: readonly DuplicateSourceRow[],
  identities: Map<string, string>,
  customersById: Map<string, Customer>
): DuplicateCandidate[] {
  return rows.map((row) => ({
    operationId: row.id,
    couponNumber: row.operation_code,
    createdAt: row.created_at,
    date: localDay(row.created_at),
    customerKey: identityKeyFor(identities, row.customer_id),
    customerName: customerLabel(
      row.customer_id ? customersById.get(row.customer_id) : undefined,
      row.customer_name
    ),
    plate: (row.plate ?? "").trim(),
    productKey: row.product_id ?? `desc:${(row.product_description ?? "").trim().toUpperCase()}`,
    productDescription: (row.product_description ?? "").trim() || "N/A",
    entryWeightKg: row.entry_weight_kg,
    exitWeightKg: row.exit_weight_kg,
    totalCents: row.total_cents ?? 0,
    operationType: row.operation_type === "internal" ? "internal" : "invoice",
    invoiceNumber: (row.omie_invoice_number ?? "").trim() || null
  }));
}

/**
 * O fechamento do periodo: uma fatura por cliente (ou por cliente e placa, com o filtro de
 * placas), a lista pesagem a pesagem, as repetidas e o resumo por transportador.
 */
export function buildInvoiceClosingReport(
  source: InvoiceClosingSource,
  options: InvoiceClosingOptions
): InvoiceClosingReport {
  const customersById = new Map(source.customers.map((customer) => [customer.id, customer]));
  const identities = buildIdentityIndex(source.customers);
  const productCode = new Map((source.products ?? []).map((p) => [p.id, p.code]));
  const carrierName = new Map((source.carriers ?? []).map((c) => [c.id, c.name]));
  const vehicleCarrier = new Map(
    (source.vehicles ?? []).map((v) => [
      normalizePlate(v.plate).replace(/[\s-]/g, ""),
      v.carrier_id
    ])
  );
  const requests = latestRequests(source.billingRequests ?? []);
  const search = options.search.trim();
  const plates = [...new Set(options.plates.map(normalizePlate).filter(Boolean))];
  const selectedPlates = new Set(plates);
  const splitByPlate = plates.length > 0;
  const cycles = options.cycles.filter(isInvoiceClosingCycle);
  const customerFilter = options.customerId ? identityKeyFor(identities, options.customerId) : null;

  // Repetidas: mesma regra da balanca, sobre a janela larga, e so os grupos que tocam o periodo.
  const duplicateGroups = groupDuplicateWeighings(
    duplicateCandidates(source.duplicateRows ?? [], identities, customersById)
  ).filter((group) =>
    [...group.keepers, ...group.duplicates].some(
      (candidate) => candidate.date >= options.startDate && candidate.date <= options.endDate
    )
  );
  const duplicateKeeper = new Map<string, number | null>();
  for (const group of duplicateGroups) {
    for (const repeat of group.duplicates) {
      duplicateKeeper.set(repeat.operationId, group.keepers[0]?.couponNumber ?? null);
    }
  }

  const invoices = new Map<string, InvoiceClosingInvoice>();
  const pending = new Map<string, InvoiceClosingPendingCustomer>();
  const lines: InvoiceClosingLine[] = [];
  const rows: InvoiceClosingLine[] = [];
  const duplicateLines: InvoiceClosingLine[] = [];
  const availablePlates = new Set<string>();
  const visibleIds = new Set<string>();

  const ordered = [...source.operations]
    .filter((op) => op.status !== "cancelled")
    .sort(
      (a, b) =>
        (a.closed_at ?? a.created_at).localeCompare(b.closed_at ?? b.created_at) ||
        (a.operation_code ?? 0) - (b.operation_code ?? 0)
    );

  for (const op of ordered) {
    const identity = identityKeyFor(identities, op.customer_id);
    if (customerFilter && identity !== customerFilter) continue;
    const customer = op.customer_id ? customersById.get(op.customer_id) : undefined;
    const operationType = op.operation_type === "internal" ? "internal" : "invoice";
    const situation = resolveSituation(op);
    const rawPlate = (op.plate ?? "").trim();
    const vehicleCarrierId = rawPlate
      ? vehicleCarrier.get(rawPlate.toUpperCase().replace(/[\s-]/g, ""))
      : undefined;
    const line: InvoiceClosingLine = {
      operationId: op.id,
      customerId: op.customer_id ?? "",
      customerName: customerLabel(customer, op.customer_name),
      customerDocument: customer?.document ? formatDocument(customer.document) : null,
      couponNumber: op.operation_code,
      date: localDay(op.closed_at ?? op.created_at),
      closedAt: op.closed_at,
      closingDate: null,
      dueDate: null,
      invoiceNumber: (op.omie_invoice_number ?? "").trim() || null,
      omieSalesOrderId: op.omie_sales_order_id,
      omieServiceOrderId: op.omie_service_order_id,
      plate: rawPlate || "SEM PLACA",
      carrierName:
        op.carrier_name?.trim() ||
        (vehicleCarrierId ? carrierName.get(vehicleCarrierId)?.trim() : "") ||
        "Sem transportadora",
      driverName: op.driver_name?.trim() || "-",
      productCode: (op.product_id ? productCode.get(op.product_id)?.trim() : "") || null,
      productDescription: op.product_description?.trim() || "N/A",
      netWeightKg: op.net_weight_kg ?? 0,
      unitPriceCents: op.unit_price_cents,
      priceUnit: op.price_unit,
      productTotalCents: op.product_total_cents ?? 0,
      freightTotalCents: op.freight_total_cents ?? 0,
      totalCents: op.total_cents ?? 0,
      operationType,
      operationTypeLabel: operationType === "internal" ? "Interna" : "Com nota",
      situation,
      situationLabel: WEIGHING_BILLING_SITUATION_LABEL[situation],
      situationDetail: resolveSituationDetail(op, situation),
      isDuplicate: false,
      duplicateOfCouponNumber: null,
      request: requests.get(op.id) ?? null
    };

    if (search && !lineMatchesSearch(line, search)) continue;
    const plate = normalizePlate(line.plate);
    availablePlates.add(plate);
    if (splitByPlate && !selectedPlates.has(plate)) continue;

    const config = customer ? creditClosingConfigFromCustomer(customer) : null;
    if (
      options.basis === "customer" &&
      cycles.length > 0 &&
      (!config || !cycles.includes(config.periodicity))
    ) {
      continue;
    }

    rows.push(line);
    visibleIds.add(line.operationId);

    if (duplicateKeeper.has(line.operationId)) {
      line.isDuplicate = true;
      line.duplicateOfCouponNumber = duplicateKeeper.get(line.operationId) ?? null;
      duplicateLines.push(line);
      continue;
    }

    if (options.basis === "customer" && !config) {
      const entry = pending.get(identity) ?? {
        key: identity,
        customerName: line.customerName,
        operations: 0,
        totalCents: 0
      };
      entry.operations += 1;
      entry.totalCents += line.totalCents;
      pending.set(identity, entry);
      continue;
    }

    const schedule =
      options.basis === "period"
        ? periodSchedule(options.endDate, config)
        : computeCreditInvoiceSchedule(config as CreditClosingConfig, line.date);
    line.closingDate = schedule.closingDate;
    line.dueDate = schedule.dueDate;
    const cycle =
      options.basis === "period"
        ? options.periodCycle
        : (config as CreditClosingConfig).periodicity;
    const key = splitByPlate
      ? `${identity}|${schedule.closingDate}|${plate}`
      : `${identity}|${schedule.closingDate}`;
    const invoice = invoices.get(key) ?? {
      key,
      customerId: line.customerId,
      customerName: line.customerName,
      customerDocument: line.customerDocument,
      plate: splitByPlate ? plate : null,
      cycle,
      cycleLabel: cycle === null ? "Periodo" : INVOICE_CLOSING_CYCLE_LABEL[cycle],
      closingDate: schedule.closingDate,
      dueDate: schedule.dueDate,
      lines: [],
      totals: emptyTotals(),
      operationsWithoutInvoice: 0
    };
    invoice.lines.push(line);
    if (!invoice.customerDocument && line.customerDocument) {
      invoice.customerDocument = line.customerDocument;
    }
    if (!line.invoiceNumber) invoice.operationsWithoutInvoice += 1;
    invoices.set(key, invoice);
    lines.push(line);
  }

  const orderedInvoices = [...invoices.values()]
    .map((invoice) => ({ ...invoice, totals: buildTotals(invoice.lines) }))
    .sort(
      (a, b) =>
        a.closingDate.localeCompare(b.closingDate) ||
        a.customerName.localeCompare(b.customerName, "pt-BR") ||
        (a.plate ?? "").localeCompare(b.plate ?? "", "pt-BR")
    );

  return {
    invoices: orderedInvoices,
    rows,
    rowTotals: buildTotals(rows),
    totals: buildTotals(lines),
    duplicates: duplicateGroups
      .filter((group) =>
        [...group.keepers, ...group.duplicates].some((c) => visibleIds.has(c.operationId))
      )
      .map((group) => ({
        key: group.key,
        customerName: group.customerName,
        plate: group.plate,
        productDescription: group.productDescription,
        entryWeightKg: group.entryWeightKg,
        exitWeightKg: group.exitWeightKg,
        kept: group.keepers.map(duplicateEntry),
        repeats: group.duplicates.map(duplicateEntry),
        removedTotalCents: group.duplicates
          .filter((c) => visibleIds.has(c.operationId))
          .reduce((total, c) => total + c.totalCents, 0),
        billedMoreThanOnce: group.billedMoreThanOnce
      })),
    duplicateTotals: buildTotals(duplicateLines),
    customers: new Set(
      orderedInvoices.map((invoice) => identityKeyFor(identities, invoice.customerId || null))
    ).size,
    withoutInvoice: buildTotals(lines.filter((line) => !line.invoiceNumber)),
    byCarrier: groupByCarrier(lines),
    pendingSetup: [...pending.values()].sort((a, b) => b.totalCents - a.totalCents),
    availablePlates: [...availablePlates].sort((a, b) => a.localeCompare(b, "pt-BR"))
  };
}

function duplicateEntry(candidate: DuplicateCandidate): InvoiceClosingDuplicateEntry {
  return {
    operationId: candidate.operationId,
    couponNumber: candidate.couponNumber,
    date: candidate.date,
    totalCents: candidate.totalCents,
    invoiceNumber: candidate.invoiceNumber
  };
}

/** Busca livre por cliente, documento, placa, transportador, motorista, produto, nota ou vale. */
function lineMatchesSearch(line: InvoiceClosingLine, search: string): boolean {
  return [
    line.customerName,
    line.customerDocument ?? "",
    line.plate,
    line.carrierName,
    line.driverName,
    line.productDescription,
    line.invoiceNumber ?? "",
    line.couponNumber === null ? "" : String(line.couponNumber)
  ].some((field) => matchesSearch(field, search));
}

function groupByCarrier(lines: readonly InvoiceClosingLine[]): InvoiceClosingCarrierRow[] {
  const carriers = new Map<string, InvoiceClosingCarrierRow>();
  for (const line of lines) {
    const carrier = carriers.get(line.carrierName) ?? {
      carrierName: line.carrierName,
      trips: 0,
      netWeightKg: 0,
      freightCents: 0,
      totalCents: 0,
      plates: []
    };
    carrier.trips += 1;
    carrier.netWeightKg += line.netWeightKg;
    carrier.freightCents += line.freightTotalCents;
    carrier.totalCents += line.totalCents;
    let plate = carrier.plates.find((item) => item.plate === line.plate);
    if (!plate) {
      plate = { plate: line.plate, trips: 0, netWeightKg: 0, freightCents: 0, totalCents: 0 };
      carrier.plates.push(plate);
    }
    plate.trips += 1;
    plate.netWeightKg += line.netWeightKg;
    plate.freightCents += line.freightTotalCents;
    plate.totalCents += line.totalCents;
    carriers.set(line.carrierName, carrier);
  }
  return [...carriers.values()]
    .map((carrier) => ({
      ...carrier,
      plates: [...carrier.plates].sort(
        (a, b) => b.trips - a.trips || a.plate.localeCompare(b.plate)
      )
    }))
    .sort((a, b) => b.trips - a.trips || a.carrierName.localeCompare(b.carrierName, "pt-BR"));
}

// ---------------------------------------------------------------------------
// Planilha (o "Gerar arquivo" do desktop, em CSV que o Excel abre)
// ---------------------------------------------------------------------------

function csvCell(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** As faturas da tela, carga a carga — o mesmo conteudo do Excel da balanca. */
export function invoiceClosingCsv(report: InvoiceClosingReport, periodLabel: string): string {
  const head = [
    "Periodo",
    "Cliente",
    "CNPJ/CPF",
    "Placa da fatura",
    "Ciclo",
    "Fechamento",
    "Vencimento",
    "Data",
    "Vale",
    "Nota fiscal",
    "Pedido/OS OMIE",
    "Placa",
    "Transportador",
    "Motorista",
    "Produto",
    "Peso (kg)",
    "Preco unit.",
    "Produto (R$)",
    "Frete (R$)",
    "Total (R$)",
    "Situacao"
  ];
  const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
  const body = report.invoices.flatMap((invoice) =>
    invoice.lines.map((line) => [
      periodLabel,
      invoice.customerName,
      invoice.customerDocument ?? "",
      invoice.plate ?? "",
      invoice.cycleLabel,
      formatDayLabel(invoice.closingDate),
      formatDayLabel(invoice.dueDate),
      formatDayLabel(line.date),
      formatCouponNumber(line.couponNumber),
      line.invoiceNumber ?? (line.operationType === "internal" ? "Interna (sem NF-e)" : "Sem nota"),
      omieReference(line),
      line.plate,
      line.carrierName,
      line.driverName,
      line.productCode
        ? `${line.productCode} - ${line.productDescription}`
        : line.productDescription,
      line.netWeightKg,
      unitPriceLabel(line),
      money(line.productTotalCents),
      money(line.freightTotalCents),
      money(line.totalCents),
      line.situationLabel
    ])
  );
  return [head, ...body].map((row) => row.map(csvCell).join(";")).join("\n");
}

// ---------------------------------------------------------------------------
// Leituras da nuvem
// ---------------------------------------------------------------------------

const CLOSED_STATUSES = ["closed_local", "pending_cloud", "pending_omie", "synced", "sync_error"];
const PAGE = 1000;

/** Pesagens concluidas da janela larga (pela criacao) para a deteccao de repetidas. */
export async function loadDuplicateRows(
  companyId: string,
  startIso: string,
  endIso: string
): Promise<DuplicateSourceRow[]> {
  const rows: DuplicateSourceRow[] = [];
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .from("weighing_operations")
      .select(
        "id, operation_code, created_at, operation_type, customer_id, customer_name, product_id, product_description, plate, entry_weight_kg, exit_weight_kg, total_cents, omie_invoice_number"
      )
      .eq("company_id", companyId)
      .in("status", CLOSED_STATUSES)
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/**
 * Pedidos de faturamento das pesagens, em lotes: a quinzena inteira em um `in(...)` so
 * estouraria o tamanho do endereco da requisicao.
 */
export async function loadBillingRequests(
  companyId: string,
  operationIds: readonly string[]
): Promise<BillingRequest[]> {
  const rows: BillingRequest[] = [];
  for (let index = 0; index < operationIds.length; index += 150) {
    const chunk = operationIds.slice(index, index + 150);
    const { data, error } = await supabase
      .from("billing_requests")
      .select("*")
      .eq("company_id", companyId)
      .in("operation_id", chunk)
      .order("requested_at", { ascending: false });
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
}
