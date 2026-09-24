/**
 * Relatorio por cliente — a conta de `apps/desktop/src/services/customer-report.ts`, lida da
 * nuvem em vez do SQLite da balanca.
 *
 * Duas telas num lugar so, como no desktop: o relatorio de UM cliente (cadastro, KPIs,
 * vencimentos, produtos, materiais por dia, placas, viagens, compras por mes e, no modelo
 * completo, transporte, pagamentos, operacao a operacao e canceladas) e o resumo de TODOS os
 * clientes do periodo, um por linha, do que mais faturou para o que menos faturou.
 *
 * Regras que vem do desktop e nao podem se perder:
 *  - o periodo de dinheiro e pela data em que a pesagem FECHOU (`closed_at`, com a criacao
 *    de reserva para a pesagem antiga) — e a data que vai ao OMIE como emissao do pedido;
 *  - o cliente e o cliente REAL: o mesmo CNPJ com dois cadastros (o do OMIE e o da balanca)
 *    aparece uma vez no seletor e o relatorio le as cargas dos dois;
 *  - as parcelas que vencem no periodo vem de compras de QUALQUER data anterior, e por isso a
 *    leitura volta no tempo o prazo mais longo das condicoes de pagamento;
 *  - o agrupamento e feito sobre uma leitura so, para o detalhe e os resumos nunca divergirem.
 *
 * O que a nuvem nao tem fica de fora (ver o relatorio da tela): a hora da captura dos pesos
 * (o "Tempo" usa entrada = criacao e saida = fechamento), o parcelamento manual da pesagem e
 * o espelho de condicoes OMIE (`omie_payment_terms`) — o prazo vem do `rules_json` da
 * condicao, que e o que a nuvem guarda.
 */

import { localDay, normalizeDocument, periodToIso } from "./format";
import { supabase, type Tables } from "./supabase";

// ---------------------------------------------------------------------------------------
// Tipos (os mesmos nomes do desktop)
// ---------------------------------------------------------------------------------------

export type CustomerReportVariant = "simplified" | "complete";

export interface CustomerReportOption {
  id: string;
  name: string;
  document: string | null;
}

export interface CustomerReportCustomer {
  id: string;
  legalName: string;
  tradeName: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  creditLimitCents: number | null;
  openReceivablesCents: number;
  omieCustomerId: number | null;
  defaultPaymentTermName: string | null;
  defaultCarrierName: string | null;
}

export interface CustomerReportCustomerKey {
  id: string | null;
  name: string;
  document: string | null;
}

export interface CustomerReportOperation {
  id: string;
  couponNumber: number | null;
  date: string;
  createdAt: string;
  status: string;
  statusLabel: string;
  operationType: "invoice" | "internal";
  cancelled: boolean;
  cancelReason: string | null;
  productCode: string | null;
  productDescription: string;
  plate: string;
  driverName: string;
  carrierName: string | null;
  carrierDocument: string | null;
  freightModalityLabel: string;
  freightDestination: string | null;
  freightTotalCents: number;
  netWeightKg: number;
  minutesInside: number | null;
  unitPriceCents: number | null;
  productTotalCents: number;
  totalCents: number;
  paymentMethodName: string | null;
  paymentTermName: string | null;
  omieSalesOrderId: number | null;
  omieInvoiceNumber: string | null;
}

export interface CustomerReportTotals {
  operations: number;
  netWeightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
  avgPriceCentsPerTon: number;
  avgTicketCents: number;
  cancelledOperations: number;
}

export interface CustomerReportProductRow {
  productCode: string | null;
  productDescription: string;
  operations: number;
  netWeightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
  avgPriceCentsPerTon: number;
  dates: string[];
}

export interface CustomerReportProductDayRow {
  date: string;
  productCode: string | null;
  productDescription: string;
  operations: number;
  netWeightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
  avgPriceCentsPerTon: number;
}

export interface CustomerReportPlateRow {
  plate: string;
  driverName: string | null;
  carrierName: string | null;
  operations: number;
  netWeightKg: number;
  totalCents: number;
  avgMinutes: number;
}

export interface CustomerReportCarrierRow {
  carrierName: string;
  carrierDocument: string | null;
  operations: number;
  netWeightKg: number;
  freightCents: number;
  plates: string[];
}

export interface CustomerReportPaymentRow {
  name: string;
  operations: number;
  netWeightKg: number;
  totalCents: number;
}

export interface CustomerReportPeriodRow {
  period: string;
  operations: number;
  netWeightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
}

export type CustomerReportInstallmentSituation = "overdue" | "today" | "upcoming";

export interface CustomerReportInstallment {
  operationId: string;
  operationDate: string;
  dueDate: string;
  number: number;
  installmentCount: number;
  amountCents: number;
  situation: CustomerReportInstallmentSituation;
  productDescription: string;
  plate: string;
  paymentTermName: string | null;
  paymentMethodName: string | null;
  omieSalesOrderId: number | null;
}

export interface CustomerReportInstallmentMonthRow {
  period: string;
  installments: number;
  amountCents: number;
}

export interface CustomerReportInstallmentTotals {
  installments: number;
  amountCents: number;
  overdueInstallments: number;
  overdueCents: number;
  upcomingInstallments: number;
  upcomingCents: number;
  nextDueDate: string | null;
  nextDueCents: number;
}

export interface CustomerReport {
  customer: CustomerReportCustomer;
  startDate: string;
  endDate: string;
  totals: CustomerReportTotals;
  byProduct: CustomerReportProductRow[];
  byProductDay: CustomerReportProductDayRow[];
  byPlate: CustomerReportPlateRow[];
  tripsByPlate: CustomerReportOperation[];
  byCarrier: CustomerReportCarrierRow[];
  byPaymentMethod: CustomerReportPaymentRow[];
  byPaymentTerm: CustomerReportPaymentRow[];
  byFreightModality: CustomerReportPaymentRow[];
  byMonth: CustomerReportPeriodRow[];
  operations: CustomerReportOperation[];
  cancelledOperations: CustomerReportOperation[];
  installments: CustomerReportInstallment[];
  installmentsByMonth: CustomerReportInstallmentMonthRow[];
  installmentTotals: CustomerReportInstallmentTotals;
  referenceDate: string;
}

export interface CustomersOverviewRow {
  customer: CustomerReportCustomerKey;
  totals: CustomerReportTotals;
  installmentTotals: CustomerReportInstallmentTotals;
  byProduct: CustomerReportProductRow[];
}

export interface CustomersOverview {
  startDate: string;
  endDate: string;
  referenceDate: string;
  customers: CustomersOverviewRow[];
  totals: CustomerReportTotals;
  installmentTotals: CustomerReportInstallmentTotals;
}

// ---------------------------------------------------------------------------------------
// Periodo (os atalhos da tela)
// ---------------------------------------------------------------------------------------

export type PeriodPreset =
  | "today"
  | "7d"
  | "30d"
  | "month"
  | "lastMonth"
  | "year"
  | "next30d"
  | "next90d"
  | "custom";

export const PERIOD_OPTIONS: Array<{ id: PeriodPreset; label: string }> = [
  { id: "today", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "month", label: "Mes atual" },
  { id: "lastMonth", label: "Mes anterior" },
  { id: "year", label: "Ano atual" },
  { id: "next30d", label: "Proximos 30 dias" },
  { id: "next90d", label: "Proximos 90 dias" },
  { id: "custom", label: "Personalizado" }
];

