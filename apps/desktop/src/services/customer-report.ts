import type { DesktopDatabase } from "../database/sqlite.js";
import { getFreightModalityInfo } from "./freight.js";
import type { FreightModality, FreightRule } from "./freight.js";
import {
  CLOSED_OPERATION_STATUS_SQL_LIST,
  isClosedOperationStatus
} from "./weighing-operations.js";

/**
 * Relatorio por cliente: todos os dados das operacoes de um cliente num periodo
 * (transporte, compras, pagamentos, produtos, tonelagem e placas), em duas versoes:
 *
 * - `simplified`: os dados principais (cabecalho do cliente, KPIs, produtos, placas
 *   e evolucao mensal) — o que o dono olha no dia a dia.
 * - `complete`: tudo do simplificado + transportadoras, pagamentos, evolucao diaria,
 *   a lista operacao a operacao com pesos/precos/frete/OMIE e as canceladas.
 *
 * O agrupamento e feito em TypeScript sobre uma unica leitura das operacoes: o volume
 * por cliente/periodo e pequeno e assim as somas do detalhe e dos resumos nunca divergem.
 */
export type CustomerReportVariant = "simplified" | "complete";

export const CUSTOMER_REPORT_VARIANTS: readonly CustomerReportVariant[] = [
  "simplified",
  "complete"
];

export function isCustomerReportVariant(value: unknown): value is CustomerReportVariant {
  return value === "simplified" || value === "complete";
}

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
  addressLine: string | null;
  city: string | null;
  state: string | null;
  creditLimitCents: number | null;
  openReceivablesCents: number;
  omieCustomerId: number | null;
  defaultPaymentTermName: string | null;
  defaultCarrierName: string | null;
}

export interface CustomerReportOperation {
  id: string;
  date: string;
  createdAt: string;
  status: string;
  statusLabel: string;
  operationType: "invoice" | "internal";
  operationTypeLabel: string;
  cancelled: boolean;
  cancelReason: string | null;
  productCode: string | null;
  productDescription: string;
  productUnit: string | null;
  plate: string;
  vehicleDescription: string | null;
  driverName: string;
  driverDocument: string | null;
  carrierName: string | null;
  carrierDocument: string | null;
  freightModality: FreightModality;
  freightModalityLabel: string;
  freightRuleName: string | null;
  freightDestination: string | null;
  freightDistanceKm: number | null;
  freightTotalCents: number;
  entryWeightKg: number | null;
  exitWeightKg: number | null;
  netWeightKg: number;
  entryAt: string | null;
  exitAt: string | null;
  minutesInside: number | null;
  unitPriceCents: number | null;
  baseUnitPriceCents: number | null;
  priceTableName: string | null;
  priceSavingsPercent: number | null;
  productTotalCents: number;
  totalCents: number;
  paymentMethodName: string | null;
  paymentTermName: string | null;
  installments: number | null;
  downPaymentCents: number | null;
  omieSalesOrderId: number | null;
  omieBillingStatus: string | null;
  omieBilledAt: string | null;
  omieDocumentUrl: string | null;
  cloudSyncedAt: string | null;
  omieSyncedAt: string | null;
}

export interface CustomerReportTotals {
  operations: number;
  netWeightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
  avgPriceCentsPerTon: number;
  avgTicketCents: number;
  avgNetWeightKg: number;
  invoiceOperations: number;
  internalOperations: number;
  cancelledOperations: number;
  cancelledNetWeightKg: number;
  firstOperationDate: string | null;
  lastOperationDate: string | null;
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
}

