/**
 * Conferencia de faturamento: a lista PESAGEM A PESAGEM do periodo com a situacao de cada
 * uma no OMIE — a mesma conta de `WeighingBillingReportService` do desktop
 * (`apps/desktop/src/services/weighing-billing-report.ts`), lendo a nuvem. A situacao e o
 * rotulo da nota sao as copias fieis do desktop (`lib/desktop/weighing-billing-situation.ts`
 * e `invoice-number-label.ts`), e o relatorio sai no formato `WeighingBillingReport` para o
 * renderizador copiado do desktop gerar o MESMO PDF e a MESMA planilha.
 *
 * Relatorio de DINHEIRO: o periodo e recortado pela data em que a pesagem FECHOU
 * (`closed_at`, com `created_at` para a pesagem antiga sem saida gravada), a mesma que sobe
 * ao OMIE como emissao do pedido. Escopo igual ao dos demais relatorios: pesagens concluidas
 * da unidade (`closed_local` ate `sync_error`), sem as canceladas.
 */

import {
  WEIGHING_BILLING_SITUATION_LABEL,
  WEIGHING_BILLING_SITUATION_ORDER,
  resolveSituation,
  resolveSituationDetail
} from "./desktop/weighing-billing-situation.js";
import type { WeighingBillingSituation } from "./desktop/weighing-billing-situation.js";
import type {
  WeighingBillingReport,
  WeighingBillingRow,
  WeighingBillingSituationRow,
  WeighingBillingTotals
} from "./desktop/weighing-billing-report-types.js";
import {
  renderWeighingBillingReportHtml,
  renderWeighingBillingReportSpreadsheet,
  weighingBillingReportFileBaseName
} from "./desktop/weighing-billing-report-render.js";
import { localDay, periodToIso, todayIso } from "./format";
import type { ReportFile } from "./report-output";
import { supabase } from "./supabase";

// ---------- situacao no OMIE (as regras sao as do desktop) ----------

export {
  WEIGHING_BILLING_SITUATIONS as BILLING_SITUATIONS,
  WEIGHING_BILLING_SITUATION_LABEL as BILLING_SITUATION_LABEL,
  WEIGHING_BILLING_SITUATION_ORDER as BILLING_SITUATION_ORDER,
  resolveSituation,
  resolveSituationDetail
} from "./desktop/weighing-billing-situation.js";
export { invoiceNumberLabel, invoiceNumberText } from "./desktop/invoice-number-label.js";

export type BillingSituation = WeighingBillingSituation;

/** Cor da etiqueta (o `SituationPill` do desktop). */
export const BILLING_SITUATION_TONE: Record<
  BillingSituation,
  "success" | "warning" | "danger" | "info"
> = {
  billed: "success",
  sent: "info",
  pending: "warning",
  cadastro_incompleto: "warning",
  failed: "danger"
};

// ---------- formatos (o `weighing-line-format.ts` do desktop) ----------

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function formatTons(kg: number): string {
  return `${(kg / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} t`;
}

