import { describe, expect, it } from "vitest";

import { classifyOmieCustomer } from "./omie-customer-classification.ts";

const tags = (...values: string[]) => ({ tags: values.map((tag) => ({ tag })) });

const customer = { isCustomer: true, isCarrier: false, isSupplier: false };
const carrier = { isCustomer: false, isCarrier: true, isSupplier: false };
const supplier = { isCustomer: false, isCarrier: false, isSupplier: true };

describe("classifyOmieCustomer", () => {
  it("trata cadastro sem tag como cliente", () => {
    // Caso da pedreira que nao usa tags no OMIE: antes esses cadastros eram
    // descartados em silencio (900+ clientes viravam 213 no KyberRock).
    expect(classifyOmieCustomer(null)).toEqual(customer);
    expect(classifyOmieCustomer({ tags: [] })).toEqual(customer);
  });

  it("respeita a tag cliente", () => {
    expect(classifyOmieCustomer(tags("Cliente"))).toEqual(customer);
  });

  it("nao traz transportadora como cliente", () => {
    expect(classifyOmieCustomer(tags("Transportadora"))).toEqual(carrier);
  });

  it("traz nos dois lados quem e transportadora e cliente", () => {
    expect(classifyOmieCustomer(tags("transportadora", "cliente"))).toEqual({
      isCustomer: true,
      isCarrier: true,
      isSupplier: false
    });
  });

  it("ignora acento e caixa nas tags", () => {
    expect(classifyOmieCustomer(tags("TRANSPORTADORA "))).toEqual(carrier);
  });

  it("nao traz fornecedor puro como cliente", () => {
    // Fornecedor cadastrado como cliente gera conflito na balanca (aparece na troca
    // de cliente da operacao); quem tambem e cliente continua entrando.
    expect(classifyOmieCustomer(tags("Fornecedor"))).toEqual(supplier);
    expect(classifyOmieCustomer(tags("Fornecedor", "Cliente"))).toEqual({
      isCustomer: true,
      isCarrier: false,
      isSupplier: true
    });
  });

  it("aceita tag como texto simples, nao so objeto", () => {
    expect(classifyOmieCustomer(["transportadora"])).toEqual(carrier);
  });

  it("cadastro com outras tags de negocio continua sendo cliente", () => {
    expect(classifyOmieCustomer(tags("Obra", "Regiao Sul"))).toEqual(customer);
  });

  it("o tipo do OMIE marca como cliente mesmo quem so tem tag de transportadora", () => {
    // `cliente_fornecedor` e o campo do proprio OMIE para isto, populado mesmo
    // em quem nao usa tags — quando ele diz que o cadastro compra, vale.
    expect(classifyOmieCustomer(tags("Transportadora"), "C")).toEqual({
      isCustomer: true,
      isCarrier: true,
      isSupplier: false
    });
    // "A" = ambos (cliente e fornecedor).
    expect(classifyOmieCustomer(tags("Transportadora"), "A")).toEqual({
      isCustomer: true,
      isCarrier: true,
      isSupplier: true
    });
  });

  it("tipo transportadora entra como transportadora mesmo sem tag", () => {
    expect(classifyOmieCustomer(null, "T")).toEqual(carrier);
  });

  it("tipo fornecedor tira o cadastro da lista de clientes", () => {
    expect(classifyOmieCustomer(null, "F")).toEqual(supplier);
    expect(classifyOmieCustomer(tags("Fornecedor"), "F")).toEqual(supplier);
  });

  it("aceita o tipo escrito por extenso e com caixa/acento variados", () => {
    expect(classifyOmieCustomer(tags("Fornecedor"), " Cliente ")).toEqual({
      isCustomer: true,
      isCarrier: false,
      isSupplier: true
    });
    expect(classifyOmieCustomer(null, "TRANSPORTADORA")).toEqual(carrier);
  });

  it("tipo ausente ou desconhecido nao muda a classificacao pela tag", () => {
    expect(classifyOmieCustomer(tags("Fornecedor"), null)).toEqual(supplier);
    expect(classifyOmieCustomer(tags("Fornecedor"), "Z")).toEqual(supplier);
  });

  it("transportadora que tambem e fornecedor continua fora dos clientes", () => {
    expect(classifyOmieCustomer(tags("Transportadora"), "F")).toEqual({
      isCustomer: false,
      isCarrier: true,
      isSupplier: true
    });
  });
});
