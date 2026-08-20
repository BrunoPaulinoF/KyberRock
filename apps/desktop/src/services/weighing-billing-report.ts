import type { DesktopDatabase } from "../database/sqlite.js";
import {
  WEIGHING_BILLING_SITUATION_LABEL,
  WEIGHING_BILLING_SITUATION_ORDER,
  isWeighingBillingSituation,
  resolveSituation,
  resolveSituationDetail
} from "./weighing-billing-situation.js";
import type { WeighingBillingSituation } from "./weighing-billing-situation.js";
import { CLOSED_OPERATION_STATUS_SQL_LIST } from "./weighing-operations.js";

/**
 * Conferencia de faturamento: a lista PESAGEM A PESAGEM do periodo, uma linha por
 * operacao fechada, com cliente, data, produto, peso, frete e total — e, ao lado, em que
 * pe esta o faturamento daquela pesagem no OMIE.
 *
 * A pergunta que este relatorio responde e "o que a balanca fechou foi faturado
 * certinho?". Por isso ele NAO agrega nada: os relatorios de Insights e por cliente ja
 * mostram o periodo somado, e um total nunca revela a pesagem que ficou pelo caminho.
 * Aqui cada carregamento aparece inteiro, e a coluna de situacao diz se ele virou pedido
 * no OMIE, se ainda esta a caminho ou se foi recusado.
 *
 * Escopo igual ao dos demais relatorios (`ReportService`, `CustomerReportService`):
 * operacoes CONCLUIDAS da unidade — `closed_local` ate `sync_error` —, sem as excluidas
 * e sem as canceladas, no intervalo de `date(created_at)`. Manter a mesma base de data e
 * o mesmo conjunto de status e o que faz o total daqui bater com o dos outros: um
 * relatorio de conferencia que discorda dos outros nao serve para conferir nada.
 */

/** Uma pesagem fechada do periodo. */
export interface WeighingBillingRow {
  operationId: string;
  /** Numero sequencial da operacao mostrado ao operador (`operation_code`). */
  operationCode: number | null;
  /** Data da operacao (`created_at`), a mesma base dos demais relatorios. */
  date: string;
  /** Saida da balanca — quando a pesagem de fato fechou. Null nas operacoes antigas. */
  closedAt: string | null;
  customerId: string | null;
  customerName: string;
  customerDocument: string | null;
  productCode: string | null;
  productDescription: string;
  plate: string;
  netWeightKg: number;
  unitPriceCents: number | null;
  /** Unidade do preco aplicado ("ton" / "kg"), para conferir o preco unitario. */
  priceUnit: string | null;
  productTotalCents: number;
  freightTotalCents: number;
  totalCents: number;
  operationType: "invoice" | "internal";
  operationTypeLabel: string;
  omieSalesOrderId: number | null;
  omieServiceOrderId: number | null;
  /**
   * Numero do pedido/OS como ele aparece DENTRO do OMIE. Os dois campos acima sao o
   * codigo interno da API; e este que se digita na busca do OMIE para achar o documento.
   */
  omieOrderNumber: string | null;
  omieBilledAt: string | null;
  situation: WeighingBillingSituation;
  situationLabel: string;
  /** O motivo gravado pelo OMIE, quando ha — e o que explica uma pesagem parada. */
  situationDetail: string | null;
}

export interface WeighingBillingTotals {
  operations: number;
  netWeightKg: number;
  productCents: number;
  freightCents: number;
  totalCents: number;
}

/** Uma situacao de faturamento e o quanto ela representa no periodo. */
export interface WeighingBillingSituationRow {
  situation: WeighingBillingSituation;
  label: string;
  operations: number;
  netWeightKg: number;
  totalCents: number;
}

