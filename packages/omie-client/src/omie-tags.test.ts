import { describe, expect, it } from "vitest";

import {
  hasClienteTag,
  hasFornecedorTag,
  hasTransportadoraTag,
  isOmieCarrierCadastro,
  isOmieCustomerCadastro,
  normalizeOmieTagValue,
  readOmieCadastroRoles,
  readOmieTagValues
} from "./omie-tags.js";

describe("omie-tags", () => {
  it("classifies multiple tags without treating Fornecedor as Transportadora", () => {
    expect(hasClienteTag({ tags: [{ tag: "Cliente" }, { tag: "Fornecedor" }] })).toBe(true);
    expect(hasClienteTag({})).toBe(false);
    expect(hasClienteTag({ tags: [{ tag: "Fornecedor" }] })).toBe(false);
    expect(hasFornecedorTag({ tags: [{ tag: "Fornecedor" }] })).toBe(true);
    expect(hasTransportadoraTag({ tags: [{ tag: "Cliente" }, { tag: "Fornecedor" }] })).toBe(false);
    expect(hasTransportadoraTag({ tags: [{ tag: "Transportadora" }, { tag: "Fornecedor" }] })).toBe(
      true
    );
  });

  it("matches tags regardless of accents and casing", () => {
    expect(hasTransportadoraTag({ tags: [{ tag: "TRANSPORTADORA" }] })).toBe(true);
    expect(hasClienteTag({ tags: ["cliente"] })).toBe(true);
    expect(hasClienteTag({ tags: { tags: ["Cliente"] } })).toBe(true);
  });
});

describe("papeis do cadastro do OMIE", () => {
  it("le o papel pela tag e pelo campo cliente_fornecedor", () => {
    expect(readOmieCadastroRoles({ customerType: "C" })).toEqual({
      isCustomer: true,
      isSupplier: false,
      isCarrier: false,
      isUnclassified: false
    });
    expect(readOmieCadastroRoles({ customerType: "A" })).toMatchObject({
      isCustomer: true,
      isSupplier: true
    });
    expect(readOmieCadastroRoles({ tags: [{ tag: "Fornecedor" }] })).toMatchObject({
      isCustomer: false,
      isSupplier: true
    });
    expect(readOmieCadastroRoles({})).toMatchObject({ isUnclassified: true });
  });

  it("traz como cliente todo cadastro que nao e so fornecedor/transportadora", () => {
    // Sem papel declarado no OMIE o cadastro e cliente da pedreira: era o caso que
    // sumia da lista da balanca quando o filtro exigia a tag "Cliente".
    expect(isOmieCustomerCadastro({})).toBe(true);
    expect(isOmieCustomerCadastro({ customerType: "C" })).toBe(true);
    expect(isOmieCustomerCadastro({ tags: [{ tag: "Cliente" }, { tag: "Fornecedor" }] })).toBe(
      true
    );
    // Fornecedor e transportadora puros ficam fora do cadastro de clientes.
    expect(isOmieCustomerCadastro({ tags: [{ tag: "Fornecedor" }] })).toBe(false);
    expect(isOmieCustomerCadastro({ customerType: "F" })).toBe(false);
    expect(isOmieCustomerCadastro({ tags: [{ tag: "Transportadora" }] })).toBe(false);
  });

  it("marca transportadora pela tag ou pelo tipo T", () => {
    expect(isOmieCarrierCadastro({ tags: [{ tag: "Transportadora" }] })).toBe(true);
    expect(isOmieCarrierCadastro({ customerType: "T" })).toBe(true);
    expect(isOmieCarrierCadastro({ customerType: "C" })).toBe(false);
  });

  it("le e normaliza os valores de tag nos tres formatos da API", () => {
    expect(readOmieTagValues([{ tag: "Cliente" }])).toEqual(["Cliente"]);
    expect(readOmieTagValues({ tags: ["Cliente"] })).toEqual(["Cliente"]);
    expect(readOmieTagValues(null)).toEqual([]);
    expect(normalizeOmieTagValue(" TRANSPORTADORA ")).toBe("transportadora");
  });
});
