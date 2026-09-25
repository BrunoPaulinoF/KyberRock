/**
 * Contas da tela Insights — espelho de `apps/desktop/src/renderer/insights-period.ts` e das
 * consultas de `apps/desktop/src/services/reports.ts` (`getDailySeries`, `getReportByProduct`,
 * `getReportByCustomer`, `getOperationMix`, `getSalesPivot`, `exportInsightsToHtml` e
 * `exportRangeToSpreadsheet`). O desktop soma no SQLite; aqui a soma e feita no navegador a
 * partir das pesagens da nuvem, com as MESMAS regras:
 *
 * - dinheiro recorta pela data em que a pesagem FECHOU (`closed_at`, com `created_at` para a
 *   pesagem antiga sem horario de fechamento) — e a data que sobe ao OMIE;
 * - a serie diaria e o mix somam `total_cents` (produto + frete); produto, cliente e a tabela
 *   dinamica somam `product_total_cents` (so o material), exatamente como no desktop;
 * - o mix conta tambem as canceladas do periodo, as outras contas so as concluidas.
 */

import { SPREADSHEET_HTML_ATTRS, SPREADSHEET_STYLE, sheetTable } from "./desktop/report-document";
import { localDay, todayIso } from "./format";
import { supabase, type Tables } from "./supabase";

type Operation = Tables<"weighing_operations">;

/** Colunas que a tela usa — menos bytes do que `select("*")` num mes inteiro de pesagens. */
export const INSIGHTS_COLUMNS =
  "id, status, operation_type, customer_id, customer_name, product_id, product_description, net_weight_kg, product_total_cents, freight_total_cents, total_cents, closed_at, created_at";

export type InsightsOperation = Pick<
  Operation,
  | "id"
  | "status"
  | "operation_type"
  | "customer_id"
  | "customer_name"
  | "product_id"
  | "product_description"
  | "net_weight_kg"
  | "product_total_cents"
  | "freight_total_cents"
  | "total_cents"
  | "closed_at"
  | "created_at"
>;

/** Os status de pesagem concluida na nuvem (`CLOSED_OPERATION_STATUSES` do desktop). */
export const CLOSED_STATUSES = [
  "closed_local",
  "pending_cloud",
  "pending_omie",
  "synced",
  "sync_error"
] as const;

