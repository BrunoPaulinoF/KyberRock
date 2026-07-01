import type { DesktopDatabase } from "../database/sqlite.js";

export interface DailyReport {
  date: string;
  totalOperations: number;
  totalNetWeightKg: number;
  totalProductCents: number;
  totalFreightCents: number;
  totalCents: number;
  operations: Array<{
    id: string;
    customerName: string;
    productDescription: string;
    netWeightKg: number;
    productTotalCents: number;
    freightTotalCents: number;
    totalCents: number;
  }>;
}

export interface MonthlyReport {
  year: number;
  month: number;
  totalOperations: number;
  totalNetWeightKg: number;
  totalProductCents: number;
  totalFreightCents: number;
  totalCents: number;
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

export interface DailySeriesPoint {
  date: string;
  totalOperations: number;
  totalNetWeightKg: number;
  totalCents: number;
}

export interface OperationMix {
  invoice: { count: number; weightKg: number; totalCents: number };
  internal: { count: number; weightKg: number; totalCents: number };
  cancelled: { count: number; weightKg: number };
}

interface RangeReportOperation {
  date: string;
  customerName: string;
  productDescription: string;
  netWeightKg: number;
  productTotalCents: number;
  freightTotalCents: number;
  totalCents: number;
}

export class ReportService {
  constructor(private readonly db: DesktopDatabase) {}

  getDailyReport(date: string, unitId: string): DailyReport {
    const stmt = this.db.prepare(`
      SELECT
        wo.id,
        c.legal_name as customer_name,
        p.description as product_description,
        wo.net_weight_kg,
        wo.product_total_cents,
        wo.freight_total_cents,
        wo.total_cents
      FROM weighing_operations wo
      LEFT JOIN customers c ON c.id = wo.customer_id
      LEFT JOIN products p ON p.id = wo.product_id
      WHERE wo.unit_id = ?
        AND wo.status = 'closed_local'
        AND date(wo.created_at) = date(?)
      ORDER BY wo.created_at ASC
    `);

    const rows = stmt.all(unitId, date) as Array<{
      id: string;
      customer_name: string;
      product_description: string;
      net_weight_kg: number;
      product_total_cents: number;
      freight_total_cents: number;
      total_cents: number;
    }>;

    const operations = rows.map((row) => ({
      id: row.id,
      customerName: row.customer_name || "N/A",
      productDescription: row.product_description || "N/A",
      netWeightKg: row.net_weight_kg || 0,
      productTotalCents: row.product_total_cents || 0,
      freightTotalCents: row.freight_total_cents || 0,
      totalCents: row.total_cents || 0
    }));

    return {
      date,
      totalOperations: operations.length,
      totalNetWeightKg: operations.reduce((sum, op) => sum + op.netWeightKg, 0),
      totalProductCents: operations.reduce((sum, op) => sum + op.productTotalCents, 0),
      totalFreightCents: operations.reduce((sum, op) => sum + op.freightTotalCents, 0),
      totalCents: operations.reduce((sum, op) => sum + op.totalCents, 0),
      operations
    };
  }

  getMonthlyReport(year: number, month: number, unitId: string): MonthlyReport {
    const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;

    const stmt = this.db.prepare(`
      SELECT
        COUNT(*) as total_operations,
        COALESCE(SUM(net_weight_kg), 0) as total_net_weight,
        COALESCE(SUM(product_total_cents), 0) as total_product,
        COALESCE(SUM(freight_total_cents), 0) as total_freight,
        COALESCE(SUM(total_cents), 0) as total
      FROM weighing_operations
      WHERE unit_id = ?
        AND status = 'closed_local'
        AND date(created_at) >= date(?)
        AND date(created_at) < date(?)
    `);

    const row = stmt.get(unitId, startDate, endDate) as {
      total_operations: number;
      total_net_weight: number;
      total_product: number;
      total_freight: number;
      total: number;
    };

    return {
      year,
      month,
      totalOperations: row.total_operations,
      totalNetWeightKg: row.total_net_weight,
      totalProductCents: row.total_product,
      totalFreightCents: row.total_freight,
      totalCents: row.total
    };
  }

  getReportByProduct(
    startDate: string,
    endDate: string,
    unitId: string
  ): ProductReport[] {
    const stmt = this.db.prepare(`
      SELECT
        p.code as product_code,
        p.description as product_description,
        COUNT(*) as total_operations,
        COALESCE(SUM(wo.net_weight_kg), 0) as total_weight,
        COALESCE(SUM(wo.product_total_cents), 0) as total_value
      FROM weighing_operations wo
      LEFT JOIN products p ON p.id = wo.product_id
      WHERE wo.unit_id = ?
        AND wo.status = 'closed_local'
        AND date(wo.created_at) >= date(?)
        AND date(wo.created_at) <= date(?)
      GROUP BY p.id
      ORDER BY total_weight DESC
    `);

    const rows = stmt.all(unitId, startDate, endDate) as Array<{
      product_code: string;
      product_description: string;
      total_operations: number;
      total_weight: number;
      total_value: number;
    }>;

    return rows.map((row) => ({
      productCode: row.product_code || "N/A",
      productDescription: row.product_description || "N/A",
      totalOperations: row.total_operations,
      totalWeightKg: row.total_weight,
      totalValueCents: row.total_value
    }));
  }

