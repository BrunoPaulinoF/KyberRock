import { describe, expect, it } from "vitest";

import { buildReceiptLines } from "./receipt-template";

describe("buildReceiptLines", () => {
  it("includes freight when it exists", () => {
    const lines = buildReceiptLines({
      operationNumber: "1",
      customerName: "Cliente Teste",
      productDescription: "Brita 1",
      plate: "ABC1D23",
      driverName: "Motorista Teste",
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
});