export interface DateRange {
  start: string;
  end: string;
  label: string;
}

/** "2026-07-15" + 30 -> "2026-08-14". Devolve a entrada crua se a data for invalida. */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const base = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return isoDate;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Dias inteiros de `from` ate `to` (negativo quando `to` ja passou). */
export function daysBetweenIsoDates(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/**
 * O periodo de cada atalho, a partir de `today` (AAAA-MM-DD, no fuso da pedreira). Datas
 * personalizadas invertidas viram um periodo valido em vez de um relatorio vazio.
 */
export function resolveRange(
  preset: PeriodPreset,
  customStart: string,
  customEnd: string,
  today: string
): DateRange {
  if (preset === "custom") {
    const start = customStart || today;
    const end = customEnd || today;
    return start <= end
      ? { start, end, label: "Periodo personalizado" }
      : { start: end, end: start, label: "Periodo personalizado" };
  }
  if (preset === "today") return { start: today, end: today, label: "Hoje" };
  if (preset === "7d") {
    return { start: addDaysToIsoDate(today, -6), end: today, label: "Ultimos 7 dias" };
  }
  if (preset === "30d") {
    return { start: addDaysToIsoDate(today, -29), end: today, label: "Ultimos 30 dias" };
  }
  if (preset === "month") {
    return { start: `${today.slice(0, 7)}-01`, end: today, label: "Mes atual" };
  }
  if (preset === "year")
    return { start: `${today.slice(0, 4)}-01-01`, end: today, label: "Ano atual" };
  // Periodos futuros: nao ha carregamento a mostrar, e o objetivo e ver os dias em que o
  // cliente ainda tem parcelas a pagar.
  if (preset === "next30d" || preset === "next90d") {
    const days = preset === "next30d" ? 29 : 89;
    return {
      start: today,
      end: addDaysToIsoDate(today, days),
      label: preset === "next30d" ? "Proximos 30 dias" : "Proximos 90 dias"
    };
  }
  const lastMonthEnd = addDaysToIsoDate(`${today.slice(0, 7)}-01`, -1);
  return { start: `${lastMonthEnd.slice(0, 7)}-01`, end: lastMonthEnd, label: "Mes anterior" };
}

// ---------------------------------------------------------------------------------------
// Cliente real (cadastros duplicados)
// ---------------------------------------------------------------------------------------

export type ReportCustomerRow = Pick<
  Tables<"customers">,
  | "id"
  | "legal_name"
  | "trade_name"
  | "document"
  | "phone"
  | "email"
  | "city"
  | "state"
  | "credit_limit_cents"
  | "open_receivables_cents"
  | "omie_customer_id"
  | "default_payment_term_id"
  | "default_carrier_id"
  | "is_active"
  | "deleted_at"
>;

/**
 * A chave do cliente real (`customerIdentityKey` do desktop): o documento manda — sem jogar
 * fora as letras do CNPJ alfanumerico —, depois o codigo OMIE, e sem os dois o proprio id.
 */
export function customerIdentityKey(row: {
  id: string;
  document: string | null;
  omie_customer_id: number | null;
}): string {
  const document = normalizeDocument(row.document ?? "");
  if (document) return `doc:${document}`;
  if (row.omie_customer_id) return `omie:${row.omie_customer_id}`;
  return `id:${row.id}`;
}

function customerDisplayName(row: { trade_name: string | null; legal_name: string | null }) {
  return (row.trade_name ?? "").trim() || (row.legal_name ?? "").trim();
}

/**
 * Clientes do seletor: os ativos, UMA opcao por cliente real, por nome. Nao filtra pelo
 * periodo de proposito — cliente sem movimento gera um relatorio vazio (informacao util).
 */
export function buildCustomerOptions(
  customers: readonly ReportCustomerRow[]
): CustomerReportOption[] {
  const sorted = customers
    .filter((row) => row.deleted_at === null && row.is_active)
    .slice()
    .sort(
      (a, b) =>
        (a.trade_name ?? "").localeCompare(b.trade_name ?? "", "pt-BR", {
          sensitivity: "base"
        }) ||
        (a.legal_name ?? "").localeCompare(b.legal_name ?? "", "pt-BR", { sensitivity: "base" })
    );
  const seen = new Set<string>();
  const options: CustomerReportOption[] = [];
  for (const row of sorted) {
    const key = customerIdentityKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      id: row.id,
      name: customerDisplayName(row) || "Sem nome",
      document: row.document
    });
  }
  return options;
}

/**
 * Todos os `customers.id` do mesmo cliente real — inclusive os inativos e excluidos: a
 * pesagem antiga aponta para o cadastro da epoca, e desativar o duplicado nao pode tirar a
 * carga do relatorio.
 */
export function resolveCustomerIdGroup(
  customers: readonly ReportCustomerRow[],
  customerId: string
): string[] {
  const row = customers.find((customer) => customer.id === customerId);
  if (!row) return [customerId];
  const key = customerIdentityKey(row);
  if (key.startsWith("id:")) return [customerId];
  const ids = customers.filter((other) => customerIdentityKey(other) === key).map((c) => c.id);
  return ids.includes(customerId) ? ids : [customerId, ...ids];
}

// ---------------------------------------------------------------------------------------
// Pesagem da nuvem -> linha do relatorio
// ---------------------------------------------------------------------------------------

export type ReportOperationRow = Pick<
  Tables<"weighing_operations">,
  | "id"
  | "operation_code"
  | "status"
  | "operation_type"
  | "cancel_reason"
  | "created_at"
  | "closed_at"
  | "customer_id"
  | "customer_name"
  | "product_id"
  | "product_description"
  | "plate"
  | "driver_name"
  | "carrier_id"
  | "carrier_name"
  | "freight_type"
  | "freight_json"
  | "freight_total_cents"
  | "net_weight_kg"
  | "unit_price_cents"
  | "product_total_cents"
  | "total_cents"
  | "payment_method_id"
  | "payment_term_id"
  | "omie_sales_order_id"
  | "omie_invoice_number"
>;

const REPORT_OPERATION_COLUMNS =
  "id, operation_code, status, operation_type, cancel_reason, created_at, closed_at, " +
  "customer_id, customer_name, product_id, product_description, plate, driver_name, " +
  "carrier_id, carrier_name, freight_type, freight_json, freight_total_cents, net_weight_kg, " +
  "unit_price_cents, product_total_cents, total_cents, payment_method_id, payment_term_id, " +
  "omie_sales_order_id, omie_invoice_number";

export const CLOSED_STATUSES = [
  "closed_local",
  "pending_cloud",
  "pending_omie",
  "synced",
  "sync_error"
] as const;

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  open: "No patio",
  entry_registered: "Entrada registrada",
  loading_requested: "Carregamento solicitado",
  awaiting_exit: "Aguardando saida",
  closed_local: "Concluida (local)",
  pending_cloud: "Pendente nuvem",
  pending_omie: "Pendente OMIE",
  synced: "Sincronizada",
  sync_error: "Erro de sincronizacao",
  cancelled: "Cancelada"
};