export function isClosedStatus(status: string): boolean {
  return (CLOSED_STATUSES as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------
// Periodo
// ---------------------------------------------------------------------------

export type InsightsPeriod = "today" | "7d" | "30d" | "month" | "lastMonth" | "custom";

export interface InsightsDateRange {
  start: string;
  end: string;
  label: string;
}

export const INSIGHTS_PERIOD_OPTIONS: Array<{ id: InsightsPeriod; label: string }> = [
  { id: "today", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "month", label: "Mes atual" },
  { id: "lastMonth", label: "Mes anterior" },
  { id: "custom", label: "Personalizado" }
];

export const CUSTOM_PERIOD_LABEL = "Periodo personalizado";

/** Soma dias a uma data AAAA-MM-DD (conta em UTC, sem horario de verao no caminho). */
export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" -> "DD/MM/YYYY". Data em outro formato segue como veio. */
export function formatDayLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

/** "YYYY-MM-DD" (ou ISO completo) -> "DD/MM", como os eixos e o "Desde" do desktop. */
export function formatShortDate(iso: string): string {
  const [datePart] = iso.split("T");
  const [, month, day] = datePart.split("-");
  return `${day}/${month}`;
}

/**
 * Datas do periodo escolhido (`resolveInsightsRange` do desktop). "Hoje" e o dia de Brasilia,
 * nao o do relogio do navegador. No personalizado, campo vazio vira hoje e datas invertidas
 * trocam de lugar — o relatorio nunca sai com um intervalo impossivel.
 */
export function resolveInsightsRange(
  period: InsightsPeriod,
  customStart: string,
  customEnd: string,
  now: Date
): InsightsDateRange {
  const today = todayIso(now);
  if (period === "custom") {
    const start = customStart || today;
    const end = customEnd || today;
    return start <= end
      ? { start, end, label: CUSTOM_PERIOD_LABEL }
      : { start: end, end: start, label: CUSTOM_PERIOD_LABEL };
  }
  if (period === "today") return { start: today, end: today, label: "Hoje" };
  if (period === "7d") return { start: addDays(today, -6), end: today, label: "Ultimos 7 dias" };
  if (period === "30d") {
    return { start: addDays(today, -29), end: today, label: "Ultimos 30 dias" };
  }
  if (period === "month")
    return { start: `${today.slice(0, 7)}-01`, end: today, label: "Mes atual" };
  const lastMonthEnd = addDays(`${today.slice(0, 7)}-01`, -1);
  return { start: `${lastMonthEnd.slice(0, 7)}-01`, end: lastMonthEnd, label: "Mes anterior" };
}

/** Dia contabil da pesagem: o do FECHAMENTO, no fuso da pedreira (`operationSaleDateSql`). */
export function saleDay(operation: Pick<Operation, "closed_at" | "created_at">): string {
  return localDay(operation.closed_at ?? operation.created_at);
}

function inRange(operation: InsightsOperation, range: Pick<InsightsDateRange, "start" | "end">) {
  const day = saleDay(operation);
  return day >= range.start && day <= range.end;
}

/** Pesagens concluidas do periodo — a base de todas as contas de dinheiro. */
export function closedInRange(
  operations: InsightsOperation[],
  range: Pick<InsightsDateRange, "start" | "end">
): InsightsOperation[] {
  return operations.filter((op) => isClosedStatus(op.status) && inRange(op, range));
}

// ---------------------------------------------------------------------------
// Contas (reports.ts)
// ---------------------------------------------------------------------------

export interface DailySeriesPoint {
  date: string;
  totalOperations: number;
  totalNetWeightKg: number;
  totalCents: number;
}

/** Um ponto por dia do periodo, inclusive os dias sem pesagem (`getDailySeries`). */
export function dailySeries(
  operations: InsightsOperation[],
  range: Pick<InsightsDateRange, "start" | "end">
): DailySeriesPoint[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.start) || !/^\d{4}-\d{2}-\d{2}$/.test(range.end)) return [];
  if (range.start > range.end) return [];
  const byDate = new Map<string, DailySeriesPoint>();
  for (const op of closedInRange(operations, range)) {
    const day = saleDay(op);
    const point = byDate.get(day) ?? {
      date: day,
      totalOperations: 0,
      totalNetWeightKg: 0,
      totalCents: 0
    };
    point.totalOperations += 1;
    point.totalNetWeightKg += op.net_weight_kg ?? 0;
    point.totalCents += op.total_cents ?? 0;
    byDate.set(day, point);
  }
  const series: DailySeriesPoint[] = [];
  for (let day = range.start; day <= range.end; day = addDays(day, 1)) {
    series.push(
      byDate.get(day) ?? { date: day, totalOperations: 0, totalNetWeightKg: 0, totalCents: 0 }
    );
  }
  return series;
}

export interface InsightsTotals {
  operations: number;
  weightKg: number;
  totalCents: number;
  ticketCents: number;
}

/** Os quatro KPIs de dinheiro, somados da serie diaria como no desktop. */
export function seriesTotals(series: DailySeriesPoint[]): InsightsTotals {
  const operations = series.reduce((sum, point) => sum + point.totalOperations, 0);
  const weightKg = series.reduce((sum, point) => sum + point.totalNetWeightKg, 0);
  const totalCents = series.reduce((sum, point) => sum + point.totalCents, 0);
  const ticketCents = operations > 0 ? Math.round(totalCents / operations) : 0;
  return { operations, weightKg, totalCents, ticketCents };
}

export interface ProductReport {
  productCode: string;
  productDescription: string;
  totalOperations: number;
  totalWeightKg: number;
  totalValueCents: number;
}

export interface CustomerReport {
  customerName: string;
  totalOperations: number;
  totalWeightKg: number;
  totalValueCents: number;
}

interface Bucket {
  key: string;
  name: string | null;
  totalOperations: number;
  totalWeightKg: number;
  totalValueCents: number;
  order: number;
}

/**
 * Agrupa somando peso e `product_total_cents`. A chave e o id do cadastro (o `GROUP BY c.id`
 * / `p.id` do desktop); pesagem sem cadastro cai no grupo do nome gravado nela.
 */
