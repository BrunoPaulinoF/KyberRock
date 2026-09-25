import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import {
  buildTruckControlReport,
  filterTruckControlReport,
  formatMinutes,
  isoDaysBefore,
  minutesBetween,
  truckControlDocument,
  truckControlFileBaseName,
  type TruckControlSourceRow
} from "./truck-control";

function row(overrides: Partial<TruckControlSourceRow>): TruckControlSourceRow {
  return {
    operationId: "op",
    plate: "ABC1D23",
    driverName: "Joao",
    customerName: "Cliente A",
    productDescription: "Brita 1",
    netWeightKg: 10000,
    entryAt: "2026-09-10T10:00:00.000Z",
    exitAt: "2026-09-10T10:30:00.000Z",
    ...overrides
  };
}

describe("formatMinutes", () => {
  it("mostra minutos e horas como o desktop", () => {
    expect(formatMinutes(42)).toBe("42min");
    expect(formatMinutes(65)).toBe("1h 05min");
    expect(formatMinutes(-3)).toBe("0min");
  });
});

describe("minutesBetween", () => {
  it("devolve null sem saida e zero com saida antes da entrada", () => {
    expect(minutesBetween("2026-09-10T10:00:00Z", null)).toBeNull();
    expect(minutesBetween("2026-09-10T10:00:00Z", "2026-09-10T09:00:00Z")).toBe(0);
    expect(minutesBetween("2026-09-10T10:00:00Z", "2026-09-10T10:45:00Z")).toBe(45);
  });
});

describe("buildTruckControlReport", () => {
  const report = buildTruckControlReport(
    [
      row({ operationId: "1" }),
      row({
        operationId: "2",
        entryAt: "2026-09-11T10:00:00.000Z",
        exitAt: "2026-09-11T11:30:00.000Z",
        customerName: "Cliente B",
        netWeightKg: 20000
      }),
      row({
        operationId: "3",
        plate: "XYZ9K88",
        driverName: "Maria",
        productDescription: "Pedrisco",
        netWeightKg: 5000
      }),
      row({ operationId: "4", plate: " ", exitAt: null })
    ],
    "2026-09-01",
    "2026-09-30"
  );

  it("agrupa por placa, ignora pesagem sem saida e ordena por numero de operacoes", () => {
    expect(report.trucks.map((truck) => truck.plate)).toEqual(["ABC1D23", "XYZ9K88"]);
    expect(report.totalOperations).toBe(3);
    expect(report.totalNetWeightKg).toBe(35000);
    // (30 + 90 + 30) / 3
    expect(report.averageMinutes).toBe(50);
  });

  it("soma clientes, produtos e cargas da placa", () => {
    const truck = report.trucks[0];
    expect(truck.avgMinutes).toBe(60);
    expect(truck.totalMinutes).toBe(120);
    expect(truck.customers).toEqual([
      { customerName: "Cliente B", totalNetWeightKg: 20000, operations: 1 },
      { customerName: "Cliente A", totalNetWeightKg: 10000, operations: 1 }
    ]);
    expect(truck.products).toEqual([
      { productDescription: "Brita 1", totalNetWeightKg: 30000, operations: 2 }
    ]);
    expect(truck.trips.map((trip) => trip.operationId)).toEqual(["1", "2"]);
    expect(truck.lastOperationAt).toBe("2026-09-11T11:30:00.000Z");
  });

  it("placa vazia vira SEM PLACA e cliente vazio vira N/A", () => {
    const other = buildTruckControlReport(
      [row({ plate: null, customerName: "  " })],
      "2026-09-01",
      "2026-09-30"
    );
    expect(other.trucks[0].plate).toBe("SEM PLACA");
    expect(other.trucks[0].customers[0].customerName).toBe("N/A");
  });

  it("filtra por placa ou motorista sem acento e sem pontuacao, refazendo os totais", () => {
    const byPlate = filterTruckControlReport(report, "abc-1d23");
    expect(byPlate.search).toBe("ABC-1D23");
    expect(byPlate.trucks.map((truck) => truck.plate)).toEqual(["ABC1D23"]);
    expect(byPlate.totalOperations).toBe(2);
    expect(byPlate.averageMinutes).toBe(60);

    const byDriver = filterTruckControlReport(
      buildTruckControlReport([row({ driverName: "João Pereira" })], "2026-09-01", "2026-09-30"),
      "joao"
    );
    expect(byDriver.trucks).toHaveLength(1);

    expect(filterTruckControlReport(report, "  ")).toBe(report);
    expect(filterTruckControlReport(report, "zzz").trucks).toHaveLength(0);
  });

  it("da o nome de arquivo do desktop, com o recorte da busca", () => {
    expect(truckControlFileBaseName(filterTruckControlReport(report, "maria"))).toBe(
      "controle-caminhoes-maria-2026-09-01-a-2026-09-30"
    );
    expect(truckControlFileBaseName(report)).toBe(
      "controle-caminhoes-geral-2026-09-01-a-2026-09-30"
    );
  });
});