/** Rotulo do tipo de frete (`getFreightModalityInfo` do desktop); o desconhecido e "sem frete". */
const FREIGHT_LABELS: Record<string, string> = {
  fob: "Valor na nota",
  cif: "Valor so no sistema",
  third_party: "So o transportador na nota",
  none: "Sem ocorrencia de frete",
  own_sender: "Com frete (transp. proprio da Pedreira)",
  own_recipient: "Com frete (transp. proprio do cliente)"
};

export function freightModalityLabel(key: string | null | undefined): string {
  return (key && FREIGHT_LABELS[key]) || FREIGHT_LABELS.none;
}

export function isClosedStatus(status: string): boolean {
  return (CLOSED_STATUSES as readonly string[]).includes(status);
}

/** Tabelas de apoio para dar nome ao que a pesagem so guarda como id. */
export interface ReportLookups {
  customers: readonly ReportCustomerRow[];
  products: ReadonlyArray<Pick<Tables<"products">, "id" | "code" | "description">>;
  carriers: ReadonlyArray<Pick<Tables<"carriers">, "id" | "name" | "document">>;
  paymentMethods: ReadonlyArray<Pick<Tables<"payment_methods">, "id" | "name">>;
  paymentTerms: ReadonlyArray<Pick<Tables<"payment_terms">, "id" | "name" | "rules_json">>;
}

interface IndexedLookups {
  customers: Map<string, ReportCustomerRow>;
  products: Map<string, { code: string; description: string }>;
  carriers: Map<string, { name: string; document: string | null }>;
  paymentMethods: Map<string, string>;
  paymentTerms: Map<string, { name: string; dueDays: number[] }>;
}

export function indexLookups(lookups: ReportLookups): IndexedLookups {
  return {
    customers: new Map(lookups.customers.map((row) => [row.id, row])),
    products: new Map(lookups.products.map((row) => [row.id, row])),
    carriers: new Map(lookups.carriers.map((row) => [row.id, row])),
    paymentMethods: new Map(lookups.paymentMethods.map((row) => [row.id, row.name])),
    paymentTerms: new Map(
      lookups.paymentTerms.map((row) => [
        row.id,
        { name: row.name, dueDays: dueDaysFromRules(row.rules_json) }
      ])
    )
  };
}

/**
 * Prazos (em dias) de cada parcela da condicao, lidos do `rules_json` que a nuvem guarda
 * (`installments[].dueDays`) — a mesma leitura que a balanca faz da condicao que chega pela
 * nuvem. Sem prazo legivel, a vista (0 dias).
 */
export function dueDaysFromRules(rules: unknown): number[] {
  let parsed: unknown = rules;
  if (typeof rules === "string") {
    try {
      parsed = JSON.parse(rules) as unknown;
    } catch {
      return [0];
    }
  }
  if (!parsed || typeof parsed !== "object") return [0];
  const installments = (parsed as { installments?: unknown }).installments;
  if (!Array.isArray(installments) || installments.length === 0) return [0];
  const days = installments.map((item) => Number((item as { dueDays?: unknown } | null)?.dueDays));
  return days.every((value) => Number.isInteger(value) && value >= 0) ? days : [0];
}

/** O prazo mais longo entre as condicoes: quanto a leitura das parcelas precisa voltar. */
export function maxDueDays(lookups: Pick<ReportLookups, "paymentTerms">): number {
  let max = 0;
  for (const term of lookups.paymentTerms) {
    for (const days of dueDaysFromRules(term.rules_json)) max = Math.max(max, days);
  }
  return max;
}

function parseFreightDestination(freightJson: string | null): string | null {
  if (!freightJson) return null;
  try {
    const parsed = JSON.parse(freightJson) as { destination?: string | null };
    return parsed.destination ?? null;
  } catch {
    // Regra de frete corrompida nao pode derrubar o relatorio inteiro.
    return null;
  }
}

/** Minutos da entrada (criacao) a saida (fechamento). Null sem saida. */
export function minutesBetween(entryIso: string | null, exitIso: string | null): number | null {
  if (!entryIso || !exitIso) return null;
  const entry = new Date(entryIso).getTime();
  const exit = new Date(exitIso).getTime();
  if (Number.isNaN(entry) || Number.isNaN(exit)) return null;
  const minutes = (exit - entry) / 60_000;
  return minutes >= 0 ? Math.round(minutes) : 0;
}

/** Dia da venda: o do fechamento, e a criacao para a pesagem antiga sem fechamento. */
export function operationSaleDay(row: Pick<ReportOperationRow, "closed_at" | "created_at">) {
  return localDay(row.closed_at ?? row.created_at);
}

export function readCustomerKey(
  row: Pick<ReportOperationRow, "customer_id" | "customer_name">,
  lookups: IndexedLookups
): CustomerReportCustomerKey {
  const customer = row.customer_id ? lookups.customers.get(row.customer_id) : undefined;
  const name =
    (customer ? customerDisplayName(customer) : "") ||
    (row.customer_name ?? "").trim() ||
    "Sem cliente";
  return { id: row.customer_id, name, document: customer?.document ?? null };
}

export function mapOperation(
  row: ReportOperationRow,
  lookups: IndexedLookups
): CustomerReportOperation {
  const product = row.product_id ? lookups.products.get(row.product_id) : undefined;
  const carrier = row.carrier_id ? lookups.carriers.get(row.carrier_id) : undefined;
  const invoiceNumber = (row.omie_invoice_number ?? "").trim();
  return {
    id: row.id,
    couponNumber: row.operation_code,
    date: operationSaleDay(row),
    createdAt: row.created_at,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    operationType: row.operation_type === "internal" ? "internal" : "invoice",
    cancelled: !isClosedStatus(row.status),
    cancelReason: row.cancel_reason,
    productCode: product?.code ?? null,
    productDescription:
      (product?.description ?? row.product_description ?? "").trim() ||
      (row.product_description ?? "").trim() ||
      "N/A",
    plate: (row.plate ?? "").trim() || "SEM PLACA",
    driverName: (row.driver_name ?? "").trim() || "N/A",
    carrierName: carrier?.name ?? row.carrier_name ?? null,
    carrierDocument: carrier?.document ?? null,
    freightModalityLabel: freightModalityLabel(row.freight_type),
    freightDestination: parseFreightDestination(row.freight_json),
    freightTotalCents: row.freight_total_cents ?? 0,
    netWeightKg: row.net_weight_kg ?? 0,
    minutesInside: minutesBetween(row.created_at, row.closed_at),
    unitPriceCents: row.unit_price_cents,
    productTotalCents: row.product_total_cents ?? 0,
    totalCents: row.total_cents ?? 0,
    paymentMethodName: row.payment_method_id
      ? (lookups.paymentMethods.get(row.payment_method_id) ?? null)
      : null,
    paymentTermName: row.payment_term_id
      ? (lookups.paymentTerms.get(row.payment_term_id)?.name ?? null)
      : null,
    omieSalesOrderId: row.omie_sales_order_id,
    omieInvoiceNumber: invoiceNumber || null
  };
}

// ---------------------------------------------------------------------------------------
// Parcelas
// ---------------------------------------------------------------------------------------

/**
 * Rateio do total pelas parcelas na mesma regra do pedido OMIE (percentual igual, com a
 * ultima parcela absorvendo o arredondamento para a soma bater exatamente o total).
 */