export interface CustomerReportPlateRow {
  plate: string;
  driverName: string | null;
  carrierName: string | null;
  operations: number;
  netWeightKg: number;
  totalCents: number;
  totalMinutes: number;
  avgMinutes: number;
  lastOperationAt: string | null;
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

/**
 * Situacao do vencimento em relacao ao dia de referencia (hoje). A BAIXA (pagamento
 * efetivo) e controlada no OMIE, nao aqui — "vencida" significa apenas que a data ja
 * passou, nao que o cliente esta inadimplente.
 */
export type CustomerReportInstallmentSituation = "overdue" | "today" | "upcoming";

export interface CustomerReportInstallment {
  operationId: string;
  /** Data da operacao que originou a parcela (saida da balanca, ou criacao). */
  operationDate: string;
  /** Data de vencimento calculada (YYYY-MM-DD). */
  dueDate: string;
  /** Numero da parcela dentro da operacao (1-based) e o total de parcelas dela. */
  number: number;
  installmentCount: number;
  amountCents: number;
  situation: CustomerReportInstallmentSituation;
  /** Dias ate o vencimento (negativo quando ja venceu). */
  daysUntilDue: number;
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
  periodLabel: string | null;
  totals: CustomerReportTotals;
  byProduct: CustomerReportProductRow[];
  byPlate: CustomerReportPlateRow[];
  byCarrier: CustomerReportCarrierRow[];
  byPaymentMethod: CustomerReportPaymentRow[];
  byPaymentTerm: CustomerReportPaymentRow[];
  byFreightModality: CustomerReportPaymentRow[];
  byDay: CustomerReportPeriodRow[];
  byMonth: CustomerReportPeriodRow[];
  operations: CustomerReportOperation[];
  cancelledOperations: CustomerReportOperation[];
  /**
   * Parcelas com vencimento DENTRO do periodo, vindas de operacoes de qualquer data
   * (inclusive anteriores ao periodo). E o que permite pedir um periodo futuro e ver
   * os dias em que o cliente ainda tem parcelas a pagar.
   */
  installments: CustomerReportInstallment[];
  installmentsByMonth: CustomerReportInstallmentMonthRow[];
  installmentTotals: CustomerReportInstallmentTotals;
  /** Dia usado para classificar vencida/hoje/a vencer. */
  referenceDate: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
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

interface CustomerRow {
  id: string;
  legal_name: string;
  trade_name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  address_street: string | null;
  address_number: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  credit_limit_cents: number | null;
  open_receivables_cents: number | null;
  omie_customer_id: number | null;
  payment_term_name: string | null;
  carrier_name: string | null;
}

interface OperationRow {
  id: string;
  status: string;
  operation_type: "invoice" | "internal";
  cancel_reason: string | null;
  created_at: string;
  product_code: string | null;
  product_description: string | null;
  product_unit: string | null;
  plate: string | null;
  vehicle_description: string | null;
  driver_name: string | null;
  driver_document: string | null;
  carrier_name: string | null;
  carrier_document: string | null;
  freight_type: string | null;
  freight_json: string | null;
  freight_total_cents: number | null;
  entry_weight_kg: number | null;
  exit_weight_kg: number | null;
  net_weight_kg: number | null;
  entry_at: string | null;
  exit_at: string | null;
  unit_price_cents: number | null;
  base_unit_price_cents: number | null;
  applied_price_table_name: string | null;
  price_savings_percent: number | null;
  product_total_cents: number | null;
  total_cents: number | null;
  payment_method_name: string | null;
  payment_term_name: string | null;
  manual_installments: number | null;
  manual_down_payment_cents: number | null;
  omie_sales_order_id: number | null;
  omie_billing_status: string | null;
  omie_billed_at: string | null;
  omie_document_url: string | null;
  cloud_synced_at: string | null;
  omie_synced_at: string | null;
}

export class CustomerReportService {
  constructor(private readonly db: DesktopDatabase) {}

  /**
   * Clientes que podem entrar no relatorio: os ativos da unidade, ordenados por nome.
   * Nao filtra pelo periodo de propósito — o usuario escolhe o cliente antes do periodo
   * e um cliente sem movimento no periodo gera um relatorio vazio (informacao util).
   */
  listCustomerOptions(unitId: string): CustomerReportOption[] {
    const rows = this.db
      .prepare(
        `SELECT c.id as id, c.trade_name as trade_name, c.legal_name as legal_name, c.document as document
         FROM customers c
         WHERE c.deleted_at IS NULL
           AND c.is_active = 1
           AND c.company_id = (SELECT company_id FROM units WHERE id = ?)
         ORDER BY c.trade_name COLLATE NOCASE, c.legal_name COLLATE NOCASE`
      )
      .all(unitId) as Array<{
      id: string;
      trade_name: string | null;
      legal_name: string | null;
      document: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: (row.trade_name ?? "").trim() || (row.legal_name ?? "").trim() || "Sem nome",
      document: row.document
    }));
  }