export interface WeighingBillingReport {
  startDate: string;
  endDate: string;
  periodLabel: string | null;
  rows: WeighingBillingRow[];
  totals: WeighingBillingTotals;
  /** Uma linha por situacao presente no periodo, da mais critica para a resolvida. */
  bySituation: WeighingBillingSituationRow[];
  /**
   * Tudo que NAO esta faturado (`situation !== "billed"`). E o numero que interessa na
   * conferencia: o resto do relatorio existe para achar de onde ele vem.
   */
  unbilled: WeighingBillingTotals;
  /** Filtros aplicados, para o documento exportado dizer o que ele mostra. */
  filters: WeighingBillingFilters;
}

export interface WeighingBillingFilters {
  customerId: string | null;
  situations: WeighingBillingSituation[];
  search: string | null;
}

export interface WeighingBillingReportOptions {
  customerId?: string | null;
  /** Vazio (ou ausente) traz todas as situacoes. */
  situations?: WeighingBillingSituation[] | null;
  /** Busca livre por cliente, produto, placa ou numero da operacao. */
  search?: string | null;
  periodLabel?: string | null;
}

interface WeighingBillingSourceRow {
  id: string;
  operation_code: number | null;
  created_at: string;
  exit_at: string | null;
  operation_type: "invoice" | "internal";
  customer_id: string | null;
  customer_trade_name: string | null;
  customer_legal_name: string | null;
  customer_document: string | null;
  product_code: string | null;
  product_description: string | null;
  plate: string | null;
  net_weight_kg: number | null;
  unit_price_cents: number | null;
  price_unit: string | null;
  product_total_cents: number | null;
  freight_total_cents: number | null;
  total_cents: number | null;
  omie_sales_order_id: number | null;
  omie_service_order_id: number | null;
  omie_order_number: string | null;
  omie_billing_status: string | null;
  omie_billing_message: string | null;
  omie_billed_at: string | null;
}

export class WeighingBillingReportService {
  constructor(private readonly db: DesktopDatabase) {}

  getReport(
    startDate: string,
    endDate: string,
    unitId: string,
    options: WeighingBillingReportOptions = {}
  ): WeighingBillingReport {
    const customerId = options.customerId ?? null;
    // Situacao vazia e "todas": um filtro que zera a lista quando ninguem escolheu nada
    // pareceria um periodo sem movimento.
    const situations = (options.situations ?? []).filter(isWeighingBillingSituation);
    const search = (options.search ?? "").trim();

    const rows = this.loadRows(startDate, endDate, unitId, customerId)
      .map(mapRow)
      .filter((row) => situations.length === 0 || situations.includes(row.situation))
      .filter((row) => matchesSearch(row, search));

    return {
      startDate,
      endDate,
      periodLabel: options.periodLabel ?? null,
      rows,
      totals: buildTotals(rows),
      bySituation: groupBySituation(rows),
      unbilled: buildTotals(rows.filter((row) => row.situation !== "billed")),
      filters: { customerId, situations, search: search || null }
    };
  }

  private loadRows(
    startDate: string,
    endDate: string,
    unitId: string,
    customerId: string | null
  ): WeighingBillingSourceRow[] {
    return this.db
      .prepare(
        `SELECT
           o.id, o.operation_code, o.created_at,
           o.exit_weight_captured_at as exit_at,
           o.operation_type,
           o.customer_id,
           cust.trade_name as customer_trade_name,
           COALESCE(cust.legal_name, o.remote_customer_name) as customer_legal_name,
           cust.document as customer_document,
           p.code as product_code,
           COALESCE(p.description, o.remote_product_description) as product_description,
           COALESCE(v.plate, o.remote_plate) as plate,
           o.net_weight_kg, o.unit_price_cents, o.price_unit,
           o.product_total_cents, o.freight_total_cents, o.total_cents,
           o.omie_sales_order_id, o.omie_service_order_id, o.omie_order_number,
           o.omie_billing_status, o.omie_billing_message, o.omie_billed_at
         FROM weighing_operations o
         LEFT JOIN customers cust ON cust.id = o.customer_id
         LEFT JOIN products p ON p.id = o.product_id
         LEFT JOIN vehicles v ON v.id = o.vehicle_id
         WHERE o.unit_id = ?
           AND (? IS NULL OR o.customer_id = ?)
           AND o.deleted_at IS NULL
           AND o.status IN (${CLOSED_OPERATION_STATUS_SQL_LIST})
           AND date(o.created_at) >= date(?)
           AND date(o.created_at) <= date(?)
         ORDER BY o.created_at ASC, o.operation_code ASC`
      )
      .all(unitId, customerId, customerId, startDate, endDate) as WeighingBillingSourceRow[];
  }
}

