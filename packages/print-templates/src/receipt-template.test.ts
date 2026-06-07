import { describe, expect, it } from "vitest";

import { buildReceiptLines } from "./receipt-template";

describe("buildReceiptLines", () => {
  it("includes freight when it exists", () => {
    const lines = buildReceiptLines({
      unitName: "Pedreira Principal",
      receiptNumber: 1,
      copyNumber: 1,
      printedAt: "2026-06-07T12:00:00.000Z",
      operationId: "operation-1",
      operationType: "invoice",
      customerName: "Cliente Teste",
      productDescription: "Brita 1",
      plate: "ABC1D23",
      driverName: "Motorista Teste",
      paymentTermName: "A vista",
      entryWeightKg: 10_000,
      exitWeightKg: 25_000,
      netWeightKg: 15_000,
      productTotalCents: 150_000,
      freightTotalCents: 25_000,
      totalCents: 175_000
    });

    const freightLine = lines.find((line) => line.startsWith("Frete:"));

    expect(freightLine?.replace(/\s/g, " ")).toBe("Frete: R$ 250,00");
    expect(lines.at(-1)).toBe("____________________________");
  });

  it("marks reprints as second copy", () => {
    const lines = buildReceiptLines({
      unitName: "Pedreira Principal",
      receiptNumber: 7,
      copyNumber: 2,
      printedAt: "2026-06-07T12:00:00.000Z",
      operationId: "operation-1",
      operationType: "internal",
      customerName: "Cliente Teste",
      productDescription: "Brita 1",
      plate: "ABC1D23",
      driverName: "Motorista Teste",
      paymentTermName: null,
      entryWeightKg: 10_000,
      exitWeightKg: 25_000,
      netWeightKg: 15_000,
      productTotalCents: 150_000,
      freightTotalCents: 0,
      totalCents: 150_000
    });

    expect(lines).toContain("SEGUNDA VIA");
    expect(lines).toContain("Cupom: 7");
    expect(lines).toContain("Tipo: Interna");
  });
});