  getCustomerReport(
    customerId: string,
    startDate: string,
    endDate: string,
    unitId: string,
    periodLabel?: string | null,
    now: Date = new Date()
  ): CustomerReport {
    const customer = this.loadCustomer(customerId);
    const rows = this.loadOperations(customerId, startDate, endDate, unitId);

    const all = rows.map((row) => mapOperation(row));
    const operations = all.filter((operation) => !operation.cancelled);
    const cancelledOperations = all.filter((operation) => operation.cancelled);

    const referenceDate = toLocalIsoDate(now);
    const installments = this.loadInstallments(
      customerId,
      startDate,
      endDate,
      unitId,
      referenceDate
    );

    return {
      installments,
      installmentsByMonth: groupInstallmentsByMonth(installments),
      installmentTotals: buildInstallmentTotals(installments),
      referenceDate,
      customer,
      startDate,
      endDate,
      periodLabel: periodLabel ?? null,
      totals: buildTotals(operations, cancelledOperations),
      byProduct: groupByProduct(operations),
      byPlate: groupByPlate(operations),
      byCarrier: groupByCarrier(operations),
      byPaymentMethod: groupByLabel(operations, (op) => op.paymentMethodName ?? "Nao informado"),
      byPaymentTerm: groupByLabel(operations, (op) => op.paymentTermName ?? "Nao informado"),
      byFreightModality: groupByLabel(operations, (op) => op.freightModalityLabel),
      byDay: groupByPeriod(operations, (op) => op.date),
      byMonth: groupByPeriod(operations, (op) => op.date.slice(0, 7)),
      operations,
      cancelledOperations
    };
  }

  private loadCustomer(customerId: string): CustomerReportCustomer {
    const row = this.db
      .prepare(
        `SELECT
           c.id, c.legal_name, c.trade_name, c.document, c.phone, c.email,
           c.address_street, c.address_number, c.neighborhood, c.city, c.state,
           c.credit_limit_cents, c.open_receivables_cents, c.omie_customer_id,
           pt.name as payment_term_name,
           ca.name as carrier_name
         FROM customers c
         LEFT JOIN payment_terms pt ON pt.id = c.default_payment_term_id
         LEFT JOIN carriers ca ON ca.id = c.default_carrier_id
         WHERE c.id = ?`
      )
      .get(customerId) as CustomerRow | undefined;

    if (!row) {
      throw new Error("Cliente nao encontrado.");
    }

    const street = [row.address_street, row.address_number].filter(Boolean).join(", ");
    const addressLine = [street, row.neighborhood].filter(Boolean).join(" - ") || null;

    return {
      id: row.id,
      legalName: row.legal_name,
      tradeName: row.trade_name,
      document: row.document,
      phone: row.phone,
      email: row.email,
      addressLine,
      city: row.city,
      state: row.state,
      creditLimitCents: row.credit_limit_cents,
      openReceivablesCents: row.open_receivables_cents ?? 0,
      omieCustomerId: row.omie_customer_id,
      defaultPaymentTermName: row.payment_term_name,
      defaultCarrierName: row.carrier_name
    };
  }