function mapRow(row: WeighingBillingSourceRow): WeighingBillingRow {
  const situation = resolveSituation(row);
  return {
    operationId: row.id,
    operationCode: row.operation_code,
    date: row.created_at.slice(0, 10),
    closedAt: row.exit_at,
    customerId: row.customer_id,
    customerName:
      (row.customer_trade_name ?? "").trim() ||
      (row.customer_legal_name ?? "").trim() ||
      "Sem cliente",
    customerDocument: row.customer_document,
    productCode: row.product_code,
    productDescription: (row.product_description ?? "").trim() || "N/A",
    plate: (row.plate ?? "").trim() || "SEM PLACA",
    netWeightKg: row.net_weight_kg ?? 0,
    unitPriceCents: row.unit_price_cents,
    priceUnit: row.price_unit,
    productTotalCents: row.product_total_cents ?? 0,
    freightTotalCents: row.freight_total_cents ?? 0,
    totalCents: row.total_cents ?? 0,
    operationType: row.operation_type,
    operationTypeLabel: row.operation_type === "internal" ? "Interna" : "Com nota",
    omieSalesOrderId: row.omie_sales_order_id,
    omieServiceOrderId: row.omie_service_order_id,
    omieOrderNumber: (row.omie_order_number ?? "").trim() || null,
    omieBilledAt: row.omie_billed_at,
    situation,
    situationLabel: WEIGHING_BILLING_SITUATION_LABEL[situation],
    situationDetail: resolveSituationDetail(row, situation)
  };
}

/** Busca livre por cliente, produto, placa, documento ou numero da operacao. */
function matchesSearch(row: WeighingBillingRow, search: string): boolean {
  if (!search) return true;
  const term = search.toLowerCase();
  return [
    row.customerName,
    row.customerDocument ?? "",
    row.productDescription,
    row.productCode ?? "",
    row.plate,
    row.operationCode === null ? "" : String(row.operationCode),
    row.omieSalesOrderId === null ? "" : String(row.omieSalesOrderId),
    row.omieServiceOrderId === null ? "" : String(row.omieServiceOrderId),
    // Tambem pelo numero que o OMIE mostra: quem chega aqui vindo da tela do OMIE tem
    // esse numero na mao, nao o codigo interno.
    row.omieOrderNumber ?? ""
  ].some((field) => field.toLowerCase().includes(term));
}

export function buildTotals(rows: readonly WeighingBillingRow[]): WeighingBillingTotals {
  return {
    operations: rows.length,
    netWeightKg: sum(rows, (row) => row.netWeightKg),
    productCents: sum(rows, (row) => row.productTotalCents),
    freightCents: sum(rows, (row) => row.freightTotalCents),
    totalCents: sum(rows, (row) => row.totalCents)
  };
}

function groupBySituation(rows: readonly WeighingBillingRow[]): WeighingBillingSituationRow[] {
  const map = new Map<WeighingBillingSituation, WeighingBillingSituationRow>();
  for (const row of rows) {
    const entry = map.get(row.situation) ?? {
      situation: row.situation,
      label: row.situationLabel,
      operations: 0,
      netWeightKg: 0,
      totalCents: 0
    };
    entry.operations += 1;
    entry.netWeightKg += row.netWeightKg;
    entry.totalCents += row.totalCents;
    map.set(row.situation, entry);
  }
  return [...map.values()].sort(
    (a, b) =>
      WEIGHING_BILLING_SITUATION_ORDER[a.situation] - WEIGHING_BILLING_SITUATION_ORDER[b.situation]
  );
}

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}
