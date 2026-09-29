import { describe, expect, it, vi } from "vitest";

import { lookupCep } from "./cep";

function fakeFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;
}

describe("lookupCep", () => {
  it("traduz a resposta do ViaCEP", async () => {
    const fetchImpl = fakeFetch({
      logradouro: "Rua Um",
      bairro: "Centro",
      localidade: "Ibiúna",
      uf: "SP"
    });
    await expect(lookupCep("18150-000", fetchImpl)).resolves.toEqual({
      street: "Rua Um",
      district: "Centro",
      city: "Ibiúna",
      state: "SP"
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://viacep.com.br/ws/18150000/json/",
      expect.anything()
    );
  });

  it("CEP incompleto nem consulta", async () => {
    const fetchImpl = fakeFetch({});
    await expect(lookupCep("1815", fetchImpl)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("CEP inexistente, erro de rede ou resposta ruim viram null", async () => {
    await expect(lookupCep("00000000", fakeFetch({ erro: true }))).resolves.toBeNull();
    await expect(lookupCep("18150000", fakeFetch({}, false))).resolves.toBeNull();
    const failing = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await expect(lookupCep("18150000", failing)).resolves.toBeNull();
  });
});
