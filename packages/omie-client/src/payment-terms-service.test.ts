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
  it("calls ListarCondicoesPagamento", async () => {
    const client = mockClient({
      condicoesPagamentoCadastro: [],
      nRegistros: 0
    });

    await listPaymentTerms(client, { pagina: 1 });

    expect(client.call).toHaveBeenCalledWith(
      "/geral/condicoespgto/",
      "ListarCondicoesPagamento",
      { pagina: 1 }
    );
  });

  it("returns formatted payment terms", async () => {
    const client = mockClient({
      condicoesPagamentoCadastro: [
        {
          codigoCondicaoPagamentoOmie: 789,
          descricaoCondicaoPagamento: "30/60/90 dias"
        }
      ],
      nRegistros: 1
    });

    const result = await listPaymentTerms(client, { pagina: 1 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 789,
      description: "30/60/90 dias"
    });
  });
});

describe("OmiePaymentTermsService", () => {
  it("lists all payment terms", async () => {
    const client = mockClient({
      condicoesPagamentoCadastro: [
        { codigoCondicaoPagamentoOmie: 1, descricaoCondicaoPagamento: "A vista" }
      ],
      nRegistros: 1
    });

    const service = new OmiePaymentTermsService(client);
    const terms = await service.listAll();

    expect(terms).toHaveLength(1);
    expect(client.call).toHaveBeenCalledWith(
      "/geral/condicoespgto/",
      "ListarCondicoesPagamento",
      expect.objectContaining({
        pagina: 1,
        registros_por_pagina: 100,
        apenas_importado_api: "N"
      })
    );
  });
});