function bucketize(
  operations: InsightsOperation[],
  keyOf: (op: InsightsOperation) => string,
  nameOf: (op: InsightsOperation) => string | null
): Bucket[] {
  const map = new Map<string, Bucket>();
  for (const op of operations) {
    const key = keyOf(op);
    const bucket = map.get(key) ?? {
      key,
      name: nameOf(op),
      totalOperations: 0,
      totalWeightKg: 0,
      totalValueCents: 0,
      order: map.size
    };
    bucket.totalOperations += 1;
    bucket.totalWeightKg += op.net_weight_kg ?? 0;
    bucket.totalValueCents += op.product_total_cents ?? 0;
    if (!bucket.name) bucket.name = nameOf(op);
    map.set(key, bucket);
  }
  return [...map.values()];
}

const customerKey = (op: InsightsOperation) =>
  op.customer_id ? `id:${op.customer_id}` : `nome:${op.customer_name ?? ""}`;
const productKey = (op: InsightsOperation) =>
  op.product_id ? `id:${op.product_id}` : `nome:${op.product_description ?? ""}`;
const customerName = (op: InsightsOperation) => op.customer_name?.trim() || null;
const productName = (op: InsightsOperation) => op.product_description?.trim() || null;

/** `getReportByProduct`: do maior peso para o menor. A nuvem nao guarda o codigo do produto. */
export function reportByProduct(
  operations: InsightsOperation[],
  range: Pick<InsightsDateRange, "start" | "end">,
  codes: ReadonlyMap<string, string> = new Map()
): ProductReport[] {
  return bucketize(closedInRange(operations, range), productKey, productName)
    .sort((a, b) => b.totalWeightKg - a.totalWeightKg || a.order - b.order)
    .map((bucket) => ({
      productCode: (bucket.key.startsWith("id:") && codes.get(bucket.key.slice(3))) || "N/A",
      productDescription: bucket.name || "N/A",
      totalOperations: bucket.totalOperations,
      totalWeightKg: bucket.totalWeightKg,
      totalValueCents: bucket.totalValueCents
    }));
}

/** `getReportByCustomer`: do maior valor para o menor (vai no PDF). */
export function reportByCustomer(
  operations: InsightsOperation[],
  range: Pick<InsightsDateRange, "start" | "end">
): CustomerReport[] {
  return bucketize(closedInRange(operations, range), customerKey, customerName)
    .sort((a, b) => b.totalValueCents - a.totalValueCents || a.order - b.order)
    .map((bucket) => ({
      customerName: bucket.name || "N/A",
      totalOperations: bucket.totalOperations,
      totalWeightKg: bucket.totalWeightKg,
      totalValueCents: bucket.totalValueCents
    }));
}

export interface OperationMix {
  invoice: { count: number; weightKg: number; totalCents: number };
  internal: { count: number; weightKg: number; totalCents: number };
  cancelled: { count: number; weightKg: number };
}

/** `getOperationMix`: com nota, interna e canceladas do periodo. */
export function operationMix(
  operations: InsightsOperation[],
  range: Pick<InsightsDateRange, "start" | "end">
): OperationMix {
  const mix: OperationMix = {
    invoice: { count: 0, weightKg: 0, totalCents: 0 },
    internal: { count: 0, weightKg: 0, totalCents: 0 },
    cancelled: { count: 0, weightKg: 0 }
  };
  for (const op of operations) {
    if (!inRange(op, range)) continue;
    if (op.status === "cancelled") {
      mix.cancelled.count += 1;
      mix.cancelled.weightKg += op.net_weight_kg ?? 0;
      continue;
    }
    if (!isClosedStatus(op.status)) continue;
    const target = op.operation_type === "internal" ? mix.internal : mix.invoice;
    target.count += 1;
    target.weightKg += op.net_weight_kg ?? 0;
    target.totalCents += op.total_cents ?? 0;
  }
  return mix;
}

export type SalesPivotGroupBy = "customer" | "product" | "customer_product" | "day";

export interface SalesPivotRow {
  key: string;
  customerName: string | null;
  productDescription: string | null;
  date: string | null;
  totalOperations: number;
  totalWeightKg: number;
  totalValueCents: number;
  avgPriceCentsPerTon: number;
}

export interface SalesPivotOption {
  id: string;
  name: string;
}

export interface SalesPivotResult {
  rows: SalesPivotRow[];
  totals: {
    totalOperations: number;
    totalWeightKg: number;
    totalValueCents: number;
    avgPriceCentsPerTon: number;
  };
  customers: SalesPivotOption[];
  products: SalesPivotOption[];
}

