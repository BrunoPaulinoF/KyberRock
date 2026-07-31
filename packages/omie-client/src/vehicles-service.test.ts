import { describe, expect, it, vi } from "vitest";

import type { OmieClient } from "./omie-client";
import { listVehicles, normalizeOmiePlate, normalizePlateState, OmieVehiclesService } from "./vehicles-service";

function mockClient(response: unknown): OmieClient {
  return { call: vi.fn().mockResolvedValue(response) } as unknown as OmieClient;
}

describe("listVehicles", () => {
  it("chama ListarVeiculos com paginacao", async () => {
    const client = mockClient({ cadastros: [] });

    await listVehicles(client, { pagina: 1, registros_por_pagina: 50 });

    expect(client.call).toHaveBeenCalledWith("/transportador/veiculo/", "ListarVeiculos", {
      pagina: 1,
      registros_por_pagina: 50
    });
  });

  it("mapeia placa e UF nas duas grafias do OMIE", async () => {
    const client = mockClient({
      cadastros: [
        { nCodVeic: 11, cPlaca: "abc-1d23", cUF: "mg", cMarca: "Volvo", cModelo: "FH" },
        { codigo: 22, placa: "XYZ 4A56", uf: "SP", descricao: "Carreta", inativo: "S" }
      ]
    });

    const result = await listVehicles(client, { pagina: 1 });

    expect(result).toEqual([
      { id: 11, plate: "ABC1D23", plateState: "MG", description: "Volvo FH", isActive: true },
      { id: 22, plate: "XYZ4A56", plateState: "SP", description: "Carreta", isActive: false }
    ]);
  });

  it("descarta linha sem placa e UF invalida (campo fiscal)", async () => {
    const client = mockClient({
      cadastros: [
        { nCodVeic: 1, cPlaca: "  " },
        { nCodVeic: 2, cPlaca: "ABC1234", cUF: "Minas Gerais" }
      ]
    });

    const result = await listVehicles(client, { pagina: 1 });

    expect(result).toEqual([
      { id: 2, plate: "ABC1234", plateState: null, description: null, isActive: true }
    ]);
  });

  it("aceita a lista sob qualquer chave conhecida", async () => {
    const client = mockClient({ veiculo_cadastro: [{ nCodVeic: 3, cPlaca: "AAA1111", cUF: "RJ" }] });

    const result = await listVehicles(client, { pagina: 1 });

    expect(result).toHaveLength(1);
    expect(result[0].plateState).toBe("RJ");
  });
});

describe("OmieVehiclesService", () => {
  it("pagina ate a ultima pagina incompleta", async () => {
    const page1 = { cadastros: [{ nCodVeic: 1, cPlaca: "AAA1111", cUF: "MG" }] };
    const page2 = { cadastros: [] };
    const call = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const service = new OmieVehiclesService({ call } as unknown as OmieClient);

    const result = await service.listAll(1);

    expect(result).toHaveLength(1);
    expect(call).toHaveBeenCalledTimes(2);
  });
});

describe("normalizacao", () => {
  it("normaliza placa e UF", () => {
    expect(normalizeOmiePlate(" abc-1d23 ")).toBe("ABC1D23");
    expect(normalizeOmiePlate(null)).toBe("");
    expect(normalizePlateState(" mg ")).toBe("MG");
    expect(normalizePlateState("M1")).toBeNull();
    expect(normalizePlateState(undefined)).toBeNull();
  });
});