describe("truckControlDocument", () => {
  const report = buildTruckControlReport(
    [
      row({ operationId: "1" }),
      row({
        operationId: "2",
        entryAt: "2026-09-11T10:00:00.000Z",
        exitAt: "2026-09-11T11:30:00.000Z",
        customerName: "Cliente B",
        netWeightKg: 20000
      }),
      row({
        operationId: "3",
        plate: "XYZ9K88",
        driverName: "Maria",
        productDescription: "Pedrisco",
        netWeightKg: 5000
      })
    ],
    "2026-09-01",
    "2026-09-30"
  );
  const generatedAt = new Date("2026-09-25T12:00:00.000Z");

  it("PDF: o A4 do desktop, com secoes, colunas, TOTAL e barra de totais", () => {
    const file = truckControlDocument("pdf", report, generatedAt);
    expect(file.filename).toBe("controle-caminhoes-geral-2026-09-01-a-2026-09-30.pdf");
    const html = file.html;
    expect(html).toContain("<title>Controle de caminhoes</title>");
    expect(html).toContain("Todos os caminhoes");
    expect(html).toContain("Periodo: 01/09/2026 a 30/09/2026");
    for (const title of [
      "Caminhoes no periodo",
      "Clientes atendidos",
      "Peso por produto",
      "Cargas do periodo",
      "Tempo medio na pedreira"
    ]) {
      expect(html).toContain(title);
    }
    for (const header of [
      "Placa",
      "Motorista",
      "Tempo total",
      "Tonelagem (t)",
      "Entrada",
      "Saida"
    ]) {
      expect(html).toContain(`>${header}</th>`);
    }
    expect(html).toContain(">TOTAL<");
    expect(html).toContain("3 carga(s)");
    expect(html).toContain("ABC1D23");
    expect(html).toContain("XYZ9K88");
  });

  it("Excel: a planilha tipada do desktop, gravada como .xls, com o recorte da busca", () => {
    const filtered = filterTruckControlReport(report, "maria");
    const file = truckControlDocument("excel", filtered, generatedAt);
    expect(file.filename).toBe("controle-caminhoes-maria-2026-09-01-a-2026-09-30.xls");
    expect(file.html).toContain("xmlns:x=");
    expect(file.html).toContain("<h1>Controle de caminhoes</h1>");
    expect(file.html).toContain("Filtro &quot;MARIA&quot;");
    expect(file.html).toContain("Filtro (placa ou motorista)");
    expect(file.html).toContain("XYZ9K88");
    expect(file.html).not.toContain("ABC1D23");
    expect(file.html).toContain("x:num");
  });

  it("recorte vazio diz que foi a busca", () => {
    const file = truckControlDocument("pdf", filterTruckControlReport(report, "zzz"), generatedAt);
    expect(file.html).toContain("Nenhum caminhao encontrado para &quot;ZZZ&quot; no periodo.");
  });
});

describe("isoDaysBefore", () => {
  it("volta dias de calendario atravessando o mes", () => {
    expect(isoDaysBefore("2026-09-24", 30)).toBe("2026-08-25");
    expect(isoDaysBefore("2026-03-01", 1)).toBe("2026-02-28");
  });
});
