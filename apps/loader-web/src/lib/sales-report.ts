/**
 * Agregacao pura do relatorio de vendas do Comercial: visoes por produto,
 * por cliente, cliente x produto e por dia, a partir das operacoes de pesagem
 * fechadas projetadas no Supabase (`weighing_operations`).
 */

/** Mesmo criterio de "venda concluida" do daily-report-email. */
export const SALES_CLOSED_STATUSES = ["closed_local", "pending_omie", "synced"] as const;

/** Offset fixo de Brasilia usado nos relatorios (igual a _shared/report-schedule). */
export const REPORT_UTC_OFFSET_MINUTES = -180;

export type SalesGroupBy = "product" | "customer" | "customer_product" | "day";

export interface SalesOperationRow {
  customer_id?: string | null;
  customer_name?: string | null;
  product_id?: string | null;
  product_description?: string | null;
  net_weight_kg?: number | string | null;
  product_total_cents?: number | string | null;
  freight_total_cents?: number | string | null;
  total_cents?: number | string | null;
  created_at: string;
}

export interface SalesReportLine {
  key: string;
  day: string | null;
  customerName: string | null;
  productDescription: string | null;
  operations: number;
  netWeightKg: number;
  productTotalCents: number;
  freightTotalCents: number;
  totalCents: number;
  avgPriceCentsPerTon: number | null;
}

export interface SalesReportTotals {
  operations: number;
  netWeightKg: number;
  productTotalCents: number;
  freightTotalCents: number;
  totalCents: number;
  avgPriceCentsPerTon: number | null;
}

export interface SalesReportResult {
  lines: SalesReportLine[];
  totals: SalesReportTotals;
}

/** Dia (AAAA-MM-DD) no fuso do relatorio, a partir do timestamp UTC da nuvem. */
export function toReportDay(
  createdAt: string,
  offsetMinutes: number = REPORT_UTC_OFFSET_MINUTES
): string | null {
  const parsed = Date.parse(createdAt);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function groupKey(row: SalesOperationRow, groupBy: SalesGroupBy): string {
  const customer = row.customer_id || row.customer_name || "sem-cliente";
  const product = row.product_id || row.product_description || "sem-produto";
  if (groupBy === "product") return `p:${product}`;
  if (groupBy === "customer") return `c:${customer}`;
  if (groupBy === "customer_product") return `cp:${customer}|${product}`;
  return `d:${toReportDay(row.created_at) ?? "sem-data"}`;
}

export function aggregateSalesReport(
  rows: SalesOperationRow[],
  groupBy: SalesGroupBy
): SalesReportResult {
  const byKey = new Map<string, SalesReportLine>();

  for (const row of rows) {
    const key = groupKey(row, groupBy);
    let line = byKey.get(key);
    if (!line) {
      line = {
        key,
        day: groupBy === "day" ? toReportDay(row.created_at) : null,
        customerName:
          groupBy === "customer" || groupBy === "customer_product"
            ? row.customer_name || "Cliente nao informado"
            : null,
        productDescription:
          groupBy === "product" || groupBy === "customer_product"
            ? row.product_description || "Produto nao informado"
            : null,
        operations: 0,
        netWeightKg: 0,
        productTotalCents: 0,
        freightTotalCents: 0,
        totalCents: 0,
        avgPriceCentsPerTon: null
      };
      byKey.set(key, line);
    }
    line.operations += 1;
    line.netWeightKg += toNumber(row.net_weight_kg);
    line.productTotalCents += Math.round(toNumber(row.product_total_cents));
    line.freightTotalCents += Math.round(toNumber(row.freight_total_cents));
    line.totalCents += Math.round(toNumber(row.total_cents));
  }

  const lines = Array.from(byKey.values());
  for (const line of lines) {
    line.avgPriceCentsPerTon = averagePriceCentsPerTon(line.productTotalCents, line.netWeightKg);
  }

  if (groupBy === "day") {
    lines.sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""));
  } else {
    lines.sort((a, b) => b.totalCents - a.totalCents);
  }

  const totals: SalesReportTotals = {
    operations: 0,
    netWeightKg: 0,
    productTotalCents: 0,
    freightTotalCents: 0,
    totalCents: 0,
    avgPriceCentsPerTon: null
  };
  for (const line of lines) {
    totals.operations += line.operations;
    totals.netWeightKg += line.netWeightKg;
    totals.productTotalCents += line.productTotalCents;
    totals.freightTotalCents += line.freightTotalCents;
    totals.totalCents += line.totalCents;
  }
  totals.avgPriceCentsPerTon = averagePriceCentsPerTon(
    totals.productTotalCents,
    totals.netWeightKg
  );

  return { lines, totals };
}

function averagePriceCentsPerTon(productTotalCents: number, netWeightKg: number): number | null {
  if (netWeightKg <= 0) return null;
  return Math.round(productTotalCents / (netWeightKg / 1000));
}

const CSV_GROUP_LABEL: Record<SalesGroupBy, string[]> = {
  product: ["Produto"],
  customer: ["Cliente"],
  customer_product: ["Cliente", "Produto"],
  day: ["Dia"]
};

function csvNumber(value: number, decimals = 2): string {
  return value.toFixed(decimals).replace(".", ",");
}

function csvCell(value: string): string {
  return /[";\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** CSV pt-BR (separador ';', decimal ',') pronto para abrir no Excel. */
export function buildSalesReportCsv(result: SalesReportResult, groupBy: SalesGroupBy): string {
  const header = [
    ...CSV_GROUP_LABEL[groupBy],
    "Operacoes",
    "Peso liquido (t)",
    "Preco medio (R$/t)",
    "Valor produto (R$)",
    "Frete (R$)",
    "Total (R$)"
  ];

  const rows = result.lines.map((line) => {
    const groupCells =
      groupBy === "customer_product"
        ? [line.customerName ?? "", line.productDescription ?? ""]
        : groupBy === "customer"
          ? [line.customerName ?? ""]
          : groupBy === "product"
            ? [line.productDescription ?? ""]
            : [line.day ?? ""];
    return [
      ...groupCells.map(csvCell),
      String(line.operations),
      csvNumber(line.netWeightKg / 1000, 3),
      line.avgPriceCentsPerTon === null ? "" : csvNumber(line.avgPriceCentsPerTon / 100),
      csvNumber(line.productTotalCents / 100),
      csvNumber(line.freightTotalCents / 100),
      csvNumber(line.totalCents / 100)
    ].join(";");
  });

  const totals = result.totals;
  const totalRow = [
    ...CSV_GROUP_LABEL[groupBy].map((_, index) => (index === 0 ? "TOTAL" : "")),
    String(totals.operations),
    csvNumber(totals.netWeightKg / 1000, 3),
    totals.avgPriceCentsPerTon === null ? "" : csvNumber(totals.avgPriceCentsPerTon / 100),
    csvNumber(totals.productTotalCents / 100),
    csvNumber(totals.freightTotalCents / 100),
    csvNumber(totals.totalCents / 100)
  ].join(";");

  // BOM para o Excel reconhecer UTF-8.
  return `\uFEFF${[header.join(";"), ...rows, totalRow].join("\r\n")}`;
}
