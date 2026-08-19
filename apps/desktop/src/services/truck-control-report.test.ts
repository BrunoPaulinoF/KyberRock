import { describe, expect, it } from "vitest";

import type { TruckControlReport } from "./reports";
import {
  filterTruckControlReport,
  renderTruckControlHtml,
  renderTruckControlSpreadsheet,
  truckControlFileBaseName
} from "./truck-control-report";

function buildReport(): TruckControlReport {
  return {
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    search: null,
    averageMinutes: 60, // (30 + 60 + 90) / 3
    totalOperations: 3,
    totalNetWeightKg: 45000,
    trucks: [
      {
        plate: "ABC1D23",
        driverName: "Joao",
        operations: 2,
        totalMinutes: 90,
        avgMinutes: 45,
        totalNetWeightKg: 25000,
        lastOperationAt: "2026-06-06 10:00:00",
        products: [
          { productDescription: "Brita 0", totalNetWeightKg: 15000, operations: 1 },
          { productDescription: "Brita 1", totalNetWeightKg: 10000, operations: 1 }
        ],
        customers: [
          { customerName: "Pedreira Sul", totalNetWeightKg: 15000, operations: 1 },
          { customerName: "Construtora Norte", totalNetWeightKg: 10000, operations: 1 }
        ],
        trips: [
          {
            operationId: "op-1",
            entryAt: "2026-06-06 08:00:00",
            exitAt: "2026-06-06 08:30:00",
            minutes: 30,
            customerName: "Pedreira Sul",
            productDescription: "Brita 0",
            netWeightKg: 15000
          },
          {
            operationId: "op-2",
            entryAt: "2026-06-06 09:00:00",
            exitAt: "2026-06-06 10:00:00",
            minutes: 60,
            customerName: "Construtora Norte",
            productDescription: "Brita 1",
            netWeightKg: 10000
          }
        ]
      },
      {
        plate: "XYZ4E56",
        driverName: "Maria",
        operations: 1,
        totalMinutes: 90,
        avgMinutes: 90,
        totalNetWeightKg: 20000,
        lastOperationAt: "2026-06-07 09:30:00",
        products: [{ productDescription: "Brita 0", totalNetWeightKg: 20000, operations: 1 }],
        customers: [{ customerName: "Asfalto Leste", totalNetWeightKg: 20000, operations: 1 }],
        trips: [
          {
            operationId: "op-3",
            entryAt: "2026-06-07 08:00:00",
            exitAt: "2026-06-07 09:30:00",
            minutes: 90,
            customerName: "Asfalto Leste",
            productDescription: "Brita 0",
            netWeightKg: 20000
          }
        ]
      }
    ]
  };
}

describe("filterTruckControlReport", () => {
  it("keeps the whole period when the search is empty", () => {
    const report = buildReport();

    expect(filterTruckControlReport(report, "")).toBe(report);
    expect(filterTruckControlReport(report, "   ")).toBe(report);
    expect(filterTruckControlReport(report, null).trucks).toHaveLength(2);
  });

  it("keeps only the matching plate and redoes the totals", () => {
    const filtered = filterTruckControlReport(buildReport(), "abc1d23");

    expect(filtered.search).toBe("ABC1D23");
    expect(filtered.trucks.map((truck) => truck.plate)).toEqual(["ABC1D23"]);
    expect(filtered.totalOperations).toBe(2);
    expect(filtered.totalNetWeightKg).toBe(25000);
    expect(filtered.averageMinutes).toBe(45); // 90 min / 2 operacoes
  });

  it("matches a partial plate and keeps every truck that appears in the list", () => {
    const filtered = filterTruckControlReport(buildReport(), "1D2");

    expect(filtered.trucks.map((truck) => truck.plate)).toEqual(["ABC1D23"]);
  });

  it("matches the driver name too", () => {
    const filtered = filterTruckControlReport(buildReport(), "maria");

    expect(filtered.trucks.map((truck) => truck.plate)).toEqual(["XYZ4E56"]);
    expect(filtered.totalOperations).toBe(1);
  });

  it("returns an empty report when nothing matches", () => {
    const filtered = filterTruckControlReport(buildReport(), "QQQ0X00");

    expect(filtered.trucks).toHaveLength(0);
    expect(filtered.totalOperations).toBe(0);
    expect(filtered.totalNetWeightKg).toBe(0);
    expect(filtered.averageMinutes).toBe(0);
  });
});