export function splitInstallmentAmounts(totalCents: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [totalCents];
  const basePercent = Math.floor(10000 / count) / 100;
  const amounts: number[] = [];
  let allocated = 0;
  for (let index = 0; index < count; index += 1) {
    if (index === count - 1) {
      amounts.push(totalCents - allocated);
      continue;
    }
    const value = Math.round((totalCents * basePercent) / 100);
    amounts.push(value);
    allocated += value;
  }
  return amounts;
}

type ScopedInstallment = CustomerReportInstallment & { customer: CustomerReportCustomerKey };

/**
 * Parcelas com vencimento DENTRO do periodo, de compras concluidas de qualquer data ate o
 * fim dele. Sem limite inferior de data da compra: uma compra de marco pode ter parcela
 * vencendo em dezembro.
 */
export function buildInstallments(
  rows: readonly ReportOperationRow[],
  lookups: IndexedLookups,
  startDate: string,
  endDate: string,
  referenceDate: string
): ScopedInstallment[] {
  const installments: ScopedInstallment[] = [];
  for (const row of rows) {
    if (!isClosedStatus(row.status)) continue;
    const baseDate = operationSaleDay(row);
    if (baseDate > endDate) continue;
    const term = row.payment_term_id ? lookups.paymentTerms.get(row.payment_term_id) : undefined;
    const dueDays = term?.dueDays ?? [0];
    const amounts = splitInstallmentAmounts(row.total_cents ?? 0, dueDays.length);
    const customer = readCustomerKey(row, lookups);
    const product = row.product_id ? lookups.products.get(row.product_id) : undefined;
    dueDays.forEach((days, index) => {
      const dueDate = addDaysToIsoDate(baseDate, days);
      if (dueDate < startDate || dueDate > endDate) return;
      const daysUntilDue = daysBetweenIsoDates(referenceDate, dueDate);
      installments.push({
        customer,
        operationId: row.id,
        operationDate: baseDate,
        dueDate,
        number: index + 1,
        installmentCount: dueDays.length,
        amountCents: amounts[index] ?? 0,
        situation: daysUntilDue < 0 ? "overdue" : daysUntilDue === 0 ? "today" : "upcoming",
        productDescription: (product?.description ?? row.product_description ?? "").trim() || "N/A",
        plate: (row.plate ?? "").trim() || "SEM PLACA",
        paymentTermName: term?.name ?? null,
        paymentMethodName: row.payment_method_id
          ? (lookups.paymentMethods.get(row.payment_method_id) ?? null)
          : null,
        omieSalesOrderId: row.omie_sales_order_id
      });
    });
  }
  return installments.sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.operationId.localeCompare(b.operationId)
  );
}

function dropCustomerKey(scoped: ScopedInstallment): CustomerReportInstallment {
  const { customer, ...installment } = scoped;
  void customer;
  return installment;
}

