import { describe, expect, it, vi } from "vitest";

import type { OmieClient } from "./omie-client";
import { listAccountsPayable, OmieAccountsPayableService } from "./accounts-payable-service";

function mockClient(response: unknown) {
  return {
    call: vi.fn().mockResolvedValue(response)
  } as unknown as OmieClient;
}

describe("listAccountsPayable", () => {
  it("chama ListarContasPagar com paginacao", async () => {
    const client = mockClient({ conta_pagar_cadastro: [] });

    await listAccountsPayable(client, { pagina: 1, registros_por_pagina: 100 });

    expect(client.call).toHaveBeenCalledWith("/financas/contapagar/", "ListarContasPagar", {
      pagina: 1,
      registros_por_pagina: 100,
      apenas_importado_api: "N"
    });
  });

  it("mapeia apenas os campos essenciais e calcula o status", async () => {
    const client = mockClient({
      conta_pagar_cadastro: [
        {
          codigo_lancamento_omie: 1001,
          codigo_cliente_fornecedor: 55,
          numero_documento: "NF-123",
          data_vencimento: "01/01/2020",
          valor_documento: 1500,
          valor_pago: 0,
          observacao: "detalhe interno irrelevante"
        },
        {
          codigo_lancamento_omie: 1002,
          codigo_cliente_fornecedor: 56,
          data_vencimento: "31/12/2099",
          valor_documento: 200,
          valor_pago: 200
        },
        {
          codigo_lancamento_omie: 1003,
          codigo_cliente_fornecedor: 57,
          data_vencimento: "31/12/2099",
          valor_documento: 500,
          valor_pago: 100
        }
      ]
    });

    const result = await listAccountsPayable(client, { pagina: 1 });

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      id: 1001,
      supplierOmieCode: 55,
      documentNumber: "NF-123",
      dueDate: "2020-01-01",
      amountCents: 150000,
      status: "overdue"
    });
    expect(result[1].status).toBe("paid");
    expect(result[2]).toMatchObject({ status: "partial", paidAmountCents: 10000 });
  });

  it("descarta linhas sem codigo_lancamento_omie", async () => {
    const client = mockClient({ conta_pagar_cadastro: [{ valor_documento: 10 }] });

    expect(await listAccountsPayable(client, { pagina: 1 })).toEqual([]);
  });
});

describe("OmieAccountsPayableService.listByDueDateRange", () => {
  it("pagina e filtra pelo intervalo de vencimento pedido", async () => {
    const page1 = {
      conta_pagar_cadastro: [
        { codigo_lancamento_omie: 1, data_vencimento: "05/07/2026", valor_documento: 10 },
        { codigo_lancamento_omie: 2, data_vencimento: "10/08/2026", valor_documento: 20 }
      ]
    };
    const page2 = { conta_pagar_cadastro: [] };
    const call = vi.fn().mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
    const client = { call } as unknown as OmieClient;

    const result = await new OmieAccountsPayableService(client).listByDueDateRange(
      "2026-07-01",
      "2026-07-31",
      2
    );

    expect(result.map((item) => item.id)).toEqual([1]);
    expect(call).toHaveBeenCalledWith(
      "/financas/contapagar/",
      "ListarContasPagar",
      expect.objectContaining({
        filtrar_por_data_de: "01/07/2026",
        filtrar_por_data_ate: "31/07/2026"
      })
    );
  });
});
