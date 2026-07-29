import { describe, expect, it } from "vitest";

import { classifyOmieCustomer } from "./omie-customer-classification.ts";

const tags = (...values: string[]) => ({ tags: values.map((tag) => ({ tag })) });

describe("classifyOmieCustomer", () => {
  it("trata cadastro sem tag como cliente", () => {
    // Caso da pedreira que nao usa tags no OMIE: antes esses cadastros eram
    // descartados em silencio (900+ clientes viravam 213 no KyberRock).
    expect(classifyOmieCustomer(null)).toEqual({ isCustomer: true, isCarrier: false });
    expect(classifyOmieCustomer({ tags: [] })).toEqual({ isCustomer: true, isCarrier: false });
  });

  it("respeita a tag cliente", () => {
    expect(classifyOmieCustomer(tags("Cliente"))).toEqual({ isCustomer: true, isCarrier: false });
  });

  it("nao traz transportadora como cliente", () => {
    expect(classifyOmieCustomer(tags("Transportadora"))).toEqual({
      isCustomer: false,
      isCarrier: true
    });
  });

  it("traz nos dois lados quem e transportadora e cliente", () => {
    expect(classifyOmieCustomer(tags("transportadora", "cliente"))).toEqual({
      isCustomer: true,
      isCarrier: true
    });
  });

  it("ignora acento e caixa nas tags", () => {
    expect(classifyOmieCustomer(tags("TRANSPORTADORA "))).toEqual({
      isCustomer: false,
      isCarrier: true
    });
  });

  it("nao traz fornecedor puro como cliente", () => {
    expect(classifyOmieCustomer(tags("Fornecedor"))).toEqual({
      isCustomer: false,
      isCarrier: false
    });
    // Fornecedor que tambem compra continua entrando como cliente.
    expect(classifyOmieCustomer(tags("Fornecedor", "Cliente"))).toEqual({
      isCustomer: true,
      isCarrier: false
    });
  });

  it("aceita tag como texto simples, nao so objeto", () => {
    expect(classifyOmieCustomer(["transportadora"])).toEqual({
      isCustomer: false,
      isCarrier: true
    });
  });

  it("cadastro com outras tags de negocio continua sendo cliente", () => {
    expect(classifyOmieCustomer(tags("Obra", "Regiao Sul"))).toEqual({
      isCustomer: true,
      isCarrier: false
    });
  });
});