export function avgPricePerTon(valueCents: number, weightKg: number): number {
  return weightKg > 0 ? Math.round(valueCents / (weightKg / 1000)) : 0;
}

function options(
  operations: InsightsOperation[],
  idOf: (op: InsightsOperation) => string | null,
  nameOf: (op: InsightsOperation) => string | null
): SalesPivotOption[] {
  const map = new Map<string, string>();
  for (const op of operations) {
    const id = idOf(op);
    if (id && !map.has(id)) map.set(id, nameOf(op) ?? "");
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * Tabela dinamica de vendas (`getSalesPivot`): agrupa por cliente, produto, cliente+produto
 * ou dia, sempre do maior valor para o menor, com filtro opcional de cliente e produto. As
 * opcoes dos filtros sao as do periodo inteiro, sem os filtros aplicados.
 */
export function salesPivot(
  operations: InsightsOperation[],
  range: Pick<InsightsDateRange, "start" | "end">,
  groupBy: SalesPivotGroupBy,
  filters: { customerId?: string | null; productId?: string | null } = {}
): SalesPivotResult {
  const base = closedInRange(operations, range);
  const filtered = base.filter(
    (op) =>
      (!filters.customerId || op.customer_id === filters.customerId) &&
      (!filters.productId || op.product_id === filters.productId)
  );

  const keyOf = (op: InsightsOperation): string => {
    if (groupBy === "product") return productKey(op);
    if (groupBy === "customer_product") return `${customerKey(op)}|${productKey(op)}`;
    if (groupBy === "day") return saleDay(op);
    return customerKey(op);
  };
  const map = new Map<string, SalesPivotRow & { order: number }>();
  for (const op of filtered) {
    const key = keyOf(op);
    const row = map.get(key) ?? {
      key,
      customerName:
        groupBy === "customer" || groupBy === "customer_product" ? customerName(op) : null,
      productDescription:
        groupBy === "product" || groupBy === "customer_product" ? productName(op) : null,
      date: groupBy === "day" ? key : null,
      totalOperations: 0,
      totalWeightKg: 0,
      totalValueCents: 0,
      avgPriceCentsPerTon: 0,
      order: map.size
    };
    row.totalOperations += 1;
    row.totalWeightKg += op.net_weight_kg ?? 0;
    row.totalValueCents += op.product_total_cents ?? 0;
    map.set(key, row);
  }
  const rows: SalesPivotRow[] = [...map.values()]
    .sort((a, b) => b.totalValueCents - a.totalValueCents || a.order - b.order)
    .map((row) => ({
      key: row.key,
      customerName: row.customerName,
      productDescription: row.productDescription,
      date: row.date,
      totalOperations: row.totalOperations,
      totalWeightKg: row.totalWeightKg,
      totalValueCents: row.totalValueCents,
      avgPriceCentsPerTon: avgPricePerTon(row.totalValueCents, row.totalWeightKg)
    }));

  const totals = rows.reduce(
    (acc, row) => ({
      totalOperations: acc.totalOperations + row.totalOperations,
      totalWeightKg: acc.totalWeightKg + row.totalWeightKg,
      totalValueCents: acc.totalValueCents + row.totalValueCents,
      avgPriceCentsPerTon: 0
    }),
    { totalOperations: 0, totalWeightKg: 0, totalValueCents: 0, avgPriceCentsPerTon: 0 }
  );
  totals.avgPriceCentsPerTon = avgPricePerTon(totals.totalValueCents, totals.totalWeightKg);

  return {
    rows,
    totals,
    customers: options(base, (op) => op.customer_id, customerName),
    products: options(base, (op) => op.product_id, productName)
  };
}

// ---------------------------------------------------------------------------
// Grafico
// ---------------------------------------------------------------------------

/**
 * Marcas "redondas" do eixo, de 0 ate cobrir `max` (o `getNiceTickValues` do Recharts que o
 * desktop usa): o passo e o passo bruto arredondado PARA CIMA num multiplo de 0,05 da sua
 * ordem de grandeza — 110 vira 150, 16.670 vira 20.000 — e o eixo sempre tem `count` marcas.
 */
export function niceTicks(max: number, count = 5): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const rough = max / (count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough) + 1);
  const ratio = Math.ceil(Number((rough / magnitude / 0.05).toFixed(9))) * 0.05;
  const step = Number((ratio * magnitude).toPrecision(12));
  return Array.from({ length: count }, (_, i) => Number((step * i).toPrecision(12)));
}

