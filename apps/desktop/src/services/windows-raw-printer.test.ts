import { describe, expect, it, vi } from "vitest";

import {
  buildReceiptDocument,
  buildSampleReceiptInput,
  DEFAULT_RECEIPT_TEMPLATE_CONFIG,
  type ReceiptTemplateConfig
} from "@kyberrock/print-templates";

import type { EscPosRasterImage } from "./escpos-encoder";
import { buildReceiptEscPosData } from "./escpos-receipt";
import { WindowsRawEscPosPrinter, receiptDocumentName } from "./windows-raw-printer";
import type { ReceiptLogoConfig, ReceiptPrintPayload } from "./printing";

const LOGO_DATA_URL = "data:image/png;base64,AAAA";

/** Raster minimo (8x2, todos os pontos marcados) para o cupom sair com bit image. */
const RASTER: EscPosRasterImage = {
  widthPx: 8,
  heightPx: 2,
  bits: Buffer.from([0xff, 0xff])
};

describe("WindowsRawEscPosPrinter", () => {
  it("entrega o cupom na fila do Windows em vez de desenhar uma pagina", async () => {
    const sendRaw = vi.fn().mockResolvedValue(undefined);

    await new WindowsRawEscPosPrinter({ sendRaw }).printReceipt(payload());

    expect(sendRaw).toHaveBeenCalledTimes(1);
    const [printerName, data, documentName] = sendRaw.mock.calls[0];
    expect(printerName).toBe("MP-4200 TH");
    expect(Buffer.isBuffer(data)).toBe(true);
    expect(documentName).toContain("000000882-4");
  });

  /**
   * O motivo de este caminho existir: a impressora termica ligada no Windows passa a receber
   * exatamente o cupom que a impressora de rede ja recebia. Se os bytes divergirem, o papel
   * volta a depender de qual meio de envio foi configurado.
   */
  it("manda os MESMOS bytes que a impressora de rede", async () => {
    const printPayload = payload({ dataUrl: LOGO_DATA_URL });
    const rasterizeLogo = () => RASTER;

    let windowsData: Buffer | null = null;
    await new WindowsRawEscPosPrinter({
      sendRaw: async (_name, data) => {
        windowsData = data;
      },
      rasterizeLogo
    }).printReceipt(printPayload);

    // `buildReceiptEscPosData` e o que a impressora de rede escreve no socket — comparar com
    // ele e comparar com o cupom que a rede imprime.
    const networkData = buildReceiptEscPosData(printPayload, rasterizeLogo);

    expect(windowsData).not.toBeNull();
    expect(Buffer.compare(windowsData!, networkData)).toBe(0);
  });

  it("imprime o cupom sem logo quando a personalizacao desliga a logo", async () => {
    // No modo "Padrao" a personalizacao inteira e ignorada de proposito, entao desligar a
    // logo so vale no modelo personalizado.
    const semLogo = payload({ dataUrl: LOGO_DATA_URL }, { mode: "custom", showLogo: false });
    let data: Buffer | null = null;

    await new WindowsRawEscPosPrinter({
      sendRaw: async (_name, sent) => {
        data = sent;
      },
      rasterizeLogo: () => RASTER
    }).printReceipt(semLogo);

    // GS v 0 e o comando de bit image: sem logo, ele nao pode aparecer.
    expect(data!.includes(Buffer.from([0x1d, 0x76, 0x30]))).toBe(false);
  });

  it("nao deixa uma logo invalida derrubar a impressao do cupom", async () => {
    const sendRaw = vi.fn().mockResolvedValue(undefined);

    await new WindowsRawEscPosPrinter({
      sendRaw,
      rasterizeLogo: () => {
        throw new Error("imagem corrompida");
      }
    }).printReceipt(payload({ dataUrl: LOGO_DATA_URL }));

    expect(sendRaw).toHaveBeenCalledTimes(1);
  });

  it("recusa imprimir sem impressora configurada", async () => {
    const semNome = { ...payload(), printerName: "   " };

    await expect(
      new WindowsRawEscPosPrinter({ sendRaw: vi.fn() }).printReceipt(semNome)
    ).rejects.toThrow(/nao configurada/i);
  });

  it("propaga a falha da fila para o cupom ser gravado como nao impresso", async () => {
    await expect(
      new WindowsRawEscPosPrinter({
        sendRaw: async () => {
          throw new Error("Spooler parado");
        }
      }).printReceipt(payload())
    ).rejects.toThrow("Spooler parado");
  });
});

describe("receiptDocumentName", () => {
  it("identifica o trabalho pelo numero do cupom na fila do Windows", () => {
    expect(receiptDocumentName(payload())).toBe("KyberRock cupom 000000882-4");
  });
});

function payload(
  logo: Partial<ReceiptLogoConfig> = {},
  configOverrides: Partial<ReceiptTemplateConfig> = {}
): ReceiptPrintPayload {
  const receiptLogo: ReceiptLogoConfig = {
    dataUrl: null,
    widthMm: 24,
    heightMm: 16,
    fit: "contain",
    ...logo
  };
  const templateConfig: ReceiptTemplateConfig = {
    ...DEFAULT_RECEIPT_TEMPLATE_CONFIG,
    ...configOverrides
  };
  const templateInput = {
    ...buildSampleReceiptInput("2026-08-13T16:03:41.000Z"),
    receiptNumber: 882,
    deviceNumber: 4,
    copyNumber: 1
  };
  const document = buildReceiptDocument(templateInput, templateConfig);

  return {
    printerName: "MP-4200 TH",
    printerType: "windows_escpos",
    networkHost: null,
    networkPort: null,
    paperWidthMm: 80,
    lines: document.lines,
    contentText: document.lines.join("\n"),
    snapshot: {
      ...templateInput,
      lines: document.lines,
      receiptLogo,
      templateConfig,
      header: document.header,
      bodyLines: document.bodyLines,
      style: document.style
    }
  };
}
