import { describe, expect, it } from "vitest";

import { describeNoteReconcile } from "./CustomerReportView";

/**
 * O aviso do botao "Conferir notas no OMIE". Ele existe para quem vai MANDAR o relatorio
 * ao cliente agora — e antes respondia contando cargas conferidas, o que fazia o operador
 * ler "326 conferidas", voltar para a tabela com a coluna "Nota fiscal" ainda em "-" e nao
 * entender o que tinha acontecido.
 */
describe("describeNoteReconcile", () => {
  it("fala primeiro do numero da nota, que e o motivo do botao", () => {
    const message = describeNoteReconcile({
      checked: 40,
      billed: 0,
      invoiceNumbers: 12,
      stillWithoutInvoiceNumber: 0
    });

    expect(message).toContain("12 carga(s) ganharam o numero da nota");
    expect(message).toContain("40 conferida(s)");
  });

  it("diz quantas continuam faturadas sem numero, em vez de deixar o operador adivinhar", () => {
    const message = describeNoteReconcile({
      checked: 40,
      billed: 2,
      invoiceNumbers: 12,
      stillWithoutInvoiceNumber: 26
    });

    expect(message).toContain("12 carga(s) ganharam o numero da nota");
    expect(message).toContain("2 passaram a constar faturadas");
    expect(message).toContain("26 continuam faturadas sem numero");
  });

  it("periodo em dia responde que nao ha novidade, e nao que nada foi conferido", () => {
    const message = describeNoteReconcile({
      checked: 40,
      billed: 0,
      invoiceNumbers: 0,
      stillWithoutInvoiceNumber: 0
    });

    expect(message).toContain("40 carga(s) conferida(s)");
    expect(message).toContain("ja estava em dia");
  });

  it("periodo sem documento no OMIE diz isso com todas as letras", () => {
    expect(
      describeNoteReconcile({
        checked: 0,
        billed: 0,
        invoiceNumbers: 0,
        stillWithoutInvoiceNumber: 0
      })
    ).toContain("Nao ha cargas com pedido ou OS no OMIE");
  });
});
