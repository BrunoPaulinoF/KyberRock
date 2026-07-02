import { describe, expect, it, vi } from "vitest";

import type { OmieClient } from "./omie-client";
import {
  OmieCustomersService,
  listCustomers,
  getCustomer
} from "./customers-service";

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

    expect(client.call).toHaveBeenCalledWith(
      "/geral/clientes/",
      "ListarClientes",
      { pagina: 1, registros_por_pagina: 50 }
    );
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

    expect(client.call).toHaveBeenCalledWith(
      "/geral/clientes/",
      "ConsultarCliente",
      { codigoClienteOmie: 123 }
    );
    expect(result?.id).toBe(123);
  });
});

describe("OmieCustomersService", () => {
  it("lists all customers across pages", async () => {
    const client = mockClient({
      clientesCadastro: [
        { codigoClienteOmie: 1, razaoSocial: "A", cnpjCpf: "1" }
      ],
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
