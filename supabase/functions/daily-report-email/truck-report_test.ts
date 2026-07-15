import { describe, expect, it } from "vitest";

import {
  buildTruckReport,
  formatMinutes,
  renderTruckReportHtml,
  type TruckReportRow
} from "./truck-report.ts";

const rows: TruckReportRow[] = [
  {
    plate: "ABC1D23",
    driverName: "Joao",
    productDescription: "Brita 0",
    netWeightKg: 15000,
    createdAt: "2026-06-06T08:00:00Z",
    closedAt: "2026-06-06T08:30:00Z"
  },
  {
    plate: "ABC1D23",
    driverName: "Joao",
    productDescription: "Brita 1",
    netWeightKg: 10000,
    createdAt: "2026-06-06T09:00:00Z",
    closedAt: "2026-06-06T10:00:00Z"
  },
  {
    plate: "XYZ4E56",
    driverName: "Maria",
    productDescription: "Brita 0",
    netWeightKg: 20000,
    createdAt: "2026-06-06T08:00:00Z",
    closedAt: "2026-06-06T09:30:00Z"
  },
  // Sem closed_at: ignorada.
  {
    plate: "NAO1234",
    driverName: null,
    productDescription: "Brita 0",
    netWeightKg: 5000,
    createdAt: "2026-06-06T08:00:00Z",
    closedAt: null
  }
];

describe("buildTruckReport", () => {
  it("aggregates per truck and computes the average", () => {
    const report = buildTruckReport(rows);

    expect(report.totalOperations).toBe(3);
    expect(report.averageMinutes).toBe(60); // (30 + 60 + 90) / 3
    expect(report.trucks).toHaveLength(2);

    const abc = report.trucks.find((t) => t.plate === "ABC1D23");
    expect(abc?.operations).toBe(2);
    expect(abc?.avgMinutes).toBe(45);
    expect(abc?.totalNetWeightKg).toBe(25000);
    expect(abc?.products).toEqual([
      { description: "Brita 0", weightKg: 15000 },
      { description: "Brita 1", weightKg: 10000 }
    ]);
  });

  it("returns an empty report when there is no completed operation", () => {
    const report = buildTruckReport([{ ...rows[3] }]);
    expect(report.totalOperations).toBe(0);
    expect(report.trucks).toEqual([]);
    expect(report.averageMinutes).toBe(0);
  });

  it("formats minutes as h/min", () => {
    expect(formatMinutes(45)).toBe("45min");
    expect(formatMinutes(90)).toBe("1h 30min");
    expect(formatMinutes(65)).toBe("1h 05min");
  });

  it("renders the HTML report", () => {
    const html = renderTruckReportHtml({
      companyName: "Pedreira",
      unitName: "Unidade",
      date: "2026-06-06",
      report: buildTruckReport(rows)
    });
    expect(html).toContain("Controle de caminhoes 2026-06-06");
    expect(html).toContain("ABC1D23");
    expect(html).toContain("Brita 0");
  });
});
