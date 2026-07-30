import { describe, expect, it, vi } from "vitest";

import type { OmieClient } from "./omie-client";
import { listCategories, OmieCategoriesService } from "./categories-service";

function mockClient(response: unknown) {
  return {
    call: vi.fn().mockResolvedValue(response)
  } as unknown as OmieClient;
}

describe("listCategories", () => {
  it("chama ListarCategorias com paginacao", async () => {
    const client = mockClient({ categoria_cadastro: [] });

    await listCategories(client, { pagina: 1, registros_por_pagina: 50 });

    expect(client.call).toHaveBeenCalledWith("/geral/categorias/", "ListarCategorias", {
      pagina: 1,
      registros_por_pagina: 50
    });
  });

  it("mapeia codigo, descricao, tipo e categoria superior", async () => {
    const client = mockClient({
      categoria_cadastro: [
        {
          codigo: "1.01.01",
          descricao: "Clientes - Rachao",
          tipo_categoria: "R",
          categoria_superior: "1.01",
          conta_inativa: "N",
          nao_exibir: "N"
        }
      ]
    });

    expect(await listCategories(client, { pagina: 1 })).toEqual([
      {
        code: "1.01.01",
        description: "Clientes - Rachao",
        categoryType: "R",
        parentCode: "1.01",
        isActive: true
      }
    ]);
  });

  it("marca como inativa a categoria totalizadora ou desativada", async () => {
    // Categoria com nao_exibir/conta_inativa nao pode receber lancamento: o OMIE
    // recusaria o pedido, entao ela nao deve aparecer para escolha.
    const client = mockClient({
      categoria_cadastro: [
        { codigo: "1.01", descricao: "Receitas", nao_exibir: "S" },
        { codigo: "1.02", descricao: "Antiga", conta_inativa: "S" }
      ]
    });

    expect((await listCategories(client, { pagina: 1 })).map((c) => c.isActive)).toEqual([
      false,
      false
    ]);
  });

  it("descarta linhas sem codigo ou sem descricao", async () => {
    const client = mockClient({
      categoria_cadastro: [
        { codigo: "1.01.01", descricao: "Valida" },
        { descricao: "Sem codigo" },
        { codigo: "1.01.02" }
      ]
    });

    expect((await listCategories(client, { pagina: 1 })).map((c) => c.code)).toEqual(["1.01.01"]);
  });
});

describe("OmieCategoriesService.listAll", () => {
  it("pagina ate a ultima pagina parcial", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce({
        categoria_cadastro: [
          { codigo: "1.01.01", descricao: "Uma" },
          { codigo: "1.01.02", descricao: "Duas" }
        ]
      })
      .mockResolvedValueOnce({ categoria_cadastro: [{ codigo: "1.01.03", descricao: "Tres" }] });
    const client = { call } as unknown as OmieClient;

    const result = await new OmieCategoriesService(client).listAll(2);

    expect(result.map((c) => c.code)).toEqual(["1.01.01", "1.01.02", "1.01.03"]);
    expect(call).toHaveBeenCalledTimes(2);
  });
});
