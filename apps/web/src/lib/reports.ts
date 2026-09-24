/**
 * Relatorios do site — espelho das contas de `apps/desktop/src/services/reports.ts`
 * (fechamento diario, periodo, tabela dinamica de vendas e mensal), feitas no navegador sobre
 * as pesagens concluidas que a nuvem guarda.
 *
 * A regra que nao pode se perder (CLAUDE.md, "Data da pesagem nos relatorios"): relatorio de
 * DINHEIRO recorta e agrupa pela data em que a pesagem FECHOU (`closed_at`), que e a data que
 * sobe ao OMIE como emissao do pedido. Operacao antiga sem `closed_at` cai pela criacao.
 */

import { localDay } from "./format";
import { supabase, type Tables } from "./supabase";

export type ReportOperation = Pick<
  Tables<"weighing_operations">,
  | "id"
  | "unit_id"
  | "customer_id"
  | "customer_name"
  | "product_id"
  | "product_description"
  | "net_weight_kg"
  | "product_total_cents"
  | "freight_total_cents"
  | "total_cents"
  | "freight_type"
  | "closed_at"
  | "created_at"
>;

export type ReportUnit = Pick<Tables<"units">, "id" | "name">;

/** Unidades da empresa, para escolher de qual balanca e o relatorio. */
export async function reportUnits(companyId: string): Promise<ReportUnit[]> {
  const { data, error } = await supabase
    .from("units")
    .select("id, name")
    .eq("company_id", companyId)
    .order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Instante da venda: o fechamento, com a criacao de reserva (o `operationSaleDateSql`). */
export function saleInstant(op: Pick<ReportOperation, "closed_at" | "created_at">): string {
  return op.closed_at ?? op.created_at;
}

/** Dia da venda (AAAA-MM-DD) no fuso da pedreira. */
export function saleDay(op: Pick<ReportOperation, "closed_at" | "created_at">): string {
  return localDay(saleInstant(op));
}

/** `""` = todas as unidades. */
export function filterByUnit<T extends Pick<ReportOperation, "unit_id">>(
  ops: T[],
  unitId: string
): T[] {
  return unitId ? ops.filter((op) => op.unit_id === unitId) : ops;
}

// ---------------------------------------------------------------------------
// Linhas do periodo (getDailyReport / getRangeOperations)
// ---------------------------------------------------------------------------

export interface ReportLine {
  id: string;
  date: string;
  customerName: string;
  productDescription: string;
  netWeightKg: number;
  productTotalCents: number;
  freightTotalCents: number;
  totalCents: number;
}

export interface ReportTotals {
  operations: number;
  netWeightKg: number;
  productTotalCents: number;
  freightTotalCents: number;
  totalCents: number;
}

/** Uma linha por pesagem, na ordem em que fecharam. */
export function reportLines(ops: ReportOperation[]): ReportLine[] {
  return [...ops]
    .sort((a, b) => saleInstant(a).localeCompare(saleInstant(b)))
    .map((op) => ({
      id: op.id,
      date: saleDay(op),
      customerName: op.customer_name || "N/A",
      productDescription: op.product_description || "N/A",
      netWeightKg: op.net_weight_kg ?? 0,
      productTotalCents: op.product_total_cents ?? 0,
      freightTotalCents: op.freight_total_cents ?? 0,
      totalCents: op.total_cents ?? 0
    }));
}

/** Linhas de UM dia (o fechamento diario). */
export function dailyLines(ops: ReportOperation[], day: string): ReportLine[] {
  return reportLines(ops).filter((line) => line.date === day);
}

export function sumLines(lines: ReportLine[]): ReportTotals {
  return lines.reduce<ReportTotals>(
    (acc, line) => ({
      operations: acc.operations + 1,
      netWeightKg: acc.netWeightKg + line.netWeightKg,
      productTotalCents: acc.productTotalCents + line.productTotalCents,
      freightTotalCents: acc.freightTotalCents + line.freightTotalCents,
      totalCents: acc.totalCents + line.totalCents
    }),
    { operations: 0, netWeightKg: 0, productTotalCents: 0, freightTotalCents: 0, totalCents: 0 }
  );
}

/**
 * Centavos por tonelada, DERIVADO do total da propria linha (`report-unit-price.ts` do
 * desktop). `null` sem peso: dividir por zero nao informa nada.
 */
export function centsPerTon(totalCents: number, netWeightKg: number): number | null {
  if (!Number.isFinite(totalCents) || !Number.isFinite(netWeightKg)) return null;
  if (netWeightKg <= 0) return null;
  return Math.round(totalCents / (netWeightKg / 1000));
}

// ---------------------------------------------------------------------------
// Tabela dinamica de vendas (getSalesPivot)
// ---------------------------------------------------------------------------

export type SalesPivotGroupBy = "customer" | "product" | "customer_product" | "day";

/**
 * Filtro de frete do relatorio de vendas (o do antigo portal do comercial): "com frete" e a
 * pesagem que tem VALOR de frete — na nota (`fob`), so no sistema (`cif`) ou o transporte
 * proprio do catalogo antigo (`own_sender`); o resto (`third_party`, `own_recipient`, `none`)
 * e "sem frete". Veio do relatorio de vendas do antigo portal do comercial.
 */
export type SalesFreightFilter = "all" | "with" | "without";

const FREIGHT_TYPES_WITH_FREIGHT = ["cif", "fob", "own_sender"];

export function hasFreight(freightType: string | null | undefined): boolean {
  return typeof freightType === "string" && FREIGHT_TYPES_WITH_FREIGHT.includes(freightType);
}

export interface SalesPivotFilters {
  customerId?: string | null;
  productId?: string | null;
  freight?: SalesFreightFilter;
}

export interface SalesPivotRow {
  key: string;
  customerName: string | null;
  productDescription: string | null;
  date: string | null;
  totalOperations: number;
  totalWeightKg: number;
  /** Valor do PRODUTO (sem frete): e dele que sai o preco medio. */
  totalValueCents: number;
  freightCents: number;
  /** Produto + frete: o total da venda. */
  grandTotalCents: number;
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
    freightCents: number;
    grandTotalCents: number;
    avgPriceCentsPerTon: number;
  };
  customers: SalesPivotOption[];
  products: SalesPivotOption[];
}

