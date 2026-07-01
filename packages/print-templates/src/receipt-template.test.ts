import { describe, expect, it } from "vitest";

import { buildReceiptLines } from "./receipt-template";

describe("buildReceiptLines", () => {
  it("includes freight when it exists", () => {
    const lines = buildReceiptLines({ ...baseInput(), freightTotalCents: 25_000, totalCents: 175_000 });

    const freightLine = lines.find((line) => line.startsWith("FRETE"));

    expect(freightLine).toBe("FRETE R$ 250,00");
    expect(lines).toContain("TOTAL DA VENDA - Itens (1) R$ 1.500,00");
    expect(lines.at(-1)).toBe("------------------------------------------------");
  });

  it("marks reprints as second copy", () => {
    const lines = buildReceiptLines({
      ...baseInput(),
      receiptNumber: 7,
      copyNumber: 2,
      operationType: "internal",
      paymentTermName: null
    });

    expect(lines).toContain("COPIA NRO 000000007");
    expect(lines).toContain("2a VIA");
    expect(lines).toContain("Cond.Pagto.: NAO INFORMADA");
  });
});

function baseInput(): Parameters<typeof buildReceiptLines>[0] {
  return {
    companyName: "Pedreira Principal LTDA",
    companyDocument: "00.000.000/0001-00",
    companyStateRegistration: "000.000.000.000",
    unitName: "Pedreira Principal",
    receiptNumber: 1,
    copyNumber: 1,
    printedAt: "2026-06-07T12:00:00.000Z",
    operationId: "operation-1",
    operationType: "invoice",
    customerName: "Cliente Teste",
    customerDocument: "11.111.111/0001-11",
    customerPhone: "(11) 99999-0000",
    customerZipCode: "00000-000",
    customerCity: "Ibiuna",
    customerState: "SP",
    productCode: "0028",
    productDescription: "Brita 1",
    plate: "ABC1D23",
    driverName: "Motorista Teste",
    paymentTermName: "A vista",
    entryCapturedAt: "2026-06-07T11:00:00.000Z",
    exitCapturedAt: "2026-06-07T12:00:00.000Z",
    permanenceLabel: "1h 0min",
    entryWeightKg: 10_000,
    exitWeightKg: 25_000,
    netWeightKg: 15_000,
    unitPriceCents: 10_000,
    productTotalCents: 150_000,
    freightTotalCents: 0,
    totalCents: 150_000
  };
}
