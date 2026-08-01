import { describe, expect, it } from "vitest";

import { buildReceiptHtml } from "./receipt-html";
import type { ReceiptLogoConfig, ReceiptPrintPayload } from "./printing";

const LOGO_DATA_URL = "data:image/png;base64,AAAA";

describe("buildReceiptHtml", () => {
  it("prints the configured logo at the top of the receipt", () => {
    const html = buildReceiptHtml(payload({ dataUrl: LOGO_DATA_URL }));

    expect(html).toContain(`<img src="${LOGO_DATA_URL}" alt="Logo" />`);
    expect(html).not.toContain('<div class="logo-fallback">');
  });

  it("falls back to the unit name when no logo is configured", () => {
    const html = buildReceiptHtml(payload({ dataUrl: null }));

    expect(html).toContain('<div class="logo-fallback">Pedreira Teste</div>');
    expect(html).not.toContain("<img");
  });

  it("uses the configured box and object-fit for the original image", () => {
    const html = buildReceiptHtml(
      payload({ dataUrl: LOGO_DATA_URL, widthMm: 30, heightMm: 20, fit: "cover" })
    );

    expect(html).toContain("width: 30mm; height: 20mm;");
    expect(html).toContain("object-fit: cover;");
  });

  it("prints the pre-rasterized logo at its exact printed size", () => {
    // O raster ja saiu enquadrado da conversao: a caixa vira o tamanho da propria imagem e
    // o object-fit volta a "contain", senao o cupom estica/corta a logo uma segunda vez.
    const html = buildReceiptHtml(payload({ dataUrl: LOGO_DATA_URL, fit: "fill" }), {
      dataUrl: "data:image/png;base64,MONO",
      widthMm: 16,
      heightMm: 16
    });

    expect(html).toContain('<img src="data:image/png;base64,MONO" alt="Logo" />');
    expect(html).not.toContain(LOGO_DATA_URL);
    expect(html).toContain("width: 16mm; height: 16mm;");
    expect(html).toContain("object-fit: contain;");
    // Imagem de 1 bit ja no tamanho final: sem suavizacao, os pontos saem nitidos.
    expect(html).toContain("image-rendering: pixelated;");
  });

  it("escapes receipt text so a quote in the company name cannot break the markup", () => {
    const html = buildReceiptHtml(
      payload({ dataUrl: null }, { companyName: 'Pedreira "A" & Cia <LTDA>' })
    );

    expect(html).toContain("Pedreira &quot;A&quot; &amp; Cia &lt;LTDA&gt;");
  });

  it("keeps the paper width of the profile in the page size", () => {
    expect(buildReceiptHtml(payload({ dataUrl: null }, { paperWidthMm: 58 }))).toContain(
      "size: 58mm auto;"
    );
  });
});

function payload(
  logo: Partial<ReceiptLogoConfig>,
  overrides: { companyName?: string; paperWidthMm?: number } = {}
): ReceiptPrintPayload {
  const receiptLogo: ReceiptLogoConfig = {
    dataUrl: null,
    widthMm: 24,
    heightMm: 16,
    fit: "contain",
    ...logo
  };
  const lines = [
    "PEDREIRA TESTE LTDA",
    "---",
    "PEDREIRA TESTE",
    "DATA: 01/01/2026  HORA: 10:00:00",
    "COPIA NRO 000000001",
    "1a VIA",
    "CODIGO.: ABC",
    "Cliente: Cliente Exemplo"
  ];

  return {
    printerName: "Impressora",
    printerType: "windows",
    networkHost: null,
    networkPort: null,
    paperWidthMm: overrides.paperWidthMm ?? 80,
    lines,
    contentText: lines.join("\n"),
    snapshot: {
      companyName: overrides.companyName ?? "Pedreira Teste LTDA",
      companyDocument: "00.000.000/0001-00",
      companyStateRegistration: null,
      unitName: "Pedreira Teste",
      receiptNumber: 1,
      deviceNumber: null,
      copyNumber: 1,
      printedAt: "2026-01-01T13:00:00.000Z",
      operationId: "op_1",
      operationType: "invoice",
      customerName: "Cliente Exemplo",
      customerDocument: null,
      customerPhone: null,
      customerZipCode: null,
      customerCity: null,
      customerState: null,
      productCode: "0001",
      productDescription: "Brita 1",
      plate: "ABC1D23",
      driverName: "Motorista",
      paymentTermName: null,
      paymentMethodName: null,
      entryCapturedAt: "2026-01-01T12:00:00.000Z",
      exitCapturedAt: "2026-01-01T13:00:00.000Z",
      permanenceLabel: "60min",
      entryWeightKg: 12_000,
      exitWeightKg: 18_500,
      netWeightKg: 6_500,
      unitPriceCents: 12_000,
      productTotalCents: 78_000,
      freightTotalCents: 0,
      totalCents: 78_000,
      lines,
      receiptLogo
    }
  };
}
