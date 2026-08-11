import { describe, expect, it } from "vitest";

import {
  evaluateOmieCustomerReadiness,
  omieRequiredCustomerFields,
  type OmieCustomerCadastro
} from "./omie-customer-readiness";

function cadastro(overrides: Partial<OmieCustomerCadastro> = {}): OmieCustomerCadastro {
  return {
    document: "12345678000195",
    email: "cliente@pedreira.com.br",
    zipcode: "18150-000",
    addressStreet: "Rua das Pedras",
    addressNumber: "123",
    neighborhood: "Centro",
    city: "Ibiuna",
    state: "SP",
    source: "local",
    ...overrides
  };
}

/**
 * A regra nasceu de uma venda real: cliente novo sem endereco, o OMIE aceitou criar o
 * cadastro e recusou o PEDIDO. A carga foi pesada, impressa e ficou sem pedido no OMIE.
 */
describe("cadastro que o OMIE exige para abrir a operacao", () => {
  it("libera a entrada quando o cadastro esta completo", () => {
    expect(evaluateOmieCustomerReadiness(cadastro(), "invoice")).toMatchObject({
      ready: true,
      missing: [],
      message: null
    });
  });

  it("barra a venda com nota sem endereco — o caso que originou a trava", () => {
    const readiness = evaluateOmieCustomerReadiness(
      cadastro({
        zipcode: null,
        addressStreet: null,
        addressNumber: null,
        neighborhood: null,
        city: null,
        state: null
      }),
      "invoice"
    );

    expect(readiness.ready).toBe(false);
    expect(readiness.missing).toEqual([
      "zipcode",
      "addressStreet",
      "addressNumber",
      "neighborhood",
      "city",
      "state"
    ]);
    expect(readiness.message).toContain("CEP");
    expect(readiness.message).toContain("Cidade e Estado (UF)");
    expect(readiness.message).toContain("recusa o pedido");
  });

  it("barra os dois tipos de operacao sem CNPJ/CPF", () => {
    // Sem documento o OMIE nao cadastra o cliente e o fechamento nem gera job.
    for (const operationType of ["invoice", "internal"] as const) {
      const readiness = evaluateOmieCustomerReadiness(cadastro({ document: "   " }), operationType);
      expect(readiness.ready).toBe(false);
      expect(readiness.missing).toContain("document");
    }
  });

  it("nao cobra endereco da operacao interna — a OS nao emite NF-e", () => {
    const readiness = evaluateOmieCustomerReadiness(
      cadastro({
        email: null,
        zipcode: null,
        addressStreet: null,
        addressNumber: null,
        neighborhood: null,
        city: null,
        state: null
      }),
      "internal"
    );

    expect(readiness.ready).toBe(true);
  });

  it("aceita o e-mail padrao de NF-e no lugar do e-mail do cliente", () => {
    // O fechamento ja preenche o e-mail do cliente a partir do padrao
    // (autoCompleteCustomerForNfe): cobrar o campo aqui travaria a balanca a toa.
    expect(
      evaluateOmieCustomerReadiness(cadastro({ email: null }), "invoice", {
        defaultNfeEmail: "nfe@pedreira.com.br"
      })
    ).toMatchObject({ ready: true });

    expect(evaluateOmieCustomerReadiness(cadastro({ email: null }), "invoice")).toMatchObject({
      ready: false,
      missing: ["email"]
    });
  });

  it("avisa que o cadastro de origem OMIE tambem precisa ser corrigido la", () => {
    const readiness = evaluateOmieCustomerReadiness(
      cadastro({ city: null, source: "omie" }),
      "invoice"
    );

    expect(readiness.omieOwned).toBe(true);
    expect(readiness.message).toContain("portal do OMIE");
  });

  it("nao cobra campo opcional do OMIE", () => {
    // Telefone e complemento nao entram na regra: travar a balanca por campo que o OMIE
    // aceita vazio custa mais que preenche-lo depois.
    const required = omieRequiredCustomerFields("invoice");
    expect(required).not.toContain("phone");
    expect(required).not.toContain("addressComplement");
  });

  it("trata cliente inexistente sem estourar", () => {
    expect(evaluateOmieCustomerReadiness(null, "invoice")).toMatchObject({
      ready: false,
      message: "Cliente nao encontrado no cadastro local."
    });
  });

  it("lista um unico campo faltante sem o conector 'e'", () => {
    expect(evaluateOmieCustomerReadiness(cadastro({ city: null }), "invoice").message).toContain(
      "falta Cidade."
    );
  });
});
