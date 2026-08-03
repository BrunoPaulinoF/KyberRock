import { describe, expect, it } from "vitest";

import {
  isCadastroIncompleteFault,
  isOmieCustomerRegistrationFault,
  isOmieMissingDocumentFault,
  isOmieProtectedRecordFault,
  isOmieStaleCustomerCodeFault
} from "./omie-fault-classifier.js";

describe("isCadastroIncompleteFault", () => {
  it("matches the reported OMIE NF-e cadastro fault (with accents/case)", () => {
    expect(
      isCadastroIncompleteFault(
        "Nao foi possivel realizar o faturamento desse Pedido de Venda de Produto! Para emitir a NF-e falta preencher o Numero do Endereco e o E-mail."
      )
    ).toBe(true);
    expect(
      isCadastroIncompleteFault(
        "Não foi possível realizar o faturamento desse Pedido de Venda de Produto! Para emitir a NF-e falta preencher o Número do Endereço e o E-mail."
      )
    ).toBe(true);
  });

  it("does not match transient / generic errors", () => {
    expect(isCadastroIncompleteFault("OMIE offline, tente novamente")).toBe(false);
    expect(isCadastroIncompleteFault("Request timeout")).toBe(false);
    expect(isCadastroIncompleteFault("HTTP 503 Service Unavailable")).toBe(false);
    expect(isCadastroIncompleteFault("OMIE nao retornou orderId")).toBe(false);
    expect(isCadastroIncompleteFault("Erro OMIE")).toBe(false);
    expect(isCadastroIncompleteFault("")).toBe(false);
  });

  it("requires both fiscal context and a missing-field cue", () => {
    // faturamento sem "falta" -> transitorio, nao bloqueia
    expect(isCadastroIncompleteFault("Erro ao realizar o faturamento no OMIE")).toBe(false);
    // "falta" sem contexto fiscal -> nao bloqueia
    expect(isCadastroIncompleteFault("falta preencher algum campo generico")).toBe(false);
  });
});

describe("isOmieProtectedRecordFault", () => {
  it("matches the reported Cliente Consumidor fault (with accents/case)", () => {
    expect(
      isOmieProtectedRecordFault(
        "OMIE HTTP 500 em AlterarCliente (/geral/clientes/) - ERROR: Não é possível alterar esse código de integração (Cliente Consumidor)!"
      )
    ).toBe(true);
    expect(
      isOmieProtectedRecordFault(
        "ERROR: Nao e possivel alterar esse codigo de integracao (Cliente Consumidor)!"
      )
    ).toBe(true);
  });

  it("does not match transient / generic errors", () => {
    expect(isOmieProtectedRecordFault("OMIE offline, tente novamente")).toBe(false);
    expect(isOmieProtectedRecordFault("HTTP 503 Service Unavailable")).toBe(false);
    expect(isOmieProtectedRecordFault("O preenchimento da tag [cnpj_cpf] é obrigatório!")).toBe(
      false
    );
    expect(isOmieProtectedRecordFault("")).toBe(false);
  });
});

describe("isOmieMissingDocumentFault", () => {
  it("matches the reported cnpj_cpf mandatory fault (with accents/case)", () => {
    expect(
      isOmieMissingDocumentFault(
        "OMIE HTTP 500 em IncluirCliente (/geral/clientes/) - ERROR: O preenchimento da tag [cnpj_cpf] é obrigatório!"
      )
    ).toBe(true);
    expect(
      isOmieMissingDocumentFault("ERROR: O preenchimento da tag [cnpj_cpf] e obrigatorio!")
    ).toBe(true);
  });

  it("does not match transient / generic errors", () => {
    expect(isOmieMissingDocumentFault("OMIE offline, tente novamente")).toBe(false);
    expect(isOmieMissingDocumentFault("Request timeout")).toBe(false);
    expect(isOmieMissingDocumentFault("cnpj_cpf invalido")).toBe(false);
    expect(isOmieMissingDocumentFault("")).toBe(false);
  });
});

describe("isOmieCustomerRegistrationFault", () => {
  it("matches the customer registration refusals raised by the omie-sync edge", () => {
    expect(
      isOmieCustomerRegistrationFault(
        "Cadastro do cliente recusado pelo OMIE (Pedreira LTDA). Falta preencher: E-mail. " +
          "Complete o cadastro do cliente e reenvie. Detalhe OMIE: ERROR: O preenchimento da tag [email] é obrigatório!"
      )
    ).toBe(true);
    expect(
      isOmieCustomerRegistrationFault(
        "Cadastro do cliente recusado pelo OMIE. Cliente sem codigo OMIE e sem dados de cadastro para criar no OMIE: informe o CNPJ/CPF do cliente e reenvie."
      )
    ).toBe(true);
    // Fluxo antigo (desktop novo com edge ainda nao implantado).
    expect(
      isOmieCustomerRegistrationFault(
        "Cliente sem codigo OMIE e sem dados de cadastro para criar no OMIE."
      )
    ).toBe(true);
    expect(
      isOmieCustomerRegistrationFault("ERROR: O preenchimento da tag [cnpj_cpf] e obrigatorio!")
    ).toBe(true);
  });

  it("does not match transient errors nor failures of the order itself", () => {
    expect(isOmieCustomerRegistrationFault("OMIE offline, tente novamente")).toBe(false);
    expect(isOmieCustomerRegistrationFault("HTTP 503 Service Unavailable")).toBe(false);
    // Recusa da OS (campo do servico, nao do cliente): segue no retry normal.
    expect(isOmieCustomerRegistrationFault("ERROR: - tag: [cCodServMun]")).toBe(false);
    expect(isOmieCustomerRegistrationFault("OMIE nao retornou orderId")).toBe(false);
    expect(isOmieCustomerRegistrationFault("")).toBe(false);
  });
});

describe("isOmieStaleCustomerCodeFault", () => {
  it("matches the raw OMIE refusal of a customer code that no longer exists", () => {
    expect(
      isOmieStaleCustomerCodeFault(
        "OMIE HTTP 500 em IncluirPedido (/produtos/pedido/) - ERROR: Cliente não cadastrado " +
          "para o Código [11455924790] ! - tag: [codigo_cliente]"
      )
    ).toBe(true);
  });

  it("matches the deterministic message the omie-sync edge returns", () => {
    expect(
      isOmieStaleCustomerCodeFault(
        "Codigo do cliente no OMIE nao existe mais (L. A. do Nascimento). O codigo 11455924790 " +
          "gravado no cadastro local nao existe nesta conta do OMIE."
      )
    ).toBe(true);
  });

  it("does not match the same refusal about the carrier, nor other faults", () => {
    // Mesma frase, outra tag: a transportadora tem outro conserto (o pedido segue sem ela).
    expect(
      isOmieStaleCustomerCodeFault(
        "ERROR: Cliente não cadastrado para o Código [777] ! - tag: [codigo_transportadora]"
      )
    ).toBe(false);
    expect(isOmieStaleCustomerCodeFault("OMIE offline, tente novamente")).toBe(false);
    expect(isOmieStaleCustomerCodeFault("OMIE nao retornou orderId")).toBe(false);
    expect(isOmieStaleCustomerCodeFault("")).toBe(false);
  });
});
