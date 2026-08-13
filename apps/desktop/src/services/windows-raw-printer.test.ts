import { describe, expect, it } from "vitest";

import {
  buildReceiptDocument,
  buildSampleReceiptInput,
  DEFAULT_RECEIPT_TEMPLATE_CONFIG
} from "@kyberrock/print-templates";

import { packRasterImage, type EscPosRasterImage } from "./escpos-encoder";
import {
  buildWindowsRawPrintCommand,
  describeWindowsRawFailure,
  WindowsRawEscPosPrinter,
  WINDOWS_RAW_PRINT_SCRIPT,
  type WindowsRawCommandResult
} from "./windows-raw-printer";
import type { ReceiptPrintPayload } from "./printing";

describe("impressao ESC/POS direta na termica do Windows", () => {
  it("manda o cupom para a fila do Windows como trabalho RAW", async () => {
    const harness = createHarness();

    await harness.printer.printReceipt(payload());

    expect(harness.runs).toHaveLength(1);
    expect(harness.runs[0].command).toBe("powershell.exe");
    expect(harness.runs[0].args).toEqual([
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "/tmp/kyberrock-cupom-fixo.ps1",
      "-PrinterName",
      "Bematech MP-4200 TH",
      "-Path",
      "/tmp/kyberrock-cupom-fixo.bin"
    ]);
    // RAW: o spooler entrega os bytes a impressora sem passar pelo desenho do driver, que e
    // justamente o que engolia a logo e o numero do cupom.
    expect(WINDOWS_RAW_PRINT_SCRIPT).toContain('info.pDataType = "RAW"');
    expect(WINDOWS_RAW_PRINT_SCRIPT).toContain("winspool.drv");
  });

  it("apaga os arquivos temporarios do cupom, mesmo quando a impressao falha", async () => {
    const ok = createHarness();
    await ok.printer.printReceipt(payload());
    expect(ok.removed).toEqual(["/tmp/kyberrock-cupom-fixo.ps1", "/tmp/kyberrock-cupom-fixo.bin"]);

    const failed = createHarness({ result: { code: 1, stderr: "Impressora sem papel." } });
    await expect(failed.printer.printReceipt(payload())).rejects.toThrow("Impressora sem papel.");
    expect(failed.removed).toHaveLength(2);
  });

  it("nao tenta imprimir sem impressora escolhida", async () => {
    const harness = createHarness();

    await expect(harness.printer.printReceipt({ ...payload(), printerName: "  " })).rejects.toThrow(
      /Selecione a impressora/
    );
    expect(harness.runs).toHaveLength(0);
  });

  it("leva a logo como bit image, antes de qualquer texto", async () => {
    const harness = createHarness();

    await harness.printer.printReceipt(payload());

    const bytes = [...harness.data()];
    const raster = findSequence(bytes, [0x1d, 0x76, 0x30, 0x00]);
    const firstText = findSequence(bytes, [...Buffer.from("COD", "ascii")]);

    expect(raster).toBeGreaterThanOrEqual(0);
    expect(raster).toBeLessThan(firstText);
  });

  it("respeita o interruptor da logo do modelo", async () => {
    const harness = createHarness();
    const semLogo = payload();
    semLogo.snapshot.style = { ...semLogo.snapshot.style, showLogo: false };

    await harness.printer.printReceipt(semLogo);

    expect(findSequence([...harness.data()], [0x1d, 0x76, 0x30, 0x00])).toBe(-1);
  });

  // O motorista volta na balanca com o papel na mao: o codigo e o numero precisam saltar
  // aos olhos, como no cupom da impressora do Windows (que ja os desenha grandes).
  it("imprime o codigo da operacao e o numero do cupom em corpo dobrado", async () => {
    const harness = createHarness();

    await harness.printer.printReceipt(payload());

    const bytes = [...harness.data()];
    for (const line of ["COD 000001", "COPIA NRO 000000101"]) {
      const at = findSequence(bytes, [...Buffer.from(line, "ascii")]);
      expect(at).toBeGreaterThan(0);
      // GS ! 0x11 (largura e altura dobradas) imediatamente antes do texto, e o texto sai
      // sem o recuo de centralizacao (quem centraliza e a impressora, com ESC a 1).
      expect(bytes.slice(at - 3, at)).toEqual([0x1d, 0x21, 0x11]);
      expect(bytes.slice(at - 6, at - 3)).toEqual([0x1b, 0x61, 0x01]);
    }
  });

  it("explica a falha com o texto que o Windows devolveu", () => {
    expect(
      describeWindowsRawFailure("MP-4200", {
        code: 1,
        stderr: "\nNao foi possivel abrir a impressora (erro 1801).\nEm C:\\script.ps1:12"
      })
    ).toBe("Falha ao imprimir em MP-4200: Nao foi possivel abrir a impressora (erro 1801).");

    expect(describeWindowsRawFailure("MP-4200", { code: 2, stderr: "   " })).toBe(
      "Falha ao imprimir em MP-4200 (codigo 2)."
    );
  });

  it("monta o comando sem depender da politica de execucao da maquina", () => {
    const { command, args } = buildWindowsRawPrintCommand("C:\\a.ps1", "Termica", "C:\\a.bin");

    expect(command).toBe("powershell.exe");
    expect(args).toContain("-ExecutionPolicy");
    expect(args).toContain("Bypass");
    expect(args).toContain("-NonInteractive");
  });
});

