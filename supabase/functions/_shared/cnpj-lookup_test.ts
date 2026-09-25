import { describe, expect, it } from "vitest";

import { CnpjLookupError, lookupCnpj } from "./cnpj-lookup";

function fakeFetch(status: number, body: unknown = {}) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("lookupCnpj", () => {
  it("traduz a resposta da Receita para o formulario do cadastro", async () => {
    const { impl, calls } = fakeFetch(200, {
      razao_social: "POLYMIX LTDA",
      nome_fantasia: "",
      cep: 18150000,
      logradouro: "RUA A",
      numero: 10,
      bairro: "CENTRO",
      municipio: "IBIUNA",
      uf: "SP",
      ddd_telefone_1: "1532490000",
      email: null
    });
    const result = await lookupCnpj("11.222.333/0001-81", impl);
    expect(calls[0]).toContain("/cnpj/v1/11222333000181");
    expect(result).toMatchObject({
      found: true,
      legalName: "POLYMIX LTDA",
      tradeName: "POLYMIX LTDA",
      zipcode: "18150000",
      addressNumber: "10",
      phone: "(15) 32490000",
      email: null,
      state: "SP"
    });
  });

  it("404 da Receita e 'nao encontrado', nao erro", async () => {
    const result = await lookupCnpj("11222333000181", fakeFetch(404).impl);
    expect(result.found).toBe(false);
  });

  it("CPF ou texto curto e recusado antes de consultar", async () => {
    const { impl, calls } = fakeFetch(200);
    await expect(lookupCnpj("529.982.247-25", impl)).rejects.toBeInstanceOf(CnpjLookupError);
    expect(calls).toHaveLength(0);
  });

  it("Receita fora do ar vira 502", async () => {
    await expect(lookupCnpj("11222333000181", fakeFetch(500).impl)).rejects.toMatchObject({
      status: 502
    });
  });
});