/**
 * Indices das legendas do eixo X que cabem: no maximo `max`, espacados por igual e sempre
 * com o ultimo dia (o Recharts do desktop pula legendas do mesmo jeito quando nao cabem).
 */
export function tickIndexes(count: number, max: number): number[] {
  if (count <= 0) return [];
  const limit = Math.max(1, Math.floor(max));
  if (count <= limit) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil((count - 1) / Math.max(1, limit - 1));
  const indexes: number[] = [];
  for (let i = count - 1; i >= 0; i -= step) indexes.unshift(i);
  return indexes;
}

/**
 * Caminho SVG de curva "monotone" (a `type="monotone"` do Recharts, que e a `curveMonotoneX`
 * do d3): passa por todos os pontos sem inventar pico nem vale entre eles.
 */
export function monotonePath(points: Array<{ x: number; y: number }>): string {
  const n = points.length;
  if (n === 0) return "";
  const fmt = (v: number) => Number(v.toFixed(2));
  if (n === 1) return `M${fmt(points[0].x)},${fmt(points[0].y)}`;
  if (n === 2) {
    return `M${fmt(points[0].x)},${fmt(points[0].y)}L${fmt(points[1].x)},${fmt(points[1].y)}`;
  }
  const sign = (v: number) => (v < 0 ? -1 : 1);
  const tangents = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const h0 = points[i].x - points[i - 1].x;
    const h1 = points[i + 1].x - points[i].x;
    const s0 = h0 ? (points[i].y - points[i - 1].y) / h0 : 0;
    const s1 = h1 ? (points[i + 1].y - points[i].y) / h1 : 0;
    const p = h0 + h1 ? (s0 * h1 + s1 * h0) / (h0 + h1) : 0;
    tangents[i] =
      (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
  }
  const endSlope = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => {
    const h = b.x - a.x;
    return h ? (3 * (b.y - a.y)) / h / 2 - t / 2 : t;
  };
  tangents[0] = endSlope(points[0], points[1], tangents[1]);
  tangents[n - 1] = endSlope(points[n - 2], points[n - 1], tangents[n - 2]);
  let path = `M${fmt(points[0].x)},${fmt(points[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = (b.x - a.x) / 3;
    path += `C${fmt(a.x + dx)},${fmt(a.y + dx * tangents[i])},${fmt(b.x - dx)},${fmt(
      b.y - dx * tangents[i + 1]
    )},${fmt(b.x)},${fmt(b.y)}`;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Leitura da nuvem
// ---------------------------------------------------------------------------

const PAGE = 1000;

/**
 * Pesagens da unidade que entram nas contas do periodo: concluidas e canceladas, recortadas
 * pela data de FECHAMENTO (`closed_at`) com a pesagem sem fechamento entrando pela criacao —
 * o mesmo filtro de `q.closedOperations`. O dia exato (fuso da pedreira) e conferido de novo
 * em `saleDay`, entao o intervalo aqui so precisa cobrir o periodo.
 */
export async function loadInsightsOperations(
  companyId: string,
  unitId: string,
  startIso: string,
  endIso: string
): Promise<InsightsOperation[]> {
  const rows: InsightsOperation[] = [];
  for (let page = 0; page < 100; page++) {
    const { data, error } = await supabase
      .from("weighing_operations")
      .select(INSIGHTS_COLUMNS)
      .eq("company_id", companyId)
      .eq("unit_id", unitId)
      .in("status", [...CLOSED_STATUSES, "cancelled"])
      .or(
        [
          `and(closed_at.gte."${startIso}",closed_at.lt."${endIso}")`,
          `and(closed_at.is.null,created_at.gte."${startIso}",created_at.lt."${endIso}")`
        ].join(",")
      )
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as InsightsOperation[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

/** Codigo de cada produto (vai no PDF, na tabela "Top 5 produtos por peso"). */
export async function loadProductCodes(companyId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("products")
    .select("id, code")
    .eq("company_id", companyId)
    .limit(5000);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).filter((row) => row.code).map((row) => [row.id, row.code ?? ""]));
}

// ---------------------------------------------------------------------------
// Exportar (PDF e Excel)
// ---------------------------------------------------------------------------

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

/** Toneladas com uma casa, como os cartoes e a tabela do desktop ("2.240,0 t"). */
export function formatTonsShort(kg: number): string {
  return `${(kg / 1000).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} t`;
}

export function formatKg(kg: number): string {
  return `${kg.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg`;
}

/** Valor por tonelada da linha; sem peso vira "-" (`perTonLabel` do desktop). */
export function perTonLabel(totalCents: number, netWeightKg: number): string {
  if (!Number.isFinite(totalCents) || !Number.isFinite(netWeightKg) || netWeightKg <= 0) {
    return "-";
  }
  return `${formatBRL(Math.round(totalCents / (netWeightKg / 1000)))}/t`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderTotalBar(items: Array<{ label: string; value: string; emphasis?: boolean }>) {
  const cell =
    "border:0;padding:9px 14px;background:#1d4ed8;color:#fff;font-family:Arial,Helvetica,sans-serif";
  const cells = items
    .map(
      (item) =>
        `<td style="${cell};text-align:right;white-space:nowrap"><span style="display:block;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#c7d2fe">${escapeHtml(
          item.label
        )}</span><strong style="display:block;margin-top:2px;line-height:1.2;font-size:${
          item.emphasis ? 19 : 15
        }px">${escapeHtml(item.value)}</strong></td>`
    )
    .join("");
  return `<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;margin-top:18px;background:#1d4ed8;color:#fff;border-radius:10px;break-inside:avoid;page-break-inside:avoid"><tbody><tr><td style="${cell};font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;white-space:nowrap">Total do periodo</td>${cells}</tr></tbody></table>`;
}