  private loadOperations(
    customerId: string,
    startDate: string,
    endDate: string,
    unitId: string
  ): OperationRow[] {
    return this.db
      .prepare(
        `SELECT
           o.id, o.status, o.operation_type, o.cancel_reason, o.created_at,
           p.code as product_code,
           COALESCE(p.description, o.remote_product_description) as product_description,
           p.unit as product_unit,
           COALESCE(v.plate, o.remote_plate) as plate, v.description as vehicle_description,
           COALESCE(d.name, o.remote_driver_name) as driver_name, d.document as driver_document,
           ca.name as carrier_name, ca.document as carrier_document,
           o.freight_type, o.freight_json, o.freight_total_cents,
           o.entry_weight_kg, o.exit_weight_kg, o.net_weight_kg,
           o.entry_weight_captured_at as entry_at, o.exit_weight_captured_at as exit_at,
           o.unit_price_cents, o.base_unit_price_cents, o.applied_price_table_name,
           o.price_savings_percent, o.product_total_cents, o.total_cents,
           pm.name as payment_method_name, pt.name as payment_term_name,
           o.manual_installments, o.manual_down_payment_cents,
           o.omie_sales_order_id, o.omie_billing_status, o.omie_billed_at, o.omie_document_url,
           o.cloud_synced_at, o.omie_synced_at
         FROM weighing_operations o
         LEFT JOIN products p ON p.id = o.product_id
         LEFT JOIN vehicles v ON v.id = o.vehicle_id
         LEFT JOIN drivers d ON d.id = o.driver_id
         LEFT JOIN carriers ca ON ca.id = o.carrier_id
         LEFT JOIN payment_methods pm ON pm.id = o.payment_method_id
         LEFT JOIN payment_terms pt ON pt.id = o.payment_term_id
         WHERE o.unit_id = ?
           AND o.customer_id = ?
           AND o.deleted_at IS NULL
           AND o.status IN (${CLOSED_OPERATION_STATUS_SQL_LIST}, 'cancelled')
           AND date(o.created_at) >= date(?)
           AND date(o.created_at) <= date(?)
         ORDER BY o.created_at ASC`
      )
      .all(unitId, customerId, startDate, endDate) as OperationRow[];
  }

  /**
   * Parcelas que vencem no periodo. Le TODAS as operacoes concluidas do cliente ate o
   * fim do periodo (sem limite inferior): uma compra de marco pode ter parcela vencendo
   * em dezembro, e essa parcela precisa aparecer quando o usuario pede dezembro. Sem
   * limite superior de data de operacao porque uma operacao posterior ao periodo so
   * geraria vencimentos posteriores ainda.
   */
  private loadInstallments(
    customerId: string,
    startDate: string,
    endDate: string,
    unitId: string,
    referenceDate: string
  ): CustomerReportInstallment[] {
    const rows = this.db
      .prepare(
        `SELECT
           o.id, o.created_at, o.exit_weight_captured_at as exit_at,
           o.total_cents, o.manual_installments, o.omie_sales_order_id,
           COALESCE(p.description, o.remote_product_description) as product_description,
           COALESCE(v.plate, o.remote_plate) as plate,
           pm.name as payment_method_name,
           pt.name as payment_term_name,
           COALESCE(opt.installment_days_json, pt.installment_days_json) as term_days_json,
           COALESCE(opt.first_installment_days, pt.first_installment_days) as term_first_days,
           COALESCE(opt.installment_interval_days, pt.installment_interval_days) as term_interval_days,
           COALESCE(opt.installment_count, pt.installment_count) as term_count
         FROM weighing_operations o
         LEFT JOIN products p ON p.id = o.product_id
         LEFT JOIN vehicles v ON v.id = o.vehicle_id
         LEFT JOIN payment_methods pm ON pm.id = o.payment_method_id
         LEFT JOIN payment_terms pt ON pt.id = o.payment_term_id
         LEFT JOIN omie_payment_terms opt
           ON opt.company_id = pt.company_id
          AND opt.code = pt.omie_parcela_code
          AND opt.is_active = 1
         WHERE o.unit_id = ?
           AND o.customer_id = ?
           AND o.deleted_at IS NULL
           AND o.status IN (${CLOSED_OPERATION_STATUS_SQL_LIST})
           AND date(COALESCE(o.exit_weight_captured_at, o.created_at)) <= date(?)
         ORDER BY o.created_at ASC`
      )
      .all(unitId, customerId, endDate) as InstallmentSourceRow[];

    const installments: CustomerReportInstallment[] = [];
    for (const row of rows) {
      const baseDate = (row.exit_at ?? row.created_at).slice(0, 10);
      const dueDays = resolveInstallmentDueDays(row);
      const amounts = splitInstallmentAmounts(row.total_cents ?? 0, dueDays.length);

      dueDays.forEach((days, index) => {
        const dueDate = addDaysToIsoDate(baseDate, days);
        if (dueDate < startDate || dueDate > endDate) return;
        const daysUntilDue = daysBetweenIsoDates(referenceDate, dueDate);
        installments.push({
          operationId: row.id,
          operationDate: baseDate,
          dueDate,
          number: index + 1,
          installmentCount: dueDays.length,
          amountCents: amounts[index],
          situation: daysUntilDue < 0 ? "overdue" : daysUntilDue === 0 ? "today" : "upcoming",
          daysUntilDue,
          productDescription: (row.product_description ?? "").trim() || "N/A",
          plate: (row.plate ?? "").trim() || "SEM PLACA",
          paymentTermName: resolveInstallmentTermName(row),
          paymentMethodName: row.payment_method_name,
          omieSalesOrderId: row.omie_sales_order_id
        });
      });
    }

    return installments.sort(
      (a, b) => a.dueDate.localeCompare(b.dueDate) || a.operationId.localeCompare(b.operationId)
    );
  }
}