export function groupInstallmentsByMonth(
  installments: readonly CustomerReportInstallment[]
): CustomerReportInstallmentMonthRow[] {
  const map = new Map<string, CustomerReportInstallmentMonthRow>();
  for (const installment of installments) {
    const period = installment.dueDate.slice(0, 7);
    const row = map.get(period) ?? { period, installments: 0, amountCents: 0 };
    row.installments += 1;
    row.amountCents += installment.amountCents;
    map.set(period, row);
  }
  return [...map.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function buildInstallmentTotals(
  installments: readonly CustomerReportInstallment[]
): CustomerReportInstallmentTotals {
  const overdue = installments.filter((item) => item.situation === "overdue");
  // "A vencer" inclui as de hoje: sao as que o cliente ainda precisa pagar.
  const upcoming = installments.filter((item) => item.situation !== "overdue");
  const nextDueDate = upcoming[0]?.dueDate ?? null;
  return {
    installments: installments.length,
    amountCents: sum(installments, (item) => item.amountCents),
    overdueInstallments: overdue.length,
    overdueCents: sum(overdue, (item) => item.amountCents),
    upcomingInstallments: upcoming.length,
    upcomingCents: sum(upcoming, (item) => item.amountCents),
    nextDueDate,
    nextDueCents: nextDueDate
      ? sum(
          upcoming.filter((item) => item.dueDate === nextDueDate),
          (item) => item.amountCents
        )
      : 0
  };
}

// ---------------------------------------------------------------------------------------
// Agrupamentos (os mesmos do desktop)
// ---------------------------------------------------------------------------------------

function sum<T>(items: readonly T[], valueOf: (item: T) => number): number {
  return items.reduce((total, item) => total + valueOf(item), 0);
}

export function avgPriceCentsPerTon(valueCents: number, weightKg: number): number {
  return weightKg > 0 ? Math.round(valueCents / (weightKg / 1000)) : 0;
}

export function buildTotals(
  operations: readonly CustomerReportOperation[],
  cancelled: readonly CustomerReportOperation[]
): CustomerReportTotals {
  const netWeightKg = sum(operations, (op) => op.netWeightKg);
  const productCents = sum(operations, (op) => op.productTotalCents);
  const totalCents = sum(operations, (op) => op.totalCents);
  return {
    operations: operations.length,
    netWeightKg,
    productCents,
    freightCents: sum(operations, (op) => op.freightTotalCents),
    totalCents,
    avgPriceCentsPerTon: avgPriceCentsPerTon(productCents, netWeightKg),
    avgTicketCents: operations.length > 0 ? Math.round(totalCents / operations.length) : 0,
    cancelledOperations: cancelled.length
  };
}

function productKey(op: { productCode: string | null; productDescription: string }): string {
  return `${op.productCode ?? ""}|${op.productDescription}`;
}

export function groupByProduct(
  operations: readonly CustomerReportOperation[]
): CustomerReportProductRow[] {
  const map = new Map<string, CustomerReportProductRow & { dateSet: Set<string> }>();
  for (const op of operations) {
    const key = productKey(op);
    const row = map.get(key) ?? {
      productCode: op.productCode,
      productDescription: op.productDescription,
      operations: 0,
      netWeightKg: 0,
      productCents: 0,
      freightCents: 0,
      totalCents: 0,
      avgPriceCentsPerTon: 0,
      dates: [],
      dateSet: new Set<string>()
    };
    row.operations += 1;
    row.netWeightKg += op.netWeightKg;
    row.productCents += op.productTotalCents;
    row.freightCents += op.freightTotalCents;
    row.totalCents += op.totalCents;
    row.dateSet.add(op.date);
    map.set(key, row);
  }
  return [...map.values()]
    .map(({ dateSet, ...row }) => ({
      ...row,
      avgPriceCentsPerTon: avgPriceCentsPerTon(row.productCents, row.netWeightKg),
      dates: [...dateSet].sort()
    }))
    .sort((a, b) => b.netWeightKg - a.netWeightKg);
}

/** Material x dia, na ordem da tabela de produtos e, dentro do material, do dia mais antigo. */
export function groupByProductDay(
  operations: readonly CustomerReportOperation[]
): CustomerReportProductDayRow[] {
  const weightByProduct = new Map<string, number>();
  const map = new Map<string, CustomerReportProductDayRow>();
  for (const op of operations) {
    const product = productKey(op);
    weightByProduct.set(product, (weightByProduct.get(product) ?? 0) + op.netWeightKg);
    const key = `${product}|${op.date}`;
    const row = map.get(key) ?? {
      date: op.date,
      productCode: op.productCode,
      productDescription: op.productDescription,
      operations: 0,
      netWeightKg: 0,
      productCents: 0,
      freightCents: 0,
      totalCents: 0,
      avgPriceCentsPerTon: 0
    };
    row.operations += 1;
    row.netWeightKg += op.netWeightKg;
    row.productCents += op.productTotalCents;
    row.freightCents += op.freightTotalCents;
    row.totalCents += op.totalCents;
    map.set(key, row);
  }
  return [...map.values()]
    .map((row) => ({
      ...row,
      avgPriceCentsPerTon: avgPriceCentsPerTon(row.productCents, row.netWeightKg)
    }))
    .sort(
      (a, b) =>
        (weightByProduct.get(productKey(b)) ?? 0) - (weightByProduct.get(productKey(a)) ?? 0) ||
        a.productDescription.localeCompare(b.productDescription, "pt-BR") ||
        a.date.localeCompare(b.date)
    );
}

export function groupByPlate(
  operations: readonly CustomerReportOperation[]
): CustomerReportPlateRow[] {
  const map = new Map<
    string,
    CustomerReportPlateRow & { totalMinutes: number; minutesSamples: number }
  >();
  for (const op of operations) {
    const row = map.get(op.plate) ?? {
      plate: op.plate,
      driverName: null,
      carrierName: null,
      operations: 0,
      netWeightKg: 0,
      totalCents: 0,
      avgMinutes: 0,
      totalMinutes: 0,
      minutesSamples: 0
    };
    row.operations += 1;
    row.netWeightKg += op.netWeightKg;
    row.totalCents += op.totalCents;
    if (op.minutesInside !== null) {
      row.totalMinutes += op.minutesInside;
      row.minutesSamples += 1;
    }
    if (op.driverName !== "N/A") row.driverName = op.driverName;
    if (op.carrierName) row.carrierName = op.carrierName;
    map.set(op.plate, row);
  }
  return [...map.values()]
    .map(({ minutesSamples, totalMinutes, ...row }) => ({
      ...row,
      avgMinutes: minutesSamples > 0 ? Math.round(totalMinutes / minutesSamples) : 0
    }))
    .sort((a, b) => b.netWeightKg - a.netWeightKg || b.operations - a.operations);
}

/**
 * Viagem a viagem na ordem de placa/motorista: a placa que mais carregou primeiro e, dentro
 * dela, cada motorista com as suas viagens da mais antiga para a mais nova.
 */
export function sortTripsByPlate(
  operations: readonly CustomerReportOperation[]
): CustomerReportOperation[] {
  const weightByPlate = new Map<string, number>();
  for (const op of operations) {
    weightByPlate.set(op.plate, (weightByPlate.get(op.plate) ?? 0) + op.netWeightKg);
  }
  return [...operations].sort(
    (a, b) =>
      (weightByPlate.get(b.plate) ?? 0) - (weightByPlate.get(a.plate) ?? 0) ||
      a.plate.localeCompare(b.plate, "pt-BR") ||
      a.driverName.localeCompare(b.driverName, "pt-BR") ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id)
  );
}

export function groupByCarrier(
  operations: readonly CustomerReportOperation[]
): CustomerReportCarrierRow[] {
  const map = new Map<string, CustomerReportCarrierRow & { plateSet: Set<string> }>();
  for (const op of operations) {
    const key = op.carrierName ?? "Sem transportadora";
    const row = map.get(key) ?? {
      carrierName: key,
      carrierDocument: op.carrierDocument,
      operations: 0,
      netWeightKg: 0,
      freightCents: 0,
      plates: [],
      plateSet: new Set<string>()
    };
    row.operations += 1;
    row.netWeightKg += op.netWeightKg;
    row.freightCents += op.freightTotalCents;
    row.plateSet.add(op.plate);
    if (op.carrierDocument) row.carrierDocument = op.carrierDocument;
    map.set(key, row);
  }
  return [...map.values()]
    .map(({ plateSet, ...row }) => ({ ...row, plates: [...plateSet].sort() }))
    .sort((a, b) => b.netWeightKg - a.netWeightKg);
}

export function groupByLabel(
  operations: readonly CustomerReportOperation[],
  labelOf: (operation: CustomerReportOperation) => string
): CustomerReportPaymentRow[] {
  const map = new Map<string, CustomerReportPaymentRow>();
  for (const op of operations) {
    const name = labelOf(op);
    const row = map.get(name) ?? { name, operations: 0, netWeightKg: 0, totalCents: 0 };
    row.operations += 1;
    row.netWeightKg += op.netWeightKg;
    row.totalCents += op.totalCents;
    map.set(name, row);
  }
  return [...map.values()].sort((a, b) => b.totalCents - a.totalCents);
}

export function groupByPeriod(
  operations: readonly CustomerReportOperation[],
  periodOf: (operation: CustomerReportOperation) => string
): CustomerReportPeriodRow[] {
  const map = new Map<string, CustomerReportPeriodRow>();
  for (const op of operations) {
    const period = periodOf(op);
    const row = map.get(period) ?? {
      period,
      operations: 0,
      netWeightKg: 0,
      productCents: 0,
      freightCents: 0,
      totalCents: 0
    };
    row.operations += 1;
    row.netWeightKg += op.netWeightKg;
    row.productCents += op.productTotalCents;
    row.freightCents += op.freightTotalCents;
    row.totalCents += op.totalCents;
    map.set(period, row);
  }
  return [...map.values()].sort((a, b) => a.period.localeCompare(b.period));
}

// ---------------------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------------------

function inPeriod(date: string, startDate: string, endDate: string): boolean {
  return date >= startDate && date <= endDate;
}

export function buildCustomerHeader(
  customerId: string,
  lookups: ReportLookups
): CustomerReportCustomer {
  const row = lookups.customers.find((customer) => customer.id === customerId);
  if (!row) throw new Error("Cliente nao encontrado.");
  const term = row.default_payment_term_id
    ? lookups.paymentTerms.find((item) => item.id === row.default_payment_term_id)
    : undefined;
  const carrier = row.default_carrier_id
    ? lookups.carriers.find((item) => item.id === row.default_carrier_id)
    : undefined;
  return {
    id: row.id,
    legalName: row.legal_name,
    tradeName: row.trade_name,
    document: row.document,
    phone: row.phone,
    email: row.email,
    city: row.city,
    state: row.state,
    creditLimitCents: row.credit_limit_cents,
    openReceivablesCents: row.open_receivables_cents ?? 0,
    omieCustomerId: row.omie_customer_id,
    defaultPaymentTermName: term?.name ?? null,
    defaultCarrierName: carrier?.name ?? null
  };
}

/**
 * O relatorio de um cliente. `rows` sao as pesagens do cliente real (concluidas e
 * canceladas) do inicio da janela de parcelas ate o fim do periodo — as do periodo viram o
 * relatorio, e as concluidas de antes so entram pelas parcelas.
 */
export function buildCustomerReport(input: {
  customerId: string;
  rows: readonly ReportOperationRow[];
  lookups: ReportLookups;
  startDate: string;
  endDate: string;
  referenceDate: string;
}): CustomerReport {
  const { rows, startDate, endDate, referenceDate } = input;
  const indexed = indexLookups(input.lookups);
  const all = rows
    .filter((row) => inPeriod(operationSaleDay(row), startDate, endDate))
    .map((row) => mapOperation(row, indexed))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
  const operations = all.filter((op) => !op.cancelled);
  const cancelledOperations = all.filter((op) => op.cancelled);
  const installments = buildInstallments(rows, indexed, startDate, endDate, referenceDate).map(
    dropCustomerKey
  );
  return {
    customer: buildCustomerHeader(input.customerId, input.lookups),
    startDate,
    endDate,
    referenceDate,
    totals: buildTotals(operations, cancelledOperations),
    byProduct: groupByProduct(operations),
    byProductDay: groupByProductDay(operations),
    byPlate: groupByPlate(operations),
    tripsByPlate: sortTripsByPlate(operations),
    byCarrier: groupByCarrier(operations),
    byPaymentMethod: groupByLabel(operations, (op) => op.paymentMethodName ?? "Nao informado"),
    byPaymentTerm: groupByLabel(operations, (op) => op.paymentTermName ?? "Nao informado"),
    byFreightModality: groupByLabel(operations, (op) => op.freightModalityLabel),
    byMonth: groupByPeriod(operations, (op) => op.date.slice(0, 7)),
    operations,
    cancelledOperations,
    installments,
    installmentsByMonth: groupInstallmentsByMonth(installments),
    installmentTotals: buildInstallmentTotals(installments)
  };
}

/**
 * Resumo de todos os clientes com movimento no periodo — carregamento OU parcela vencendo
 * nele —, com as MESMAS funcoes do relatorio individual, do que mais faturou para o que menos.
 */
export function buildCustomersOverview(input: {
  rows: readonly ReportOperationRow[];
  lookups: ReportLookups;
  startDate: string;
  endDate: string;
  referenceDate: string;
}): CustomersOverview {
  const { rows, startDate, endDate, referenceDate } = input;
  const indexed = indexLookups(input.lookups);
  const buckets = new Map<
    string,
    {
      customer: CustomerReportCustomerKey;
      operations: CustomerReportOperation[];
      cancelled: CustomerReportOperation[];
      installments: CustomerReportInstallment[];
    }
  >();
  const bucketFor = (customer: CustomerReportCustomerKey) => {
    const key = customer.id ?? "";
    const existing = buckets.get(key);
    if (existing) return existing;
    const created = {
      customer,
      operations: [] as CustomerReportOperation[],
      cancelled: [] as CustomerReportOperation[],
      installments: [] as CustomerReportInstallment[]
    };
    buckets.set(key, created);
    return created;
  };

  const allOperations: CustomerReportOperation[] = [];
  const allCancelled: CustomerReportOperation[] = [];
  for (const row of rows) {
    if (!inPeriod(operationSaleDay(row), startDate, endDate)) continue;
    const operation = mapOperation(row, indexed);
    const bucket = bucketFor(readCustomerKey(row, indexed));
    if (operation.cancelled) {
      bucket.cancelled.push(operation);
      allCancelled.push(operation);
    } else {
      bucket.operations.push(operation);
      allOperations.push(operation);
    }
  }
  const installments = buildInstallments(rows, indexed, startDate, endDate, referenceDate);
  for (const { customer, ...installment } of installments) {
    bucketFor(customer).installments.push(installment);
  }

  const customers = [...buckets.values()]
    .map((bucket) => ({
      customer: bucket.customer,
      totals: buildTotals(bucket.operations, bucket.cancelled),
      installmentTotals: buildInstallmentTotals(bucket.installments),
      byProduct: groupByProduct(bucket.operations)
    }))
    .sort(
      (a, b) =>
        b.totals.totalCents - a.totals.totalCents ||
        a.customer.name.localeCompare(b.customer.name, "pt-BR")
    );

  return {
    startDate,
    endDate,
    referenceDate,
    customers,
    totals: buildTotals(allOperations, allCancelled),
    installmentTotals: buildInstallmentTotals(installments.map(dropCustomerKey))
  };
}

// ---------------------------------------------------------------------------------------
// Formatacao (a mesma da tela do desktop)
// ---------------------------------------------------------------------------------------

export const INSTALLMENT_SITUATION_LABEL: Record<CustomerReportInstallmentSituation, string> = {
  overdue: "Vencida",
  today: "Vence hoje",
  upcoming: "A vencer"
};

export const INSTALLMENT_NOTE =
  "Vencimentos calculados pela condicao de pagamento de cada operacao (mesma regra do pedido " +
  "enviado ao OMIE). A baixa dos titulos e feita no OMIE: uma parcela marcada como vencida " +
  "pode ja ter sido paga.";

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/** Toneladas com uma casa, como nos KPIs do relatorio do desktop. */
export function formatReportTons(kg: number): string {
  return `${(kg / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} t`;
}

/** Peso em quilos, so o numero: a coluna ja diz "Peso". */
export function formatKg(kg: number): string {
  return kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export function formatNumber(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

export function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}min`;
}

export function formatDayLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

export function formatMonthLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 2) return iso;
  const [year, month] = parts;
  return `${month}/${year}`;
}

export function formatDatesSummary(dates: readonly string[]): string {
  if (dates.length === 0) return "-";
  if (dates.length <= 2) return dates.map(formatDayLabel).join(", ");
  return `${formatDayLabel(dates[0])} a ${formatDayLabel(dates[dates.length - 1])} (${dates.length} dias)`;
}

export function formatCouponNumber(code: number | null): string {
  return code === null ? "-" : String(code).padStart(6, "0");
}

/** A coluna "Nota fiscal": o numero, "Sem nota" (venda com nota sem numero) ou interna. */
export function invoiceNumberText(
  invoiceNumber: string | null,
  operationType: "invoice" | "internal"
): string {
  const number = (invoiceNumber ?? "").trim();
  if (number) return number;
  return operationType === "internal" ? "Interna (sem NF-e)" : "Sem nota";
}

// ---------------------------------------------------------------------------------------
// Tabelas da tela (usadas tambem pela planilha, para tela e arquivo contarem o mesmo)
// ---------------------------------------------------------------------------------------

export interface ReportTable {
  title: string;
  headers: string[];
  rows: string[][];
  emptyMessage?: string;
  footNote?: string;
}

export function customerReportTables(
  report: CustomerReport,
  variant: CustomerReportVariant
): ReportTable[] {
  const tables: ReportTable[] = [
    {
      title: "Vencimentos no periodo",
      headers: ["Mes", "Parcelas", "Valor"],
      rows: report.installmentsByMonth.map((row) => [
        formatMonthLabel(row.period),
        formatNumber(row.installments),
        formatBRL(row.amountCents)
      ]),
      footNote: INSTALLMENT_NOTE,
      emptyMessage:
        "Nenhuma parcela vence neste periodo. Escolha datas futuras para ver os proximos vencimentos."
    },
    {
      title: "Parcelas a pagar",
      headers: [
        "Vencimento",
        "Situacao",
        "Parcela",
        "Valor",
        "Data da compra",
        "Produto",
        "Placa",
        "Condicao",
        "Forma"
      ],
      rows: report.installments.map((installment) => [
        formatDayLabel(installment.dueDate),
        INSTALLMENT_SITUATION_LABEL[installment.situation],
        `${installment.number}/${installment.installmentCount}`,
        formatBRL(installment.amountCents),
        formatDayLabel(installment.operationDate),
        installment.productDescription,
        installment.plate,
        installment.paymentTermName ?? "-",
        installment.paymentMethodName ?? "-"
      ]),
      emptyMessage: "Nenhuma parcela vence neste periodo."
    },
    {
      title: "Produtos comprados",
      headers: [
        "Produto",
        "Codigo",
        "Carregamentos",
        "Datas",
        "Peso",
        "Valor produto",
        "Preco medio",
        "Total"
      ],
      rows: report.byProduct.map((row) => [
        row.productDescription,
        row.productCode ?? "-",
        formatNumber(row.operations),
        formatDatesSummary(row.dates),
        formatKg(row.netWeightKg),
        formatBRL(row.productCents),
        `${formatBRL(row.avgPriceCentsPerTon)}/t`,
        formatBRL(row.totalCents)
      ])
    },
    {
      title: "Materiais por dia",
      headers: ["Produto", "Dia", "Carregamentos", "Peso", "Valor produto", "Preco medio", "Total"],
      rows: report.byProductDay.map((row) => [
        row.productDescription,
        formatDayLabel(row.date),
        formatNumber(row.operations),
        formatKg(row.netWeightKg),
        formatBRL(row.productCents),
        `${formatBRL(row.avgPriceCentsPerTon)}/t`,
        formatBRL(row.totalCents)
      ]),
      emptyMessage: "Nenhum carregamento neste periodo."
    },
    {
      title: "Placas",
      headers: ["Placa", "Motorista", "Transportadora", "Viagens", "Peso", "Tempo medio", "Total"],
      rows: report.byPlate.map((row) => [
        row.plate,
        row.driverName ?? "-",
        row.carrierName ?? "-",
        formatNumber(row.operations),
        formatKg(row.netWeightKg),
        formatMinutes(row.avgMinutes),
        formatBRL(row.totalCents)
      ])
    },
    {
      title: "Viagens por placa e motorista",
      headers: [
        "Placa",
        "Motorista",
        "Data",
        "Cupom",
        "Produto",
        "Peso",
        "Preco/t",
        "Produto (R$)",
        "Frete (R$)",
        "Total",
        "Nota fiscal",
        "Tempo"
      ],
      rows: report.tripsByPlate.map((operation) => [
        operation.plate,
        operation.driverName,
        formatDayLabel(operation.date),
        formatCouponNumber(operation.couponNumber),
        operation.productDescription,
        formatKg(operation.netWeightKg),
        operation.unitPriceCents === null ? "-" : formatBRL(operation.unitPriceCents),
        formatBRL(operation.productTotalCents),
        formatBRL(operation.freightTotalCents),
        formatBRL(operation.totalCents),
        invoiceNumberText(operation.omieInvoiceNumber, operation.operationType),
        operation.minutesInside === null ? "-" : formatMinutes(operation.minutesInside)
      ]),
      emptyMessage: "Nenhuma viagem neste periodo."
    },
    {
      title: "Compras por mes",
      headers: ["Mes", "Carregamentos", "Peso", "Produto", "Frete", "Total"],
      rows: report.byMonth.map((row) => [
        formatMonthLabel(row.period),
        formatNumber(row.operations),
        formatKg(row.netWeightKg),
        formatBRL(row.productCents),
        formatBRL(row.freightCents),
        formatBRL(row.totalCents)
      ])
    }
  ];
  if (variant !== "complete") return tables;

  tables.push(
    {
      title: "Transporte por transportadora",
      headers: ["Transportadora", "CNPJ / CPF", "Viagens", "Peso", "Frete", "Placas"],
      rows: report.byCarrier.map((row) => [
        row.carrierName,
        row.carrierDocument ?? "-",
        formatNumber(row.operations),
        formatKg(row.netWeightKg),
        formatBRL(row.freightCents),
        row.plates.join(", ") || "-"
      ])
    },
    {
      title: "Tipos de frete",
      headers: ["Tipo de frete", "Carregamentos", "Peso", "Total"],
      rows: paymentRows(report.byFreightModality)
    },
    {
      title: "Pagamentos por forma",
      headers: ["Forma de pagamento", "Carregamentos", "Peso", "Total"],
      rows: paymentRows(report.byPaymentMethod)
    },
    {
      title: "Pagamentos por condicao",
      headers: ["Condicao de pagamento", "Carregamentos", "Peso", "Total"],
      rows: paymentRows(report.byPaymentTerm)
    },
    {
      title: "Operacoes (detalhado)",
      headers: [
        "Data",
        "Cupom",
        "Produto",
        "Placa",
        "Motorista",
        "Transportadora",
        "Frete",
        "Liquido",
        "Tempo",
        "Preco/t",
        "Produto",
        "Frete (R$)",
        "Total",
        "Forma",
        "Condicao",
        "Nota fiscal",
        "Pedido OMIE",
        "Status"
      ],
      rows: report.operations.map((operation) => [
        formatDayLabel(operation.date),
        formatCouponNumber(operation.couponNumber),
        operation.productDescription,
        operation.plate,
        operation.driverName,
        operation.carrierName ?? "-",
        [operation.freightModalityLabel, operation.freightDestination].filter(Boolean).join(" - "),
        formatKg(operation.netWeightKg),
        operation.minutesInside === null ? "-" : formatMinutes(operation.minutesInside),
        operation.unitPriceCents === null ? "-" : formatBRL(operation.unitPriceCents),
        formatBRL(operation.productTotalCents),
        formatBRL(operation.freightTotalCents),
        formatBRL(operation.totalCents),
        operation.paymentMethodName ?? "-",
        operation.paymentTermName ?? "-",
        invoiceNumberText(operation.omieInvoiceNumber, operation.operationType),
        operation.omieSalesOrderId === null ? "-" : String(operation.omieSalesOrderId),
        operation.statusLabel
      ])
    },
    {
      title: "Operacoes canceladas",
      headers: ["Data", "Cupom", "Produto", "Placa", "Motorista", "Liquido", "Motivo"],
      rows: report.cancelledOperations.map((operation) => [
        formatDayLabel(operation.date),
        formatCouponNumber(operation.couponNumber),
        operation.productDescription,
        operation.plate,
        operation.driverName,
        formatKg(operation.netWeightKg),
        operation.cancelReason ?? "-"
      ])
    }
  );
  return tables;
}

function paymentRows(rows: readonly CustomerReportPaymentRow[]): string[][] {
  return rows.map((row) => [
    row.name,
    formatNumber(row.operations),
    formatKg(row.netWeightKg),
    formatBRL(row.totalCents)
  ]);
}

export function overviewTables(overview: CustomersOverview): ReportTable[] {
  const { totals, installmentTotals } = overview;
  return [
    {
      title: "Clientes no periodo",
      headers: [
        "Cliente",
        "Carregamentos",
        "Tonelagem",
        "Preco medio/t",
        "Total comprado",
        "A vencer",
        "Vencidas"
      ],
      rows:
        overview.customers.length === 0
          ? []
          : [
              ...overview.customers.map((row) => [
                row.customer.document
                  ? `${row.customer.name} - ${row.customer.document}`
                  : row.customer.name,
                formatNumber(row.totals.operations),
                formatReportTons(row.totals.netWeightKg),
                formatBRL(row.totals.avgPriceCentsPerTon),
                formatBRL(row.totals.totalCents),
                formatBRL(row.installmentTotals.upcomingCents),
                formatBRL(row.installmentTotals.overdueCents)
              ]),
              [
                "TOTAL",
                formatNumber(totals.operations),
                formatReportTons(totals.netWeightKg),
                formatBRL(totals.avgPriceCentsPerTon),
                formatBRL(totals.totalCents),
                formatBRL(installmentTotals.upcomingCents),
                formatBRL(installmentTotals.overdueCents)
              ]
            ],
      emptyMessage: "Nenhum cliente com movimento no periodo.",
      footNote: INSTALLMENT_NOTE
    },
    {
      title: "Materiais por cliente",
      headers: [
        "Cliente",
        "Produto",
        "Codigo",
        "Carregamentos",
        "Datas",
        "Peso",
        "Preco medio/t",
        "Total"
      ],
      rows: overview.customers.flatMap((row) =>
        row.byProduct.map((product) => [
          row.customer.name,
          product.productDescription,
          product.productCode ?? "-",
          formatNumber(product.operations),
          formatDatesSummary(product.dates),
          formatKg(product.netWeightKg),
          formatBRL(product.avgPriceCentsPerTon),
          formatBRL(product.totalCents)
        ])
      ),
      emptyMessage: "Nenhum carregamento no periodo."
    }
  ];
}

// ---------------------------------------------------------------------------------------
// Planilha (o "Excel" do site: CSV com `;`, que o Excel abre direto)
// ---------------------------------------------------------------------------------------

function csvLine(cells: readonly string[]): string {
  return cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(";");
}

export function tablesToCsv(header: string[][], tables: readonly ReportTable[]): string {
  const lines: string[] = header.map(csvLine);
  for (const table of tables) {
    lines.push("", csvLine([table.title]), csvLine(table.headers));
    if (table.rows.length === 0)
      lines.push(csvLine([table.emptyMessage ?? "Sem dados no periodo."]));
    for (const row of table.rows) lines.push(csvLine(row));
    if (table.footNote) lines.push(csvLine([table.footNote]));
  }
  return lines.join("\n");
}

function slug(text: string, fallback: string): string {
  const value = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return value || fallback;
}

export function customerReportFileBaseName(
  report: CustomerReport,
  variant: CustomerReportVariant
): string {
  const name = slug(report.customer.tradeName || report.customer.legalName, "cliente");
  return `relatorio-cliente-${name}-${variant === "complete" ? "completo" : "simplificado"}-${report.startDate}-a-${report.endDate}`;
}

export function customerReportCsv(
  report: CustomerReport,
  variant: CustomerReportVariant,
  periodLabel: string
): string {
  const { customer, totals, installmentTotals: dues } = report;
  return tablesToCsv(
    [
      [`Relatorio por cliente - ${variant === "complete" ? "completo" : "simplificado"}`],
      ["Cliente", customer.tradeName || customer.legalName],
      ["Razao social", customer.legalName || "-"],
      ["CNPJ / CPF", customer.document ?? "-"],
      [
        "Periodo",
        `${periodLabel}: ${formatDayLabel(report.startDate)} a ${formatDayLabel(report.endDate)}`
      ],
      ["Carregamentos", formatNumber(totals.operations)],
      ["Tonelagem", formatReportTons(totals.netWeightKg)],
      ["Total comprado", formatBRL(totals.totalCents)],
      ["Titulos em aberto", formatBRL(customer.openReceivablesCents)],
      ["A vencer no periodo", formatBRL(dues.upcomingCents)],
      ["Vencidas no periodo", formatBRL(dues.overdueCents)]
    ],
    customerReportTables(report, variant)
  );
}

export function overviewCsv(overview: CustomersOverview, periodLabel: string): string {
  return tablesToCsv(
    [
      ["Relatorio por cliente - todos os clientes"],
      [
        "Periodo",
        `${periodLabel}: ${formatDayLabel(overview.startDate)} a ${formatDayLabel(overview.endDate)}`
      ]
    ],
    overviewTables(overview)
  );
}

// ---------------------------------------------------------------------------------------
// Leitura da nuvem
// ---------------------------------------------------------------------------------------

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

const PAGE = 1000;

async function readAll<T>(
  query: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await query(page * PAGE, page * PAGE + PAGE - 1);
    fail(error);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/**
 * Cadastros de apoio do relatorio. Clientes, transportadoras, formas e condicoes vem TODOS,
 * inclusive inativos e excluidos: a pesagem antiga aponta para o cadastro da epoca.
 */
export async function loadReportLookups(companyId: string): Promise<ReportLookups> {
  const [customers, products, carriers, paymentMethods, paymentTerms] = await Promise.all([
    readAll<ReportCustomerRow>((from, to) =>
      supabase
        .from("customers")
        .select(
          "id, legal_name, trade_name, document, phone, email, city, state, credit_limit_cents, " +
            "open_receivables_cents, omie_customer_id, default_payment_term_id, " +
            "default_carrier_id, is_active, deleted_at"
        )
        .eq("company_id", companyId)
        .order("id")
        .range(from, to)
        .returns<ReportCustomerRow[]>()
    ),
    readAll<ReportLookups["products"][number]>((from, to) =>
      supabase
        .from("products")
        .select("id, code, description")
        .eq("company_id", companyId)
        .order("id")
        .range(from, to)
    ),
    readAll<ReportLookups["carriers"][number]>((from, to) =>
      supabase
        .from("carriers")
        .select("id, name, document")
        .eq("company_id", companyId)
        .order("id")
        .range(from, to)
    ),
    readAll<ReportLookups["paymentMethods"][number]>((from, to) =>
      supabase
        .from("payment_methods")
        .select("id, name")
        .eq("company_id", companyId)
        .order("id")
        .range(from, to)
    ),
    readAll<ReportLookups["paymentTerms"][number]>((from, to) =>
      supabase
        .from("payment_terms")
        .select("id, name, rules_json")
        .eq("company_id", companyId)
        .order("id")
        .range(from, to)
    )
  ]);
  return { customers, products, carriers, paymentMethods, paymentTerms };
}

/**
 * Pesagens concluidas e canceladas da unidade cuja data de venda (fechamento, ou criacao na
 * pesagem antiga) cai entre `startDay - lookbackDays` e `endDay`. A volta no tempo e o prazo
 * mais longo das condicoes: e o que basta para achar toda parcela que vence no periodo.
 * `customerIds` nulo le todos os clientes (o resumo do periodo).
 */
export async function loadReportOperations(input: {
  companyId: string;
  unitId: string;
  customerIds: string[] | null;
  startDay: string;
  endDay: string;
  lookbackDays: number;
}): Promise<ReportOperationRow[]> {
  const { startIso, endIso } = periodToIso(
    addDaysToIsoDate(input.startDay, -Math.max(0, input.lookbackDays)),
    input.endDay
  );
  return readAll<ReportOperationRow>((from, to) => {
    let query = supabase
      .from("weighing_operations")
      .select(REPORT_OPERATION_COLUMNS)
      .eq("company_id", input.companyId)
      .eq("unit_id", input.unitId)
      .in("status", [...CLOSED_STATUSES, "cancelled"]);
    if (input.customerIds) query = query.in("customer_id", input.customerIds);
    return query
      .or(
        [
          `and(closed_at.gte."${startIso}",closed_at.lt."${endIso}")`,
          `and(closed_at.is.null,created_at.gte."${startIso}",created_at.lt."${endIso}")`
        ].join(",")
      )
      .order("id")
      .range(from, to)
      .returns<ReportOperationRow[]>();
  });
}