/** O "Painel de Insights" A4 do botao Exportar PDF (`exportInsightsToHtml`). */
export function insightsReportHtml(
  operations: InsightsOperation[],
  range: InsightsDateRange,
  productCodes: ReadonlyMap<string, string> = new Map(),
  generatedAt: Date = new Date()
): string {
  const series = dailySeries(operations, range);
  const topProducts = reportByProduct(operations, range, productCodes).slice(0, 5);
  const topCustomers = reportByCustomer(operations, range).slice(0, 10);
  const mix = operationMix(operations, range);
  const { operations: count, weightKg, totalCents, ticketCents } = seriesTotals(series);

  const kpiCards = [
    ["Operacoes", count.toLocaleString("pt-BR")],
    ["Peso liquido", formatTonsShort(weightKg)],
    ["Faturamento", formatBRL(totalCents)],
    ["Ticket medio", formatBRL(ticketCents)]
  ]
    .map(
      ([label, value]) =>
        `<div class="kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
    )
    .join("");

  const mixRows = [
    { name: "Com nota", ...mix.invoice, value: formatBRL(mix.invoice.totalCents) },
    { name: "Interna", ...mix.internal, value: formatBRL(mix.internal.totalCents) },
    { name: "Cancelada", ...mix.cancelled, value: "-" }
  ];
  const mixCount = mixRows.reduce((sum, row) => sum + row.count, 0);
  const mixBody = mixRows
    .map((row) => {
      const pct = mixCount > 0 ? (row.count / mixCount) * 100 : 0;
      return `<tr><td>${row.name}</td><td class="num">${row.count.toLocaleString(
        "pt-BR"
      )}</td><td class="num">${pct.toLocaleString("pt-BR", {
        maximumFractionDigits: 1
      })}%</td><td class="num">${formatTonsShort(row.weightKg)}</td><td class="num">${row.value}</td></tr>`;
    })
    .join("");

  const productsBody = topProducts.length
    ? topProducts
        .map(
          (p, i) =>
            `<tr><td class="num">${i + 1}</td><td>${escapeHtml(p.productDescription)}</td><td>${escapeHtml(
              p.productCode
            )}</td><td class="num">${p.totalOperations}</td><td class="num">${formatTonsShort(
              p.totalWeightKg
            )}</td><td class="num">${formatBRL(p.totalValueCents)}</td></tr>`
        )
        .join("")
    : '<tr><td colspan="6" class="empty">Sem produtos no periodo.</td></tr>';

  const customersBody = topCustomers.length
    ? topCustomers
        .map(
          (c, i) =>
            `<tr><td class="num">${i + 1}</td><td>${escapeHtml(c.customerName)}</td><td class="num">${
              c.totalOperations
            }</td><td class="num">${formatTonsShort(c.totalWeightKg)}</td><td class="num">${formatBRL(
              avgPricePerTon(c.totalValueCents, c.totalWeightKg)
            )}/t</td><td class="num">${formatBRL(c.totalValueCents)}</td></tr>`
        )
        .join("")
    : '<tr><td colspan="6" class="empty">Sem clientes no periodo.</td></tr>';

  const seriesBody = series.some((point) => point.totalOperations > 0)
    ? series
        .map(
          (point) =>
            `<tr><td>${formatDayLabel(point.date)}</td><td class="num">${
              point.totalOperations
            }</td><td class="num">${formatTonsShort(point.totalNetWeightKg)}</td><td class="num">${formatBRL(
              point.totalCents
            )}</td></tr>`
        )
        .join("")
    : '<tr><td colspan="4" class="empty">Sem operacoes fechadas no periodo.</td></tr>';

  const periodText = `${escapeHtml(range.label)} &middot; ${formatDayLabel(range.start)} a ${formatDayLabel(
    range.end
  )}`;

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>Painel de Insights</title><style>
:root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--soft:#f8fafc;--brand:#1d4ed8}
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:var(--ink);margin:0;font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.header{display:flex;justify-content:space-between;align-items:flex-end;border-left:6px solid var(--brand);padding:4px 0 14px 14px;margin-bottom:8px;border-bottom:2px solid var(--line)}
.header h1{margin:0;font-size:22px;letter-spacing:.2px}
.header .period{margin:6px 0 0;color:var(--muted);font-size:13px}
.header .generated{color:var(--muted);font-size:11px;text-align:right;white-space:nowrap}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0 8px}
.kpi{border:1px solid var(--line);border-top:3px solid var(--brand);border-radius:10px;padding:10px 12px;background:var(--soft)}
.kpi span{display:block;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.kpi strong{display:block;margin-top:4px;font-size:18px}
section{margin-top:18px;break-inside:avoid}
h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 8px;font-weight:800}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{border:1px solid var(--line);padding:7px 9px;text-align:left}
th{background:var(--line);font-size:11px;text-transform:uppercase;letter-spacing:.03em}
tbody tr:nth-child(even){background:var(--soft)}
tr{break-inside:avoid}
.num{text-align:right;white-space:nowrap}
.empty{text-align:center;color:var(--muted);font-style:italic}
tfoot td{font-weight:bold;background:#eef2ff;border-top:2px solid var(--brand)}
@page{size:A4;margin:14mm}
</style></head><body>
<div class="header"><div><h1>Painel de Insights</h1><p class="period">${periodText}</p></div><div class="generated">Gerado em<br />${escapeHtml(
    generatedAt.toLocaleString("pt-BR")
  )}</div></div>
<div class="kpis">${kpiCards}</div>
<section><h2>Mix de operacoes</h2><table><thead><tr><th>Tipo</th><th class="num">Operacoes</th><th class="num">% oper.</th><th class="num">Peso</th><th class="num">Faturamento</th></tr></thead><tbody>${mixBody}</tbody></table></section>
<section><h2>Top 5 produtos por peso</h2><table><thead><tr><th class="num">#</th><th>Produto</th><th>Codigo</th><th class="num">Operacoes</th><th class="num">Peso</th><th class="num">Valor produto</th></tr></thead><tbody>${productsBody}</tbody></table></section>
<section><h2>Vendas por cliente</h2><table><thead><tr><th class="num">#</th><th>Cliente</th><th class="num">Operacoes</th><th class="num">Peso</th><th class="num">Preco medio</th><th class="num">Total</th></tr></thead><tbody>${customersBody}</tbody></table></section>
<section><h2>Evolucao diaria</h2><table><thead><tr><th>Data</th><th class="num">Operacoes</th><th class="num">Peso liquido</th><th class="num">Faturamento</th></tr></thead><tbody>${seriesBody}</tbody><tfoot><tr><td>Total</td><td class="num">${count.toLocaleString(
    "pt-BR"
  )}</td><td class="num">${formatTonsShort(weightKg)}</td><td class="num">${formatBRL(
    totalCents
  )}</td></tr></tfoot></table></section>
${renderTotalBar([
  { label: "Operacoes", value: count.toLocaleString("pt-BR") },
  { label: "Peso liquido", value: formatTonsShort(weightKg) },
  { label: "Ticket medio", value: formatBRL(ticketCents) },
  { label: "Faturamento", value: formatBRL(totalCents), emphasis: true }
])}
</body></html>`;
}

/**
 * A planilha do botao Exportar Excel (`exportRangeToSpreadsheet`): resumo do periodo e as
 * cargas uma a uma, em ordem de fechamento. HTML de tabelas com extensao `.xls`, montado com o
 * MESMO `sheetTable` do desktop (`desktop/report-document.ts`): celulas tipadas, larguras de
 * coluna e alinhamento iguais aos do arquivo que a balanca salva.
 */
export function rangeSpreadsheetHtml(
  operations: InsightsOperation[],
  range: Pick<InsightsDateRange, "start" | "end">,
  generatedAt: Date = new Date()
): string {
  const rows = closedInRange(operations, range)
    .map((op) => ({ op, at: op.closed_at ?? op.created_at }))
    .sort((a, b) => a.at.localeCompare(b.at))
    .map(({ op }) => ({
      date: saleDay(op),
      customerName: op.customer_name || "N/A",
      productDescription: op.product_description || "N/A",
      netWeightKg: op.net_weight_kg ?? 0,
      productTotalCents: op.product_total_cents ?? 0,
      freightTotalCents: op.freight_total_cents ?? 0,
      totalCents: op.total_cents ?? 0
    }));
  const totalWeight = rows.reduce((sum, op) => sum + op.netWeightKg, 0);
  const totalProduct = rows.reduce((sum, op) => sum + op.productTotalCents, 0);
  const totalFreight = rows.reduce((sum, op) => sum + op.freightTotalCents, 0);
  const total = rows.reduce((sum, op) => sum + op.totalCents, 0);
  const period = `${formatDayLabel(range.start)} a ${formatDayLabel(range.end)}`;

  const blocks = [
    sheetTable(
      "Periodo",
      ["Campo", "Valor"],
      [
        ["Periodo", period],
        ["Carregamentos", rows.length.toLocaleString("pt-BR")],
        ["Peso liquido (kg)", totalWeight.toLocaleString("pt-BR")],
        [
          "Tonelagem (t)",
          (totalWeight / 1000).toLocaleString("pt-BR", {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1
          })
        ],
        ["Valor produto", formatBRL(totalProduct)],
        ["Valor frete", formatBRL(totalFreight)],
        ["Total", formatBRL(total)],
        ["Gerado em", generatedAt.toLocaleString("pt-BR")]
      ]
    ),
    sheetTable(
      "Carregamentos do periodo",
      [
        "Data",
        "Cliente",
        "Produto",
        "Peso (kg)",
        "Produto (R$/t)",
        "Produto (R$)",
        "Frete (R$/t)",
        "Frete (R$)",
        "Total (R$)"
      ],
      rows.map((op) => [
        formatDayLabel(op.date),
        op.customerName,
        op.productDescription,
        op.netWeightKg.toLocaleString("pt-BR"),
        perTonLabel(op.productTotalCents, op.netWeightKg),
        formatBRL(op.productTotalCents),
        perTonLabel(op.freightTotalCents, op.netWeightKg),
        formatBRL(op.freightTotalCents),
        formatBRL(op.totalCents)
      ]),
      rows.length > 0
        ? [
            "TOTAL",
            "",
            "",
            totalWeight.toLocaleString("pt-BR"),
            perTonLabel(totalProduct, totalWeight),
            formatBRL(totalProduct),
            perTonLabel(totalFreight, totalWeight),
            formatBRL(totalFreight),
            formatBRL(total)
          ]
        : null
    )
  ];

  return `<!doctype html><html ${SPREADSHEET_HTML_ATTRS}><head><meta charset="utf-8" /><title>${escapeHtml(
    `Relatorio KyberRock - ${period}`
  )}</title><style>${SPREADSHEET_STYLE}</style></head><body>
<h1>Relatorio KyberRock</h1>
<p class="sub">${escapeHtml(`${period} - gerado em ${generatedAt.toLocaleString("pt-BR")}`)}</p>
${blocks.join("\n")}
</body></html>`;
}
