// Relatorio de controle de caminhoes para o envio automatico. Puro (sem
// dependencias Deno), para poder ser testado e reutilizado.

export interface TruckReportRow {
  plate: string | null;
  driverName: string | null;
  productDescription: string | null;
  netWeightKg: number | null;
  createdAt: string | null;
  closedAt: string | null;
}

export interface TruckReportProduct {
  description: string;
  weightKg: number;
}

export interface TruckReportTruck {
  plate: string;
  driverName: string | null;
  operations: number;
  totalMinutes: number;
  avgMinutes: number;
  totalNetWeightKg: number;
  products: TruckReportProduct[];
}

export interface TruckReport {
  totalOperations: number;
  totalNetWeightKg: number;
  averageMinutes: number;
  trucks: TruckReportTruck[];
}

function minutesBetween(entry: string | null, exit: string | null): number | null {
  if (!entry || !exit) return null;
  const start = new Date(entry).getTime();
  const end = new Date(exit).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const minutes = (end - start) / 60_000;
  return minutes >= 0 ? minutes : 0;
}

export function formatMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h ${String(rest).padStart(2, "0")}min`;
}

export function buildTruckReport(rows: TruckReportRow[]): TruckReport {
  const byPlate = new Map<
    string,
    {
      plate: string;
      driverName: string | null;
      operations: number;
      totalMinutes: number;
      totalNetWeightKg: number;
      products: Map<string, TruckReportProduct>;
    }
  >();

  let totalMinutesAll = 0;
  let totalOperations = 0;
  let totalNetWeightKg = 0;

  for (const row of rows) {
    const minutes = minutesBetween(row.createdAt, row.closedAt);
    if (minutes === null) continue;
    const plate = (row.plate ?? "").trim() || "SEM PLACA";
    const weight = Number(row.netWeightKg ?? 0);

    let truck = byPlate.get(plate);
    if (!truck) {
      truck = {
        plate,
        driverName: row.driverName,
        operations: 0,
        totalMinutes: 0,
        totalNetWeightKg: 0,
        products: new Map()
      };
      byPlate.set(plate, truck);
    }

    truck.operations += 1;
    truck.totalMinutes += minutes;
    truck.totalNetWeightKg += weight;
    if (row.driverName) truck.driverName = row.driverName;

    const key = (row.productDescription ?? "N/A").trim() || "N/A";
    const product = truck.products.get(key) ?? { description: key, weightKg: 0 };
    product.weightKg += weight;
    truck.products.set(key, product);

    totalMinutesAll += minutes;
    totalOperations += 1;
    totalNetWeightKg += weight;
  }

  const trucks: TruckReportTruck[] = Array.from(byPlate.values())
    .map((truck) => ({
      plate: truck.plate,
      driverName: truck.driverName,
      operations: truck.operations,
      totalMinutes: Math.round(truck.totalMinutes),
      avgMinutes: truck.operations > 0 ? Math.round(truck.totalMinutes / truck.operations) : 0,
      totalNetWeightKg: truck.totalNetWeightKg,
      products: Array.from(truck.products.values()).sort((a, b) => b.weightKg - a.weightKg)
    }))
    .sort((a, b) => b.operations - a.operations || b.totalNetWeightKg - a.totalNetWeightKg);

  return {
    totalOperations,
    totalNetWeightKg,
    averageMinutes: totalOperations > 0 ? Math.round(totalMinutesAll / totalOperations) : 0,
    trucks
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderTruckReportHtml(input: {
  companyName: string;
  unitName: string;
  date: string;
  report: TruckReport;
}): string {
  const { report } = input;
  const rows = report.trucks
    .map((truck) => {
      const products =
        truck.products
          .map((p) => `${escapeHtml(p.description)}: ${p.weightKg.toLocaleString("pt-BR")} kg`)
          .join("<br />") || "-";
      return `<tr><td>${escapeHtml(truck.plate)}</td><td>${escapeHtml(
        truck.driverName ?? "-"
      )}</td><td style="text-align:right">${truck.operations}</td><td style="text-align:right">${formatMinutes(
        truck.avgMinutes
      )}</td><td style="text-align:right">${truck.totalNetWeightKg.toLocaleString(
        "pt-BR"
      )}</td><td>${products}</td></tr>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8" /><title>Controle de caminhoes ${escapeHtml(
    input.date
  )}</title></head><body style="font-family:Arial,sans-serif;color:#0f172a;padding:24px;background:#f8fafc"><h1 style="margin:0 0 4px;font-size:22px">Controle de caminhoes ${escapeHtml(
    input.date
  )}</h1><p style="margin:0 0 16px;color:#475569">${escapeHtml(input.companyName)} - ${escapeHtml(
    input.unitName
  )}</p><table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;background:#fff;border:1px solid #cbd5e1"><thead><tr style="background:#1e293b;color:#fff"><th>Caminhoes</th><th>Operacoes</th><th>Tempo medio na pedreira</th></tr></thead><tbody><tr><td style="text-align:center">${report.trucks.length}</td><td style="text-align:center">${report.totalOperations}</td><td style="text-align:center">${formatMinutes(
    report.averageMinutes
  )}</td></tr></tbody></table><h2 style="margin:24px 0 8px;font-size:16px">Por caminhao</h2><table cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;background:#fff;border:1px solid #cbd5e1"><thead><tr style="background:#e2e8f0"><th>Placa</th><th>Motorista</th><th>Operacoes</th><th>Tempo medio</th><th>Peso</th><th>Peso por produto</th></tr></thead><tbody>${
    rows || '<tr><td colspan="6">Sem operacoes no periodo.</td></tr>'
  }</tbody></table></body></html>`;
}

export function renderTruckReportWhatsapp(input: { date: string; report: TruckReport }): string {
  const { report } = input;
  const lines = [
    `*Controle de caminhoes ${input.date}*`,
    `Caminhoes: ${report.trucks.length} | Operacoes: ${report.totalOperations}`,
    `Tempo medio na pedreira: ${formatMinutes(report.averageMinutes)}`
  ];
  for (const truck of report.trucks.slice(0, 15)) {
    lines.push(
      `- ${truck.plate}: ${truck.operations}x, media ${formatMinutes(truck.avgMinutes)}, ${truck.totalNetWeightKg.toLocaleString("pt-BR")} kg`
    );
  }
  return lines.join("\n");
}
