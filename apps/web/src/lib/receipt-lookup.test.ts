import { describe, expect, it } from "vitest";

import {
  operationCodeLabel,
  parseReceiptQuery,
  permanenceLabel,
  invoiceStampLines,
  receiptLines,
  receiptNumberLabel,
  receiptPrintHtml,
  snapshotText
} from "./receipt-lookup";

describe("parseReceiptQuery", () => {
  it("le o COD do topo do cupom", () => {
    expect(parseReceiptQuery("COD 003249")).toEqual({ kind: "code", code: 3249 });
    expect(parseReceiptQuery(" cod.3249 ")).toEqual({ kind: "code", code: 3249 });
  });

  it("le o numero da via com a balanca depois do traco", () => {
    expect(parseReceiptQuery("COPIA NRO 000004038-4")).toEqual({
      kind: "receipt",
      receiptNumber: 4038,
      deviceNumber: 4
    });
    expect(parseReceiptQuery("4038 - 4")).toEqual({
      kind: "receipt",
      receiptNumber: 4038,
      deviceNumber: 4
    });
  });

  it("numero solto procura nos dois", () => {
    expect(parseReceiptQuery("003249")).toEqual({ kind: "number", value: 3249 });
  });

  it("recusa vazio, zero, texto e numero grande demais", () => {
    expect(parseReceiptQuery("").kind).toBe("invalid");
    expect(parseReceiptQuery("0").kind).toBe("invalid");
    expect(parseReceiptQuery("ABC-12").kind).toBe("invalid");
    expect(parseReceiptQuery("99999999999").kind).toBe("invalid");
    expect(parseReceiptQuery("4038-0").kind).toBe("invalid");
  });
});

describe("rotulos", () => {
  it("formata como o cupom impresso", () => {
    expect(operationCodeLabel(3249)).toBe("COD 003249");
    expect(operationCodeLabel(null)).toBe("Sem codigo");
    expect(receiptNumberLabel(4038, 4)).toBe("000004038-4");
    expect(receiptNumberLabel(4038, null)).toBe("000004038");
  });

  it("permanencia entre entrada e saida", () => {
    expect(permanenceLabel("2026-09-28T10:00:00Z", "2026-09-28T10:42:00Z")).toBe("42 min");
    expect(permanenceLabel("2026-09-28T10:00:00Z", "2026-09-28T11:25:00Z")).toBe("1h 25min");
    expect(permanenceLabel("2026-09-28T10:00:00Z", "2026-09-28T12:00:00Z")).toBe("2h");
    expect(permanenceLabel("2026-09-28T10:00:00Z", null)).toBeNull();
  });
});

describe("copia congelada", () => {
  it("le as linhas em lista ou em texto JSON", () => {
    expect(receiptLines({ lines: ["COD 003249", "PEDREIRA"] })).toEqual(["COD 003249", "PEDREIRA"]);
    expect(receiptLines({ lines: '["A","B"]' })).toEqual(["A", "B"]);
    expect(receiptLines({ lines: "nao e json" })).toEqual([]);
    expect(receiptLines({})).toEqual([]);
    expect(receiptLines(null)).toEqual([]);
  });

  it("le um texto do snapshot", () => {
    expect(snapshotText({ paymentMethodName: " Boleto " }, "paymentMethodName")).toBe("Boleto");
    expect(snapshotText({ paymentMethodName: "" }, "paymentMethodName")).toBeNull();
    expect(snapshotText({ deviceNumber: 4 }, "deviceNumber")).toBe("4");
  });

  it("html de impressao escapa o texto do cupom", () => {
    const html = receiptPrintHtml(["Cliente: A & <B>"], "cupom");
    expect(html).toContain("Cliente: A &amp; &lt;B&gt;");
    expect(html).toContain("<title>cupom</title>");
  });
});

describe("nota fiscal no cupom virtual", () => {
  it("sem nota nao acrescenta nada", () => {
    expect(invoiceStampLines(null)).toEqual([]);
    expect(invoiceStampLines("  ")).toEqual([]);
  });

  it("carimba o numero centralizado na largura da via", () => {
    const stamp = invoiceStampLines(" 4521 ", ["x".repeat(48)]);
    expect(stamp[0]).toBe("-".repeat(48));
    expect(stamp[1].trim()).toBe("NOTA FISCAL (NF-e): 4521");
    expect(stamp[1].length).toBeLessThanOrEqual(48);
    expect(stamp[1].startsWith(" ")).toBe(true);
  });
});
