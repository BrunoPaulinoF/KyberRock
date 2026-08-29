import { describe, expect, it } from "vitest";

import { describePrinterTypeMismatch, looksLikeThermalReceiptPrinter } from "./printer-type";

describe("termica no modo grafico", () => {
  it("reconhece as termicas de cupom que a operacao usa", () => {
    for (const nome of [
      "MP-4200 TH",
      "MP4200TH",
      "Bematech MP-2800 TH",
      "ELGIN i9",
      "EPSON TM-T20X Receipt",
      "Daruma DR-800",
      "POS-80 Printer",
      "Impressora Termica Balanca"
    ]) {
      expect(looksLikeThermalReceiptPrinter(nome)).toBe(true);
    }
  });

  it("nao confunde impressora comum com termica", () => {
    // Falso positivo custa um aviso a toa; melhor errar para o lado de calar.
    for (const nome of ["HP LaserJet Pro M15w", "Microsoft Print to PDF", "Brother DCP-L2540DW"]) {
      expect(looksLikeThermalReceiptPrinter(nome)).toBe(false);
    }
    expect(looksLikeThermalReceiptPrinter("")).toBe(false);
    expect(looksLikeThermalReceiptPrinter(null)).toBe(false);
  });

  it("avisa a combinacao que aceita o cupom e nao imprime", () => {
    const aviso = describePrinterTypeMismatch("windows", "MP-4200 TH");

    expect(aviso).toContain("MP-4200 TH");
    expect(aviso).toContain("ESC/POS");
  });

  it("cala quando nao ha o que avisar", () => {
    // Termica ja no modo certo, impressora comum no modo grafico, e rede.
    expect(describePrinterTypeMismatch("windows_escpos", "MP-4200 TH")).toBeNull();
    expect(describePrinterTypeMismatch("network", "MP-4200 TH")).toBeNull();
    expect(describePrinterTypeMismatch("windows", "HP LaserJet Pro M15w")).toBeNull();
    expect(describePrinterTypeMismatch("windows", "")).toBeNull();
  });
});
