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

  it("traz fornecedor como cliente: cliente faltando e caminhao parado", () => {
    // Era aqui que 701 dos 948 cadastros do OMIE ficavam de fora. Fornecedor
    // sobrando na busca e ruido; cliente faltando trava a balanca.
    expect(classifyOmieCustomer(tags("Fornecedor"))).toEqual({
      isCustomer: true,
      isCarrier: false
    });
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

  it("o tipo do OMIE marca como cliente mesmo quem so tem tag de transportadora", () => {
    // `cliente_fornecedor` e o campo do proprio OMIE para isto, populado mesmo
    // em quem nao usa tags — quando ele diz que o cadastro compra, vale.
    expect(classifyOmieCustomer(tags("Transportadora"), "C")).toEqual({
      isCustomer: true,
      isCarrier: true
    });
    // "A" = ambos (cliente e fornecedor).
    expect(classifyOmieCustomer(tags("Transportadora"), "A")).toEqual({
      isCustomer: true,
      isCarrier: true
    });
  });

  it("tipo transportadora entra como transportadora mesmo sem tag", () => {
    expect(classifyOmieCustomer(null, "T")).toEqual({ isCustomer: false, isCarrier: true });
  });

  it("tipo fornecedor nao exclui: so transportadora fica fora dos clientes", () => {
    expect(classifyOmieCustomer(null, "F")).toEqual({ isCustomer: true, isCarrier: false });
    expect(classifyOmieCustomer(tags("Fornecedor"), "F")).toEqual({
      isCustomer: true,
      isCarrier: false
    });
  });

  it("aceita o tipo escrito por extenso e com caixa/acento variados", () => {
    expect(classifyOmieCustomer(tags("Fornecedor"), " Cliente ")).toEqual({
      isCustomer: true,
      isCarrier: false
    });
    expect(classifyOmieCustomer(null, "TRANSPORTADORA")).toEqual({
      isCustomer: false,
      isCarrier: true
    });
  });

  it("tipo ausente ou desconhecido nao muda nada: o cadastro entra como cliente", () => {
    expect(classifyOmieCustomer(tags("Fornecedor"), null)).toEqual({
      isCustomer: true,
      isCarrier: false
    });
    expect(classifyOmieCustomer(tags("Fornecedor"), "Z")).toEqual({
      isCustomer: true,
      isCarrier: false
    });
  });

  it("transportadora pura continua sendo o unico cadastro fora dos clientes", () => {
    expect(classifyOmieCustomer(tags("Transportadora"), "F")).toEqual({
      isCustomer: false,
      isCarrier: true
    });
  });
});