interface InstallmentSourceRow {
  id: string;
  created_at: string;
  exit_at: string | null;
  total_cents: number | null;
  manual_installments: number | null;
  omie_sales_order_id: number | null;
  product_description: string | null;
  plate: string | null;
  payment_method_name: string | null;
  payment_term_name: string | null;
  term_days_json: string | null;
  term_first_days: number | null;
  term_interval_days: number | null;
  term_count: number | null;
}

/**
 * Dias de vencimento de cada parcela, na MESMA regra que o pedido enviado ao OMIE
 * (`resolveInstallmentDays` em weighing-operations + `orderDueDays` na edge omie-sync):
 * dias explicitos da condicao; senao primeiro dia + intervalo x quantidade; senao a
 * quantidade de parcelas (manual da operacao tem precedencia, como no rotulo da lista
 * de operacoes) em intervalos mensais de 30 dias; sem nada disso, a vista (0 dias).
 */
function resolveInstallmentDueDays(row: InstallmentSourceRow): number[] {
  if (row.term_days_json) {
    try {
      const parsed = JSON.parse(row.term_days_json) as unknown;
      if (Array.isArray(parsed)) {
        const days = parsed
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 0);
        if (days.length > 0) return days;
      }
    } catch {
      // Condicao com JSON invalido: cai na derivacao abaixo.
    }
  }

  const termCount = row.term_count;
  const first = row.term_first_days;
  if (termCount && termCount >= 1 && first !== null && first >= 0) {
    const interval = row.term_interval_days ?? 0;
    return Array.from({ length: termCount }, (_, index) => first + index * interval);
  }

  const count = row.manual_installments ?? termCount ?? 1;
  if (!Number.isInteger(count) || count <= 1) return [0];
  return Array.from({ length: count }, (_, index) => MONTHLY_INSTALLMENT_DAYS * (index + 1));
}

/** Rotulo da condicao: parcelamento manual tem precedencia sobre a condicao cadastrada. */
function resolveInstallmentTermName(row: InstallmentSourceRow): string | null {
  if (row.manual_installments === 1) return "1 parcela";
  if (row.manual_installments && row.manual_installments > 1) {
    return `${row.manual_installments} parcelas`;
  }
  return row.payment_term_name;
}

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

/** Numero de dias tratado como "1 mes" quando so ha a quantidade de parcelas. */
const MONTHLY_INSTALLMENT_DAYS = 30;

/** "2026-07-15" + 30 -> "2026-08-14". Devolve a entrada crua se a data for invalida. */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const base = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return isoDate;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Dias inteiros de `from` ate `to` (negativo quando `to` ja passou). */
function daysBetweenIsoDates(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

/** Data local (nao UTC) em ISO — o vencimento e comparado com o dia do operador. */
function toLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function groupInstallmentsByMonth(
  installments: CustomerReportInstallment[]
): CustomerReportInstallmentMonthRow[] {
  const map = new Map<string, CustomerReportInstallmentMonthRow>();
  for (const installment of installments) {
    const period = installment.dueDate.slice(0, 7);
    const row = map.get(period) ?? { period, installments: 0, amountCents: 0 };
    row.installments += 1;
    row.amountCents += installment.amountCents;
    map.set(period, row);
  }
  return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period));
}

