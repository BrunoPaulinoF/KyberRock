import { describe, expect, it, vi } from "vitest";

import type { OmieClient } from "./omie-client";
import { listProducts, OmieProductsService } from "./products-service";

function mockClient(response: unknown) {
  return {
    call: vi.fn().mockResolvedValue(response)
  } as unknown as OmieClient;
}

describe("listProducts", () => {
  it("calls ListarProdutos with pagination", async () => {
    const client = mockClient({
      produtoCadastro: [],
      nRegistros: 0
    });

    await listProducts(client, { pagina: 1, registrosPorPagina: 50 });

    expect(client.call).toHaveBeenCalledWith(
      "/api/v1/geral/produtos/",
      "ListarProdutos",
      { pagina: 1, registrosPorPagina: 50 }
    );
  });

  it("returns formatted products", async () => {
    const client = mockClient({
      produtoCadastro: [
        {
          codigoProdutoOmie: 456,
          descricao: "Brita 0",
          codigo: "BRITA0",
          valorUnitario: 150.0
        }
      ],
      nRegistros: 1
    });

    const result = await listProducts(client, { pagina: 1 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 456,
      description: "Brita 0",
      code: "BRITA0",
      unitPrice: 150.0
    });
  });
});

describe("OmieProductsService", () => {
  it("lists all products across pages", async () => {
    const client = mockClient({
      produtoCadastro: [
        { codigoProdutoOmie: 1, descricao: "Brita", codigo: "B1", valorUnitario: 100 }
      ],
      nRegistros: 1
    });

    const service = new OmieProductsService(client);
    const products = await service.listAll();

    expect(products).toHaveLength(1);
  });
});