  getReportByCustomer(
    startDate: string,
    endDate: string,
    unitId: string
  ): CustomerReport[] {
    const stmt = this.db.prepare(`
      SELECT
        c.legal_name as customer_name,
        COUNT(*) as total_operations,
        COALESCE(SUM(wo.net_weight_kg), 0) as total_weight,
        COALESCE(SUM(wo.product_total_cents), 0) as total_value
      FROM weighing_operations wo
      LEFT JOIN customers c ON c.id = wo.customer_id
      WHERE wo.unit_id = ?
        AND wo.status = 'closed_local'
        AND date(wo.created_at) >= date(?)
        AND date(wo.created_at) <= date(?)
      GROUP BY c.id
      ORDER BY total_value DESC
    `);

    const rows = stmt.all(unitId, startDate, endDate) as Array<{
      customer_name: string;
      total_operations: number;
      total_weight: number;
      total_value: number;
    }>;

    return rows.map((row) => ({
      customerName: row.customer_name || "N/A",
      totalOperations: row.total_operations,
      totalWeightKg: row.total_weight,
      totalValueCents: row.total_value
    }));
  }

  getDailySeries(
    startDate: string,
    endDate: string,
    unitId: string
  ): DailySeriesPoint[] {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return [];
    }

    const stmt = this.db.prepare(`
      SELECT
        date(created_at) as day,
        COUNT(*) as total_operations,
        COALESCE(SUM(net_weight_kg), 0) as total_weight,
        COALESCE(SUM(total_cents), 0) as total
      FROM weighing_operations
      WHERE unit_id = ?
        AND status = 'closed_local'
        AND date(created_at) >= date(?)
        AND date(created_at) <= date(?)
      GROUP BY day
      ORDER BY day ASC
    `);

    const rows = stmt.all(unitId, startDate, endDate) as Array<{
      day: string;
      total_operations: number;
      total_weight: number;
      total: number;
    }>;

    const byDate = new Map<string, DailySeriesPoint>();
    for (const row of rows) {
      byDate.set(row.day, {
        date: row.day,
        totalOperations: row.total_operations,
        totalNetWeightKg: row.total_weight,
        totalCents: row.total
      });
    }

    const series: DailySeriesPoint[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const iso = cursor.toISOString().slice(0, 10);
      series.push(
        byDate.get(iso) ?? {
          date: iso,
          totalOperations: 0,
          totalNetWeightKg: 0,
          totalCents: 0
        }
      );
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return series;
  }

  getOperationMix(startDate: string, endDate: string, unitId: string): OperationMix {
    const stmt = this.db.prepare(`
      SELECT
        operation_type,
        status,
        COUNT(*) as total_operations,
        COALESCE(SUM(net_weight_kg), 0) as total_weight,
        COALESCE(SUM(total_cents), 0) as total
      FROM weighing_operations
      WHERE unit_id = ?
        AND date(created_at) >= date(?)
        AND date(created_at) <= date(?)
      GROUP BY operation_type, status
    `);

    const rows = stmt.all(unitId, startDate, endDate) as Array<{
      operation_type: "invoice" | "internal";
      status: string;
      total_operations: number;
      total_weight: number;
      total: number;
    }>;

    const mix: OperationMix = {
      invoice: { count: 0, weightKg: 0, totalCents: 0 },
      internal: { count: 0, weightKg: 0, totalCents: 0 },
      cancelled: { count: 0, weightKg: 0 }
    };

    for (const row of rows) {
      if (row.status === "cancelled") {
        mix.cancelled.count += row.total_operations;
        mix.cancelled.weightKg += row.total_weight;
        continue;
      }
      if (row.status !== "closed_local") continue;
      const target = row.operation_type === "internal" ? mix.internal : mix.invoice;
      target.count += row.total_operations;
      target.weightKg += row.total_weight;
      target.totalCents += row.total;
    }

    return mix;
  }

