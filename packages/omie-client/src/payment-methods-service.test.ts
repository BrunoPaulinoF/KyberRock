import { describe, expect, it, vi } from "vitest";

import type { OmieClient } from "./omie-client";
import { listPaymentMethods } from "./payment-methods-service";

function mockClient(response: unknown) {
  return {
    call: vi.fn().mockResolvedValue(response)
  } as unknown as OmieClient;
}

describe("listPaymentMethods", () => {
  it("calls ListarMeiosPagamento no endpoint de meios de pagamento", async () => {
    const client = mockClient({ meio_pagamento_cadastro: [] });

    await listPaymentMethods(client);

    expect(client.call).toHaveBeenCalledWith("/geral/meiospagamento/", "ListarMeiosPagamento", {
      codigo: ""
    });
  });

  it("mapeia codigo (preservando zeros a esquerda), descricao e tipo", async () => {
    const client = mockClient({
      meio_pagamento_cadastro: [
        { codigo: "01", descricao: "Dinheiro", tipo: "DIN" },
        { codigo: "17", descricao: "PIX" }
      ]
    });

    const result = await listPaymentMethods(client);

    expect(result).toEqual([
      { code: "01", description: "Dinheiro", type: "DIN" },
      { code: "17", description: "PIX", type: null }
    ]);
  });

  it("descarta entradas sem codigo ou descricao", async () => {
    const client = mockClient({
      meio_pagamento_cadastro: [
        { codigo: "", descricao: "Sem codigo" },
        { codigo: "15" },
        { codigo: "03", descricao: "Cartao de Credito" }
      ]
    });

    const result = await listPaymentMethods(client);

    expect(result).toEqual([{ code: "03", description: "Cartao de Credito", type: null }]);
  });

  it("aceita variacao de chave da lista na resposta", async () => {
    const client = mockClient({
      outra_chave_qualquer: [{ codigo: "04", descricao: "Cartao de Debito" }]
    });

    const result = await listPaymentMethods(client);

    expect(result).toEqual([{ code: "04", description: "Cartao de Debito", type: null }]);
  });
});
