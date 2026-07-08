import { describe, expect, it, vi } from "vitest";

import type { OmieClient } from "./omie-client";
import { listParcelas, OmieParcelasService } from "./parcelas-service";

function mockClient(response: unknown) {
  return {
    call: vi.fn().mockResolvedValue(response)
  } as unknown as OmieClient;
}

describe("listParcelas", () => {
  it("chama ListarParcelas com paginacao", async () => {
    const client = mockClient({ cadastros: [] });

    await listParcelas(client, { pagina: 1, registros_por_pagina: 50 });

    expect(client.call).toHaveBeenCalledWith("/geral/parcelas/", "ListarParcelas", {
      pagina: 1,
      registros_por_pagina: 50,
      apenas_importado_api: "N"
    });
  });

  it("mapeia codigo (preservando zeros), descricao, dias e flags", async () => {
    const client = mockClient({
      cadastros: [
        {
          nCodigo: "000",
          cDescricao: "A Vista",
          nParcelas: 1,
          nDiasPrimeiraParcela: 0,
          cInativo: "N",
          cVisualizar: "S"
        },
        {
          nCodigo: "212",
          cDescricao: "7/14/21",
          nParcelas: 3,
          aparcela_dias: [7, 14, 21],
          cInativo: "S"
        }
      ]
    });

    const result = await listParcelas(client, { pagina: 1 });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      code: "000",
      description: "A Vista",
      installmentCount: 1,
      isActive: true,
      visible: true
    });
    expect(result[1]).toMatchObject({
      code: "212",
      description: "7/14/21",
      installmentCount: 3,
      installmentDays: [7, 14, 21],
      isActive: false
    });
  });

  it("descarta linhas sem codigo ou descricao", async () => {
    const client = mockClient({
      cadastros: [{ cDescricao: "Sem codigo" }, { nCodigo: "030" }]
    });

    expect(await listParcelas(client, { pagina: 1 })).toEqual([]);
  });
});

describe("OmieParcelasService.listAll", () => {
  it("pagina ate a resposta vir menor que o pageSize", async () => {
    const page1 = {
      cadastros: [
        { nCodigo: "001", cDescricao: "30" },
        { nCodigo: "002", cDescricao: "60" }
      ]
    };
    const page2 = { cadastros: [{ nCodigo: "003", cDescricao: "90" }] };
    const call = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const client = { call } as unknown as OmieClient;

    const result = await new OmieParcelasService(client).listAll(2);

    expect(result.map((parcela) => parcela.code)).toEqual(["001", "002", "003"]);
    expect(call).toHaveBeenCalledTimes(2);
  });
});
