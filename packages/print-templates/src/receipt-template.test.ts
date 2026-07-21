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

  it("prints the payment method alongside the condition", () => {
    const lines = buildReceiptLines(baseInput());

    expect(lines).toContain("Cond.Pagto.: A vista");
    expect(lines).toContain("Meio Pagto.: Dinheiro");
  });

  it("falls back when the payment method is missing", () => {
    const lines = buildReceiptLines({ ...baseInput(), paymentMethodName: null });

    expect(lines).toContain("Meio Pagto.: NAO INFORMADO");
  });

  it("aligns the quantity/unit/total columns to the same width as the header", () => {
    const lines = buildReceiptLines(baseInput());

    const headerIndex = lines.findIndex((line) => line.includes("Quantidade"));
    expect(headerIndex).toBeGreaterThanOrEqual(0);
    const header = lines[headerIndex];
    const values = lines[headerIndex + 1];
    // Cabecalho e valores tem a mesma largura (colunas de 1/3 do cupom).
    expect(header.length).toBe(values.length);
    expect(header.trimEnd()).toBe(header); // sem espacos sobrando a direita
  });

  it("breaks the signature onto its own line so it is not cut off", () => {
    const lines = buildReceiptLines(baseInput());

    const dateLine = lines.find((line) => line.startsWith("Data: "));
    expect(dateLine).toBeDefined();
    // A data e a assinatura ficam em linhas separadas (antes iam juntas e cortavam).
    expect(dateLine).not.toContain("Assinatura");
    expect(lines).toContain("Assinatura do Recebimento:");
  });

  it("leaves a wide line and space for the customer to sign", () => {
    const lines = buildReceiptLines(baseInput());

    const signatureLineIndex = lines.findIndex((line) => /^_{10,}$/.test(line));
    // Ha uma linha continua larga para o cliente assinar...
    expect(signatureLineIndex).toBeGreaterThanOrEqual(0);
    expect(lines[signatureLineIndex].length).toBe(48);
    // ...com o rotulo logo abaixo dela.
    expect(lines[signatureLineIndex + 1]).toBe("Assinatura do Cliente");

    // Ha espaco em branco reservado acima da linha para a assinatura fisica.
    const receiptLabelIndex = lines.indexOf("Assinatura do Recebimento:");
    const blankLinesBefore = lines
      .slice(receiptLabelIndex + 1, signatureLineIndex)
      .filter((line) => line === "").length;
    expect(blankLinesBefore).toBeGreaterThanOrEqual(3);
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
    paymentMethodName: "Dinheiro",
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
