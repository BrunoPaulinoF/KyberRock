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
      produto_servico_cadastro: [],
      nRegistros: 0
    });

    await listProducts(client, { pagina: 1, registrosPorPagina: 50 });

    expect(client.call).toHaveBeenCalledWith(
      "/api/v1/geral/produtos/",
      "ListarProdutos",
      { pagina: 1, registrosPorPagina: 50 }
    );
  });

  it("returns formatted products with active flag", async () => {
    const client = mockClient({
      produto_servico_cadastro: [
        {
          codigo_produto: 456,
          descricao: "Brita 0",
          codigo: "BRITA0",
          valor_unitario: 150.0,
          inativo: "N"
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
      unitPrice: 150.0,
      unitPriceCents: 15000,
      isActive: true,
      blocked: false
    });
  });

  it("maps all OMIE attributes (family, brand, dimensions, fiscal)", async () => {
    const client = mockClient({
      produto_servico_cadastro: [
        {
          codigo_produto: 789,
          codigo_produto_integracao: "INT-789",
          codigo: "BRITA1",
          descricao: "Brita 1",
          descr_detalhada: "Brita 1 - 19mm",
          unidade: "M3",
          ncm: "25171000",
          ean: "7891234567890",
          valor_unitario: 95.5,
          codigo_familia: 10,
          descricao_familia: "Britas",
          marca: "Pedreira X",
          modelo: "M1",
          obs_internas: "Estoque baixo",
          peso_bruto: 1600,
          peso_liq: 1580,
          altura: 0.5,
          largura: 1.2,
          profundidade: 0.8,
          cest: "0102000",
          tipoItem: "00",
          inativo: "N",
          bloqueado: "N",
          recomendacoes_fiscais: { origem_mercadoria: "0", cfop: "5102" }
        }
      ]
    });

    const result = await listProducts(client, { pagina: 1 });

    expect(result[0]).toMatchObject({
      id: 789,
      integrationCode: "INT-789",
      code: "BRITA1",
      description: "Brita 1",
      detailedDescription: "Brita 1 - 19mm",
      unit: "M3",
      ncm: "25171000",
      ean: "7891234567890",
      unitPriceCents: 9550,
      familyCode: "10",
      familyDescription: "Britas",
      brand: "Pedreira X",
      model: "M1",
      internalNotes: "Estoque baixo",
      grossWeightKg: 1600,
      netWeightKg: 1580,
      heightM: 0.5,
      widthM: 1.2,
      depthM: 0.8,
      cest: "0102000",
      itemType: "00",
      icmsOrigin: "0",
      isActive: true,
      blocked: false,
      fiscalRecommendations: { origem_mercadoria: "0", cfop: "5102" }
    });
  });

  it("marks inactive and blocked products from OMIE flags", async () => {
    const client = mockClient({
      produto_servico_cadastro: [
        {
          codigo_produto: 1,
          descricao: "Inativo",
          codigo: "INA",
          inativo: "S",
          bloqueado: "S"
        }
      ]
    });

    const result = await listProducts(client, { pagina: 1 });

    expect(result[0]).toMatchObject({ isActive: false, blocked: true });
  });
});

describe("OmieProductsService", () => {
  it("lists all products across pages with verbose params", async () => {
    const client = mockClient({
      produto_servico_cadastro: [
        {
          codigo_produto: 1,
          descricao: "Brita",
          codigo: "B1",
          valor_unitario: 100,
          inativo: "N"
        }
      ],
      nRegistros: 1
    });

    const service = new OmieProductsService(client);
    const products = await service.listAll();

    expect(products).toHaveLength(1);
    expect(client.call).toHaveBeenCalledWith(
      "/api/v1/geral/produtos/",
      "ListarProdutos",
      expect.objectContaining({
        pagina: 1,
        apenasImportadoApi: "N",
        filtrarApenasOmiepdv: "N",
        exibirCaracteristicas: "N",
        exibirObs: "S"
      })
    );
  });
});