/** Preco medio por tonelada da tabela dinamica: sem peso vale 0 (como no desktop). */
function avgPricePerTon(valueCents: number, weightKg: number): number {
  return weightKg > 0 ? Math.round(valueCents / (weightKg / 1000)) : 0;
}

function distinctOptions(entries: Array<[string | null, string | null]>): SalesPivotOption[] {
  const map = new Map<string, string>();
  for (const [id, name] of entries) {
    if (id && !map.has(id)) map.set(id, name || "N/A");
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * Agrupa por cliente, produto, cliente + produto ou dia. O valor e o do PRODUTO (sem frete),
 * como no desktop, e o preco medio sai dele. As opcoes de filtro sao as presentes no periodo,
 * sem os filtros aplicados.
 */
export function salesPivot(
  ops: ReportOperation[],
  groupBy: SalesPivotGroupBy,
  filters: SalesPivotFilters = {}
): SalesPivotResult {
  const filtered = ops.filter(
    (op) =>
      (!filters.customerId || op.customer_id === filters.customerId) &&
      (!filters.productId || op.product_id === filters.productId) &&
      (!filters.freight ||
        filters.freight === "all" ||
        hasFreight(op.freight_type) === (filters.freight === "with"))
  );

  const groups = new Map<string, SalesPivotRow>();
  for (const op of filtered) {
    // O desktop agrupa pelo id do cadastro. Na nuvem a pesagem tambem guarda o NOME (foto do
    // momento da venda): sem id, o nome separa os grupos em vez de juntar tudo em "N/A".
    const customerKey = op.customer_id ?? (op.customer_name ? `nome:${op.customer_name}` : "");
    const productKey =
      op.product_id ?? (op.product_description ? `nome:${op.product_description}` : "");
    const day = saleDay(op);
    const key =
      groupBy === "customer"
        ? customerKey
        : groupBy === "product"
          ? productKey
          : groupBy === "customer_product"
            ? `${customerKey}|${productKey}`
            : day;
    const row = groups.get(key) ?? {
      key,
      customerName:
        groupBy === "customer" || groupBy === "customer_product"
          ? customerKey
            ? op.customer_name || "N/A"
            : null
          : null,
      productDescription:
        groupBy === "product" || groupBy === "customer_product"
          ? productKey
            ? op.product_description || "N/A"
            : null
          : null,
      date: groupBy === "day" ? day : null,
      totalOperations: 0,
      totalWeightKg: 0,
      totalValueCents: 0,
      freightCents: 0,
      grandTotalCents: 0,
      avgPriceCentsPerTon: 0
    };
    const productCents = op.product_total_cents ?? 0;
    const freightCents = op.freight_total_cents ?? 0;
    row.totalOperations += 1;
    row.totalWeightKg += op.net_weight_kg ?? 0;
    row.totalValueCents += productCents;
    row.freightCents += freightCents;
    row.grandTotalCents += op.total_cents ?? productCents + freightCents;
    groups.set(key, row);
  }

  const rows = [...groups.values()]
    .map((row) => ({
      ...row,
      avgPriceCentsPerTon: avgPricePerTon(row.totalValueCents, row.totalWeightKg)
    }))
    .sort((a, b) => b.totalValueCents - a.totalValueCents || a.key.localeCompare(b.key));

  const totalOperations = rows.reduce((sum, row) => sum + row.totalOperations, 0);
  const totalWeightKg = rows.reduce((sum, row) => sum + row.totalWeightKg, 0);
  const totalValueCents = rows.reduce((sum, row) => sum + row.totalValueCents, 0);
  const freightCents = rows.reduce((sum, row) => sum + row.freightCents, 0);
  const grandTotalCents = rows.reduce((sum, row) => sum + row.grandTotalCents, 0);

  return {
    rows,
    totals: {
      totalOperations,
      totalWeightKg,
      totalValueCents,
      freightCents,
      grandTotalCents,
      avgPriceCentsPerTon: avgPricePerTon(totalValueCents, totalWeightKg)
    },
    customers: distinctOptions(ops.map((op) => [op.customer_id, op.customer_name])),
    products: distinctOptions(ops.map((op) => [op.product_id, op.product_description]))
  };
}

// ---------------------------------------------------------------------------
// Mensal (getMonthlyReport + getDailySeries)
// ---------------------------------------------------------------------------

/** Atalhos de periodo do antigo portal do comercial. */
export type PeriodPreset = "today" | "7d" | "30d" | "month" | "lastMonth";

export const PERIOD_PRESETS: Array<{ id: PeriodPreset; label: string }> = [
  { id: "today", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
  { id: "month", label: "Este mes" },
  { id: "lastMonth", label: "Mes passado" }
];

function shiftDay(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Datas (AAAA-MM-DD) do atalho, contando o dia de hoje. */
export function presetRange(preset: PeriodPreset, today: string): { start: string; end: string } {
  if (preset === "today") return { start: today, end: today };
  if (preset === "7d") return { start: shiftDay(today, -6), end: today };
  if (preset === "30d") return { start: shiftDay(today, -29), end: today };
  if (preset === "month") return { start: `${today.slice(0, 7)}-01`, end: today };
  const lastOfPrevious = shiftDay(`${today.slice(0, 7)}-01`, -1);
  return { start: `${lastOfPrevious.slice(0, 7)}-01`, end: lastOfPrevious };
}

/** "2026-09" -> primeiro e ultimo dia do mes. */
export function monthRange(month: string): { start: string; end: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const mm = String(monthNumber).padStart(2, "0");
  return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}` };
}

export interface DailySeriesPoint extends ReportTotals {
  date: string;
}

/** Um ponto por dia do intervalo, inclusive os dias sem venda (zerados). */
export function dailySeries(
  ops: ReportOperation[],
  startDay: string,
  endDay: string
): DailySeriesPoint[] {
  const start = new Date(`${startDay}T00:00:00Z`);
  const end = new Date(`${endDay}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const byDay = new Map<string, ReportLine[]>();
  for (const line of reportLines(ops)) {
    const list = byDay.get(line.date) ?? [];
    list.push(line);
    byDay.set(line.date, list);
  }
  const series: DailySeriesPoint[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    series.push({ date, ...sumLines(byDay.get(date) ?? []) });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}

/** Total do mes (o `getMonthlyReport`) somando a serie diaria. */
export function sumSeries(series: ReportTotals[]): ReportTotals {
  return series.reduce<ReportTotals>(
    (acc, point) => ({
      operations: acc.operations + point.operations,
      netWeightKg: acc.netWeightKg + point.netWeightKg,
      productTotalCents: acc.productTotalCents + point.productTotalCents,
      freightTotalCents: acc.freightTotalCents + point.freightTotalCents,
      totalCents: acc.totalCents + point.totalCents
    }),
    { operations: 0, netWeightKg: 0, productTotalCents: 0, freightTotalCents: 0, totalCents: 0 }
  );
}

// ---------------------------------------------------------------------------
// Exportacao (CSV pt-BR, o `exportDailyToCSV` do desktop)
// ---------------------------------------------------------------------------

/** "2026-07-15" -> "15/07/2026"; devolve a entrada crua fora do formato ISO. */
export function formatDayLabel(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

/** Centavos -> "1234,56": o Excel brasileiro abre como NUMERO. */
export function csvMoney(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/** R$/t para a planilha; "-" sem peso. */
export function csvPerTon(totalCents: number, netWeightKg: number): string {
  const cents = centsPerTon(totalCents, netWeightKg);
  return cents === null ? "-" : csvMoney(cents);
}

/** Kg -> toneladas com 3 casas e virgula. */
export function csvTons(kg: number): string {
  return (kg / 1000).toFixed(3).replace(".", ",");
}

function csvCell(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * Separador ";" e BOM: sem o BOM o Excel abre como ANSI e todo acento vira lixo; com a
 * virgula de separador, o valor decimal quebraria em duas colunas.
 */
export function toCsv(rows: string[][]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}

/** Fechamento diario — as mesmas colunas do CSV do desktop. */
export function dailyCsv(day: string, lines: ReportLine[]): string {
  const totals = sumLines(lines);
  return toCsv([
    [
      "Data",
      "Cliente",
      "Produto",
      "Peso Liquido (kg)",
      "Valor Produto (R$)",
      "Frete (R$)",
      "Total (R$)"
    ],
    ...lines.map((line) => [
      formatDayLabel(day),
      line.customerName,
      line.productDescription,
      String(line.netWeightKg),
      csvMoney(line.productTotalCents),
      csvMoney(line.freightTotalCents),
      csvMoney(line.totalCents)
    ]),
    [
      "TOTAL",
      "",
      "",
      String(totals.netWeightKg),
      csvMoney(totals.productTotalCents),
      csvMoney(totals.freightTotalCents),
      csvMoney(totals.totalCents)
    ]
  ]);
}

/** Carregamentos do periodo — as colunas da planilha do desktop (`exportRangeToSpreadsheet`). */
export function periodCsv(lines: ReportLine[]): string {
  const totals = sumLines(lines);
  return toCsv([
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
    ...lines.map((line) => [
      formatDayLabel(line.date),
      line.customerName,
      line.productDescription,
      String(line.netWeightKg),
      csvPerTon(line.productTotalCents, line.netWeightKg),
      csvMoney(line.productTotalCents),
      csvPerTon(line.freightTotalCents, line.netWeightKg),
      csvMoney(line.freightTotalCents),
      csvMoney(line.totalCents)
    ]),
    ...(lines.length > 0
      ? [
          [
            "TOTAL",
            "",
            "",
            String(totals.netWeightKg),
            csvPerTon(totals.productTotalCents, totals.netWeightKg),
            csvMoney(totals.productTotalCents),
            csvPerTon(totals.freightTotalCents, totals.netWeightKg),
            csvMoney(totals.freightTotalCents),
            csvMoney(totals.totalCents)
          ]
        ]
      : [])
  ]);
}

/** Colunas de agrupamento da tabela dinamica, na ordem da tela. */
export function pivotGroupColumns(
  groupBy: SalesPivotGroupBy
): Array<"day" | "customer" | "product"> {
  if (groupBy === "day") return ["day"];
  if (groupBy === "customer") return ["customer"];
  if (groupBy === "product") return ["product"];
  return ["customer", "product"];
}

const PIVOT_COLUMN_LABEL = { day: "Dia", customer: "Cliente", product: "Produto" } as const;

export function pivotCsv(result: SalesPivotResult, groupBy: SalesPivotGroupBy): string {
  const columns = pivotGroupColumns(groupBy);
  const cellFor = (row: SalesPivotRow, column: "day" | "customer" | "product"): string =>
    column === "day"
      ? row.date
        ? formatDayLabel(row.date)
        : "-"
      : column === "customer"
        ? (row.customerName ?? "N/A")
        : (row.productDescription ?? "N/A");
  return toCsv([
    [
      ...columns.map((column) => PIVOT_COLUMN_LABEL[column]),
      "Operacoes",
      "Quantidade (t)",
      "Preco medio (R$/t)",
      "Valor produto (R$)",
      "Frete (R$)",
      "Total (R$)"
    ],
    ...result.rows.map((row) => [
      ...columns.map((column) => cellFor(row, column)),
      String(row.totalOperations),
      csvTons(row.totalWeightKg),
      csvMoney(row.avgPriceCentsPerTon),
      csvMoney(row.totalValueCents),
      csvMoney(row.freightCents),
      csvMoney(row.grandTotalCents)
    ]),
    ...(result.rows.length > 0
      ? [
          [
            "TOTAL",
            ...columns.slice(1).map(() => ""),
            String(result.totals.totalOperations),
            csvTons(result.totals.totalWeightKg),
            csvMoney(result.totals.avgPriceCentsPerTon),
            csvMoney(result.totals.totalValueCents),
            csvMoney(result.totals.freightCents),
            csvMoney(result.totals.grandTotalCents)
          ]
        ]
      : [])
  ]);
}

export function monthlyCsv(series: DailySeriesPoint[]): string {
  const totals = sumSeries(series);
  return toCsv([
    ["Data", "Operacoes", "Peso Liquido (kg)", "Valor Produto (R$)", "Frete (R$)", "Total (R$)"],
    ...series.map((point) => [
      formatDayLabel(point.date),
      String(point.operations),
      String(point.netWeightKg),
      csvMoney(point.productTotalCents),
      csvMoney(point.freightTotalCents),
      csvMoney(point.totalCents)
    ]),
    [
      "TOTAL",
      String(totals.operations),
      String(totals.netWeightKg),
      csvMoney(totals.productTotalCents),
      csvMoney(totals.freightTotalCents),
      csvMoney(totals.totalCents)
    ]
  ]);
}
