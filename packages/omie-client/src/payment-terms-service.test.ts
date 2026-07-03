import { describe, expect, it, vi } from "vitest";

import type { OmieClient } from "./omie-client";
import {
  listPaymentTerms,
  OmiePaymentTermsService
} from "./payment-terms-service";

function mockClient(response: unknown) {
  return {
    call: vi.fn().mockResolvedValue(response)
  } as unknown as OmieClient;
}

describe("listPaymentTerms", () => {
  it("calls ListarParcelas no endpoint /geral/parcelas/", async () => {
    const client = mockClient({
      cadastros: [],
      total_de_registros: 0
    });

    await listPaymentTerms(client, { pagina: 1 });

    expect(client.call).toHaveBeenCalledWith(
      "/geral/parcelas/",
      "ListarParcelas",
      { pagina: 1 }
    );
  });

  it("mapeia os campos do ListarParcelas (nCodigo, cDescricao, nParcelas)", async () => {
    const client = mockClient({
      cadastros: [
        {
          nCodigo: "000",
          cDescricao: "A vista",
          nParcelas: 1
        }
      ],
      total_de_registros: 1
    });

    const result = await listPaymentTerms(client, { pagina: 1 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 0,
      code: "000",
      description: "A vista",
      installmentCount: 1
    });
  });

  it("preserva zeros a esquerda do codigo da parcela", async () => {
    const client = mockClient({
      cadastros: [{ nCodigo: "030", cDescricao: "30 dias", nParcelas: 1 }],
      total_de_registros: 1
    });

    const [term] = await listPaymentTerms(client, { pagina: 1 });

    expect(term.code).toBe("030");
    expect(term.id).toBe(30);
  });
});

describe("OmiePaymentTermsService", () => {
  it("lists all payment terms", async () => {
    const client = mockClient({
      cadastros: [{ nCodigo: "000", cDescricao: "A vista", nParcelas: 1 }],
      total_de_registros: 1
    });

    const service = new OmiePaymentTermsService(client);
    const terms = await service.listAll();

    expect(terms).toHaveLength(1);
    expect(client.call).toHaveBeenCalledWith(
      "/geral/parcelas/",
      "ListarParcelas",
      expect.objectContaining({
        pagina: 1,
        registros_por_pagina: 100,
        apenas_importado_api: "N"
      })
    );
  });
});
