import { describe, expect, it } from "vitest";

import { invoiceNumberLabel, invoiceNumberText } from "./invoice-number-label";

describe("coluna Nota fiscal", () => {
  it("mostra o numero quando a nota saiu", () => {
    expect(invoiceNumberLabel("28727", "invoice")).toEqual({
      state: "number",
      text: "28727",
      title: null
    });
  });

  it("venda INTERNA nao e pendencia: ela nao emite NF-e", () => {
    // Era o que fazia a tela mentir. A maioria do movimento de uma pedreira e interna, e
    // toda linha interna saia com "Sem nota" em vermelho ao lado de "Faturada" — o operador
    // lia as duas coisas na mesma linha e concluia, com razao, que o sistema estava errado.
    const label = invoiceNumberLabel(null, "internal");

    expect(label.state).toBe("not_applicable");
    expect(label.text).toBe("—");
    expect(label.title).toContain("nao emite NF-e");
  });

  it("interna que ganhou NFS-e mostra o numero como qualquer outra", () => {
    // A pedreira pode emitir nota de servico a partir da OS. Quando emite, o numero vale.
    expect(invoiceNumberLabel("512", "internal").state).toBe("number");
  });

  it("venda COM NOTA sem numero e a unica pendencia de verdade", () => {
    const label = invoiceNumberLabel(null, "invoice");

    expect(label.state).toBe("pending");
    expect(label.text).toBe("Sem nota");
    expect(label.title).toContain("NF-e nao foi emitida");
  });

  it("numero em branco conta como ausente", () => {
    expect(invoiceNumberLabel("   ", "invoice").state).toBe("pending");
    expect(invoiceNumberLabel("   ", "internal").state).toBe("not_applicable");
  });

  it("no arquivo exportado a interna se explica sozinha", () => {
    // Quem abre o Excel nao tem o tooltip: "—" sozinho ali nao diz nada.
    expect(invoiceNumberText(null, "internal")).toBe("Interna (sem NF-e)");
    expect(invoiceNumberText(null, "invoice")).toBe("Sem nota");
    expect(invoiceNumberText("28727", "invoice")).toBe("28727");
  });
});