export function formatKg(kg: number): string {
  return kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export function formatCount(value: number): string {
  return value.toLocaleString("pt-BR");
}

/** "YYYY-MM-DD" -> "DD/MM/YYYY". */
export function formatDayLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

/** Preco unitario com a unidade em que foi aplicado ("R$ 42,00/t"). */
export function unitPriceLabel(line: {
  unitPriceCents: number | null;
  priceUnit: string | null;
}): string {
  if (line.unitPriceCents === null) return "-";
  return `${formatBRL(line.unitPriceCents)}/${line.priceUnit === "kg" ? "kg" : "t"}`;
}

/**
 * Numero pelo qual a pesagem e procurada no OMIE (o `omieReference` do desktop). O numero
 * VISIVEL do pedido vem entre parenteses quando conhecido — hoje a coluna `omie_order_number`
 * nao sobe para a nuvem, entao no site sai so o codigo do pedido/OS.
 */
export function omieReference(line: {
  omieSalesOrderId: number | null;
  omieServiceOrderId: number | null;
  omieOrderNumber?: string | null;
}): string {
  const visible = line.omieOrderNumber ? ` (nº ${line.omieOrderNumber})` : "";
  if (line.omieSalesOrderId) return `Pedido ${line.omieSalesOrderId}${visible}`;
  if (line.omieServiceOrderId) return `OS ${line.omieServiceOrderId}${visible}`;
  return "-";
}

// ---------- periodo (o `insights-period.ts` do desktop) ----------

export type BillingPeriod = "today" | "7d" | "30d" | "month" | "lastMonth" | "custom";

export const BILLING_PERIOD_OPTIONS: Array<{ id: BillingPeriod; label: string }> = [
  { id: "today", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "month", label: "Mes atual" },
  { id: "lastMonth", label: "Mes anterior" },
  { id: "custom", label: "Personalizado" }
];

export interface DateRange {
  start: string;
  end: string;
  label: string;
}

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Datas do periodo escolhido, no dia da pedreira. No personalizado, campo vazio cai em hoje e
 * datas invertidas trocam de lugar — o relatorio nunca sai com intervalo impossivel.
 */
export function resolveRange(
  period: BillingPeriod,
  customStart: string,
  customEnd: string,
  now: Date = new Date()
): DateRange {
  const today = todayIso(now);
  if (period === "custom") {
    const start = customStart || today;
    const end = customEnd || today;
    const label = "Periodo personalizado";
    return start <= end ? { start, end, label } : { start: end, end: start, label };
  }
  if (period === "today") return { start: today, end: today, label: "Hoje" };
  if (period === "7d") return { start: shiftDays(today, -6), end: today, label: "Ultimos 7 dias" };
  if (period === "30d") {
    return { start: shiftDays(today, -29), end: today, label: "Ultimos 30 dias" };
  }
  if (period === "month")
    return { start: `${today.slice(0, 7)}-01`, end: today, label: "Mes atual" };
  const lastMonthEnd = shiftDays(`${today.slice(0, 7)}-01`, -1);
  return { start: `${lastMonthEnd.slice(0, 7)}-01`, end: lastMonthEnd, label: "Mes anterior" };
}

// ---------- relatorio (o `WeighingBillingReport` do desktop) ----------

export type BillingRow = WeighingBillingRow;
export type BillingTotals = WeighingBillingTotals;
export type BillingSituationRow = WeighingBillingSituationRow;
export type BillingReport = WeighingBillingReport;

/** A pesagem da nuvem, so com as colunas que a conferencia le. */
export interface BillingSourceOperation {
  id: string;
  operation_code: number | null;
  created_at: string;
  closed_at: string | null;
  operation_type: string;
  customer_id: string | null;
  customer_name: string | null;
  product_id: string | null;
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
  omie_invoice_number: string | null;
  omie_billing_status: string | null;
  omie_billing_message: string | null;
}

export interface BillingCustomerInfo {
  trade_name: string | null;
  legal_name: string | null;
  document: string | null;
}

export interface BillingProductInfo {
  code: string | null;
  description: string | null;
}

/** O `mapRow` do desktop, lendo a pesagem da nuvem e os cadastros dela. */
export function mapBillingRow(
  op: BillingSourceOperation,
  customer: BillingCustomerInfo | undefined,
  product: BillingProductInfo | undefined
): BillingRow {
  const operationType = op.operation_type === "internal" ? "internal" : "invoice";
  const source = { ...op, operation_type: operationType } as const;
  const situation = resolveSituation(source);
  return {
    operationId: op.id,
    operationCode: op.operation_code,
    date: localDay(op.closed_at ?? op.created_at),
    closedAt: op.closed_at,
    customerId: op.customer_id,
    customerName:
      (customer?.trade_name ?? "").trim() ||
      (customer?.legal_name ?? "").trim() ||
      (op.customer_name ?? "").trim() ||
      "Sem cliente",
    customerDocument: customer?.document ?? null,
    productCode: product?.code ?? null,
    productDescription:
      (product?.description ?? "").trim() || (op.product_description ?? "").trim() || "N/A",
    plate: (op.plate ?? "").trim() || "SEM PLACA",
    netWeightKg: op.net_weight_kg ?? 0,
    unitPriceCents: op.unit_price_cents,
    priceUnit: op.price_unit,
    productTotalCents: op.product_total_cents ?? 0,
    freightTotalCents: op.freight_total_cents ?? 0,
    totalCents: op.total_cents ?? 0,
    operationType,
    operationTypeLabel: operationType === "internal" ? "Interna" : "Com nota",
    omieSalesOrderId: op.omie_sales_order_id,
    omieServiceOrderId: op.omie_service_order_id,
    // O numero VISIVEL do pedido/OS e a data do faturamento ficam so no SQLite da balanca:
    // `weighing_operations` da nuvem nao tem essas colunas.
    omieOrderNumber: null,
    omieInvoiceNumber: (op.omie_invoice_number ?? "").trim() || null,
    omieBilledAt: null,
    situation,
    situationLabel: WEIGHING_BILLING_SITUATION_LABEL[situation],
    situationDetail: resolveSituationDetail(source, situation)
  };
}

/** Busca livre por cliente, documento, produto, placa, numero da operacao, pedido/OS ou nota. */
export function matchesBillingSearch(row: BillingRow, search: string): boolean {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [
    row.customerName,
    row.customerDocument ?? "",
    row.productDescription,
    row.productCode ?? "",
    row.plate,
    row.operationCode === null ? "" : String(row.operationCode),
    row.omieSalesOrderId === null ? "" : String(row.omieSalesOrderId),
    row.omieServiceOrderId === null ? "" : String(row.omieServiceOrderId),
    row.omieOrderNumber ?? "",
    row.omieInvoiceNumber ?? ""
  ].some((field) => field.toLowerCase().includes(term));
}

export function buildTotals(rows: readonly BillingRow[]): BillingTotals {
  return {
    operations: rows.length,
    netWeightKg: rows.reduce((sum, row) => sum + row.netWeightKg, 0),
    productCents: rows.reduce((sum, row) => sum + row.productTotalCents, 0),
    freightCents: rows.reduce((sum, row) => sum + row.freightTotalCents, 0),
    totalCents: rows.reduce((sum, row) => sum + row.totalCents, 0)
  };
}

function groupBySituation(rows: readonly BillingRow[]): BillingSituationRow[] {
  const map = new Map<BillingSituation, BillingSituationRow>();
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

export interface BillingReportOptions {
  /** O periodo da tela: datas e rotulo ("Mes atual"), que o documento imprime no topo. */
  range: DateRange;
  /** Cliente escolhido (a consulta ja veio filtrada por ele); vazio e "todos". */
  customerId: string | null;
  situations: readonly BillingSituation[];
  search: string;
}

/**
 * O `getReport` do desktop sobre as pesagens ja lidas: aplica situacao e busca (o cliente ja
 * vem filtrado na consulta), monta os totais e o envelope — periodo, rotulo e filtros — que o
 * documento exportado imprime. Situacao vazia e "todas": um filtro que zera a lista pareceria
 * um periodo sem movimento.
 */
export function buildBillingReport(
  allRows: readonly BillingRow[],
  options: BillingReportOptions
): BillingReport {
  const situations = [...options.situations];
  const search = options.search.trim();
  const rows = allRows
    .filter((row) => situations.length === 0 || situations.includes(row.situation))
    .filter((row) => matchesBillingSearch(row, search));
  return {
    startDate: options.range.start,
    endDate: options.range.end,
    periodLabel: options.range.label,
    rows,
    totals: buildTotals(rows),
    bySituation: groupBySituation(rows),
    unbilled: buildTotals(rows.filter((row) => row.situation !== "billed")),
    filters: { customerId: options.customerId || null, situations, search: search || null }
  };
}

// ---------- arquivos (os mesmos do desktop) ----------

export type BillingExportFormat = "pdf" | "excel";

/**
 * Os documentos que o desktop grava (`buildWeighingBillingReportDocuments`): o A4 paisagem que
 * vira PDF e a planilha `.xls`, com o mesmo nome de arquivo, na ordem PDF e depois Excel.
 */
export function buildBillingReportFiles(
  report: BillingReport,
  formats: readonly BillingExportFormat[],
  generatedAt: Date = new Date()
): { pdf: ReportFile[]; xls: ReportFile[] } {
  const baseName = weighingBillingReportFileBaseName(report);
  return {
    pdf: formats.includes("pdf")
      ? [
          {
            filename: `${baseName}.pdf`,
            html: renderWeighingBillingReportHtml(report, generatedAt)
          }
        ]
      : [],
    xls: formats.includes("excel")
      ? [
          {
            filename: `${baseName}.xls`,
            html: renderWeighingBillingReportSpreadsheet(report, generatedAt)
          }
        ]
      : []
  };
}

// ---------- consultas ----------

const CLOSED_STATUSES = ["closed_local", "pending_cloud", "pending_omie", "synced", "sync_error"];
const PAGE = 1000;

const OPERATION_COLUMNS =
  "id, operation_code, created_at, closed_at, operation_type, customer_id, customer_name, product_id, product_description, plate, net_weight_kg, unit_price_cents, price_unit, product_total_cents, freight_total_cents, total_cents, omie_sales_order_id, omie_service_order_id, omie_invoice_number, omie_billing_status, omie_billing_message";

export interface CustomerOption {
  id: string;
  name: string;
  document: string | null;
}

/**
 * Clientes ativos da empresa para o filtro, um por cliente REAL: o mesmo documento ou o mesmo
 * codigo OMIE em duas linhas (a do OMIE e a da balanca) aparece uma vez so.
 */
export async function loadCustomerOptions(companyId: string): Promise<CustomerOption[]> {
  const rows: Array<{
    id: string;
    trade_name: string | null;
    legal_name: string | null;
    document: string | null;
    omie_customer_id: number | null;
  }> = [];
  for (let page = 0; page < 50; page++) {
    const { data, error } = await supabase
      .from("customers")
      .select("id, trade_name, legal_name, document, omie_customer_id")
      .eq("company_id", companyId)
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("trade_name")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return dedupeCustomers(rows);
}

export function dedupeCustomers(
  rows: ReadonlyArray<{
    id: string;
    trade_name: string | null;
    legal_name: string | null;
    document: string | null;
    omie_customer_id: number | null;
  }>
): CustomerOption[] {
  const seen = new Set<string>();
  const options: CustomerOption[] = [];
  for (const row of rows) {
    // Documento sem pontuacao e sem caixa, mas COM as letras do CNPJ alfanumerico.
    const document = (row.document ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
    const key = row.omie_customer_id
      ? `omie:${row.omie_customer_id}`
      : document
        ? `doc:${document}`
        : `id:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      id: row.id,
      name: (row.trade_name ?? "").trim() || (row.legal_name ?? "").trim() || "Sem nome",
      document: row.document
    });
  }
  return options;
}

/**
 * Pesagens concluidas da unidade no periodo pela data de FECHAMENTO, ja com cliente e
 * produto do cadastro. `customerId` vazio traz todos os clientes.
 */
export async function loadBillingRows(
  companyId: string,
  unitId: string,
  range: { start: string; end: string },
  customerId: string | null
): Promise<BillingRow[]> {
  const { startIso, endIso } = periodToIso(range.start, range.end);
  const operations: BillingSourceOperation[] = [];
  for (let page = 0; page < 50; page++) {
    let query = supabase
      .from("weighing_operations")
      .select(OPERATION_COLUMNS)
      .eq("company_id", companyId)
      .eq("unit_id", unitId)
      .in("status", CLOSED_STATUSES)
      .or(
        [
          `and(closed_at.gte."${startIso}",closed_at.lt."${endIso}")`,
          `and(closed_at.is.null,created_at.gte."${startIso}",created_at.lt."${endIso}")`
        ].join(",")
      );
    if (customerId) query = query.eq("customer_id", customerId);
    const { data, error } = await query
      .order("closed_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    operations.push(...((data ?? []) as BillingSourceOperation[]));
    if (!data || data.length < PAGE) break;
  }

  const customerIds = [...new Set(operations.map((op) => op.customer_id).filter(isId))];
  const productIds = [...new Set(operations.map((op) => op.product_id).filter(isId))];
  const [customers, products] = await Promise.all([
    byIds<BillingCustomerInfo & { id: string }>(
      "customers",
      "id, trade_name, legal_name, document",
      companyId,
      customerIds
    ),
    byIds<BillingProductInfo & { id: string }>(
      "products",
      "id, code, description",
      companyId,
      productIds
    )
  ]);
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const productById = new Map(products.map((p) => [p.id, p]));

  return sortBillingRows(
    operations.map((op) =>
      mapBillingRow(
        op,
        op.customer_id ? customerById.get(op.customer_id) : undefined,
        op.product_id ? productById.get(op.product_id) : undefined
      )
    )
  );
}

/** Ordem do desktop: pela data de fechamento (a saida, ou a criacao), depois pelo numero. */
export function sortBillingRows(rows: BillingRow[]): BillingRow[] {
  return [...rows].sort((a, b) => {
    // Pesagem antiga sem saida gravada entra pelo dia (o dia da criacao).
    const byDate = (a.closedAt ?? a.date).localeCompare(b.closedAt ?? b.date);
    if (byDate !== 0) return byDate;
    return (a.operationCode ?? 0) - (b.operationCode ?? 0);
  });
}

function isId(value: string | null): value is string {
  return Boolean(value);
}

async function byIds<T>(
  table: "customers" | "products",
  columns: string,
  companyId: string,
  ids: string[]
): Promise<T[]> {
  const rows: T[] = [];
  for (let index = 0; index < ids.length; index += 150) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("company_id", companyId)
      .in("id", ids.slice(index, index + 150));
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as T[]));
  }
  return rows;
}
