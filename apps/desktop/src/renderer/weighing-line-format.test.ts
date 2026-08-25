import { describe, expect, it } from "vitest";

import {
  formatBRL,
  formatCount,
  formatKg,
  formatTons,
  omieReference,
  unitPriceLabel
} from "./weighing-line-format";

/**
 * O Intl do pt-BR separa "R$" do valor com espaco NAO quebravel. Escrever esse caractere
 * cru no teste dispara `no-irregular-whitespace` — e um NBSP invisivel no meio de uma
 * string e exatamente o tipo de coisa que ninguem enxerga revisando. Aqui ele e escapado.
 */
const NBSP = "\u00a0";

/**
 * Estes seis formatos existiam duas vezes — uma copia na Conferencia de faturamento e
 * outra no Fechamento de faturas —, e as duas telas sao comparadas lado a lado pela
 * atendente. Os testes prendem o formato que as duas ja mostravam, para a juncao das
 * copias nao ter mexido em nenhum deles.
 */
describe("formatos da pesagem", () => {
  it("dinheiro sai em real, a partir de centavos", () => {
    // Espaco NAO quebravel depois do "R$" — e o que o Intl do pt-BR produz.
    expect(formatBRL(123456)).toBe(`R$${NBSP}1.234,56`);
    expect(formatBRL(0)).toBe(`R$${NBSP}0,00`);
  });

  it("tonelada sai com uma casa, sempre", () => {
    expect(formatTons(31500)).toBe("31,5 t");
    // Uma casa mesmo quando o peso e redondo: sem isso a coluna desalinha na leitura.
    expect(formatTons(30000)).toBe("30,0 t");
  });

  it("quilo sai so com o numero, sem casa decimal e sem a unidade repetida", () => {
    expect(formatKg(31500)).toBe("31.500");
    expect(formatKg(31500.7)).toBe("31.501");
  });

  it("contagem usa o separador de milhar do pt-BR", () => {
    expect(formatCount(326)).toBe("326");
    expect(formatCount(1234)).toBe("1.234");
  });
});

describe("unitPriceLabel", () => {
  it("traz a unidade junto: por tonelada e por quilo sao contas mil vezes diferentes", () => {
    expect(unitPriceLabel({ unitPriceCents: 4200, priceUnit: "ton" })).toBe(`R$${NBSP}42,00/t`);
    expect(unitPriceLabel({ unitPriceCents: 4200, priceUnit: "kg" })).toBe(`R$${NBSP}42,00/kg`);
  });

  it("sem preco aplicado, a celula fica com o traco", () => {
    expect(unitPriceLabel({ unitPriceCents: null, priceUnit: "ton" })).toBe("-");
  });

  it("unidade desconhecida cai em tonelada, que e o padrao da pedreira", () => {
    expect(unitPriceLabel({ unitPriceCents: 100, priceUnit: null })).toBe(`R$${NBSP}1,00/t`);
  });
});

describe("omieReference", () => {
  it("venda com nota vira pedido, com o numero visivel entre parenteses", () => {
    expect(
      omieReference({
        omieOrderNumber: "622",
        omieSalesOrderId: 11495333606,
        omieServiceOrderId: null
      })
    ).toBe("Pedido 11495333606 (nº 622)");
  });

  it("venda interna vira OS", () => {
    expect(
      omieReference({ omieOrderNumber: "88", omieSalesOrderId: null, omieServiceOrderId: 4321 })
    ).toBe("OS 4321 (nº 88)");
  });

  /**
   * O codigo grande e o da integracao: digitar ele na busca do OMIE nao acha nada. Enquanto
   * o numero visivel nao foi conferido la, a celula mostra so o codigo — sem parenteses
   * vazios, que pareceriam um numero que nao existe.
   */
  it("sem o numero visivel, mostra so o codigo interno", () => {
    expect(
      omieReference({ omieOrderNumber: null, omieSalesOrderId: 9002, omieServiceOrderId: null })
    ).toBe("Pedido 9002");
  });

  it("pesagem que ainda nao chegou ao OMIE fica com o traco", () => {
    expect(
      omieReference({ omieOrderNumber: null, omieSalesOrderId: null, omieServiceOrderId: null })
    ).toBe("-");
  });
});
