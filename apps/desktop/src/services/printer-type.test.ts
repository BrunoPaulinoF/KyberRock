import { describe, expect, it } from "vitest";

import { looksLikeReceiptThermalPrinter } from "./printer-type";

describe("looksLikeReceiptThermalPrinter", () => {
  it("reconhece as termicas de cupom pelo nome da fila do Windows", () => {
    for (const name of [
      "Bematech MP-4200 HS",
      "Bematech MP-4200 HS (Copiar 1)",
      "MP-4200 TH",
      "MP 2800",
      "ELGIN i9(USB)",
      "EPSON TM-T20",
      "Epson TM-T88V Receipt",
      "Tanca TP-650",
      "Control iD Print iD",
      "POS-80",
      "XP-58 (copia 1)",
      "Impressora Termica Balanca"
    ]) {
      expect(looksLikeReceiptThermalPrinter(name), name).toBe(true);
    }
  });

  it("nao confunde impressora comum com termica", () => {
    // As tres primeiras sao as filas que a mesma balanca usou entre uma termica e outra.
    for (const name of [
      "EPSON L3150 Series",
      "HP LaserJet Professional M1212nf MFP",
      "Microsoft Print to PDF",
      "Brother DCP-L2540DW",
      "Canon G3110",
      "",
      "   "
    ]) {
      expect(looksLikeReceiptThermalPrinter(name), name).toBe(false);
    }
    expect(looksLikeReceiptThermalPrinter(null)).toBe(false);
    expect(looksLikeReceiptThermalPrinter(undefined)).toBe(false);
  });
});