function createHarness(options: { result?: WindowsRawCommandResult } = {}) {
  const runs: Array<{ command: string; args: string[] }> = [];
  const written = new Map<string, string | Buffer>();
  const removed: string[] = [];
  const printer = new WindowsRawEscPosPrinter({
    writeFile: (filePath, data) => written.set(filePath, data),
    removeFile: (filePath) => removed.push(filePath),
    tempPath: (fileName) => `/tmp/${fileName}`,
    uniqueId: () => "fixo",
    rasterizeLogo: () => logoRaster(),
    run: async (command, args) => {
      runs.push({ command, args });
      return options.result ?? { code: 0, stderr: "" };
    }
  });

  return {
    printer,
    runs,
    removed,
    data: (): Buffer => {
      const data = written.get("/tmp/kyberrock-cupom-fixo.bin");
      if (!Buffer.isBuffer(data)) throw new Error("O cupom nao foi gravado em bytes.");
      return data;
    }
  };
}

function logoRaster(): EscPosRasterImage {
  const pixels = new Uint8Array(16 * 8 * 4);
  for (let index = 0; index < 16 * 8; index += 1) {
    pixels[index * 4 + 3] = 255;
  }
  const raster = packRasterImage(pixels, 16, 8);
  if (!raster) throw new Error("Raster de teste invalido.");
  return raster;
}

function payload(): ReceiptPrintPayload {
  const templateInput = {
    ...buildSampleReceiptInput("2026-08-12T13:00:00.000Z"),
    receiptNumber: 101,
    copyNumber: 1
  };
  const document = buildReceiptDocument(templateInput, DEFAULT_RECEIPT_TEMPLATE_CONFIG);

  return {
    printerName: "Bematech MP-4200 TH",
    printerType: "windows_escpos",
    networkHost: null,
    networkPort: null,
    paperWidthMm: 80,
    lines: document.lines,
    contentText: document.lines.join("\n"),
    snapshot: {
      ...templateInput,
      lines: document.lines,
      receiptLogo: {
        dataUrl: "data:image/png;base64,AAAA",
        widthMm: 24,
        heightMm: 16,
        fit: "contain"
      },
      templateConfig: DEFAULT_RECEIPT_TEMPLATE_CONFIG,
      header: document.header,
      bodyLines: document.bodyLines,
      style: document.style
    }
  };
}

function findSequence(bytes: number[], sequence: number[]): number {
  for (let index = 0; index <= bytes.length - sequence.length; index += 1) {
    if (sequence.every((byte, offset) => bytes[index + offset] === byte)) {
      return index;
    }
  }

  return -1;
}
