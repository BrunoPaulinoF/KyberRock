import { describe, expect, it, vi } from "vitest";

import type { OmieClient } from "./omie-client";
import {
  OmieReceivablesService,
  listReceivables
} from "./receivables-service";

function mockClient(response: unknown) {
  return {
    call: vi.fn().mockResolvedValue(response)
  } as unknown as OmieClient;
}

describe("listReceivables", () => {
  it("calls ListarContasReceber with pagination", async () => {
    const client = mockClient({
      contaReceberCadastro: [],
      nRegistros: 0
    });

    await listReceivables(client, { pagina: 1, registrosPorPagina: 50 });

    expect(client.call).toHaveBeenCalledWith(
      "//financas/contareceber//",
      "ListarContasReceber",
      { pagina: 1, registrosPorPagina: 50 }
    );
  });

  it("returns formatted receivables", async () => {
    const client = mockClient({
      contaReceberCadastro: [
        {
          codigoLancamentoOmie: 123,
          codigoClienteOmie: 456,
          valorDocumento: 1000.5,
          dataVencimento: "2026-06-15",
          statusTitulo: "ABERTO"
        }
      ],
      nRegistros: 1
    });

    const result = await listReceivables(client, { pagina: 1 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 123,
      clientId: 456,
      amount: 1000.5,
      dueDate: "2026-06-15",
      status: "ABERTO"
    });
  });
});

describe("OmieReceivablesService", () => {
  it("calculates total open amount for a client", async () => {
    const client = mockClient({
      contaReceberCadastro: [
        {
          codigoLancamentoOmie: 1,
          codigoClienteOmie: 100,
          valorDocumento: 500,
          statusTitulo: "ABERTO"
        },
        {
          codigoLancamentoOmie: 2,
          codigoClienteOmie: 100,
          valorDocumento: 300,
          statusTitulo: "ABERTO"
        },
        {
          codigoLancamentoOmie: 3,
          codigoClienteOmie: 100,
          valorDocumento: 200,
          statusTitulo: "RECEBIDO"
        }
      ],
      nRegistros: 3
    });

    const service = new OmieReceivablesService(client);
    const total = await service.getTotalOpenAmountForClient(100);

    expect(total).toBe(800);
  });
});
