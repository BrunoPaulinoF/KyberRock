import { describe, expect, it } from "vitest";

import { describeOmieCustomersScan, type OmieCustomersScan } from "./runtime";

/**
 * A tela so mostrava "N clientes baixados", entao um pull que traz menos do que
 * existe no OMIE ficava indistinguivel de um pull completo. Estes numeros vem do
 * proprio OMIE e separam as duas causas possiveis: varredura parada no meio
 * (paginas) ou cadastro descartado na classificacao (tags).
 */
describe("resumo da varredura de clientes do OMIE", () => {
  it("mostra paginas, registros e quantos foram descartados na classificacao", () => {
    expect(
      describeOmieCustomersScan(
        scan({
          pagesRun: 12,
          rawRecords: 1165,
          classifiedCustomers: 1132,
          classifiedCarriers: 33,
          omieTotalPages: 12,
          omieTotalRecords: 1165,
          finished: true
        })
      )
    ).toBe(
      "12/12 paginas, 1165 de 1165 registros, 1132 clientes, 33 transportadoras, 0 sem codigo/razao social"
    );
  });

  it("avisa quando a varredura parou antes do fim declarado pelo OMIE", () => {
    const summary = describeOmieCustomersScan(
      scan({
        pagesRun: 3,
        rawRecords: 300,
        classifiedCustomers: 214,
        classifiedCarriers: 33,
        supplierOnly: 50,
        invalid: 3,
        omieTotalPages: 12,
        omieTotalRecords: 1165,
        finished: false
      })
    );

    expect(summary).toContain("3/12 paginas");
    expect(summary).toContain("300 de 1165 registros");
    expect(summary).toContain("50 fora da classificacao");
    expect(summary).toContain("3 sem codigo/razao social");
    expect(summary).toContain("varredura NAO concluida");
  });

  it("nao inventa resumo quando nenhuma pagina rodou", () => {
    expect(describeOmieCustomersScan(scan({ pagesRun: 0 }))).toBeNull();
  });
});

function scan(overrides: Partial<OmieCustomersScan>): OmieCustomersScan {
  return {
    pagesRun: 0,
    rawRecords: 0,
    classifiedCustomers: 0,
    classifiedCarriers: 0,
    invalid: 0,
    supplierOnly: 0,
    omieTotalPages: null,
    omieTotalRecords: null,
    finished: false,
    ...overrides
  };
}