  exportDailyToCSV(date: string, unitId: string): string {
    const report = this.getDailyReport(date, unitId);

    const lines: string[] = [
      "Data,Cliente,Produto,Peso Liquido (kg),Valor Produto,Frete,Total"
    ];

    for (const op of report.operations) {
      lines.push(
        `${report.date},"${op.customerName}","${op.productDescription}",${op.netWeightKg},${this.formatCurrency(op.productTotalCents)},${this.formatCurrency(op.freightTotalCents)},${this.formatCurrency(op.totalCents)}`
      );
    }

    lines.push(
      `TOTAL,,,${report.totalNetWeightKg},${this.formatCurrency(report.totalProductCents)},${this.formatCurrency(report.totalFreightCents)},${this.formatCurrency(report.totalCents)}`
    );

    return lines.join("\n");
  }

  exportRangeToHtml(startDate: string, endDate: string, unitId: string): string {
    const operations = this.getRangeOperations(startDate, endDate, unitId);
    const totalWeight = operations.reduce((sum, op) => sum + op.netWeightKg, 0);
    const totalProduct = operations.reduce((sum, op) => sum + op.productTotalCents, 0);
    const totalFreight = operations.reduce((sum, op) => sum + op.freightTotalCents, 0);
    const total = operations.reduce((sum, op) => sum + op.totalCents, 0);
    const rows = operations
      .map(
        (op) => `<tr><td>${escapeHtml(op.date)}</td><td>${escapeHtml(op.customerName)}</td><td>${escapeHtml(op.productDescription)}</td><td class="num">${op.netWeightKg.toLocaleString("pt-BR")}</td><td class="num">${this.formatCurrency(op.productTotalCents)}</td><td class="num">${this.formatCurrency(op.freightTotalCents)}</td><td class="num">${this.formatCurrency(op.totalCents)}</td></tr>`
      )
      .join("");

    return `<!doctype html><html><head><meta charset="utf-8" /><style>body{font-family:Arial,sans-serif;color:#0f172a;margin:28px}h1{margin:0 0 4px;font-size:22px}p{margin:0 0 18px;color:#475569}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.card{border:1px solid #cbd5e1;border-radius:10px;padding:10px}.card span{display:block;color:#64748b;font-size:12px}.card strong{font-size:16px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #cbd5e1;padding:7px;text-align:left}th{background:#e2e8f0}.num{text-align:right}tfoot td{font-weight:bold;background:#f8fafc}@page{size:A4;margin:14mm}</style></head><body><h1>Relatorio KyberRock</h1><p>Periodo: ${escapeHtml(startDate)} a ${escapeHtml(endDate)}</p><section class="summary"><div class="card"><span>Carregamentos</span><strong>${operations.length}</strong></div><div class="card"><span>Tonelagem</span><strong>${(totalWeight / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} t</strong></div><div class="card"><span>Produto</span><strong>${this.formatCurrency(totalProduct)}</strong></div><div class="card"><span>Total</span><strong>${this.formatCurrency(total)}</strong></div></section><table><thead><tr><th>Data</th><th>Cliente</th><th>Produto</th><th>Peso kg</th><th>Produto</th><th>Frete</th><th>Total</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="3">TOTAL</td><td class="num">${totalWeight.toLocaleString("pt-BR")}</td><td class="num">${this.formatCurrency(totalProduct)}</td><td class="num">${this.formatCurrency(totalFreight)}</td><td class="num">${this.formatCurrency(total)}</td></tr></tfoot></table></body></html>`;
  }

  private getRangeOperations(startDate: string, endDate: string, unitId: string): RangeReportOperation[] {
    const rows = this.db.prepare(`
      SELECT
        date(wo.created_at) as operation_date,
        c.legal_name as customer_name,
        p.description as product_description,
        wo.net_weight_kg,
        wo.product_total_cents,
        wo.freight_total_cents,
        wo.total_cents
      FROM weighing_operations wo
      LEFT JOIN customers c ON c.id = wo.customer_id
      LEFT JOIN products p ON p.id = wo.product_id
      WHERE wo.unit_id = ?
        AND wo.status = 'closed_local'
        AND date(wo.created_at) >= date(?)
        AND date(wo.created_at) <= date(?)
      ORDER BY wo.created_at ASC
    `).all(unitId, startDate, endDate) as Array<{
      operation_date: string;
      customer_name: string | null;
      product_description: string | null;
      net_weight_kg: number | null;
      product_total_cents: number | null;
      freight_total_cents: number | null;
      total_cents: number | null;
    }>;
    return rows.map((row) => ({
      date: row.operation_date,
      customerName: row.customer_name ?? "N/A",
      productDescription: row.product_description ?? "N/A",
      netWeightKg: row.net_weight_kg ?? 0,
      productTotalCents: row.product_total_cents ?? 0,
      freightTotalCents: row.freight_total_cents ?? 0,
      totalCents: row.total_cents ?? 0
    }));
  }

  private formatCurrency(cents: number): string {
    const value = (cents / 100).toFixed(2);
    return `R$ ${value}`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