function buildInstallmentTotals(
  installments: CustomerReportInstallment[]
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

function mapOperation(row: OperationRow): CustomerReportOperation {
  const modalityInfo = getFreightModalityInfo(row.freight_type);
  const freight = parseFreight(row.freight_json);
  const cancelled = !isClosedOperationStatus(row.status);

  return {
    id: row.id,
    date: row.created_at.slice(0, 10),
    createdAt: row.created_at,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] ?? row.status,
    operationType: row.operation_type,
    operationTypeLabel: row.operation_type === "internal" ? "Interna" : "Com nota",
    cancelled,
    cancelReason: row.cancel_reason,
    productCode: row.product_code,
    productDescription: (row.product_description ?? "").trim() || "N/A",
    productUnit: row.product_unit,
    plate: (row.plate ?? "").trim() || "SEM PLACA",
    vehicleDescription: row.vehicle_description,
    driverName: (row.driver_name ?? "").trim() || "N/A",
    driverDocument: row.driver_document,
    carrierName: row.carrier_name,
    carrierDocument: row.carrier_document,
    freightModality: modalityInfo.key,
    freightModalityLabel: modalityInfo.label,
    freightRuleName: freight.ruleName,
    freightDestination: freight.destination,
    freightDistanceKm: freight.distanceKm,
    freightTotalCents: row.freight_total_cents ?? 0,
    entryWeightKg: row.entry_weight_kg,
    exitWeightKg: row.exit_weight_kg,
    netWeightKg: row.net_weight_kg ?? 0,
    entryAt: row.entry_at,
    exitAt: row.exit_at,
    minutesInside: minutesBetween(row.entry_at, row.exit_at),
    unitPriceCents: row.unit_price_cents,
    baseUnitPriceCents: row.base_unit_price_cents,
    priceTableName: row.applied_price_table_name,
    priceSavingsPercent: row.price_savings_percent,
    productTotalCents: row.product_total_cents ?? 0,
    totalCents: row.total_cents ?? 0,
    paymentMethodName: row.payment_method_name,
    paymentTermName: resolvePaymentTermName(row),
    installments: row.manual_installments,
    downPaymentCents: row.manual_down_payment_cents,
    omieSalesOrderId: row.omie_sales_order_id,
    omieBillingStatus: row.omie_billing_status,
    omieBilledAt: row.omie_billed_at,
    omieDocumentUrl: row.omie_document_url,
    cloudSyncedAt: row.cloud_synced_at,
    omieSyncedAt: row.omie_synced_at
  };
}

/**
 * Parcelamento manual tem precedencia sobre a condicao cadastrada — a mesma regra
 * usada na lista de operacoes (`listOpenWeighingOperations`).
 */
function resolvePaymentTermName(row: OperationRow): string | null {
  if (row.manual_installments === 1) return "1 parcela";
  if (row.manual_installments && row.manual_installments > 1) {
    return `${row.manual_installments} parcelas`;
  }
  return row.payment_term_name;
}

function parseFreight(freightJson: string | null): {
  ruleName: string | null;
  destination: string | null;
  distanceKm: number | null;
} {
  if (!freightJson) return { ruleName: null, destination: null, distanceKm: null };
  try {
    const parsed = JSON.parse(freightJson) as { rule?: FreightRule; destination?: string | null };
    return {
      ruleName: parsed.rule?.name ?? null,
      destination: parsed.destination ?? null,
      distanceKm: parsed.rule?.distanceKm ?? null
    };
  } catch {
    // Regra de frete corrompida nao pode derrubar o relatorio inteiro.
    return { ruleName: null, destination: null, distanceKm: null };
  }
}