describe("truckControlFileBaseName", () => {
  it("names the file after the period and the applied search", () => {
    expect(truckControlFileBaseName(buildReport())).toBe(
      "controle-caminhoes-geral-2026-06-01-a-2026-06-30"
    );
    expect(truckControlFileBaseName(filterTruckControlReport(buildReport(), "abc1d23"))).toBe(
      "controle-caminhoes-abc1d23-2026-06-01-a-2026-06-30"
    );
  });
});

describe("renderTruckControlHtml", () => {
  it("brings every truck of the period when there is no search", () => {
    const html = renderTruckControlHtml(buildReport(), new Date("2026-07-01T12:00:00Z"));

    expect(html).toContain("Controle de caminhoes");
    expect(html).toContain("Todos os caminhoes");
    expect(html).toContain("ABC1D23");
    expect(html).toContain("XYZ4E56");
    expect(html).toContain("Brita 1");
  });

  it("brings only the searched truck and its totals", () => {
    const html = renderTruckControlHtml(
      filterTruckControlReport(buildReport(), "ABC1D23"),
      new Date("2026-07-01T12:00:00Z")
    );

    expect(html).toContain("ABC1D23");
    expect(html).not.toContain("XYZ4E56");
    expect(html).not.toContain("Maria");
    expect(html).toContain("Filtro &quot;ABC1D23&quot;");
    expect(html).toContain("25.000");
  });

  it("lists every customer the plate loaded for, and the trips behind them", () => {
    const html = renderTruckControlHtml(
      filterTruckControlReport(buildReport(), "ABC1D23"),
      new Date("2026-07-01T12:00:00Z")
    );

    expect(html).toContain("Clientes atendidos");
    expect(html).toContain("Pedreira Sul");
    expect(html).toContain("Construtora Norte");
    expect(html).not.toContain("Asfalto Leste");
    expect(html).toContain("Cargas do periodo");
    expect(html).toContain("06/06/2026");
  });
});

describe("renderTruckControlSpreadsheet", () => {
  it("lists the trucks and the weight per product of the period", () => {
    const sheet = renderTruckControlSpreadsheet(buildReport(), new Date("2026-07-01T12:00:00Z"));

    expect(sheet).toContain("Caminhoes no periodo");
    expect(sheet).toContain("Peso por produto");
    expect(sheet).toContain("ABC1D23");
    expect(sheet).toContain("XYZ4E56");
  });

  it("brings the customers of each plate and the trip by trip list", () => {
    const sheet = renderTruckControlSpreadsheet(buildReport(), new Date("2026-07-01T12:00:00Z"));

    expect(sheet).toContain("Clientes atendidos");
    expect(sheet).toContain("Pedreira Sul");
    expect(sheet).toContain("Construtora Norte");
    expect(sheet).toContain("Asfalto Leste");
    expect(sheet).toContain("Cargas do periodo");
  });

  it("brings only the searched truck", () => {
    const sheet = renderTruckControlSpreadsheet(
      filterTruckControlReport(buildReport(), "XYZ4E56"),
      new Date("2026-07-01T12:00:00Z")
    );

    expect(sheet).toContain("XYZ4E56");
    expect(sheet).not.toContain("ABC1D23");
    expect(sheet).not.toContain("Joao");
    expect(sheet).toContain("20.000");
    // O recorte leva junto os clientes e as cargas: nada da outra placa entra no arquivo.
    expect(sheet).toContain("Asfalto Leste");
    expect(sheet).not.toContain("Pedreira Sul");
  });
});
