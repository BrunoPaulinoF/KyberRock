import { describe, expect, it, vi } from "vitest";

import type { OmieClient } from "./omie-client";
import {
  OmieCustomersService,
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer
} from "./customers-service";
import { clampOmieText } from "./omie-field-limits";

function mockClient(response: unknown) {
  return {
    call: vi.fn().mockResolvedValue(response)
  } as unknown as OmieClient;
}

describe("listCustomers", () => {
  it("calls ListarClientes with pagination", async () => {
    const client = mockClient({
      clientesCadastro: [],
      nRegistros: 0
    });

    await listCustomers(client, { pagina: 1, registros_por_pagina: 50 });

    expect(client.call).toHaveBeenCalledWith("/geral/clientes/", "ListarClientes", {
      pagina: 1,
      registros_por_pagina: 50
    });
  });

  it("returns formatted customers", async () => {
    const client = mockClient({
      clientesCadastro: [
        {
          codigoClienteOmie: 123,
          razaoSocial: "ACME Ltda",
          nomeFantasia: "ACME",
          cnpjCpf: "12345678000195",
          email: "acme@example.com"
        }
      ],
      nRegistros: 1
    });

    const result = await listCustomers(client, { pagina: 1 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 123,
      name: "ACME Ltda",
      tradeName: "ACME",
      document: "12345678000195",
      email: "acme@example.com"
    });
  });
});

describe("getCustomer", () => {
  it("calls ConsultarCliente with client code", async () => {
    const client = mockClient({
      codigoClienteOmie: 123,
      razaoSocial: "ACME Ltda",
      cnpjCpf: "12345678000195"
    });

    const result = await getCustomer(client, 123);

    expect(client.call).toHaveBeenCalledWith("/geral/clientes/", "ConsultarCliente", {
      codigoClienteOmie: 123
    });
    expect(result?.id).toBe(123);
  });
});

describe("OmieCustomersService", () => {
  it("lists all customers across pages", async () => {
    const client = mockClient({
      clientesCadastro: [{ codigoClienteOmie: 1, razaoSocial: "A", cnpjCpf: "1" }],
      nRegistros: 1
    });

    const service = new OmieCustomersService(client);
    const customers = await service.listAll();

    expect(customers).toHaveLength(1);
    expect(client.call).toHaveBeenCalledTimes(1);
    expect(client.call).toHaveBeenCalledWith(
      "/geral/clientes/",
      "ListarClientes",
      expect.objectContaining({
        pagina: 1,
        registros_por_pagina: 100,
        apenas_importado_api: "N"
      })
    );
  });
});

describe("OMIE field limits", () => {
  it("clamps razao social and nome fantasia when creating a customer", async () => {
    const client = mockClient({ codigoClienteOmie: 42 });
    // O OMIE recusa a chamada inteira quando a razao social passa de 60 caracteres.
    const longa = "LOGI TRANSPORTES E LOGISTICA INTEGRADA DO BRASIL LTDA - FILIAL SAO PAULO";

    await createCustomer(client, {
      razaoSocial: longa,
      nomeFantasia: longa,
      cnpjCpf: "12345678000190"
    });

    expect(client.call).toHaveBeenCalledWith("/geral/clientes/", "IncluirCliente", {
      razaoSocial: "LOGI TRANSPORTES E LOGISTICA INTEGRADA DO BRASIL LTDA",
      nomeFantasia: "LOGI TRANSPORTES E LOGISTICA INTEGRADA DO BRASIL LTDA",
      // O documento nunca e cortado: encurtar um CNPJ mandaria um documento errado.
      cnpjCpf: "12345678000190"
    });
  });

  it("clamps razao social when updating a customer and leaves short values untouched", async () => {
    const client = mockClient({});

    await updateCustomer(client, {
      codigoClienteOmie: 42,
      razaoSocial: "A".repeat(80),
      nomeFantasia: "Pedreira"
    });

    expect(client.call).toHaveBeenCalledWith("/geral/clientes/", "AlterarCliente", {
      codigoClienteOmie: 42,
      razaoSocial: "A".repeat(60),
      nomeFantasia: "Pedreira"
    });
  });

  it("keeps fields the caller did not send out of the payload", async () => {
    const client = mockClient({});

    await updateCustomer(client, { codigoClienteOmie: 42, email: "nfe@pedreira.com.br" });

    expect(client.call).toHaveBeenCalledWith("/geral/clientes/", "AlterarCliente", {
      codigoClienteOmie: 42,
      email: "nfe@pedreira.com.br"
    });
  });
});

describe("clampOmieText", () => {
  it("normalizes whitespace and cuts on a word boundary", () => {
    expect(clampOmieText("  Pedreira   LTDA  ", 60)).toBe("Pedreira LTDA");
    expect(clampOmieText("   ", 60)).toBeUndefined();
    expect(clampOmieText(undefined, 60)).toBeUndefined();
    // Palavra unica maior que o limite: corte seco, senao nao sobraria quase nada.
    expect(clampOmieText("A".repeat(80), 60)).toBe("A".repeat(60));
  });

  it("is deterministic so re-sends stay idempotent in OMIE", () => {
    const nome = "TRANSPORTADORA UNIAO DO NORTE E NORDESTE DISTRIBUIDORA LTDA ME";
    expect(clampOmieText(nome, 60)).toBe(clampOmieText(nome, 60));
    expect((clampOmieText(nome, 60) ?? "").length).toBeLessThanOrEqual(60);
  });
});
