import { describe, expect, it } from "vitest";

import { weighingLineFooterSpans } from "./WeighingLinesTable";

/**
 * O rodape era escrito a mao, e diferente, em cada uma das duas telas que mostram esta
 * tabela: `colSpan={5}` e `colSpan={4}` na Conferencia de faturamento, `colSpan={9}` e
 * `colSpan={6}` no Fechamento de faturas. Numero a mao nesse lugar quebra CALADO — a soma
 * continua somando, so que embaixo da coluna errada, e ninguem percebe olhando a tela.
 *
 * Estes testes prendem os quatro numeros que as telas de fato usavam antes da tabela virar
 * um componente so. Se a conta mudar, e aqui que aparece.
 */
describe("weighingLineFooterSpans", () => {
  it("sem colunas opcionais, e o rodape que a Conferencia de faturamento tinha", () => {
    // Op., Data, Cliente, Produto, Placa | ... | Tipo, Situacao, Nota fiscal, Pedido/OS.
    expect(weighingLineFooterSpans({})).toEqual({ leading: 5, trailing: 4 });
  });

  it("com todas as opcionais, e o rodape que o Fechamento de faturas tinha", () => {
    expect(
      weighingLineFooterSpans({ coupon: true, document: true, carrier: true, closing: true })
    ).toEqual({ leading: 9, trailing: 6 });
  });

  it("transportador e motorista contam como duas colunas, porque andam juntas", () => {
    expect(weighingLineFooterSpans({ carrier: true }).leading).toBe(7);
  });

  it("fechamento e vencimento contam como duas, e so mexem no fim da linha", () => {
    const spans = weighingLineFooterSpans({ closing: true });
    expect(spans).toEqual({ leading: 5, trailing: 6 });
  });

  it("cada opcional de uma coluna soma exatamente uma", () => {
    expect(weighingLineFooterSpans({ coupon: true }).leading).toBe(6);
    expect(weighingLineFooterSpans({ document: true }).leading).toBe(6);
  });

  /**
   * A conta so vale se as duas pontas somadas derem o total de colunas do cabecalho, menos
   * as cinco do meio que tem valor proprio (Peso, Preco unit., Produto, Frete e Total).
   */
  it("as duas pontas mais as cinco colunas de valor fecham o cabecalho inteiro", () => {
    const conferencia = weighingLineFooterSpans({});
    expect(conferencia.leading + 5 + conferencia.trailing).toBe(14);

    const fechamento = weighingLineFooterSpans({
      coupon: true,
      document: true,
      carrier: true,
      closing: true
    });
    expect(fechamento.leading + 5 + fechamento.trailing).toBe(20);
  });
});