function minutesBetween(entryIso: string | null, exitIso: string | null): number | null {
  if (!entryIso || !exitIso) return null;
  const entry = new Date(entryIso).getTime();
  const exit = new Date(exitIso).getTime();
  if (Number.isNaN(entry) || Number.isNaN(exit)) return null;
  const minutes = (exit - entry) / 60_000;
  return minutes >= 0 ? Math.round(minutes) : 0;
}

export function avgPriceCentsPerTon(valueCents: number, weightKg: number): number {
  return weightKg > 0 ? Math.round(valueCents / (weightKg / 1000)) : 0;
}

function buildTotals(
  operations: CustomerReportOperation[],
  cancelled: CustomerReportOperation[]
): CustomerReportTotals {
  const netWeightKg = sum(operations, (op) => op.netWeightKg);
  const productCents = sum(operations, (op) => op.productTotalCents);
  const freightCents = sum(operations, (op) => op.freightTotalCents);
  const totalCents = sum(operations, (op) => op.totalCents);
  const dates = operations.map((op) => op.date).sort();

  return {
    operations: operations.length,
    netWeightKg,
    productCents,
    freightCents,
    totalCents,
    avgPriceCentsPerTon: avgPriceCentsPerTon(productCents, netWeightKg),
    avgTicketCents: operations.length > 0 ? Math.round(totalCents / operations.length) : 0,
    avgNetWeightKg: operations.length > 0 ? Math.round(netWeightKg / operations.length) : 0,
    invoiceOperations: operations.filter((op) => op.operationType === "invoice").length,
    internalOperations: operations.filter((op) => op.operationType === "internal").length,
    cancelledOperations: cancelled.length,
    cancelledNetWeightKg: sum(cancelled, (op) => op.netWeightKg),
    firstOperationDate: dates[0] ?? null,
    lastOperationDate: dates[dates.length - 1] ?? null
  };
}

function groupByProduct(operations: CustomerReportOperation[]): CustomerReportProductRow[] {
  const map = new Map<string, CustomerReportProductRow>();
  for (const op of operations) {
    const key = `${op.productCode ?? ""}|${op.productDescription}`;
    const row = map.get(key) ?? {
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
  return Array.from(map.values())
    .map((row) => ({
      ...row,
      avgPriceCentsPerTon: avgPriceCentsPerTon(row.productCents, row.netWeightKg)
    }))
    .sort((a, b) => b.netWeightKg - a.netWeightKg);
}

function groupByPlate(operations: CustomerReportOperation[]): CustomerReportPlateRow[] {
  const map = new Map<string, CustomerReportPlateRow & { minutesSamples: number }>();
  for (const op of operations) {
    const row = map.get(op.plate) ?? {
      plate: op.plate,
      driverName: null,
      carrierName: null,
      operations: 0,
      netWeightKg: 0,
      totalCents: 0,
      totalMinutes: 0,
      avgMinutes: 0,
      lastOperationAt: null,
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
    const reference = op.exitAt ?? op.createdAt;
    if (!row.lastOperationAt || reference > row.lastOperationAt) row.lastOperationAt = reference;
    map.set(op.plate, row);
  }
  return Array.from(map.values())
    .map(({ minutesSamples, ...row }) => ({
      ...row,
      avgMinutes: minutesSamples > 0 ? Math.round(row.totalMinutes / minutesSamples) : 0
    }))
    .sort((a, b) => b.netWeightKg - a.netWeightKg || b.operations - a.operations);
}

function groupByCarrier(operations: CustomerReportOperation[]): CustomerReportCarrierRow[] {
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
  return Array.from(map.values())
    .map(({ plateSet, ...row }) => ({ ...row, plates: Array.from(plateSet).sort() }))
    .sort((a, b) => b.netWeightKg - a.netWeightKg);
}

function groupByLabel(
  operations: CustomerReportOperation[],
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
  return Array.from(map.values()).sort((a, b) => b.totalCents - a.totalCents);
}

function groupByPeriod(
  operations: CustomerReportOperation[],
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
  return Array.from(map.values()).sort((a, b) => a.period.localeCompare(b.period));
}

function sum<T>(items: T[], valueOf: (item: T) => number): number {
  return items.reduce((total, item) => total + valueOf(item), 0);
}
